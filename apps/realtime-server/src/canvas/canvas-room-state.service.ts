import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasLoadedViewportBounds,
  CanvasCheckpointSyncOperation,
  CanvasRoomLoadedRegion,
  CanvasRoomRef,
} from "./canvas-types";

const MAX_ROOM_LOADED_REGIONS = 64;
const MAX_ROOM_CACHED_SHAPES = 2_000;

type CachedRoomShape = {
  cachedAt: string;
  shape: Record<string, unknown>;
};

export type CanvasRoomCheckpointSnapshot = {
  operations: CanvasCheckpointSyncOperation[];
};

export type CanvasRoomStateService = {
  applyShapePatch: (
    room: CanvasRoomRef,
    patch: { deletedShapeIds: string[]; upsertShapes: Record<string, unknown>[] },
  ) => void;
  getCachedShapes: (room: CanvasRoomRef) => Record<string, unknown>[];
  getCheckpointSnapshot: (room: CanvasRoomRef) => CanvasRoomCheckpointSnapshot;
  getDeletedTombstones: (room: CanvasRoomRef) => string[];
  getDirtyShapeIds: (room: CanvasRoomRef) => string[];
  getLoadedRegions: (room: CanvasRoomRef) => CanvasRoomLoadedRegion[];
  recordLoadedViewport: (
    room: CanvasRoomRef,
    bounds: CanvasLoadedViewportBounds,
    shapes?: Record<string, unknown>[],
  ) => CanvasRoomLoadedRegion[];
  markCheckpointSucceeded: (
    room: CanvasRoomRef,
    operations: CanvasCheckpointSyncOperation[],
  ) => void;
};

function isCoveringRegion(
  region: CanvasRoomLoadedRegion,
  bounds: CanvasLoadedViewportBounds,
) {
  const left = bounds.x - bounds.margin;
  const top = bounds.y - bounds.margin;
  const right = bounds.x + bounds.width + bounds.margin;
  const bottom = bounds.y + bounds.height + bounds.margin;

  return (
    region.left <= left &&
    region.top <= top &&
    region.right >= right &&
    region.bottom >= bottom
  );
}

function createLoadedRegion(
  room: CanvasRoomRef,
  bounds: CanvasLoadedViewportBounds,
): CanvasRoomLoadedRegion {
  const left = bounds.x - bounds.margin;
  const top = bounds.y - bounds.margin;
  const right = bounds.x + bounds.width + bounds.margin;
  const bottom = bounds.y + bounds.height + bounds.margin;

  return {
    bottom,
    id: `${room.workspaceId}:${room.canvasId}:${Math.round(left)}:${Math.round(top)}:${Math.round(right)}:${Math.round(bottom)}`,
    left,
    loadedAt: new Date().toISOString(),
    right,
    top,
  };
}

