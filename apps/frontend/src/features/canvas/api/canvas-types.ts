export type CanvasClientMode = "api" | "mock";

export type CanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

export type CanvasViewportShapeQuery = {
  x: number;
  y: number;
  width: number;
  height: number;
  margin?: number;
};

export type CanvasWorkspaceRequestOptions = {
  signal?: AbortSignal;
  workspaceId: string;
};

export type CanvasShapeOperationPayload = {
  id: string;
  workspaceId: string;
  canvasId: string;
  shapeId: string;
  operationType: "create" | "update" | "delete";
  opSeq: number;
  actorUserId: string;
  clientOperationId: string;
  baseRevision: number | null;
  resultRevision: number;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CanvasOperationsCatchupPayload = {
  latestOpSeq: number;
  operations: CanvasShapeOperationPayload[];
};

export type CanvasBoardDetail = {
  id: string;
  workspaceId: string;
  title: string;
  boardType: "freeform" | string;
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

export type CanvasClientOptions = {
  mode?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  authToken?: string | null;
};
