"use client";

import { useEffect, useRef } from "react";
import { useEditor, type TLShape } from "tldraw";
import { useValue } from "@tldraw/state-react";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasViewSetting,
} from "../types";

function isPersistableFreeformShape(_shape: TLShape) {
  return true;
}

function toFreeformSnapshot(shape: TLShape): PiloCanvasFreeformShape {
  return JSON.parse(JSON.stringify(shape)) as PiloCanvasFreeformShape;
}

export function CanvasStateReporter({
  onFreeformShapesChange,
  onViewChange,
}: {
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onViewChange: (viewSetting: PiloCanvasViewSetting) => void;
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
    }, 140);

    return () => {
      if (viewSyncTimerRef.current) {
        clearTimeout(viewSyncTimerRef.current);
      }
    };
  }, [camera.x, camera.y, camera.z, onViewChange]);

  useEffect(() => {
    function readFreeformShapes() {
      return editor
        .getCurrentPageShapes()
        .filter(isPersistableFreeformShape)
        .map(toFreeformSnapshot);
    }

    function scheduleFreeformSync() {
      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }

      freeformSyncTimerRef.current = setTimeout(() => {
        freeformSyncTimerRef.current = null;
        onFreeformShapesChange(readFreeformShapes());
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
  }, [editor, onFreeformShapesChange]);

  return null;
}
