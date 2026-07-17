import type { CanvasShapePreviewEventPayload } from "@/shared/canvas-realtime/canvas-realtime-types";

export type CanvasRemoteShapePreviewStore = {
  acknowledgeAppliedShapeIds: (shapeIds: readonly string[]) => void;
  getSnapshot: () => readonly CanvasShapePreviewEventPayload[];
  subscribe: (listener: () => void) => () => void;
};

export type CanvasRemoteShapePreviewStoreController =
  CanvasRemoteShapePreviewStore & {
    clear: () => void;
    clearActor: (actorUserId: string, shapeIds?: readonly string[]) => void;
    markCommittedShapeIds: (
      actorUserId: string,
      shapeIds: readonly string[],
    ) => void;
    removeShapeIds: (actorUserId: string, shapeIds: readonly string[]) => void;
    replace: (previews: readonly CanvasShapePreviewEventPayload[]) => void;
    sweepStale: (staleBefore: number) => void;
    upsert: (preview: CanvasShapePreviewEventPayload) => void;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getShapeId(shape: unknown) {
  const shapeId = isRecord(shape) ? shape.id : null;

  return typeof shapeId === "string" ? shapeId : null;
}

function hasPreviewPayload(preview: CanvasShapePreviewEventPayload) {
  return Boolean(preview.shapes.length || preview.deletedShapeIds?.length);
}

function parsePreviewTimestamp(sentAt: string) {
  const time = new Date(sentAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function filterPreviewShapeIds(
  preview: CanvasShapePreviewEventPayload,
  shapeIds: ReadonlySet<string>,
  shouldKeep: boolean,
) {
  const nextPreview = {
    ...preview,
    deletedShapeIds: preview.deletedShapeIds?.filter(
      (shapeId) => shapeIds.has(shapeId) === shouldKeep,
    ),
    shapes: preview.shapes.filter((shape) => {
      const shapeId = getShapeId(shape);

      return shapeId ? shapeIds.has(shapeId) === shouldKeep : !shouldKeep;
    }),
  };

  return hasPreviewPayload(nextPreview) ? nextPreview : null;
}

function mergePreviewPayloads(
  livePreview: CanvasShapePreviewEventPayload | undefined,
  committedPreview: CanvasShapePreviewEventPayload | undefined,
) {
  if (!committedPreview) return livePreview ?? null;
  if (!livePreview) return committedPreview;

  const committedShapeIds = new Set([
    ...(committedPreview.deletedShapeIds ?? []),
    ...committedPreview.shapes.flatMap((shape) => {
      const shapeId = getShapeId(shape);

      return shapeId ? [shapeId] : [];
    }),
  ]);

  return {
    ...livePreview,
    deletedShapeIds: Array.from(
      new Set([
        ...(livePreview.deletedShapeIds ?? []).filter(
          (shapeId) => !committedShapeIds.has(shapeId),
        ),
        ...(committedPreview.deletedShapeIds ?? []),
      ]),
    ),
    shapes: [
      ...livePreview.shapes.filter((shape) => {
        const shapeId = getShapeId(shape);

        return shapeId ? !committedShapeIds.has(shapeId) : true;
      }),
      ...committedPreview.shapes,
    ],
  };
}

function toSortedSnapshot({
  committedPreviewsByActor,
  livePreviewsByActor,
}: {
  committedPreviewsByActor: ReadonlyMap<
    string,
    CanvasShapePreviewEventPayload
  >;
  livePreviewsByActor: ReadonlyMap<string, CanvasShapePreviewEventPayload>;
}) {
  const actorUserIds = new Set([
    ...livePreviewsByActor.keys(),
    ...committedPreviewsByActor.keys(),
  ]);

  return [...actorUserIds]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((actorUserId) => {
      const preview = mergePreviewPayloads(
        livePreviewsByActor.get(actorUserId),
        committedPreviewsByActor.get(actorUserId),
      );

      return preview ? [preview] : [];
    });
}

export function createCanvasRemoteShapePreviewStore(): CanvasRemoteShapePreviewStoreController {
  const listeners = new Set<() => void>();
  const livePreviewsByActor = new Map<
    string,
    CanvasShapePreviewEventPayload
  >();
  const committedPreviewsByActor = new Map<
    string,
    CanvasShapePreviewEventPayload
  >();
  let snapshot: readonly CanvasShapePreviewEventPayload[] = [];

  function publish() {
    snapshot = toSortedSnapshot({
      committedPreviewsByActor,
      livePreviewsByActor,
    });
    listeners.forEach((listener) => listener());
  }

  function removeShapeIdsFromActor(
    actorUserId: string,
    shapeIds: readonly string[],
  ) {
    if (!shapeIds.length) return false;

    const shapeIdSet = new Set(shapeIds);
    let changed = false;

    [livePreviewsByActor, committedPreviewsByActor].forEach(
      (previewsByActor) => {
        const preview = previewsByActor.get(actorUserId);
        if (!preview) return;

        const nextPreview = filterPreviewShapeIds(preview, shapeIdSet, false);

        if (nextPreview) {
          previewsByActor.set(actorUserId, nextPreview);
        } else {
          previewsByActor.delete(actorUserId);
        }
        changed = true;
      },
    );

    return changed;
  }

  return {
    acknowledgeAppliedShapeIds(shapeIds) {
      if (!shapeIds.length) return;

      const shapeIdSet = new Set(shapeIds);
      let changed = false;

      committedPreviewsByActor.forEach((preview, actorUserId) => {
        const nextPreview = filterPreviewShapeIds(
          preview,
          shapeIdSet,
          false,
        );

        if (nextPreview) {
          committedPreviewsByActor.set(actorUserId, nextPreview);
        } else {
          committedPreviewsByActor.delete(actorUserId);
        }
        changed = true;
      });

      if (changed) publish();
    },
    clear() {
      if (!livePreviewsByActor.size && !committedPreviewsByActor.size) return;
      livePreviewsByActor.clear();
      committedPreviewsByActor.clear();
      publish();
    },
    clearActor(actorUserId, shapeIds) {
      if (!shapeIds?.length) {
        if (!livePreviewsByActor.delete(actorUserId)) return;
        publish();
        return;
      }

      const preview = livePreviewsByActor.get(actorUserId);
      if (!preview) return;

      const nextPreview = filterPreviewShapeIds(
        preview,
        new Set(shapeIds),
        false,
      );

      if (nextPreview) {
        livePreviewsByActor.set(actorUserId, nextPreview);
      } else {
        livePreviewsByActor.delete(actorUserId);
      }
      publish();
    },
    getSnapshot() {
      return snapshot;
    },
    markCommittedShapeIds(actorUserId, shapeIds) {
      if (!shapeIds.length) return;

      const livePreview = livePreviewsByActor.get(actorUserId);
      if (!livePreview) return;

      const shapeIdSet = new Set(shapeIds);
      const committedPreview = filterPreviewShapeIds(
        livePreview,
        shapeIdSet,
        true,
      );

      if (!committedPreview) return;

      committedPreviewsByActor.set(
        actorUserId,
        mergePreviewPayloads(
          committedPreviewsByActor.get(actorUserId),
          committedPreview,
        ) ?? committedPreview,
      );
      const nextLivePreview = filterPreviewShapeIds(
        livePreview,
        shapeIdSet,
        false,
      );

      if (nextLivePreview) {
        livePreviewsByActor.set(actorUserId, nextLivePreview);
      } else {
        livePreviewsByActor.delete(actorUserId);
      }
      publish();
    },
    removeShapeIds(actorUserId, shapeIds) {
      if (removeShapeIdsFromActor(actorUserId, shapeIds)) publish();
    },
    replace(previews) {
      livePreviewsByActor.clear();
      committedPreviewsByActor.clear();
      previews.forEach((preview) => {
        livePreviewsByActor.set(preview.actorUserId, preview);
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

      livePreviewsByActor.forEach((preview, actorUserId) => {
        if (parsePreviewTimestamp(preview.sentAt) >= staleBefore) return;
        livePreviewsByActor.delete(actorUserId);
        changed = true;
      });

      if (changed) publish();
    },
    upsert(preview) {
      livePreviewsByActor.set(preview.actorUserId, preview);
      publish();
    },
  };
}
