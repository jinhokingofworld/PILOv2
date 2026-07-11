import { badRequest } from "../../common/api-error";
import {
  CanvasShapeBatchOperationValues,
  CompleteShapeWriteValues,
  CreateCanvasShapeRequest,
  CreateCanvasRequest,
  ListCanvasOperationsQuery,
  ListCanvasShapesQuery,
  ShapeWriteValues,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasShapeRequest,
  UpdateCanvasViewSettingRequest,
  ViewportBoundsValues,
  CanvasViewSettingPayload
} from "./canvas.types";

const MAX_CANVAS_TITLE_LENGTH = 120;
export const MAX_CANVAS_SHAPE_BATCH_OPERATIONS = 100;
const ALLOWED_SHAPE_TYPES = new Set([
  "sticky-note",
  "note",
  "text",
  "frame",
  "draw",
  "highlight",
  "geo",
  "arrow",
  "line",
  "image",
  "video",
  "bookmark",
  "embed",
  "pilo-code-block",
  "file_node",
  "group"
]);

export function validateCanvasTitle(value: CreateCanvasRequest["title"]): string {
  const title = typeof value === "string" ? value.trim() : "";

  if (title.length > MAX_CANVAS_TITLE_LENGTH) {
    throw badRequest("Canvas title must be 120 characters or less");
  }

  return title || "Untitled canvas";
}

export function validateShapeId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("Canvas shape id is required");
  }

  return value.trim();
}

export function validateShapeCreate(
  input: CreateCanvasShapeRequest
): CompleteShapeWriteValues {
  return {
    parentShapeId: validateOptionalParentShapeId(input.parentShapeId),
    shapeType: validateShapeType(input.shapeType),
    title: validateNullableString(input.title, "Shape title"),
    textContent: validateNullableString(
      input.textContent,
      "Shape textContent"
    ),
    x: validateNumber(input.x, "Shape x", 0),
    y: validateNumber(input.y, "Shape y", 0),
    width: validateNullableNonNegativeNumber(input.width, "Shape width"),
    height: validateNullableNonNegativeNumber(
      input.height,
      "Shape height"
    ),
    rotation: validateNumber(input.rotation, "Shape rotation", 0),
    zIndex: validateInteger(input.zIndex, "Shape zIndex", 0),
    rawShape: validateRawShape(input.rawShape)
  };
}

export function validateShapeUpdate(
  input: UpdateCanvasShapeRequest
): ShapeWriteValues {
  if (!isRecord(input)) {
    throw badRequest("Canvas shape update body is required");
  }

  const values: ShapeWriteValues = {};

  if (hasOwn(input, "shapeType")) {
    values.shapeType = validateShapeType(input.shapeType);
  }

  if (hasOwn(input, "parentShapeId")) {
    values.parentShapeId = validateOptionalParentShapeId(input.parentShapeId);
  }

  if (hasOwn(input, "title")) {
    values.title = validateNullableString(input.title, "Shape title");
  }

  if (hasOwn(input, "textContent")) {
    values.textContent = validateNullableString(
      input.textContent,
      "Shape textContent"
    );
  }

  if (hasOwn(input, "x")) {
    values.x = validateNumber(input.x, "Shape x");
  }

  if (hasOwn(input, "y")) {
    values.y = validateNumber(input.y, "Shape y");
  }

  if (hasOwn(input, "width")) {
    values.width = validateNullableNonNegativeNumber(
      input.width,
      "Shape width"
    );
  }

  if (hasOwn(input, "height")) {
    values.height = validateNullableNonNegativeNumber(
      input.height,
      "Shape height"
    );
  }

  if (hasOwn(input, "rotation")) {
    values.rotation = validateNumber(input.rotation, "Shape rotation");
  }

  if (hasOwn(input, "zIndex")) {
    values.zIndex = validateInteger(input.zIndex, "Shape zIndex");
  }

  if (hasOwn(input, "rawShape")) {
    values.rawShape = validateRawShape(input.rawShape);
  }

  if (Object.keys(values).length === 0) {
    throw badRequest("Canvas shape update body is required");
  }

  return values;
}

