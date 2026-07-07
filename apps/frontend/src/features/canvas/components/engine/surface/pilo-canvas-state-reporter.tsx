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

function isPersistableFreeformShape(_shape: TLShape) {
  return true;
}

function toFreeformSnapshot(
  editor: Editor,
  shape: TLShape,
): PiloCanvasFreeformShape {
  return withSerializedArrowBindings(editor, shape);
}

export function CanvasStateReporter({
  onFreeformShapesDraftChange,
  onFreeformShapesChange,
  onViewChange,
  onViewportBoundsChange,
}: {
  onFreeformShapesDraftChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onViewChange: (viewSetting: PiloCanvasViewSetting) => void;
  onViewportBoundsChange: (bounds: PiloCanvasViewportBounds) => void;
}) {
  const editor = useEditor();
  const viewSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeformSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const camera = useValue("pilo-camera-state", () => editor.getCamera(), [
    editor,
  ]);

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
        .map((shape) => toFreeformSnapshot(editor, shape));
    }

    function scheduleFreeformSync() {
      const nextFreeformShapes = readFreeformShapes();

      onFreeformShapesDraftChange(nextFreeformShapes);

      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }

      freeformSyncTimerRef.current = setTimeout(() => {
        freeformSyncTimerRef.current = null;
        onFreeformShapesChange(nextFreeformShapes);
      }, 220);
    }

    const removeListener = editor.store.listen(scheduleFreeformSync, {
      source: "all",
      scope: "document",
    });

    return () => {
      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }
      removeListener();
    };
  }, [editor, onFreeformShapesChange, onFreeformShapesDraftChange]);

  return null;
}
