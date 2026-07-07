import { badRequest, payloadTooLarge } from "../../common/api-error";
import {
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  NormalizedCreateSqlErdSessionInput,
  NormalizedDeleteSqlErdSessionInput,
  NormalizedUpdateSqlErdSessionInput,
  SqlErdDialect,
  SqlErdJsonObject,
  SqlErdSourceFormat,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TITLE = "Untitled ERD";
const DEFAULT_SOURCE_FORMAT: SqlErdSourceFormat = "sql";
const DEFAULT_DIALECT: SqlErdDialect = "auto";
const MAX_TITLE_LENGTH = 120;
const MAX_SOURCE_TEXT_BYTES = 1024 * 1024;
const MAX_MODEL_JSON_BYTES = 1024 * 1024;
const MAX_LAYOUT_JSON_BYTES = 1024 * 1024;
const MAX_SETTINGS_JSON_BYTES = 64 * 1024;
const MAX_TABLE_COUNT = 100;
const MAX_RELATION_COUNT = 300;
const SOURCE_FORMATS = new Set<SqlErdSourceFormat>(["sql"]);
const DIALECTS = new Set<SqlErdDialect>(["auto", "postgresql", "mysql"]);

export function validateSqlErdSessionId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest("sqltoerd sessionId is invalid");
  }

  return value;
}

export function validateCreateSqlErdSessionRequest(
  body: CreateSqlErdSessionRequest
): NormalizedCreateSqlErdSessionInput {
  const draft = readBody(body);
  const modelJson = readVersionedJsonObject(draft.modelJson, "modelJson");
  const layoutJson = readVersionedJsonObject(draft.layoutJson, "layoutJson");
  const counts = readModelCounts(modelJson);

  return {
    title: readTitle(draft.title),
    sourceFormat: readSourceFormat(draft.sourceFormat),
    dialect: readDialect(draft.dialect),
    sourceText: readSourceText(draft.sourceText),
    modelJson,
    layoutJson,
    settingsJson: readOptionalJsonObject(draft.settingsJson, "settingsJson"),
    tableCount: counts.tableCount,
    relationCount: counts.relationCount
  };
}

export function validateUpdateSqlErdSessionRequest(
  body: UpdateSqlErdSessionRequest
): NormalizedUpdateSqlErdSessionInput {
  const draft = readBody(body);
  const modelJson = readOptionalVersionedJsonObject(draft.modelJson, "modelJson");
  const counts = modelJson ? readModelCounts(modelJson) : undefined;
  const input: NormalizedUpdateSqlErdSessionInput = {
    baseRevision: readBaseRevision(draft.baseRevision),
    title: readOptionalTitle(draft.title),
    sourceFormat: readOptionalSourceFormat(draft.sourceFormat),
    dialect: readOptionalDialect(draft.dialect),
    sourceText: readOptionalSourceText(draft.sourceText),
    modelJson,
    layoutJson: readOptionalVersionedJsonObject(draft.layoutJson, "layoutJson"),
    settingsJson: readOptionalSettingsJson(draft.settingsJson),
    tableCount: counts?.tableCount,
    relationCount: counts?.relationCount
  };

  if (!hasUpdateField(input)) {
    throw badRequest("At least one update field is required");
  }

  return input;
}

export function validateDeleteSqlErdSessionQuery(
  query: DeleteSqlErdSessionQuery
): NormalizedDeleteSqlErdSessionInput {
  const draft = readBody(query);

  return {
    baseRevision: readBaseRevision(draft.baseRevision)
  };
}

function readBody(body: unknown): Record<string, unknown> {
  if (!isPlainJsonObject(body)) {
    throw badRequest("Request body must be an object");
  }

  return body;
}

function readTitle(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_TITLE;
  }

  if (typeof value !== "string") {
    throw badRequest("title must be a string");
  }

  const title = value.trim();
  if (!title) {
    throw badRequest("title is required");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw badRequest("title must be 120 characters or less");
  }

  return title;
}

function readOptionalTitle(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readTitle(value);
}