export function createCanvasRoomStateService(): CanvasRoomStateService {
  const loadedRegionsByRoom = new Map<string, CanvasRoomLoadedRegion[]>();
  const deletedTombstonesByRoom = new Map<string, Map<string, number | null>>();
  const dirtyShapeIdsByRoom = new Map<string, Set<string>>();
  const shapesByRoom = new Map<string, Map<string, CachedRoomShape>>();

  function getRoomShapeCache(roomName: string) {
    let shapeCache = shapesByRoom.get(roomName);

    if (!shapeCache) {
      shapeCache = new Map<string, CachedRoomShape>();
      shapesByRoom.set(roomName, shapeCache);
    }

    return shapeCache;
  }

  function getRoomShapeIdSet(map: Map<string, Set<string>>, roomName: string) {
    let shapeIds = map.get(roomName);

    if (!shapeIds) {
      shapeIds = new Set<string>();
      map.set(roomName, shapeIds);
    }

    return shapeIds;
  }

  function getRoomTombstones(roomName: string) {
    let tombstones = deletedTombstonesByRoom.get(roomName);

    if (!tombstones) {
      tombstones = new Map<string, number | null>();
      deletedTombstonesByRoom.set(roomName, tombstones);
    }

    return tombstones;
  }

  function readShapeRevision(shape: Record<string, unknown> | undefined) {
    const revision = shape?.revision;

    return typeof revision === "number" && Number.isInteger(revision) && revision > 0
      ? revision
      : null;
  }

  function createCheckpointOperationId(type: string, shapeId: string) {
    return `checkpoint:${type}:${shapeId}:${Date.now()}`;
  }

  function resolveParentShapeId(parentId: unknown) {
    if (typeof parentId !== "string") return null;
    if (!parentId.startsWith("shape:")) return null;

    const shapeId = parentId.slice("shape:".length).trim();

    return shapeId || null;
  }

  function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  function readFiniteNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function readNullableSize(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  }

  function readRichTextPlainText(value: unknown) {
    const richText = readRecord(value);
    const content = richText.content;

    if (!Array.isArray(content)) return null;

    const text = content
      .flatMap((node) => {
        if (!readRecord(node)) return [];
        const paragraph = node as Record<string, unknown>;
        const children = paragraph.content;

        return Array.isArray(children)
          ? children.flatMap((child) => {
              const textNode = readRecord(child);
              const childText = textNode.text;

              return typeof childText === "string" ? [childText] : [];
            })
          : [];
      })
      .join("\n")
      .trim();

    return text || null;
  }

  function toCanvasShapePayload(shape: Record<string, unknown>, zIndex: number) {
    const props = readRecord(shape.props);
    const title =
      typeof props.name === "string"
        ? props.name
        : typeof props.fileName === "string"
          ? props.fileName
          : null;
    const textContent =
      typeof props.text === "string"
        ? props.text
        : typeof props.code === "string"
          ? props.code
          : readRichTextPlainText(props.richText);

    return {
      height: readNullableSize(props.h),
      id: typeof shape.id === "string" ? shape.id : "",
      parentShapeId: resolveParentShapeId(shape.parentId),
      rawShape: shape,
      rotation: readFiniteNumber(shape.rotation, 0),
      shapeType: typeof shape.type === "string" ? shape.type : "",
      textContent,
      title,
      width: readNullableSize(props.w),
      x: readFiniteNumber(shape.x, 0),
      y: readFiniteNumber(shape.y, 0),
      zIndex,
    };
  }

  function upsertRoomShapes(
    roomName: string,
    shapes: Record<string, unknown>[],
    options: { markDirty: boolean },
  ) {
    if (!shapes.length) return;

    const shapeCache = getRoomShapeCache(roomName);
    const cachedAt = new Date().toISOString();

    shapes.forEach((shape) => {
      const shapeId = typeof shape.id === "string" ? shape.id.trim() : "";

      if (!shapeId) return;
      shapeCache.set(shapeId, { cachedAt, shape });
      getRoomTombstones(roomName).delete(shapeId);
      if (options.markDirty) {
        getRoomShapeIdSet(dirtyShapeIdsByRoom, roomName).add(shapeId);
      }
    });

    if (shapeCache.size <= MAX_ROOM_CACHED_SHAPES) return;

    const staleShapeIds = Array.from(shapeCache.entries())
      .sort(([, left], [, right]) => left.cachedAt.localeCompare(right.cachedAt))
      .slice(0, shapeCache.size - MAX_ROOM_CACHED_SHAPES)
      .map(([shapeId]) => shapeId);

    staleShapeIds.forEach((shapeId) => {
      shapeCache.delete(shapeId);
    });
  }

  return {
    applyShapePatch(room, patch) {
      const roomName = createCanvasRoomName(room);

      upsertRoomShapes(roomName, patch.upsertShapes, { markDirty: true });

      if (!patch.deletedShapeIds.length) return;

      const shapeCache = getRoomShapeCache(roomName);
      const deletedTombstones = getRoomTombstones(roomName);
      const dirtyShapeIds = getRoomShapeIdSet(dirtyShapeIdsByRoom, roomName);

      patch.deletedShapeIds.forEach((shapeId) => {
        const normalizedShapeId = shapeId.trim();

        if (!normalizedShapeId) return;
        const deletedShape = shapeCache.get(normalizedShapeId)?.shape;

        shapeCache.delete(normalizedShapeId);
        deletedTombstones.set(normalizedShapeId, readShapeRevision(deletedShape));
        dirtyShapeIds.add(normalizedShapeId);
      });
    },

    getCachedShapes(room) {
      const shapeCache = shapesByRoom.get(createCanvasRoomName(room));

      return shapeCache ? Array.from(shapeCache.values(), ({ shape }) => shape) : [];
    },

    getCheckpointSnapshot(room) {
      const roomName = createCanvasRoomName(room);
      const shapeCache = shapesByRoom.get(roomName) ?? new Map();
      const dirtyShapeIds = dirtyShapeIdsByRoom.get(roomName) ?? new Set();
      const deletedTombstones =
        deletedTombstonesByRoom.get(roomName) ?? new Map();
      const operations: CanvasCheckpointSyncOperation[] = [];

      Array.from(dirtyShapeIds).forEach((shapeId) => {
        const deletedBaseRevision = deletedTombstones.get(shapeId);

        if (deletedTombstones.has(shapeId)) {
          operations.push({
            baseRevision: deletedBaseRevision ?? null,
            clientOperationId: createCheckpointOperationId("delete", shapeId),
            shapeId,
            type: "delete",
          });
          return;
        }

        const shape = shapeCache.get(shapeId)?.shape;

        if (!shape) return;

        const revision = readShapeRevision(shape);

        operations.push({
          baseRevision: revision,
          clientOperationId: createCheckpointOperationId(
            revision === null ? "create" : "update",
            shapeId,
          ),
          payload: toCanvasShapePayload(shape, operations.length),
          shapeId,
          type: revision === null ? "create" : "update",
        });
      });

      return { operations };
    },

    getDeletedTombstones(room) {
      return Array.from(
        deletedTombstonesByRoom.get(createCanvasRoomName(room))?.keys() ?? [],
      );
    },

    getDirtyShapeIds(room) {
      return Array.from(dirtyShapeIdsByRoom.get(createCanvasRoomName(room)) ?? []);
    },

    getLoadedRegions(room) {
      return loadedRegionsByRoom.get(createCanvasRoomName(room)) ?? [];
    },

    recordLoadedViewport(room, bounds, shapes = []) {
      const roomName = createCanvasRoomName(room);
      const currentRegions = loadedRegionsByRoom.get(roomName) ?? [];

      upsertRoomShapes(roomName, shapes, { markDirty: false });

      if (currentRegions.some((region) => isCoveringRegion(region, bounds))) {
        return currentRegions;
      }

      const nextRegions = [...currentRegions, createLoadedRegion(room, bounds)]
        .sort((left, right) => left.loadedAt.localeCompare(right.loadedAt))
        .slice(-MAX_ROOM_LOADED_REGIONS);

      loadedRegionsByRoom.set(roomName, nextRegions);
      return nextRegions;
    },

    markCheckpointSucceeded(room, operations) {
      const roomName = createCanvasRoomName(room);
      const dirtyShapeIds = dirtyShapeIdsByRoom.get(roomName);
      const deletedTombstones = deletedTombstonesByRoom.get(roomName);

      operations.forEach((operation) => {
        dirtyShapeIds?.delete(operation.shapeId);
        if (operation.type === "delete") {
          deletedTombstones?.delete(operation.shapeId);
        }
      });
    },
  };
}
