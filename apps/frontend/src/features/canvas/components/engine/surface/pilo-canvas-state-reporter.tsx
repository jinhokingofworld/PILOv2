"use client";

import { useEffect, useRef } from "react";
import { useEditor, type Editor, type TLShape } from "tldraw";
import { useValue } from "@tldraw/state-react";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasLocalShapeChange,
  PiloCanvasViewportBounds,
  PiloCanvasViewSetting,
} from "../types";
import { withSerializedArrowBindings } from "./pilo-canvas-arrow-bindings";
import { withPiloMediaAsset } from "../assets/pilo-canvas-assets";

const INTERACTION_SNAPSHOT_THROTTLE_MS = 80;
const FREEHAND_DRAW_SNAPSHOT_THROTTLE_MS = 160;
const FREEFORM_SYNC_IDLE_DELAY_MS = 220;
const TL_DRAWING_RECORD_TYPES = new Set(["asset", "binding", "shape"]);

type CanvasStoreListenEntry = {
  changes?: {
    added?: Record<string, unknown>;
    removed?: Record<string, unknown>;
    updated?: Record<string, readonly [unknown, unknown]>;
  };
};

function isPersistableFreeformShape(_shape: TLShape) {
  return true;
}

function isFreehandDrawingTool(toolId: string) {
  return toolId.includes("draw") || toolId.includes("highlight");
}

function isFreehandDrawingInProgress(editor: Editor) {
  if (!isFreehandDrawingTool(editor.getCurrentToolId())) return false;

  return editor.inputs.getIsPointing() || editor.inputs.getIsDragging();
}

function toFreeformSnapshot(
  editor: Editor,
  shape: TLShape,
): PiloCanvasFreeformShape {
  return withPiloMediaAsset(editor, withSerializedArrowBindings(editor, shape));
}

function getTldrawRecordType(record: unknown) {
  if (!record || typeof record !== "object") return null;

  const typeName = (record as { typeName?: unknown }).typeName;

  return typeof typeName === "string" ? typeName : null;
}

function isCanvasShapeSyncRecord(record: unknown) {
  const recordType = getTldrawRecordType(record);

  return recordType ? TL_DRAWING_RECORD_TYPES.has(recordType) : false;
}

function shouldReadCanvasShapeSnapshot(entry?: CanvasStoreListenEntry) {
  if (!entry?.changes) return true;

  const { added = {}, removed = {}, updated = {} } = entry.changes;

  if (Object.values(added).some(isCanvasShapeSyncRecord)) return true;
  if (Object.values(removed).some(isCanvasShapeSyncRecord)) return true;

  return Object.values(updated).some(([before, after]) => {
    return isCanvasShapeSyncRecord(before) || isCanvasShapeSyncRecord(after);
  });
}

function getRemovedCanvasShapeIds(entry?: CanvasStoreListenEntry) {
  const removedRecords = Object.values(entry?.changes?.removed ?? {});

  return removedRecords.flatMap((record) => {
    if (
      getTldrawRecordType(record) !== "shape" ||
      !record ||
      typeof record !== "object" ||
      !("id" in record) ||
      typeof record.id !== "string"
    ) {
      return [];
    }

    return [record.id];
  });
}

function addChangedRecordShapeIds(
  record: unknown,
  shapeIds: Set<string>,
  assetIds: Set<string>,
) {
  if (!record || typeof record !== "object") return;

  const recordType = getTldrawRecordType(record);
  const recordValue = record as {
    fromId?: unknown;
    id?: unknown;
    toId?: unknown;
  };

  if (recordType === "shape" && typeof recordValue.id === "string") {
    shapeIds.add(recordValue.id);
    return;
  }

  if (recordType === "binding") {
    if (typeof recordValue.fromId === "string") {
      shapeIds.add(recordValue.fromId);
    }
    if (typeof recordValue.toId === "string") {
      shapeIds.add(recordValue.toId);
    }
    return;
  }

  if (recordType === "asset" && typeof recordValue.id === "string") {
    assetIds.add(recordValue.id);
  }
}

function getChangedCanvasShapeRecordIds(entry?: CanvasStoreListenEntry) {
  const shapeIds = new Set<string>();
  const assetIds = new Set<string>();
  const { added = {}, removed = {}, updated = {} } = entry?.changes ?? {};

  Object.values(added).forEach((record) => {
    addChangedRecordShapeIds(record, shapeIds, assetIds);
  });
  Object.values(removed).forEach((record) => {
    addChangedRecordShapeIds(record, shapeIds, assetIds);
  });
  Object.values(updated).forEach(([before, after]) => {
    addChangedRecordShapeIds(before, shapeIds, assetIds);
    addChangedRecordShapeIds(after, shapeIds, assetIds);
  });

  return { assetIds, shapeIds };
}

