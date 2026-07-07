import { useEffect } from "react";
import {
  normalizeCanvasFreeformShapes,
  readCanvasStorage,
} from "../../../utils/canvas-storage";
import type { PiloCanvasFreeformShape } from "../types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSetting,
} from "./canvas-runtime-types";
import { normalizeViewSetting } from "./canvas-runtime-utils";

type RuntimeRef<T> = {
  current: T;
};

type UseCanvasRuntimeHydrationOptions = {
  board: CanvasBoardDetail;
  freeformShapesRef: RuntimeRef<PiloCanvasFreeformShape[]>;
  pendingLocalShapeVersionsRef: RuntimeRef<Map<string, number>>;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  setCameraRestoreVersion: (updater: (version: number) => number) => void;
  setCanvasHydrationVersion: (updater: (version: number) => number) => void;
  setFreeformShapes: (shapes: PiloCanvasFreeformShape[]) => void;
  setViewSetting: (viewSetting: CanvasViewSetting) => void;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeDetailRequestSeqRef: RuntimeRef<number>;
  storageMode: CanvasRuntimeStorageMode;
  viewSettingRef: RuntimeRef<CanvasViewSetting>;
  viewportShapeLoadRequestSeqRef: RuntimeRef<number>;
};

export function useCanvasRuntimeHydration({
  board,
  freeformShapesRef,
  pendingLocalShapeVersionsRef,
  pendingShapeDetailRef,
  setCameraRestoreVersion,
  setCanvasHydrationVersion,
  setFreeformShapes,
  setViewSetting,
  shapeDetailCacheRef,
  shapeDetailRequestSeqRef,
  storageMode,
  viewSettingRef,
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
    const storedViewSetting =
      storageMode === "local"
        ? normalizeViewSetting(
            readCanvasStorage("view-setting", board.id),
            board.viewSetting,
          )
        : board.viewSetting;

    queueMicrotask(() => {
      if (cancelled) return;

      shapeDetailCacheRef.current.clear();
      pendingShapeDetailRef.current = null;
      shapeDetailRequestSeqRef.current += 1;
      viewportShapeLoadRequestSeqRef.current += 1;
      pendingLocalShapeVersionsRef.current.clear();
      freeformShapesRef.current = storedFreeformShapes;
      setFreeformShapes(storedFreeformShapes);
      viewSettingRef.current = storedViewSetting;
      setViewSetting(storedViewSetting);

      setCanvasHydrationVersion((version) => version + 1);
      setCameraRestoreVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [
    board.id,
    board.shapes,
    board.viewSetting,
    freeformShapesRef,
    pendingLocalShapeVersionsRef,
    pendingShapeDetailRef,
    setCameraRestoreVersion,
    setCanvasHydrationVersion,
    setFreeformShapes,
    setViewSetting,
    shapeDetailCacheRef,
    shapeDetailRequestSeqRef,
    storageMode,
    viewSettingRef,
    viewportShapeLoadRequestSeqRef,
  ]);
}
