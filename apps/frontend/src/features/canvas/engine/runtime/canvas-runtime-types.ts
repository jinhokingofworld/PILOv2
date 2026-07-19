import type { CanvasShapeApiClient } from "@/features/canvas/persistence/canvas-shape-sync";
import type {
  CanvasBoardDetail,
  CanvasOperationsCatchupPayload,
  CanvasViewportShapeQuery,
  CanvasViewSetting,
} from "@/features/canvas/api/canvas-types";
import type { PiloCanvasViewportBounds } from "../canvas-engine-types";

export type { CanvasBoardDetail, CanvasViewSetting };

export type CanvasRuntimeStorageMode = "api" | "local";

export type CanvasViewSettingApiClient = CanvasShapeApiClient & {
  updateViewSetting: (
    boardId: string,
    body: CanvasViewSetting,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  listShapesInViewport?: (
    boardId: string,
    query: CanvasViewportShapeQuery,
    options: { signal?: AbortSignal; workspaceId: string },
  ) => Promise<unknown>;
  getShapeDetail?: (
    shapeId: string,
    options: { signal?: AbortSignal; workspaceId: string },
  ) => Promise<unknown>;
  listOperationsAfterSeq?: (
    boardId: string,
    afterSeq: number,
    options: { signal?: AbortSignal; workspaceId: string },
  ) => Promise<CanvasOperationsCatchupPayload>;
  enterCanvas?: (
    boardId: string,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  leaveCanvas?: (
    boardId: string,
    options: { workspaceId: string },
  ) => Promise<unknown>;
};
