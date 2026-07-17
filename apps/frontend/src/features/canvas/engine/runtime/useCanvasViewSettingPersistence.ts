import { useCallback } from "react";
import { writeCanvasStorage } from "@/features/canvas/persistence/canvas-storage";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSetting,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import {
  areViewSettingsEqual,
  CANVAS_SHAPE_DETAIL_MIN_ZOOM,
  clampZoom,
  DEFAULT_VIEW_SETTING_SYNC_DEBOUNCE_MS,
} from "./canvas-runtime-utils";

type RuntimeRef<T> = {
  current: T;
};

type UseCanvasViewSettingPersistenceOptions = {
  board: CanvasBoardDetail;
  canvasClient: CanvasViewSettingApiClient | null;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  pendingViewSettingRef: RuntimeRef<CanvasViewSetting | null>;
  setViewSetting: (viewSetting: CanvasViewSetting) => void;
  storageMode: CanvasRuntimeStorageMode;
  viewSettingRef: RuntimeRef<CanvasViewSetting>;
  viewSettingSyncTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
};

export function useCanvasViewSettingPersistence({
  board,
  canvasClient,
  pendingShapeDetailRef,
  pendingViewSettingRef,
  setViewSetting,
  storageMode,
  viewSettingRef,
  viewSettingSyncTimerRef,
}: UseCanvasViewSettingPersistenceOptions) {
  return useCallback(
    (nextViewSetting: CanvasViewSetting) => {
      const normalizedViewSetting = {
        zoom: clampZoom(nextViewSetting.zoom),
        viewportX: nextViewSetting.viewportX,
        viewportY: nextViewSetting.viewportY,
      };

      if (areViewSettingsEqual(viewSettingRef.current, normalizedViewSetting)) {
        return;
      }

      viewSettingRef.current = normalizedViewSetting;
      setViewSetting(normalizedViewSetting);

      if (normalizedViewSetting.zoom < CANVAS_SHAPE_DETAIL_MIN_ZOOM) {
        pendingShapeDetailRef.current = null;
      }

      if (storageMode === "api" && canvasClient) {
        pendingViewSettingRef.current = normalizedViewSetting;

        if (viewSettingSyncTimerRef.current) {
          clearTimeout(viewSettingSyncTimerRef.current);
        }

        viewSettingSyncTimerRef.current = setTimeout(() => {
          const pendingViewSetting = pendingViewSettingRef.current;

          viewSettingSyncTimerRef.current = null;
          pendingViewSettingRef.current = null;

          if (!pendingViewSetting) return;

          void canvasClient
            .updateViewSetting(board.id, pendingViewSetting, {
              workspaceId: board.workspaceId,
            })
            .catch((error: unknown) => {
              console.error("Canvas API view setting sync failed", error);
            });
        }, DEFAULT_VIEW_SETTING_SYNC_DEBOUNCE_MS);
        return;
      }

      writeCanvasStorage("view-setting", board.id, normalizedViewSetting);
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      pendingShapeDetailRef,
      pendingViewSettingRef,
      setViewSetting,
      storageMode,
      viewSettingRef,
      viewSettingSyncTimerRef,
    ],
  );
}
