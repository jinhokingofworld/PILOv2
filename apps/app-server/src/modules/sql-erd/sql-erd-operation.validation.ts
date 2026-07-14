import { badRequest, payloadTooLarge } from "../../common/api-error";
import {
  CreateSqlErdOperationRequest,
  ListSqlErdOperationsQuery,
  NormalizedListSqlErdOperationsInput,
  NormalizedSqlErdOperationInput,
  SqlErdJsonObject,
  SqlErdLayoutPatch,
  SqlErdLayoutPatchCollection
} from "./sql-erd.types";

const MAX_OPERATION_PAYLOAD_BYTES = 1024 * 1024;
const MAX_OPERATION_ID_LENGTH = 128;
const MAX_OPERATION_LIST_LIMIT = 100;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const OPERATION_REQUEST_FIELDS = new Set([
  "baseRevision",
  "clientOperationId",
  "patch",
  "type"
]);
const OPERATION_LIST_QUERY_FIELDS = new Set(["afterSeq", "limit"]);
const PATCH_COLLECTION_FIELDS = new Set(["deleteIds", "upsert"]);
const ANNOTATION_COLLECTION_NAMES = [
  "frames",
  "links",
  "notes",
  "strokes",
  "texts"
] as const;
const ANNOTATION_COLLECTION_NAME_SET = new Set(ANNOTATION_COLLECTION_NAMES);

export function validateCreateSqlErdOperationRequest(
  body: CreateSqlErdOperationRequest
): NormalizedSqlErdOperationInput {
  const draft = readPlainObject(body, "Request body");
  assertJsonSafety(draft, "Request body");
  assertAllowedFields(draft, OPERATION_REQUEST_FIELDS, "Request body");

  if (draft.type !== "layout_patch") {
    throw badRequest("type is invalid");
  }

  const patch = readLayoutPatch(draft.patch);
  assertPayloadSize(patch);

  return {
    baseRevision: readPositiveInteger(draft.baseRevision, "baseRevision"),
    clientOperationId: readClientOperationId(draft.clientOperationId),
    patch,
    type: "layout_patch"
  };
}

export function validateListSqlErdOperationsQuery(
  query: ListSqlErdOperationsQuery
): NormalizedListSqlErdOperationsInput {
  const draft = readPlainObject(query, "Query");
  assertAllowedFields(draft, OPERATION_LIST_QUERY_FIELDS, "Query");

  return {
    afterSeq:
      draft.afterSeq === undefined
        ? 0
        : readNonNegativeInteger(draft.afterSeq, "afterSeq"),
    limit:
      draft.limit === undefined
        ? MAX_OPERATION_LIST_LIMIT
        : readBoundedInteger(draft.limit, "limit", 1, MAX_OPERATION_LIST_LIMIT)
  };
}

function readLayoutPatch(value: unknown): SqlErdLayoutPatch {
  const patch = readPlainObject(value, "patch");
  assertJsonSafety(patch, "patch");
  assertAllowedFields(patch, new Set(["annotations", "tableLayouts", "viewport"]), "patch");

  const tableLayouts =
    patch.tableLayouts === undefined
      ? undefined
      : readCollectionPatch(patch.tableLayouts, "patch.tableLayouts", "tableId");
  const annotations =
    patch.annotations === undefined
      ? undefined
      : readAnnotationPatches(patch.annotations);
  const viewport =
    patch.viewport === undefined ? undefined : readViewportPatch(patch.viewport);

  if (!hasPatchCommand(tableLayouts, annotations, viewport)) {
    throw badRequest("patch must contain at least one command");
  }

  return { annotations, tableLayouts, viewport };
}

function readAnnotationPatches(
  value: unknown
): SqlErdLayoutPatch["annotations"] {
  const annotations = readPlainObject(value, "patch.annotations");
  assertAllowedFields(
    annotations,
    ANNOTATION_COLLECTION_NAME_SET,
    "patch.annotations"
  );

  const result: NonNullable<SqlErdLayoutPatch["annotations"]> = {};
  for (const name of ANNOTATION_COLLECTION_NAMES) {
    if (annotations[name] !== undefined) {
      result[name] = readCollectionPatch(
        annotations[name],
        `patch.annotations.${name}`,
        "id"
      );
    }
  }

  if (Object.keys(result).length === 0) {
    throw badRequest("patch.annotations must contain a collection command");
  }

  return result;
}

function readCollectionPatch(
  value: unknown,
  field: string,
  idField: "id" | "tableId"
): SqlErdLayoutPatchCollection {
  const collection = readPlainObject(value, field);
  assertAllowedFields(collection, PATCH_COLLECTION_FIELDS, field);

  const deleteIds =
    collection.deleteIds === undefined
      ? undefined
      : readIdentifierArray(collection.deleteIds, `${field}.deleteIds`);
  const upsert =
    collection.upsert === undefined
      ? undefined
      : readUpsertArray(collection.upsert, `${field}.upsert`, idField);

  if (deleteIds === undefined && upsert === undefined) {
    throw badRequest(`${field} must contain upsert or deleteIds`);
  }

  const upsertIds = new Set((upsert ?? []).map((item) => String(item[idField])));
  if ((deleteIds ?? []).some((id) => upsertIds.has(id))) {
    throw badRequest(`${field} cannot upsert and delete the same id`);
  }

  return { deleteIds, upsert };
}