function readSourceFormat(value: unknown): SqlErdSourceFormat {
  if (value === undefined) {
    return DEFAULT_SOURCE_FORMAT;
  }

  if (typeof value !== "string" || !SOURCE_FORMATS.has(value as SqlErdSourceFormat)) {
    throw badRequest("sourceFormat is invalid");
  }

  return value as SqlErdSourceFormat;
}

function readOptionalSourceFormat(value: unknown): SqlErdSourceFormat | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readSourceFormat(value);
}

function readDialect(value: unknown): SqlErdDialect {
  if (value === undefined) {
    return DEFAULT_DIALECT;
  }

  if (typeof value !== "string" || !DIALECTS.has(value as SqlErdDialect)) {
    throw badRequest("dialect is invalid");
  }

  return value as SqlErdDialect;
}

function readOptionalDialect(value: unknown): SqlErdDialect | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readDialect(value);
}

function readSourceText(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value !== "string") {
    throw badRequest("sourceText must be a string");
  }

  if (Buffer.byteLength(value, "utf8") > MAX_SOURCE_TEXT_BYTES) {
    throw payloadTooLarge("sourceText is too large");
  }

  return value;
}

function readOptionalSourceText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readSourceText(value);
}

function readVersionedJsonObject(
  value: unknown,
  field: "modelJson" | "layoutJson"
): SqlErdJsonObject {
  if (!isPlainJsonObject(value)) {
    throw badRequest(`${field} must be an object`);
  }

  if (value.version !== 1) {
    throw badRequest(`${field}.version must be 1`);
  }

  assertJsonByteLength(
    value,
    field,
    field === "modelJson" ? MAX_MODEL_JSON_BYTES : MAX_LAYOUT_JSON_BYTES
  );

  return value;
}

function readOptionalVersionedJsonObject(
  value: unknown,
  field: "modelJson" | "layoutJson"
): SqlErdJsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readVersionedJsonObject(value, field);
}

function readOptionalJsonObject(
  value: unknown,
  field: "settingsJson"
): SqlErdJsonObject {
  if (value === undefined) {
    return {};
  }

  if (!isPlainJsonObject(value)) {
    throw badRequest(`${field} must be an object`);
  }

  assertJsonByteLength(value, field, MAX_SETTINGS_JSON_BYTES);

  return value;
}

function readOptionalSettingsJson(value: unknown): SqlErdJsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readOptionalJsonObject(value, "settingsJson");
}

function readBaseRevision(value: unknown): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }

    throw badRequest("baseRevision must be a positive integer");
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  throw badRequest("baseRevision is required");
}

function hasUpdateField(input: NormalizedUpdateSqlErdSessionInput): boolean {
  return (
    input.title !== undefined ||
    input.sourceFormat !== undefined ||
    input.dialect !== undefined ||
    input.sourceText !== undefined ||
    input.modelJson !== undefined ||
    input.layoutJson !== undefined ||
    input.settingsJson !== undefined
  );
}

function assertJsonByteLength(
  value: SqlErdJsonObject,
  field: "modelJson" | "layoutJson" | "settingsJson",
  maxBytes: number
): void {
  const serialized = stringifyJsonObject(value, field);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw payloadTooLarge(`${field} is too large`);
  }
}

function stringifyJsonObject(
  value: SqlErdJsonObject,
  field: "modelJson" | "layoutJson" | "settingsJson"
): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw badRequest(`${field} must be JSON serializable`);
  }
}

function readModelCounts(modelJson: SqlErdJsonObject): {
  tableCount: number;
  relationCount: number;
} {
  const schema = modelJson.schema;
  if (!isPlainJsonObject(schema)) {
    throw badRequest("modelJson.schema must be an object");
  }

  if (!Array.isArray(schema.tables)) {
    throw badRequest("modelJson.schema.tables must be an array");
  }

  if (!Array.isArray(schema.relations)) {
    throw badRequest("modelJson.schema.relations must be an array");
  }

  const tableCount = schema.tables.length;
  const relationCount = schema.relations.length;
  if (tableCount > MAX_TABLE_COUNT) {
    throw badRequest("table count limit exceeded");
  }

  if (relationCount > MAX_RELATION_COUNT) {
    throw badRequest("relation count limit exceeded");
  }

  return {
    tableCount,
    relationCount
  };
}

function isPlainJsonObject(value: unknown): value is SqlErdJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
