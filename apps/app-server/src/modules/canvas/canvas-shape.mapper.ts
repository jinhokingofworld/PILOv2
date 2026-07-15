import { badRequest } from "../../common/api-error";
import {
  CanvasBoardPayload,
  CanvasRow,
  CanvasShapeDeletePayload,
  CanvasShapeDeleteRow,
  CanvasShapePayload,
  CanvasShapeRow,
  CanvasShapeOperationPayload,
  CanvasShapeOperationRow,
  CanvasSyncDocumentPayload,
  CanvasSyncDocumentRow,
  CanvasUserStatePayload,
  CanvasUserStateRow,
  CompleteShapeWriteValues,
  ShapeWriteValues
} from "./canvas.types";

export function mapCanvas(
  canvas: CanvasRow,
  shapeCount?: number
): CanvasBoardPayload {
  const zoom = toNumber(canvas.zoom);
  const viewportX = toNumber(canvas.viewport_x);
  const viewportY = toNumber(canvas.viewport_y);

  return {
    id: canvas.id,
    workspaceId: canvas.workspace_id,
    title: canvas.title,
    boardType: canvas.board_type,
    engineType: canvas.engine_type ?? "classic",
    engineVersion:
      canvas.engine_version === undefined ? 1 : Number(canvas.engine_version),
    sourceCanvasId: canvas.source_canvas_id ?? null,
    zoom,
    viewportX,
    viewportY,
    shapeCount:
      shapeCount ?? (canvas.shape_count === undefined ? 0 : Number(canvas.shape_count)),
    updatedAt: toIsoString(canvas.updated_at)
  };
}

export function mapCanvasSyncDocument(
  document: CanvasSyncDocumentRow | null,
  {
    canvasId,
    workspaceId
  }: {
    canvasId: string;
    workspaceId: string;
  }
): CanvasSyncDocumentPayload {
  if (!document) {
    return {
      canvasId,
      providerType: "tldraw_sync",
      snapshot: null,
      updatedAt: null,
      version: 0,
      workspaceId
    };
  }

  return {
    canvasId: document.canvas_id,
    providerType: document.provider_type,
    snapshot: document.snapshot,
    updatedAt: toIsoString(document.updated_at),
    version: Number(document.version),
    workspaceId: document.workspace_id
  };
}

export function mapShape(shape: CanvasShapeRow): CanvasShapePayload {
  return {
    id: shape.id,
    canvasId: shape.canvas_id,
    parentShapeId: shape.parent_shape_id,
    shapeType: shape.shape_type,
    title: shape.title,
    textContent: shape.text_content,
    x: toNumber(shape.x),
    y: toNumber(shape.y),
    width: shape.width === null ? null : toNumber(shape.width),
    height: shape.height === null ? null : toNumber(shape.height),
    rotation: toNumber(shape.rotation),
    zIndex: Number(shape.z_index),
    childShapeCount:
      shape.child_shape_count === undefined ? 0 : Number(shape.child_shape_count),
    rawShape: shape.raw_shape ?? {},
    contentHash: shape.content_hash,
    revision: Number(shape.revision),
    createdAt: toIsoString(shape.created_at),
    updatedAt: toIsoString(shape.updated_at),
    deletedAt:
      shape.deleted_at === null ? null : toIsoString(shape.deleted_at)
  };
}

export function mapDeletedShape(
  shape: CanvasShapeDeleteRow
): CanvasShapeDeletePayload {
  if (shape.deleted_at === null) {
    throw badRequest("Canvas shape delete timestamp missing");
  }

  return {
    id: shape.id,
    deleted: true,
    deletedAt: toIsoString(shape.deleted_at),
    contentHash: shape.content_hash,
    revision: Number(shape.revision)
  };
}

export function mapShapeOperation(
  operation: CanvasShapeOperationRow
): CanvasShapeOperationPayload {
  return {
    id: operation.id,
    workspaceId: operation.workspace_id,
    canvasId: operation.canvas_id,
    shapeId: operation.shape_id,
    operationType: operation.operation_type,
    opSeq: Number(operation.op_seq),
    actorUserId: operation.actor_user_id,
    clientOperationId: operation.client_operation_id,
    baseRevision:
      operation.base_revision === null ? null : Number(operation.base_revision),
    resultRevision: Number(operation.result_revision),
    contentHash: operation.content_hash,
    payload: operation.payload ?? {},
    createdAt: toIsoString(operation.created_at)
  };
}

export function attachShapeOperationMeta<
  T extends CanvasShapeDeletePayload | CanvasShapePayload
>(payload: T, operation: CanvasShapeOperationPayload): T {
  return {
    ...payload,
    actorUserId: operation.actorUserId,
    clientOperationId: operation.clientOperationId,
    operationType: operation.operationType,
    opSeq: operation.opSeq
  };
}

export function mapCanvasUserState(
  userState: CanvasUserStateRow
): CanvasUserStatePayload {
  return {
    canvasId: userState.canvas_id,
    userId: userState.user_id,
    enteredAt: toIsoString(userState.entered_at),
    leftAt:
      userState.left_at === null ? null : toIsoString(userState.left_at)
  };
}

export function mergeShapeWriteValues(
  currentShape: CanvasShapeRow,
  values: ShapeWriteValues
): CompleteShapeWriteValues {
  return {
    parentShapeId:
      values.parentShapeId === undefined
        ? currentShape.parent_shape_id
        : values.parentShapeId,
    shapeType: values.shapeType ?? currentShape.shape_type,
    title: values.title === undefined ? currentShape.title : values.title,
    textContent:
      values.textContent === undefined
        ? currentShape.text_content
        : values.textContent,
    x: values.x ?? toNumber(currentShape.x),
    y: values.y ?? toNumber(currentShape.y),
    width:
      values.width === undefined
        ? currentShape.width === null
          ? null
          : toNumber(currentShape.width)
        : values.width,
    height:
      values.height === undefined
        ? currentShape.height === null
          ? null
          : toNumber(currentShape.height)
        : values.height,
    rotation: values.rotation ?? toNumber(currentShape.rotation),
    zIndex: values.zIndex ?? Number(currentShape.z_index),
    rawShape: values.rawShape ?? (currentShape.raw_shape ?? {})
  };
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