function getShapeAssetId(shape: PiloCanvasFreeformShape) {
  if (!shape.props || typeof shape.props !== "object") return null;

  const assetId = (shape.props as { assetId?: unknown }).assetId;

  return typeof assetId === "string" ? assetId : null;
}

function getFreeformSnapshotSignature(shapes: PiloCanvasFreeformShape[]) {
  return JSON.stringify(shapes);
}

export function CanvasStateReporter({
  onFreeformShapesDraftChange,
  onFreeformShapesChange,
  onResolveFreeformShapeSnapshot,
  onViewChange,
  onViewportBoundsChange,
}: {
  onFreeformShapesDraftChange: (
    shapes: PiloCanvasFreeformShape[],
    change: PiloCanvasLocalShapeChange,
  ) => void;
  onFreeformShapesChange: (
    shapes: PiloCanvasFreeformShape[],
    change: PiloCanvasLocalShapeChange,
  ) => void;
  onResolveFreeformShapeSnapshot?: (
    shape: TLShape,
    snapshot: PiloCanvasFreeformShape,
  ) => PiloCanvasFreeformShape | null;
  onViewChange: (viewSetting: PiloCanvasViewSetting) => void;
  onViewportBoundsChange: (bounds: PiloCanvasViewportBounds) => void;
}) {
  const editor = useEditor();
  const viewSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeformSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const freeformSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastFreeformSnapshotAtRef = useRef(0);
  const lastFreeformSnapshotSignatureRef = useRef<string | null>(null);
  const pendingChangedAssetIdsRef = useRef(new Set<string>());
  const pendingDraftChangedShapeIdsRef = useRef(new Set<string>());
  const pendingDraftDeletedShapeIdsRef = useRef(new Set<string>());
  const pendingPersistChangedShapeIdsRef = useRef(new Set<string>());
  const pendingExplicitDeletedShapeIdsRef = useRef(new Set<string>());
  const onFreeformShapesDraftChangeRef = useRef(onFreeformShapesDraftChange);
  const onFreeformShapesChangeRef = useRef(onFreeformShapesChange);
  const onResolveFreeformShapeSnapshotRef = useRef(
    onResolveFreeformShapeSnapshot,
  );
  const camera = useValue("pilo-camera-state", () => editor.getCamera(), [
    editor,
  ]);

  onFreeformShapesDraftChangeRef.current = onFreeformShapesDraftChange;
  onFreeformShapesChangeRef.current = onFreeformShapesChange;
  onResolveFreeformShapeSnapshotRef.current = onResolveFreeformShapeSnapshot;

  useEffect(() => {
    if (viewSyncTimerRef.current) {
      clearTimeout(viewSyncTimerRef.current);
    }

    const nextViewSetting = {
      zoom: camera.z,
      viewportX: camera.x,
      viewportY: camera.y,
    };

    viewSyncTimerRef.current = setTimeout(() => {
      viewSyncTimerRef.current = null;
      onViewChange(nextViewSetting);

      const bounds = editor.getViewportPageBounds();

      if (
        Number.isFinite(bounds.x) &&
        Number.isFinite(bounds.y) &&
        Number.isFinite(bounds.w) &&
        Number.isFinite(bounds.h) &&
        bounds.w > 0 &&
        bounds.h > 0
      ) {
        onViewportBoundsChange({
          x: bounds.x,
          y: bounds.y,
          width: bounds.w,
          height: bounds.h,
          zoom: camera.z,
        });
      }
    }, 140);

    return () => {
      if (viewSyncTimerRef.current) {
        clearTimeout(viewSyncTimerRef.current);
      }
    };
  }, [camera.x, camera.y, camera.z, editor, onViewChange, onViewportBoundsChange]);

  useEffect(() => {
    function readFreeformShapes() {
      return editor
        .getCurrentPageShapes()
        .filter(isPersistableFreeformShape)
        .map((shape) => {
          const snapshot = toFreeformSnapshot(editor, shape);
          const resolveSnapshot = onResolveFreeformShapeSnapshotRef.current;

          return resolveSnapshot ? resolveSnapshot(shape, snapshot) : snapshot;
        })
        .filter((shape): shape is PiloCanvasFreeformShape => shape !== null);
    }

    function scheduleFreeformSync(entry?: CanvasStoreListenEntry) {
      const changedRecords = getChangedCanvasShapeRecordIds(entry);

      changedRecords.assetIds.forEach((assetId) => {
        pendingChangedAssetIdsRef.current.add(assetId);
      });
      changedRecords.shapeIds.forEach((shapeId) => {
        pendingDraftChangedShapeIdsRef.current.add(shapeId);
        pendingPersistChangedShapeIdsRef.current.add(shapeId);
      });
      getRemovedCanvasShapeIds(entry).forEach((shapeId) => {
        pendingDraftDeletedShapeIdsRef.current.add(shapeId);
        pendingExplicitDeletedShapeIdsRef.current.add(shapeId);
      });

      if (!shouldReadCanvasShapeSnapshot(entry)) {
        return;
      }

      const isDrawing = isFreehandDrawingInProgress(editor);
      const isInteracting =
        isDrawing || editor.inputs.getIsPointing() || editor.inputs.getIsDragging();

      if (freeformSnapshotTimerRef.current) {
        if (isInteracting) {
          return;
        }

        clearTimeout(freeformSnapshotTimerRef.current);
      }

      const elapsedSinceLastSnapshot =
        Date.now() - lastFreeformSnapshotAtRef.current;
      const snapshotDelay = isDrawing
        ? Math.max(
            0,
            FREEHAND_DRAW_SNAPSHOT_THROTTLE_MS - elapsedSinceLastSnapshot,
          )
        : isInteracting
          ? Math.max(
              0,
              INTERACTION_SNAPSHOT_THROTTLE_MS - elapsedSinceLastSnapshot,
            )
        : 0;

      freeformSnapshotTimerRef.current = setTimeout(() => {
        freeformSnapshotTimerRef.current = null;
        lastFreeformSnapshotAtRef.current = Date.now();
        let nextFreeformShapes: PiloCanvasFreeformShape[];

        try {
          nextFreeformShapes = readFreeformShapes();
        } catch (error) {
          console.error("Canvas shape snapshot read failed", error);
          return;
        }

        const nextSnapshotSignature =
          getFreeformSnapshotSignature(nextFreeformShapes);

        if (pendingChangedAssetIdsRef.current.size) {
          nextFreeformShapes.forEach((shape) => {
            const assetId = getShapeAssetId(shape);

            if (
              !assetId ||
              !pendingChangedAssetIdsRef.current.has(assetId) ||
              typeof shape.id !== "string"
            ) {
              return;
            }

            pendingDraftChangedShapeIdsRef.current.add(shape.id);
            pendingPersistChangedShapeIdsRef.current.add(shape.id);
          });
          pendingChangedAssetIdsRef.current.clear();
        }

        if (
          lastFreeformSnapshotSignatureRef.current === nextSnapshotSignature &&
          !pendingExplicitDeletedShapeIdsRef.current.size
        ) {
          return;
        }

        lastFreeformSnapshotSignatureRef.current = nextSnapshotSignature;
        const draftChange: PiloCanvasLocalShapeChange = {
          changedShapeIds: Array.from(
            pendingDraftChangedShapeIdsRef.current,
          ),
          deletedShapeIds: Array.from(
            pendingDraftDeletedShapeIdsRef.current,
          ),
          isFreehandDrawing: isDrawing,
        };

        pendingDraftChangedShapeIdsRef.current.clear();
        pendingDraftDeletedShapeIdsRef.current.clear();
        onFreeformShapesDraftChangeRef.current(
          nextFreeformShapes,
          draftChange,
        );

        if (freeformSyncTimerRef.current) {
          clearTimeout(freeformSyncTimerRef.current);
        }

        function scheduleFreeformPersist() {
          freeformSyncTimerRef.current = setTimeout(() => {
            freeformSyncTimerRef.current = null;

            if (isFreehandDrawingInProgress(editor)) {
              scheduleFreeformPersist();
              return;
            }

            const persistChange: PiloCanvasLocalShapeChange = {
              changedShapeIds: Array.from(
                pendingPersistChangedShapeIdsRef.current,
              ),
              deletedShapeIds: Array.from(
                pendingExplicitDeletedShapeIdsRef.current,
              ),
              isFreehandDrawing: false,
            };

            pendingPersistChangedShapeIdsRef.current.clear();
            pendingExplicitDeletedShapeIdsRef.current.clear();
            onFreeformShapesChangeRef.current(nextFreeformShapes, persistChange);
          }, FREEFORM_SYNC_IDLE_DELAY_MS);
        }

        scheduleFreeformPersist();
      }, snapshotDelay);
    }

    const removeListener = editor.store.listen(scheduleFreeformSync, {
      source: "user",
      scope: "document",
    });

    return () => {
      if (freeformSnapshotTimerRef.current) {
        clearTimeout(freeformSnapshotTimerRef.current);
      }
      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }
      pendingChangedAssetIdsRef.current.clear();
      pendingDraftChangedShapeIdsRef.current.clear();
      pendingDraftDeletedShapeIdsRef.current.clear();
      pendingPersistChangedShapeIdsRef.current.clear();
      pendingExplicitDeletedShapeIdsRef.current.clear();
      removeListener();
    };
  }, [editor]);

  return null;
}