export function validateShapeBatchOperations(
  input: SyncCanvasShapesBatchRequest
): CanvasShapeBatchOperationValues[] {
  if (!isRecord(input)) {
    throw badRequest("Canvas shape batch body is required");
  }

  if (!Array.isArray(input.operations)) {
    throw badRequest("Canvas shape batch operations must be an array");
  }

  if (input.operations.length > MAX_CANVAS_SHAPE_BATCH_OPERATIONS) {
    throw badRequest(
      `Canvas shape batch operations must be ${MAX_CANVAS_SHAPE_BATCH_OPERATIONS} or fewer`
    );
  }

  return input.operations.map((operation, index) => {
    if (!isRecord(operation)) {
      throw badRequest(`Canvas shape batch operation ${index} is invalid`);
    }

    const type = operation.type;
    if (type !== "create" && type !== "update" && type !== "delete") {
      throw badRequest(`Canvas shape batch operation ${index} type is invalid`);
    }

    const shapeId = validateShapeId(operation.shapeId);
    const clientOperationId = validateOptionalClientOperationId(
      operation.clientOperationId,
      `Canvas shape batch operation ${index} clientOperationId`
    );
    const baseRevision = validateOptionalBaseRevision(
      operation.baseRevision,
      `Canvas shape batch operation ${index} baseRevision`
    );

    if (type === "delete") {
      return {
        baseRevision,
        clientOperationId,
        type,
        shapeId
      };
    }

    if (!isRecord(operation.payload)) {
      throw badRequest(
        `Canvas shape batch operation ${index} payload is required`
      );
    }

    if (type === "create") {
      if (hasOwn(operation.payload, "id")) {
        const payloadShapeId = validateShapeId(operation.payload.id);
        if (payloadShapeId !== shapeId) {
          throw badRequest(
            `Canvas shape batch operation ${index} shapeId must match payload id`
          );
        }
      }

      return {
        baseRevision,
        clientOperationId,
        type,
        shapeId,
        payload: {
          ...operation.payload,
          id: shapeId
        }
      };
    }

    return {
      baseRevision,
      clientOperationId,
      type,
      shapeId,
      payload: operation.payload
    };
  });
}

export function validateViewSetting(
  input: UpdateCanvasViewSettingRequest
): CanvasViewSettingPayload {
  if (!isRecord(input)) {
    throw badRequest("Canvas view setting body is required");
  }

  const zoom = validateNumber(input.zoom, "Canvas zoom");
  if (zoom <= 0) {
    throw badRequest("Canvas zoom must be greater than 0");
  }

  return {
    zoom,
    viewportX: validateNumber(input.viewportX, "Canvas viewportX"),
    viewportY: validateNumber(input.viewportY, "Canvas viewportY")
  };
}

export function validateViewportBounds(
  input: ListCanvasShapesQuery
): ViewportBoundsValues {
  if (!isRecord(input)) {
    throw badRequest("Canvas viewport bounds query is required");
  }

  const parentShapeId = validateOptionalParentShapeId(input.parentShapeId);

  if (parentShapeId !== null) {
    return { parentShapeId };
  }

  const width = validateQueryNumber(input.width, "Canvas viewport width");
  const height = validateQueryNumber(input.height, "Canvas viewport height");
  const margin = validateQueryNumber(input.margin, "Canvas viewport margin", 0);

  if (width <= 0) {
    throw badRequest("Canvas viewport width must be greater than 0");
  }

  if (height <= 0) {
    throw badRequest("Canvas viewport height must be greater than 0");
  }

  if (margin < 0) {
    throw badRequest("Canvas viewport margin must be greater than or equal to 0");
  }

  return {
    parentShapeId,
    x: validateQueryNumber(input.x, "Canvas viewport x"),
    y: validateQueryNumber(input.y, "Canvas viewport y"),
    width,
    height,
    margin
  };
}

export function validateCanvasOperationsAfterSeq(
  input: ListCanvasOperationsQuery
): number {
  if (!isRecord(input)) {
    return 0;
  }

  const afterSeq = validateQueryNumber(
    input.afterSeq,
    "Canvas operations afterSeq",
    0
  );

  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw badRequest(
      "Canvas operations afterSeq must be a non-negative integer"
    );
  }

  return afterSeq;
}

export function validateOptionalClientOperationId(
  value: unknown,
  fieldName = "Canvas shape clientOperationId"
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

export function validateOptionalParentShapeId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return validateShapeId(value);
}

export function validateOptionalBaseRevision(
  value: unknown,
  fieldName = "Canvas shape baseRevision"
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const revision = validateInteger(value, fieldName);

  if (revision <= 0) {
    throw badRequest(`${fieldName} must be greater than 0`);
  }

  return revision;
}

function validateShapeType(value: unknown): string {
  if (typeof value !== "string" || !ALLOWED_SHAPE_TYPES.has(value)) {
    throw badRequest("Canvas shapeType is invalid");
  }

  return value;
}

function validateNullableString(
  value: unknown,
  fieldName: string
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw badRequest(`${fieldName} must be a string`);
  }

  return value;
}

function validateNumber(
  value: unknown,
  fieldName: string,
  fallback?: number
): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw badRequest(`${fieldName} is required`);
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${fieldName} must be a finite number`);
  }

  return value;
}

function validateQueryNumber(
  value: unknown,
  fieldName: string,
  fallback?: number
): number {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }

    throw badRequest(`${fieldName} is required`);
  }

  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numberValue)) {
    throw badRequest(`${fieldName} must be a finite number`);
  }

  return numberValue;
}

function validateNullableNonNegativeNumber(
  value: unknown,
  fieldName: string
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const numberValue = validateNumber(value, fieldName);
  if (numberValue < 0) {
    throw badRequest(`${fieldName} must be greater than or equal to 0`);
  }

  return numberValue;
}

function validateInteger(
  value: unknown,
  fieldName: string,
  fallback?: number
): number {
  const numberValue = validateNumber(value, fieldName, fallback);

  if (!Number.isInteger(numberValue)) {
    throw badRequest(`${fieldName} must be an integer`);
  }

  return numberValue;
}

function validateRawShape(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw badRequest("Shape rawShape must be an object");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