function readViewportPatch(value: unknown): SqlErdLayoutPatch["viewport"] {
  const viewport = readPlainObject(value, "patch.viewport");
  assertAllowedFields(viewport, new Set(["action", "value"]), "patch.viewport");

  if (viewport.action === "delete") {
    if (viewport.value !== undefined) {
      throw badRequest("patch.viewport.delete must not include value");
    }
    return { action: "delete" };
  }

  if (viewport.action !== "set") {
    throw badRequest("patch.viewport.action is invalid");
  }

  const valueObject = readPlainObject(viewport.value, "patch.viewport.value");
  assertAllowedFields(valueObject, new Set(["x", "y", "zoom"]), "patch.viewport.value");
  const x = readFiniteNumber(valueObject.x, "patch.viewport.value.x");
  const y = readFiniteNumber(valueObject.y, "patch.viewport.value.y");
  const zoom = readFiniteNumber(valueObject.zoom, "patch.viewport.value.zoom");
  if (zoom <= 0) {
    throw badRequest("patch.viewport.value.zoom must be greater than 0");
  }

  return { action: "set", value: { x, y, zoom } };
}

function readUpsertArray(
  value: unknown,
  field: string,
  idField: "id" | "tableId"
): SqlErdJsonObject[] {
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array`);
  }

  const ids = new Set<string>();
  return value.map((item, index) => {
    const object = readPlainObject(item, `${field}[${index}]`);
    const id = readIdentifier(object[idField], `${field}[${index}].${idField}`);
    if (ids.has(id)) {
      throw badRequest(`${field} contains duplicate ${idField}`);
    }
    ids.add(id);
    return object;
  });
}

function readIdentifierArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array`);
  }

  const ids = value.map((item, index) => readIdentifier(item, `${field}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw badRequest(`${field} contains duplicate id`);
  }
  return ids;
}

function hasPatchCommand(
  tableLayouts: SqlErdLayoutPatchCollection | undefined,
  annotations: SqlErdLayoutPatch["annotations"],
  viewport: SqlErdLayoutPatch["viewport"]
): boolean {
  if (viewport) return true;
  if (hasCollectionCommand(tableLayouts)) return true;
  return Object.values(annotations ?? {}).some(hasCollectionCommand);
}

function hasCollectionCommand(
  patch: SqlErdLayoutPatchCollection | undefined
): boolean {
  return Boolean((patch?.deleteIds?.length ?? 0) + (patch?.upsert?.length ?? 0));
}

function readClientOperationId(value: unknown): string {
  if (typeof value !== "string") {
    throw badRequest("clientOperationId must be a string");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_OPERATION_ID_LENGTH) {
    throw badRequest("clientOperationId length is invalid");
  }
  return normalized;
}

function readPositiveInteger(value: unknown, field: string): number {
  const parsed = readInteger(value);
  if (parsed === null || parsed < 1) {
    throw badRequest(`${field} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  const parsed = readInteger(value);
  if (parsed === null || parsed < 0) {
    throw badRequest(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function readBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  const parsed = readInteger(value);
  if (parsed === null || parsed < minimum || parsed > maximum) {
    throw badRequest(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number`);
  }
  return value;
}

function readPlainObject(value: unknown, field: string): SqlErdJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return value as SqlErdJsonObject;
}

function assertAllowedFields(
  value: SqlErdJsonObject,
  allowed: ReadonlySet<string>,
  field: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw badRequest(`${field} has unknown field`);
    }
  }
}

function assertPayloadSize(patch: SqlErdLayoutPatch): void {
  const serialized = JSON.stringify(patch);
  if (Buffer.byteLength(serialized, "utf8") > MAX_OPERATION_PAYLOAD_BYTES) {
    throw payloadTooLarge("patch is too large");
  }
}

function assertJsonSafety(value: unknown, field: string): void {
  const visited = new WeakSet<object>();
  visit(value, field, 1, visited);
}

function visit(
  value: unknown,
  field: string,
  depth: number,
  visited: WeakSet<object>
): void {
  if (depth > 20) {
    throw badRequest(`${field} depth limit exceeded`);
  }
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) {
    throw badRequest(`${field} must be JSON serializable`);
  }
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, field, depth + 1, visited));
    return;
  }
  Object.entries(value as SqlErdJsonObject).forEach(([key, child]) => {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw badRequest(`${field} contains forbidden key`);
    }
    visit(child, field, depth + 1, visited);
  });
}
