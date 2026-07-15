"use client";

import { useEffect, useRef } from "react";
import { useEditor, type Editor, type TLShape } from "tldraw";
import { useValue } from "@tldraw/state-react";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasViewportBounds,
  PiloCanvasViewSetting,
} from "../types";
import { withSerializedArrowBindings } from "./pilo-canvas-arrow-bindings";
import { withPiloMediaAsset } from "../assets/pilo-canvas-assets";

const FREEHAND_DRAW_SNAPSHOT_THROTTLE_MS = 120;
const FREEFORM_SYNC_IDLE_DELAY_MS = 220;

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

export function CanvasStateReporter({
  onFreeformShapesDraftChange,
  onFreeformShapesChange,
  onResolveFreeformShapeSnapshot,
  onViewChange,
  onViewportBoundsChange,
}: {
  onFreeformShapesDraftChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
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

    function scheduleFreeformSync() {
      const isDrawing = isFreehandDrawingInProgress(editor);

      if (freeformSnapshotTimerRef.current) {
        if (isDrawing) {
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

        onFreeformShapesDraftChangeRef.current(nextFreeformShapes);

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

            onFreeformShapesChangeRef.current(nextFreeformShapes);
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
      removeListener();
    };
  }, [editor]);

  return null;
}
