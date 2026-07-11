import { QueryResultRow } from "pg";

export interface CanvasRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  title: string;
  board_type: string;
  zoom: number | string;
  viewport_x: number | string;
  viewport_y: number | string;
  shape_count?: number | string;
  updated_at: Date | string;
}

export interface CanvasShapeRow extends QueryResultRow {
  id: string;
  canvas_id: string;
  parent_shape_id: string | null;
  shape_type: string;
  title: string | null;
  text_content: string | null;
  x: number | string;
  y: number | string;
  width: number | string | null;
  height: number | string | null;
  rotation: number | string;
  z_index: number | string;
  raw_shape: Record<string, unknown>;
  content_hash: string;
  revision: number | string;
  child_shape_count?: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

export interface CanvasShapeDeleteRow extends QueryResultRow {
  id: string;
  content_hash: string;
  revision: number | string;
  deleted_at: Date | string | null;
}

export interface CanvasUserStateRow extends QueryResultRow {
  canvas_id: string;
  user_id: string;
  entered_at: Date | string;
  left_at: Date | string | null;
}

export interface CanvasShapeCleanupRow extends QueryResultRow {
  deleted_count: number | string;
}

export interface CanvasLatestOperationSeqRow extends QueryResultRow {
  latest_op_seq: number | string;
}

export type CanvasShapeOperationType = "create" | "update" | "delete";

export interface CanvasShapeOperationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  canvas_id: string;
  shape_id: string;
  actor_user_id: string;
  operation_type: CanvasShapeOperationType;
  op_seq: number | string;
  client_operation_id: string;
  base_revision: number | string | null;
  result_revision: number | string;
  content_hash: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

export interface CreateCanvasRequest {
  title?: unknown;
}

export interface CreateCanvasShapeRequest {
  id?: unknown;
  parentShapeId?: unknown;
  shapeType?: unknown;
  title?: unknown;
  textContent?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  zIndex?: unknown;
  rawShape?: unknown;
  clientOperationId?: unknown;
  baseRevision?: unknown;
}

export type UpdateCanvasShapeRequest = Partial<CreateCanvasShapeRequest>;

export interface DeleteCanvasShapeRequest {
  clientOperationId?: unknown;
  baseRevision?: unknown;
}

export interface UpdateCanvasViewSettingRequest {
  zoom?: unknown;
  viewportX?: unknown;
  viewportY?: unknown;
}

export interface ListCanvasShapesQuery {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  margin?: unknown;
  parentShapeId?: unknown;
}

export interface ListCanvasOperationsQuery {
  afterSeq?: unknown;
}

export interface SyncCanvasShapesBatchRequest {
  operations?: unknown;
}

export interface CanvasViewSettingPayload {
  zoom: number;
  viewportX: number;
  viewportY: number;
}

export interface CanvasShapePayload {
  id: string;
  canvasId: string;
  parentShapeId: string | null;
  shapeType: string;
  title: string | null;
  textContent: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  zIndex: number;
  childShapeCount: number;
  rawShape: Record<string, unknown>;
  contentHash: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  operationType?: CanvasShapeOperationType;
  opSeq?: number;
  actorUserId?: string;
  clientOperationId?: string;
}

export type CanvasShapeSummaryPayload = CanvasShapePayload;

export interface CanvasBoardPayload {
  id: string;
  workspaceId: string;
  title: string;
  boardType: string;
  zoom: number;
  viewportX: number;
  viewportY: number;
  shapeCount: number;
  updatedAt: string;
}

export interface CanvasBoardDetailPayload extends CanvasBoardPayload {
  shapes: CanvasShapePayload[];
  viewSetting: CanvasViewSettingPayload;
  userState: null;
}

export interface CanvasShapeDeletePayload {
  id: string;
  deleted: true;
  deletedAt: string;
  contentHash: string;
  revision: number;
  operationType?: "delete";
  opSeq?: number;
  actorUserId?: string;
  clientOperationId?: string;
}

export interface CanvasShapeBatchPayload {
  created: number;
  updated: number;
  deleted: number;
  shapes: CanvasShapePayload[];
  deletedShapes: CanvasShapeDeletePayload[];
}

export interface CanvasUserStatePayload {
  canvasId: string;
  userId: string;
  enteredAt: string;
  leftAt: string | null;
}

export interface CanvasLeavePayload extends CanvasUserStatePayload {
  permanentlyDeletedShapeCount: number;
}

export interface CanvasShapeOperationPayload {
  id: string;
  workspaceId: string;
  canvasId: string;
  shapeId: string;
  operationType: CanvasShapeOperationType;
  opSeq: number;
  actorUserId: string;
  clientOperationId: string;
  baseRevision: number | null;
  resultRevision: number;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CanvasOperationsCatchupPayload {
  latestOpSeq: number;
  operations: CanvasShapeOperationPayload[];
}

export interface ShapeWriteValues {
  parentShapeId?: string | null;
  shapeType?: string;
  title?: string | null;
  textContent?: string | null;
  x?: number;
  y?: number;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  zIndex?: number;
  rawShape?: Record<string, unknown>;
}

export interface CompleteShapeWriteValues {
  parentShapeId: string | null;
  shapeType: string;
  title: string | null;
  textContent: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  zIndex: number;
  rawShape: Record<string, unknown>;
}

export interface ViewportBoundsValues {
  parentShapeId: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  margin?: number;
}

export type CanvasShapeBatchOperationValues =
  | {
      type: "create";
      shapeId: string;
      clientOperationId: string | null;
      baseRevision: number | null;
      payload: CreateCanvasShapeRequest;
    }
  | {
      type: "update";
      shapeId: string;
      clientOperationId: string | null;
      baseRevision: number | null;
      payload: UpdateCanvasShapeRequest;
    }
  | {
      type: "delete";
      shapeId: string;
      clientOperationId: string | null;
      baseRevision: number | null;
    };
