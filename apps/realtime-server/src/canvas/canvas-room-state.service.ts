import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasLoadedViewportBounds,
  CanvasCheckpointSyncOperation,
  CanvasRoomHistoryAction,
  CanvasRoomHistoryItem,
  CanvasRoomLoadedRegion,
  CanvasRoomRef,
} from "./canvas-types";

const MAX_ROOM_LOADED_REGIONS = 64;
const MAX_ROOM_CACHED_SHAPES = 2_000;
const MAX_ROOM_HISTORY_ITEMS = 200;

type CachedRoomShape = {
  cachedAt: string;
  shape: Record<string, unknown>;
};

export type CanvasRoomCheckpointSnapshot = {
  operations: CanvasCheckpointSyncOperation[];
};

export type CanvasRoomCheckpointState = {
  checkpointHistorySeq: number | null;
  checkpointVersion: number;
  historySeq: number;
};

export type CanvasRoomHistoryState = {
  canRedo: boolean;
  canUndo: boolean;
  historySeq: number;
};

export type CanvasRoomHistoryPatch = {
  canRedo: boolean;
  canUndo: boolean;
  deletedShapeIds: string[];
  historySeq: number;
  upsertShapes: Record<string, unknown>[];
};

export type CanvasRoomStateStats = {
  cachedShapeCount: number;
  deletedTombstoneCount: number;
  dirtyShapeCount: number;
  historyItemCount: number;
  loadedRegionCount: number;
  redoHistoryItemCount: number;
  roomCount: number;
};

