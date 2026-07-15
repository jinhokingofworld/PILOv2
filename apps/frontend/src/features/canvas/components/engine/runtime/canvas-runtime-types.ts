import type { CanvasShapeApiClient } from "../../../utils/canvas-shape-sync";
import type {
  CanvasBoardDetail,
  CanvasOperationsCatchupPayload,
  CanvasSyncDocumentPayload,
  CanvasViewportShapeQuery,
  CanvasViewSetting,
} from "../../../api/canvas-types";
import type { PiloCanvasViewportBounds } from "../types";

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
  getSyncDocument?: (
    boardId: string,
    options: { workspaceId: string },
  ) => Promise<CanvasSyncDocumentPayload>;
  updateSyncDocument?: (
    boardId: string,
    body: { snapshot: Record<string, unknown> | null },
    options: { workspaceId: string },
  ) => Promise<CanvasSyncDocumentPayload>;
};
