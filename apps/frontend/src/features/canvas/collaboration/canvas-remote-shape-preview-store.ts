import type { CanvasShapePreviewEventPayload } from "@/shared/canvas-realtime/canvas-realtime-types";

export type CanvasRemoteShapePreviewStore = {
  getSnapshot: () => readonly CanvasShapePreviewEventPayload[];
  subscribe: (listener: () => void) => () => void;
};

export type CanvasRemoteShapePreviewStoreController =
  CanvasRemoteShapePreviewStore & {
    clear: () => void;
    clearActor: (actorUserId: string) => void;
    removeShapeIds: (actorUserId: string, shapeIds: readonly string[]) => void;
    replace: (previews: readonly CanvasShapePreviewEventPayload[]) => void;
    sweepStale: (staleBefore: number) => void;
    upsert: (preview: CanvasShapePreviewEventPayload) => void;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPreviewPayload(preview: CanvasShapePreviewEventPayload) {
  return Boolean(preview.shapes.length || preview.deletedShapeIds?.length);
}

function parsePreviewTimestamp(sentAt: string) {
  const time = new Date(sentAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toSortedSnapshot(
  previewsByActor: ReadonlyMap<string, CanvasShapePreviewEventPayload>,
) {
  return [...previewsByActor.values()].sort((a, b) =>
    a.actorUserId.localeCompare(b.actorUserId),
  );
}

export function createCanvasRemoteShapePreviewStore(): CanvasRemoteShapePreviewStoreController {
  const listeners = new Set<() => void>();
  const previewsByActor = new Map<string, CanvasShapePreviewEventPayload>();
  let snapshot: readonly CanvasShapePreviewEventPayload[] = [];

  function publish() {
    snapshot = toSortedSnapshot(previewsByActor);
    listeners.forEach((listener) => listener());
  }

  function clearActor(actorUserId: string) {
    if (!previewsByActor.delete(actorUserId)) return;
    publish();
  }

  return {
    clear() {
      if (!previewsByActor.size) return;
      previewsByActor.clear();
      publish();
    },
    clearActor,
    getSnapshot() {
      return snapshot;
    },
    removeShapeIds(actorUserId, shapeIds) {
      if (!shapeIds.length) return;
      const preview = previewsByActor.get(actorUserId);
      if (!preview) return;

      const shapeIdSet = new Set(shapeIds);
      const nextPreview = {
        ...preview,
        deletedShapeIds: preview.deletedShapeIds?.filter(
          (shapeId) => !shapeIdSet.has(shapeId),
        ),
        shapes: preview.shapes.filter((shape) => {
          const shapeId = isRecord(shape) ? shape.id : null;

          return typeof shapeId === "string" ? !shapeIdSet.has(shapeId) : true;
        }),
      };

      if (!hasPreviewPayload(nextPreview)) {
        previewsByActor.delete(actorUserId);
      } else {
        previewsByActor.set(actorUserId, nextPreview);
      }
      publish();
    },
    replace(previews) {
      previewsByActor.clear();
      previews.forEach((preview) => {
        previewsByActor.set(preview.actorUserId, preview);
      });
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    sweepStale(staleBefore) {
      let changed = false;

      previewsByActor.forEach((preview, actorUserId) => {
        if (parsePreviewTimestamp(preview.sentAt) >= staleBefore) return;
        previewsByActor.delete(actorUserId);
        changed = true;
      });

      if (changed) publish();
    },
    upsert(preview) {
      previewsByActor.set(preview.actorUserId, preview);
      publish();
    },
  };
}
