import { useEffect } from "react";
import {
  normalizeCanvasFreeformShapes,
  readCanvasStorage,
} from "@/features/canvas/persistence/canvas-storage";
import type { PiloCanvasFreeformShape } from "../canvas-engine-types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
} from "./canvas-runtime-types";

type RuntimeRef<T> = {
  current: T;
};

type UseCanvasRuntimeHydrationOptions = {
  board: CanvasBoardDetail;
  freeformShapesRef: RuntimeRef<PiloCanvasFreeformShape[]>;
  pendingLocalShapeVersionsRef: RuntimeRef<Map<string, number>>;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  setCameraResetVersion: (updater: (version: number) => number) => void;
  setCanvasHydrationVersion: (updater: (version: number) => number) => void;
  setFreeformShapes: (shapes: PiloCanvasFreeformShape[]) => void;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeDetailRequestSeqRef: RuntimeRef<number>;
  storageMode: CanvasRuntimeStorageMode;
  viewportShapeLoadRequestSeqRef: RuntimeRef<number>;
};

export function useCanvasRuntimeHydration({
  board,
  freeformShapesRef,
  pendingLocalShapeVersionsRef,
  pendingShapeDetailRef,
  setCameraResetVersion,
  setCanvasHydrationVersion,
  setFreeformShapes,
  shapeDetailCacheRef,
  shapeDetailRequestSeqRef,
  storageMode,
  viewportShapeLoadRequestSeqRef,
}: UseCanvasRuntimeHydrationOptions) {
  useEffect(() => {
    let cancelled = false;
    const boardFreeformShapes = normalizeCanvasFreeformShapes(
      board.shapes,
    ) as PiloCanvasFreeformShape[];
    const storedFreeformShapes =
      storageMode === "local"
        ? (normalizeCanvasFreeformShapes(
            readCanvasStorage("freeform-shapes", board.id),
          ) as PiloCanvasFreeformShape[])
        : boardFreeformShapes;
    queueMicrotask(() => {
      if (cancelled) return;

      shapeDetailCacheRef.current.clear();
      pendingShapeDetailRef.current = null;
      shapeDetailRequestSeqRef.current += 1;
      viewportShapeLoadRequestSeqRef.current += 1;
      pendingLocalShapeVersionsRef.current.clear();
      freeformShapesRef.current = storedFreeformShapes;
      setFreeformShapes(storedFreeformShapes);

      setCanvasHydrationVersion((version) => version + 1);
      setCameraResetVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [
    board.id,
    board.shapes,
    freeformShapesRef,
    pendingLocalShapeVersionsRef,
    pendingShapeDetailRef,
    setCameraResetVersion,
    setCanvasHydrationVersion,
    setFreeformShapes,
    shapeDetailCacheRef,
    shapeDetailRequestSeqRef,
    storageMode,
    viewportShapeLoadRequestSeqRef,
  ]);
}
