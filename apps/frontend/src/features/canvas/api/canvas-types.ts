export type CanvasClientMode = "api" | "mock";

export type CanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

export type CanvasViewportShapeQuery = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  margin?: number;
  parentShapeId?: string;
};

export type CanvasWorkspaceRequestOptions = {
  signal?: AbortSignal;
  workspaceId: string;
};

export type {
  CanvasOperationsCatchupPayload,
  CanvasShapeOperationPayload,
} from "@/shared/canvas-realtime/canvas-realtime-types";

export type CanvasBoardDetail = {
  id: string;
  workspaceId: string;
  title: string;
  boardType: "freeform" | string;
  engineType: "classic" | "tldraw_sync" | string;
  engineVersion: number;
  sourceCanvasId: string | null;
  zoom: number;
  viewportX: number;
  viewportY: number;
  shapeCount: number;
  updatedAt: string;
  shapes: unknown[];
  viewSetting: CanvasViewSetting;
  userState: Record<string, unknown> | null;
};

export type CanvasBoardSummary = Omit<
  CanvasBoardDetail,
  "shapes" | "viewSetting" | "userState"
>;

export type CanvasSyncDocumentPayload = {
  canvasId: string;
  workspaceId: string;
  providerType: "tldraw_sync" | string;
  snapshot: Record<string, unknown> | null;
  version: number;
  updatedAt: string | null;
};

export type CanvasClientOptions = {
  mode?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  authToken?: string | null;
};