export type CanvasRoomStateService = {
  applyShapePatch: (
    room: CanvasRoomRef,
    patch: { deletedShapeIds: string[]; upsertShapes: Record<string, unknown>[] },
    options?: { actorUserId?: string | null },
  ) => void;
  getCachedShapes: (room: CanvasRoomRef) => Record<string, unknown>[];
  getCheckpointSnapshot: (room: CanvasRoomRef) => CanvasRoomCheckpointSnapshot;
  getCheckpointState: (room: CanvasRoomRef) => CanvasRoomCheckpointState;
  getDeletedTombstones: (room: CanvasRoomRef) => string[];
  getDirtyShapeIds: (room: CanvasRoomRef) => string[];
  getHistoryState: (room: CanvasRoomRef) => CanvasRoomHistoryState;
  getLoadedRegions: (room: CanvasRoomRef) => CanvasRoomLoadedRegion[];
  getStats: () => CanvasRoomStateStats;
  recordLoadedViewport: (
    room: CanvasRoomRef,
    bounds: CanvasLoadedViewportBounds,
    shapes?: Record<string, unknown>[],
  ) => CanvasRoomLoadedRegion[];
  markCheckpointSucceeded: (
    room: CanvasRoomRef,
    operations: CanvasCheckpointSyncOperation[],
    result?: unknown,
    options?: { advanceCheckpoint?: boolean },
  ) => void;
  redoLastHistory: (
    room: CanvasRoomRef,
    options?: { actorUserId?: string | null },
  ) => CanvasRoomHistoryPatch | null;
  undoLastHistory: (
    room: CanvasRoomRef,
    options?: { actorUserId?: string | null },
  ) => CanvasRoomHistoryPatch | null;
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

function doRegionsOverlap(
  leftRegion: CanvasRoomLoadedRegion,
  rightRegion: CanvasRoomLoadedRegion,
) {
  return (
    leftRegion.left <= rightRegion.right &&
    leftRegion.right >= rightRegion.left &&
    leftRegion.top <= rightRegion.bottom &&
    leftRegion.bottom >= rightRegion.top
  );
}

function mergeLoadedRegions(
  regions: CanvasRoomLoadedRegion[],
  nextRegion: CanvasRoomLoadedRegion,
) {
  const mergedRegion = { ...nextRegion };
  const remainingRegions: CanvasRoomLoadedRegion[] = [];

  regions.forEach((region) => {
    if (!doRegionsOverlap(region, mergedRegion)) {
      remainingRegions.push(region);
      return;
    }

    mergedRegion.bottom = Math.max(mergedRegion.bottom, region.bottom);
    mergedRegion.left = Math.min(mergedRegion.left, region.left);
    mergedRegion.loadedAt =
      region.loadedAt < mergedRegion.loadedAt ? region.loadedAt : mergedRegion.loadedAt;
    mergedRegion.right = Math.max(mergedRegion.right, region.right);
    mergedRegion.top = Math.min(mergedRegion.top, region.top);
  });

  return [...remainingRegions, mergedRegion]
    .sort((left, right) => left.loadedAt.localeCompare(right.loadedAt))
    .slice(-MAX_ROOM_LOADED_REGIONS);
}

export function createCanvasRoomStateService(): CanvasRoomStateService {
  let checkpointOperationSequence = 0;
  const loadedRegionsByRoom = new Map<string, CanvasRoomLoadedRegion[]>();
  const deletedTombstonesByRoom = new Map<string, Map<string, number | null>>();
  const dirtyShapeIdsByRoom = new Map<string, Set<string>>();
  const checkpointOperationIdsByRoom = new Map<string, Map<string, string>>();
  const checkpointHistorySeqByRoom = new Map<string, number | null>();
  const checkpointVersionByRoom = new Map<string, number>();
  const historyByRoom = new Map<string, CanvasRoomHistoryItem[]>();
  const historySeqByRoom = new Map<string, number>();
  const redoHistoryByRoom = new Map<string, CanvasRoomHistoryItem[]>();
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

  function readShapeContentHash(shape: Record<string, unknown> | undefined) {
    return typeof shape?.contentHash === "string" && shape.contentHash
      ? shape.contentHash
      : null;
  }

  function cloneShapeRecord(shape: Record<string, unknown> | null | undefined) {
    if (!shape) return null;

    try {
      return JSON.parse(JSON.stringify(shape)) as Record<string, unknown>;
    } catch {
      return { ...shape };
    }
  }

  function areShapeRecordsEqual(
    left: Record<string, unknown> | null | undefined,
    right: Record<string, unknown> | null | undefined,
  ) {
    if (!left && !right) return true;
    if (!left || !right) return false;

    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return left === right;
    }
  }

  function getNextHistorySeq(roomName: string) {
    const nextSeq = (historySeqByRoom.get(roomName) ?? 0) + 1;

    historySeqByRoom.set(roomName, nextSeq);
    return nextSeq;
  }

  function pushRoomHistoryItem(
    roomName: string,
    item: Omit<CanvasRoomHistoryItem, "createdAt" | "id" | "seq">,
    options: { clearRedo?: boolean } = {},
  ) {
    const seq = getNextHistorySeq(roomName);
    const historyItem: CanvasRoomHistoryItem = {
      ...item,
      createdAt: new Date().toISOString(),
      id: `${roomName}:history:${seq}`,
      seq,
    };
    const history = historyByRoom.get(roomName) ?? [];

    history.push(historyItem);
    historyByRoom.set(roomName, history.slice(-MAX_ROOM_HISTORY_ITEMS));
    if (options.clearRedo ?? true) {
      redoHistoryByRoom.delete(roomName);
    }
  }

  function recordRoomHistoryChange({
    action,
    actorUserId,
    after,
    before,
    roomName,
    shapeId,
  }: {
    action: CanvasRoomHistoryAction;
    actorUserId: string;
    after: Record<string, unknown> | null;
    before: Record<string, unknown> | null;
    roomName: string;
    shapeId: string;
  }) {
    if (areShapeRecordsEqual(before, after)) return;

    pushRoomHistoryItem(roomName, {
      action,
      actorUserId,
      after: cloneShapeRecord(after),
      before: cloneShapeRecord(before),
      shapeId,
    });
  }

  function buildHistoryPatchFromState(roomName: string) {
    return {
      canRedo: Boolean(redoHistoryByRoom.get(roomName)?.length),
      canUndo: Boolean(historyByRoom.get(roomName)?.length),
      historySeq: historySeqByRoom.get(roomName) ?? 0,
    };
  }

  function applyHistoryPatch(
    roomName: string,
    patch: { deletedShapeIds: string[]; upsertShapes: Record<string, unknown>[] },
  ) {
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
      invalidateCheckpointOperationIds(roomName, normalizedShapeId);
      dirtyShapeIds.add(normalizedShapeId);
    });
  }

  function createUndoPatch(historyItem: CanvasRoomHistoryItem) {
    if (historyItem.action === "create") {
      return {
        deletedShapeIds: [historyItem.shapeId],
        upsertShapes: [],
      };
    }

    if (!historyItem.before) {
      return {
        deletedShapeIds: [historyItem.shapeId],
        upsertShapes: [],
      };
    }

    return {
      deletedShapeIds: [],
      upsertShapes: [cloneShapeRecord(historyItem.before) ?? historyItem.before],
    };
  }

  function createRedoPatch(historyItem: CanvasRoomHistoryItem) {
    if (historyItem.action === "delete") {
      return {
        deletedShapeIds: [historyItem.shapeId],
        upsertShapes: [],
      };
    }

    if (!historyItem.after) {
      return {
        deletedShapeIds: [historyItem.shapeId],
        upsertShapes: [],
      };
    }

    return {
      deletedShapeIds: [],
      upsertShapes: [cloneShapeRecord(historyItem.after) ?? historyItem.after],
    };
  }

  function getRoomCheckpointOperationIds(roomName: string) {
    let operationIds = checkpointOperationIdsByRoom.get(roomName);

    if (!operationIds) {
      operationIds = new Map<string, string>();
      checkpointOperationIdsByRoom.set(roomName, operationIds);
    }

    return operationIds;
  }

  function createCheckpointOperationId(
    roomName: string,
    type: string,
    shapeId: string,
  ) {
    const operationIds = getRoomCheckpointOperationIds(roomName);
    const operationKey = `${type}:${shapeId}`;
    const currentOperationId = operationIds.get(operationKey);

    if (currentOperationId) return currentOperationId;

    checkpointOperationSequence += 1;
    const nextOperationId =
      `checkpoint:${type}:${shapeId}:${Date.now()}:${checkpointOperationSequence}`;

    operationIds.set(operationKey, nextOperationId);
    return nextOperationId;
  }

  function clearCheckpointOperationIds(roomName: string, shapeId: string) {
    const operationIds = checkpointOperationIdsByRoom.get(roomName);

    if (!operationIds) return;

    operationIds.delete(`create:${shapeId}`);
    operationIds.delete(`update:${shapeId}`);
    operationIds.delete(`delete:${shapeId}`);

    if (!operationIds.size) {
      checkpointOperationIdsByRoom.delete(roomName);
    }
  }

  function invalidateCheckpointOperationIds(roomName: string, shapeId: string) {
    clearCheckpointOperationIds(roomName, shapeId);
  }

  function isCurrentCheckpointOperation(
    roomName: string,
    operation: CanvasCheckpointSyncOperation,
  ) {
    return (
      checkpointOperationIdsByRoom
        .get(roomName)
        ?.get(`${operation.type}:${operation.shapeId}`) ===
      operation.clientOperationId
    );
  }

  function unwrapApiResponseData(value: unknown) {
    const response = readRecord(value);

    return response.success === true && "data" in response
      ? response.data
      : value;
  }

  function readPersistedShapeMetadata(value: unknown) {
    const shape = readRecord(value);
    const id = shape.id;
    const revision = readShapeRevision(shape);
    const contentHash = readShapeContentHash(shape);

    if (typeof id !== "string" || !id.trim() || revision === null) {
      return null;
    }

    return {
      contentHash,
      revision,
      shapeId: id,
    };
  }

  function readPersistedShapeMetadataById(result: unknown) {
    const data = readRecord(unwrapApiResponseData(result));
    const shapes = Array.isArray(data.shapes) ? data.shapes : [];
    const metadataById = new Map<
      string,
      { contentHash: string | null; revision: number; shapeId: string }
    >();

    shapes.forEach((shape) => {
      const metadata = readPersistedShapeMetadata(shape);

      if (metadata) {
        metadataById.set(metadata.shapeId, metadata);
      }
    });

    return metadataById;
  }

  function applyPersistedShapeMetadata(
    shapeCache: Map<string, CachedRoomShape>,
    shapeId: string,
    metadata:
      | { contentHash: string | null; revision: number; shapeId: string }
      | undefined,
  ) {
    if (!metadata) return;

    const cachedShape = shapeCache.get(shapeId);

    if (!cachedShape) return;

    const nextShape: Record<string, unknown> = {
      ...cachedShape.shape,
      revision: metadata.revision,
    };

    if (metadata.contentHash) {
      nextShape.contentHash = metadata.contentHash;
    } else {
      delete nextShape.contentHash;
    }

    shapeCache.set(shapeId, {
      cachedAt: cachedShape.cachedAt,
      shape: nextShape,
    });
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
    const rawShape = { ...shape };

    delete rawShape.contentHash;
    delete rawShape.revision;

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
      rawShape,
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
    const tombstones = getRoomTombstones(roomName);

    shapes.forEach((shape) => {
      const shapeId = typeof shape.id === "string" ? shape.id.trim() : "";

      if (!shapeId) return;
      if (!options.markDirty && tombstones.has(shapeId)) return;

      const currentShape = shapeCache.get(shapeId)?.shape;
      const nextShape = { ...shape };

      if (readShapeRevision(nextShape) === null) {
        const currentRevision = readShapeRevision(currentShape);

        if (currentRevision !== null) {
          nextShape.revision = currentRevision;
        }
      }

      if (readShapeContentHash(nextShape) === null) {
        const currentContentHash = readShapeContentHash(currentShape);

        if (currentContentHash) {
          nextShape.contentHash = currentContentHash;
        }
      }

      shapeCache.set(shapeId, { cachedAt, shape: nextShape });
      if (options.markDirty) {
        tombstones.delete(shapeId);
        invalidateCheckpointOperationIds(roomName, shapeId);
        getRoomShapeIdSet(dirtyShapeIdsByRoom, roomName).add(shapeId);
      }
    });

    evictStaleCleanRoomShapes(roomName, shapeCache);
  }

  function evictStaleCleanRoomShapes(
    roomName: string,
    shapeCache: Map<string, CachedRoomShape>,
  ) {
    if (shapeCache.size <= MAX_ROOM_CACHED_SHAPES) return;

    const dirtyShapeIds = dirtyShapeIdsByRoom.get(roomName) ?? new Set();
    const deletedTombstones = deletedTombstonesByRoom.get(roomName) ?? new Map();
    const evictionCount = shapeCache.size - MAX_ROOM_CACHED_SHAPES;
    const staleShapeIds = Array.from(shapeCache.entries())
      .filter(
        ([shapeId]) =>
          !dirtyShapeIds.has(shapeId) && !deletedTombstones.has(shapeId),
      )
      .sort(([, left], [, right]) => left.cachedAt.localeCompare(right.cachedAt))
      .slice(0, evictionCount)
      .map(([shapeId]) => shapeId);

    staleShapeIds.forEach((shapeId) => {
      shapeCache.delete(shapeId);
    });
  }

  function sumMapSizes<T>(map: Map<string, Map<string, T> | Set<string>>) {
    return Array.from(map.values()).reduce((sum, value) => sum + value.size, 0);
  }

  function sumArrayMapLengths<T>(map: Map<string, T[]>) {
    return Array.from(map.values()).reduce(
      (sum, value) => sum + value.length,
      0,
    );
  }

  return {
    applyShapePatch(room, patch, options = {}) {
      const roomName = createCanvasRoomName(room);
      const actorUserId = options.actorUserId?.trim() || "unknown";
      const shapeCache = getRoomShapeCache(roomName);

      patch.upsertShapes.forEach((shape) => {
        const shapeId = typeof shape.id === "string" ? shape.id.trim() : "";

        if (!shapeId) return;

        const before = cloneShapeRecord(shapeCache.get(shapeId)?.shape);
        const after = cloneShapeRecord(shape);

        recordRoomHistoryChange({
          action: before ? "update" : "create",
          actorUserId,
          after,
          before,
          roomName,
          shapeId,
        });
      });

      upsertRoomShapes(roomName, patch.upsertShapes, { markDirty: true });

      if (!patch.deletedShapeIds.length) return;

      const deletedTombstones = getRoomTombstones(roomName);
      const dirtyShapeIds = getRoomShapeIdSet(dirtyShapeIdsByRoom, roomName);

      patch.deletedShapeIds.forEach((shapeId) => {
        const normalizedShapeId = shapeId.trim();

        if (!normalizedShapeId) return;
        const deletedShape = shapeCache.get(normalizedShapeId)?.shape;

        recordRoomHistoryChange({
          action: "delete",
          actorUserId,
          after: null,
          before: cloneShapeRecord(deletedShape),
          roomName,
          shapeId: normalizedShapeId,
        });

        shapeCache.delete(normalizedShapeId);
        deletedTombstones.set(normalizedShapeId, readShapeRevision(deletedShape));
        invalidateCheckpointOperationIds(roomName, normalizedShapeId);
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
        if (deletedTombstones.has(shapeId)) {
          operations.push({
            baseRevision: null,
            clientOperationId: createCheckpointOperationId(
              roomName,
              "delete",
              shapeId,
            ),
            shapeId,
            type: "delete",
          });
          return;
        }

        const shape = shapeCache.get(shapeId)?.shape;

        if (!shape) return;

        const revision = readShapeRevision(shape);

        operations.push({
          baseRevision: null,
          clientOperationId: createCheckpointOperationId(
            roomName,
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

    getCheckpointState(room) {
      const roomName = createCanvasRoomName(room);

      return {
        checkpointHistorySeq: checkpointHistorySeqByRoom.get(roomName) ?? null,
        checkpointVersion: checkpointVersionByRoom.get(roomName) ?? 0,
        historySeq: historySeqByRoom.get(roomName) ?? 0,
      };
    },

    getDeletedTombstones(room) {
      return Array.from(
        deletedTombstonesByRoom.get(createCanvasRoomName(room))?.keys() ?? [],
      );
    },

    getDirtyShapeIds(room) {
      return Array.from(dirtyShapeIdsByRoom.get(createCanvasRoomName(room)) ?? []);
    },

    getHistoryState(room) {
      const roomName = createCanvasRoomName(room);

      return buildHistoryPatchFromState(roomName);
    },

    getLoadedRegions(room) {
      return loadedRegionsByRoom.get(createCanvasRoomName(room)) ?? [];
    },

    getStats() {
      const roomNames = new Set<string>();

      [
        loadedRegionsByRoom,
        deletedTombstonesByRoom,
        dirtyShapeIdsByRoom,
        checkpointOperationIdsByRoom,
        checkpointHistorySeqByRoom,
        checkpointVersionByRoom,
        historyByRoom,
        historySeqByRoom,
        redoHistoryByRoom,
        shapesByRoom,
      ].forEach((map) => {
        map.forEach((_, roomName) => roomNames.add(roomName));
      });

      return {
        cachedShapeCount: sumMapSizes(shapesByRoom),
        deletedTombstoneCount: sumMapSizes(deletedTombstonesByRoom),
        dirtyShapeCount: sumMapSizes(dirtyShapeIdsByRoom),
        historyItemCount: sumArrayMapLengths(historyByRoom),
        loadedRegionCount: sumArrayMapLengths(loadedRegionsByRoom),
        redoHistoryItemCount: sumArrayMapLengths(redoHistoryByRoom),
        roomCount: roomNames.size,
      };
    },

    recordLoadedViewport(room, bounds, shapes = []) {
      const roomName = createCanvasRoomName(room);
      const currentRegions = loadedRegionsByRoom.get(roomName) ?? [];

      upsertRoomShapes(roomName, shapes, { markDirty: false });

      if (currentRegions.some((region) => isCoveringRegion(region, bounds))) {
        return currentRegions;
      }

      const nextRegions = mergeLoadedRegions(
        currentRegions,
        createLoadedRegion(room, bounds),
      );

      loadedRegionsByRoom.set(roomName, nextRegions);
      return nextRegions;
    },

    markCheckpointSucceeded(room, operations, result, options = {}) {
      const roomName = createCanvasRoomName(room);
      const shapeCache = shapesByRoom.get(roomName);
      const dirtyShapeIds = dirtyShapeIdsByRoom.get(roomName);
      const deletedTombstones = deletedTombstonesByRoom.get(roomName);
      const metadataById = readPersistedShapeMetadataById(result);

      operations.forEach((operation) => {
        const isCurrentOperation = isCurrentCheckpointOperation(
          roomName,
          operation,
        );

        if (!isCurrentOperation) {
          if (operation.type !== "delete" && shapeCache) {
            applyPersistedShapeMetadata(
              shapeCache,
              operation.shapeId,
              metadataById.get(operation.shapeId),
            );
          }
          return;
        }

        dirtyShapeIds?.delete(operation.shapeId);
        clearCheckpointOperationIds(roomName, operation.shapeId);
        if (operation.type === "delete") {
          deletedTombstones?.delete(operation.shapeId);
          return;
        }

        if (shapeCache) {
          applyPersistedShapeMetadata(
            shapeCache,
            operation.shapeId,
            metadataById.get(operation.shapeId),
          );
        }
      });

      if (
        operations.length &&
        (options.advanceCheckpoint ?? true) &&
        !dirtyShapeIds?.size
      ) {
        checkpointVersionByRoom.set(
          roomName,
          (checkpointVersionByRoom.get(roomName) ?? 0) + 1,
        );
        checkpointHistorySeqByRoom.set(
          roomName,
          historySeqByRoom.get(roomName) ?? null,
        );
      }
    },

    redoLastHistory(room, options = {}) {
      const roomName = createCanvasRoomName(room);
      const redoHistory = redoHistoryByRoom.get(roomName);
      const historyItem = redoHistory?.pop();

      if (!redoHistory || !historyItem) return null;
      if (!redoHistory.length) {
        redoHistoryByRoom.delete(roomName);
      }

      const patch = createRedoPatch(historyItem);

      applyHistoryPatch(roomName, patch);
      pushRoomHistoryItem(
        roomName,
        {
          action: historyItem.action,
          actorUserId: options.actorUserId?.trim() || historyItem.actorUserId,
          after: cloneShapeRecord(historyItem.after),
          before: cloneShapeRecord(historyItem.before),
          shapeId: historyItem.shapeId,
        },
        { clearRedo: false },
      );

      return {
        ...patch,
        ...buildHistoryPatchFromState(roomName),
      };
    },

    undoLastHistory(room, options = {}) {
      const roomName = createCanvasRoomName(room);
      const history = historyByRoom.get(roomName);
      const historyItem = history?.pop();

      if (!history || !historyItem) return null;
      if (!history.length) {
        historyByRoom.delete(roomName);
      }

      const patch = createUndoPatch(historyItem);

      applyHistoryPatch(roomName, patch);
      getNextHistorySeq(roomName);

      const redoHistory = redoHistoryByRoom.get(roomName) ?? [];

      redoHistory.push({
        ...historyItem,
        actorUserId: options.actorUserId?.trim() || historyItem.actorUserId,
      });
      redoHistoryByRoom.set(roomName, redoHistory.slice(-MAX_ROOM_HISTORY_ITEMS));

      return {
        ...patch,
        ...buildHistoryPatchFromState(roomName),
      };
    },
  };
}
