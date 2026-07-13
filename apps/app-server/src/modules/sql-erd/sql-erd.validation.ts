import { badRequest, payloadTooLarge } from "../../common/api-error";
import { decodeSqlErdSessionCursor } from "./sql-erd.cursor";
import {
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  ListSqlErdSessionsQuery,
  NormalizedCreateSqlErdSessionInput,
  NormalizedDeleteSqlErdSessionInput,
  NormalizedListSqlErdSessionsInput,
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
const MAX_ANNOTATION_COUNT = 300;
const MAX_CANVAS_NOTE_COUNT = 100;
const MAX_CANVAS_FRAME_COUNT = 100;
const MAX_COLUMN_COUNT = 1000;
const MAX_COLUMNS_PER_TABLE = 200;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_COLUMN_TYPE_LENGTH = 512;
const MAX_ANNOTATION_LABEL_LENGTH = 200;
const MAX_CANVAS_NOTE_TEXT_LENGTH = 2_000;
const MAX_CANVAS_FRAME_TITLE_LENGTH = 200;
const MAX_JSON_DEPTH = 20;
const SOURCE_FORMATS = new Set<SqlErdSourceFormat>(["sql"]);
const DIALECTS = new Set<SqlErdDialect>([
  "auto",
  "postgresql",
  "mysql",
  "sqlite"
]);
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CREATE_REQUEST_FIELDS = new Set([
  "title",
  "sourceFormat",
  "dialect",
  "sourceText",
  "modelJson",
  "layoutJson",
  "settingsJson"
]);
const UPDATE_REQUEST_FIELDS = new Set([
  "baseRevision",
  "title",
  "sourceFormat",
  "dialect",
  "sourceText",
  "modelJson",
  "layoutJson",
  "settingsJson"
]);
const DELETE_QUERY_FIELDS = new Set(["baseRevision"]);
const LIST_QUERY_FIELDS = new Set(["limit", "cursor"]);
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_CURSOR_LENGTH = 2048;

interface ModelMetadata {
  tableCount: number;
  relationCount: number;
  tableIds: Set<string>;
  tableColumnIds: Map<string, Set<string>>;
}

export function validateSqlErdSessionId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest("sqltoerd sessionId is invalid");
  }

  return value;
}

export function validateCreateSqlErdSessionRequest(
  body: CreateSqlErdSessionRequest
): NormalizedCreateSqlErdSessionInput {
  const draft = readBody(body, CREATE_REQUEST_FIELDS);
  const modelJson = readVersionedJsonObject(draft.modelJson, "modelJson");
  const layoutJson = readVersionedJsonObject(draft.layoutJson, "layoutJson");
  const metadata = readModelMetadata(modelJson);
  validateLayoutJson(layoutJson, metadata);

  return {
    title: readTitle(draft.title),
    sourceFormat: readSourceFormat(draft.sourceFormat),
    dialect: readDialect(draft.dialect),
    sourceText: readSourceText(draft.sourceText),
    modelJson,
    layoutJson,
    settingsJson: readOptionalJsonObject(draft.settingsJson, "settingsJson"),
    tableCount: metadata.tableCount,
    relationCount: metadata.relationCount
  };
}

export function validateUpdateSqlErdSessionRequest(
  body: UpdateSqlErdSessionRequest
): NormalizedUpdateSqlErdSessionInput {
  const draft = readBody(body, UPDATE_REQUEST_FIELDS);
  const modelJson = readOptionalVersionedJsonObject(draft.modelJson, "modelJson");
  const metadata = modelJson ? readModelMetadata(modelJson) : undefined;
  const input: NormalizedUpdateSqlErdSessionInput = {
    baseRevision: readBaseRevision(draft.baseRevision),
    title: readOptionalTitle(draft.title),
    sourceFormat: readOptionalSourceFormat(draft.sourceFormat),
    dialect: readOptionalDialect(draft.dialect),
    sourceText: readOptionalSourceText(draft.sourceText),
    modelJson,
    layoutJson: readOptionalVersionedJsonObject(draft.layoutJson, "layoutJson"),
    settingsJson: readOptionalSettingsJson(draft.settingsJson),
    tableCount: metadata?.tableCount,
    relationCount: metadata?.relationCount
  };

  if (!hasUpdateField(input)) {
    throw badRequest("At least one update field is required");
  }

  return input;
}

export function validateDeleteSqlErdSessionQuery(
  query: DeleteSqlErdSessionQuery
): NormalizedDeleteSqlErdSessionInput {
  const draft = readBody(query, DELETE_QUERY_FIELDS);

  return {
    baseRevision: readBaseRevision(draft.baseRevision)
  };
}

export function validateListSqlErdSessionsQuery(
  query: ListSqlErdSessionsQuery
): NormalizedListSqlErdSessionsInput {
  if (!isPlainJsonObject(query)) {
    throw badRequest("Query must be an object");
  }

  assertAllowedFields(query, LIST_QUERY_FIELDS, "Query");
  return {
    limit: readListLimit(query.limit),
    cursor: readListCursor(query.cursor)
  };
}

export function validateSqlErdLayoutJson(
  layoutJson: SqlErdJsonObject,
  modelJson: SqlErdJsonObject
): void {
  const metadata = readModelMetadata(modelJson);
  validateLayoutJson(layoutJson, metadata);
}

function readBody(
  body: unknown,
  allowedFields: ReadonlySet<string>
): Record<string, unknown> {
  if (!isPlainJsonObject(body)) {
    throw badRequest("Request body must be an object");
  }

  assertNoForbiddenJsonKeys(body, "Request body");
  assertAllowedFields(body, allowedFields, "Request body");

  return body;
}

function readListLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
    throw badRequest("limit must be an integer between 1 and 100");
  }

  return parsed;
}

function readListCursor(value: unknown): NormalizedListSqlErdSessionsInput["cursor"] {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.length > MAX_CURSOR_LENGTH) {
    throw badRequest("sqltoerd cursor is invalid");
  }

  return decodeSqlErdSessionCursor(value);
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

  assertJsonPayloadSafety(value, field);

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

  assertJsonPayloadSafety(value, field);
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

function readModelMetadata(modelJson: SqlErdJsonObject): ModelMetadata {
  assertAllowedFields(modelJson, new Set(["version", "schema"]), "modelJson");

  const schema = modelJson.schema;
  if (!isPlainJsonObject(schema)) {
    throw badRequest("modelJson.schema must be an object");
  }

  assertAllowedFields(schema, new Set(["tables", "relations"]), "modelJson.schema");

  if (!Array.isArray(schema.tables)) {
    throw badRequest("modelJson.schema.tables must be an array");
  }

  if (!Array.isArray(schema.relations)) {
    throw badRequest("modelJson.schema.relations must be an array");
  }

  const tableCount = schema.tables.length;
  const relationCount = schema.relations.length;
  const tableIds = new Set<string>();
  const tableColumnIds = new Map<string, Set<string>>();
  let columnCount = 0;

  if (tableCount > MAX_TABLE_COUNT) {
    throw badRequest("table count limit exceeded");
  }

  if (relationCount > MAX_RELATION_COUNT) {
    throw badRequest("relation count limit exceeded");
  }

  schema.tables.forEach((table, tableIndex) => {
    const tablePath = `modelJson.schema.tables[${tableIndex}]`;
    const tableObject = readPlainJsonObject(table, tablePath);
    assertAllowedFields(
      tableObject,
      new Set(["id", "name", "schemaName", "columns", "constraints", "comment"]),
      tablePath
    );

    const tableId = readIdentifier(tableObject.id, `${tablePath}.id`);
    readIdentifier(tableObject.name, `${tablePath}.name`);
    readNullableIdentifier(tableObject.schemaName, `${tablePath}.schemaName`);
    readNullableString(tableObject.comment, `${tablePath}.comment`);

    if (tableIds.has(tableId)) {
      throw badRequest("duplicate table id");
    }

    tableIds.add(tableId);

    if (!Array.isArray(tableObject.columns)) {
      throw badRequest(`${tablePath}.columns must be an array`);
    }

    if (tableObject.columns.length > MAX_COLUMNS_PER_TABLE) {
      throw badRequest("table column count limit exceeded");
    }

    columnCount += tableObject.columns.length;
    if (columnCount > MAX_COLUMN_COUNT) {
      throw badRequest("column count limit exceeded");
    }

    const columnIds = new Set<string>();
    tableObject.columns.forEach((column, columnIndex) => {
      const columnPath = `${tablePath}.columns[${columnIndex}]`;
      const columnObject = readPlainJsonObject(column, columnPath);
      assertAllowedFields(
        columnObject,
        new Set([
          "id",
          "name",
          "dataType",
          "nullable",
          "primaryKey",
          "foreignKey",
          "unique",
          "defaultValue",
          "comment"
        ]),
        columnPath
      );

      const columnId = readIdentifier(columnObject.id, `${columnPath}.id`);
      readIdentifier(columnObject.name, `${columnPath}.name`);
      readColumnType(columnObject.dataType, `${columnPath}.dataType`);
      readBoolean(columnObject.nullable, `${columnPath}.nullable`);
      readBoolean(columnObject.primaryKey, `${columnPath}.primaryKey`);
      readBoolean(columnObject.foreignKey, `${columnPath}.foreignKey`);
      readBoolean(columnObject.unique, `${columnPath}.unique`);
      readNullableString(columnObject.defaultValue, `${columnPath}.defaultValue`);
      readNullableString(columnObject.comment, `${columnPath}.comment`);

      if (columnIds.has(columnId)) {
        throw badRequest("duplicate column id");
      }

      columnIds.add(columnId);
    });
    tableColumnIds.set(tableId, columnIds);

    if (!Array.isArray(tableObject.constraints)) {
      throw badRequest(`${tablePath}.constraints must be an array`);
    }

    const constraintIds = new Set<string>();
    tableObject.constraints.forEach((constraint, constraintIndex) => {
      const constraintPath = `${tablePath}.constraints[${constraintIndex}]`;
      const constraintObject = readPlainJsonObject(constraint, constraintPath);
      assertAllowedFields(
        constraintObject,
        new Set(["id", "kind", "columnIds", "name"]),
        constraintPath
      );

      const constraintId = readIdentifier(
        constraintObject.id,
        `${constraintPath}.id`
      );
      if (constraintIds.has(constraintId)) {
        throw badRequest("duplicate constraint id");
      }

      constraintIds.add(constraintId);

      if (
        constraintObject.kind !== "primary_key" &&
        constraintObject.kind !== "unique"
      ) {
        throw badRequest(`${constraintPath}.kind is invalid`);
      }

      const constraintColumnIds = readIdentifierArray(
        constraintObject.columnIds,
        `${constraintPath}.columnIds`
      );
      constraintColumnIds.forEach((columnId) => {
        if (!columnIds.has(columnId)) {
          throw badRequest("constraint column reference is invalid");
        }
      });
      readNullableIdentifier(constraintObject.name, `${constraintPath}.name`);
    });
  });

  const relationIds = new Set<string>();
  schema.relations.forEach((relation, relationIndex) => {
    const relationPath = `modelJson.schema.relations[${relationIndex}]`;
    const relationObject = readPlainJsonObject(relation, relationPath);
    assertAllowedFields(
      relationObject,
      new Set([
        "id",
        "kind",
        "fromTableId",
        "fromColumnIds",
        "toTableId",
        "toColumnIds",
        "constraintName"
      ]),
      relationPath
    );

    const relationId = readIdentifier(relationObject.id, `${relationPath}.id`);
    if (relationIds.has(relationId)) {
      throw badRequest("duplicate relation id");
    }

    relationIds.add(relationId);

    if (relationObject.kind !== "foreign_key") {
      throw badRequest(`${relationPath}.kind is invalid`);
    }

    const fromTableId = readIdentifier(
      relationObject.fromTableId,
      `${relationPath}.fromTableId`
    );
    const toTableId = readIdentifier(
      relationObject.toTableId,
      `${relationPath}.toTableId`
    );

    if (!tableIds.has(fromTableId) || !tableIds.has(toTableId)) {
      throw badRequest("relation table reference is invalid");
    }

    const fromColumnIds = readIdentifierArray(
      relationObject.fromColumnIds,
      `${relationPath}.fromColumnIds`
    );
    const toColumnIds = readIdentifierArray(
      relationObject.toColumnIds,
      `${relationPath}.toColumnIds`
    );

    if (fromColumnIds.length !== toColumnIds.length) {
      throw badRequest("relation column reference length mismatch");
    }

    const fromColumns = tableColumnIds.get(fromTableId) ?? new Set<string>();
    const toColumns = tableColumnIds.get(toTableId) ?? new Set<string>();
    fromColumnIds.forEach((columnId) => {
      if (!fromColumns.has(columnId)) {
        throw badRequest("relation fromColumnIds reference is invalid");
      }
    });
    toColumnIds.forEach((columnId) => {
      if (!toColumns.has(columnId)) {
        throw badRequest("relation toColumnIds reference is invalid");
      }
    });
    readNullableIdentifier(
      relationObject.constraintName,
      `${relationPath}.constraintName`
    );
  });

  return {
    tableCount,
    relationCount,
    tableIds,
    tableColumnIds
  };
}

function validateLayoutJson(
  layoutJson: SqlErdJsonObject,
  metadata: ModelMetadata
): void {
  const { tableIds } = metadata;
  assertAllowedFields(
    layoutJson,
    new Set(["version", "tableLayouts", "viewport", "annotations"]),
    "layoutJson"
  );

  if (!Array.isArray(layoutJson.tableLayouts)) {
    throw badRequest("layoutJson.tableLayouts must be an array");
  }

  if (layoutJson.tableLayouts.length > tableIds.size) {
    throw badRequest("layoutJson.tableLayouts length limit exceeded");
  }

  const layoutTableIds = new Set<string>();
  layoutJson.tableLayouts.forEach((tableLayout, layoutIndex) => {
    const layoutPath = `layoutJson.tableLayouts[${layoutIndex}]`;
    const layoutObject = readPlainJsonObject(tableLayout, layoutPath);
    assertAllowedFields(
      layoutObject,
      new Set(["tableId", "x", "y", "width"]),
      layoutPath
    );

    const tableId = readIdentifier(layoutObject.tableId, `${layoutPath}.tableId`);
    if (!tableIds.has(tableId)) {
      throw badRequest("layoutJson.tableLayouts tableId reference is invalid");
    }

    if (layoutTableIds.has(tableId)) {
      throw badRequest("duplicate layout tableId");
    }

    layoutTableIds.add(tableId);
    readFiniteNumber(layoutObject.x, `${layoutPath}.x`);
    readFiniteNumber(layoutObject.y, `${layoutPath}.y`);
    if (layoutObject.width !== undefined) {
      readFiniteNumber(layoutObject.width, `${layoutPath}.width`);
    }
  });

  if (layoutJson.viewport !== undefined) {
    const viewport = readPlainJsonObject(layoutJson.viewport, "layoutJson.viewport");
    assertAllowedFields(
      viewport,
      new Set(["x", "y", "zoom"]),
      "layoutJson.viewport"
    );
    readFiniteNumber(viewport.x, "layoutJson.viewport.x");
    readFiniteNumber(viewport.y, "layoutJson.viewport.y");
    const zoom = readFiniteNumber(viewport.zoom, "layoutJson.viewport.zoom");
    if (zoom <= 0) {
      throw badRequest("layoutJson.viewport.zoom must be greater than 0");
    }
  }

  if (layoutJson.annotations !== undefined) {
    validateAnnotations(layoutJson.annotations, metadata);
  }
}

function validateAnnotations(value: unknown, metadata: ModelMetadata): void {
  const annotations = readPlainJsonObject(value, "layoutJson.annotations");
  assertAllowedFields(
    annotations,
    new Set(["version", "links", "notes", "frames"]),
    "layoutJson.annotations"
  );

  if (annotations.version !== 1) {
    throw badRequest("layoutJson.annotations.version must be 1");
  }

  if (!Array.isArray(annotations.links)) {
    throw badRequest("layoutJson.annotations.links must be an array");
  }

  if (annotations.links.length > MAX_ANNOTATION_COUNT) {
    throw badRequest("layoutJson.annotations.links length limit exceeded");
  }

  const annotationIds = new Set<string>();
  const endpointKeys = new Set<string>();

  annotations.links.forEach((link, linkIndex) => {
    const linkPath = `layoutJson.annotations.links[${linkIndex}]`;
    const linkObject = readPlainJsonObject(link, linkPath);
    const kind = linkObject.kind;

    if (kind !== "table_link" && kind !== "column_link") {
      throw badRequest(`${linkPath}.kind is invalid`);
    }

    assertAllowedFields(
      linkObject,
      kind === "table_link"
        ? new Set(["id", "kind", "fromTableId", "toTableId", "label"])
        : new Set([
            "id",
            "kind",
            "fromTableId",
            "fromColumnId",
            "toTableId",
            "toColumnId",
            "label"
          ]),
      linkPath
    );

    const annotationId = readIdentifier(linkObject.id, `${linkPath}.id`);
    if (annotationIds.has(annotationId)) {
      throw badRequest("duplicate annotation id");
    }
    annotationIds.add(annotationId);

    const fromTableId = readIdentifier(
      linkObject.fromTableId,
      `${linkPath}.fromTableId`
    );
    const toTableId = readIdentifier(
      linkObject.toTableId,
      `${linkPath}.toTableId`
    );
    if (!metadata.tableIds.has(fromTableId) || !metadata.tableIds.has(toTableId)) {
      throw badRequest("annotation table reference is invalid");
    }

    readAnnotationLabel(linkObject.label, `${linkPath}.label`);

    let endpointKey: string;
    if (kind === "table_link") {
      endpointKey = createUndirectedEndpointKey(
        kind,
        [fromTableId],
        [toTableId]
      );
    } else {
      const fromColumnId = readIdentifier(
        linkObject.fromColumnId,
        `${linkPath}.fromColumnId`
      );
      const toColumnId = readIdentifier(
        linkObject.toColumnId,
        `${linkPath}.toColumnId`
      );
      if (
        !metadata.tableColumnIds.get(fromTableId)?.has(fromColumnId) ||
        !metadata.tableColumnIds.get(toTableId)?.has(toColumnId)
      ) {
        throw badRequest("annotation column reference is invalid");
      }

      endpointKey = createUndirectedEndpointKey(
        kind,
        [fromTableId, fromColumnId],
        [toTableId, toColumnId]
      );
    }

    if (endpointKeys.has(endpointKey)) {
      throw badRequest("duplicate annotation endpoint");
    }
    endpointKeys.add(endpointKey);
  });

  validateCanvasNotes(annotations.notes, annotationIds);
  validateCanvasFrames(annotations.frames, annotationIds);
}

function validateCanvasNotes(value: unknown, annotationIds: Set<string>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw badRequest("layoutJson.annotations.notes must be an array");
  }
  if (value.length > MAX_CANVAS_NOTE_COUNT) {
    throw badRequest("layoutJson.annotations.notes length limit exceeded");
  }

  value.forEach((note, index) => {
    const path = `layoutJson.annotations.notes[${index}]`;
    const noteObject = readPlainJsonObject(note, path);
    assertAllowedFields(noteObject, new Set(["id", "x", "y", "width", "height", "text"]), path);
    readUniqueAnnotationId(noteObject.id, `${path}.id`, annotationIds);
    readFiniteNumber(noteObject.x, `${path}.x`);
    readFiniteNumber(noteObject.y, `${path}.y`);
    readPositiveFiniteNumber(noteObject.width, `${path}.width`);
    readPositiveFiniteNumber(noteObject.height, `${path}.height`);
    readBoundedString(noteObject.text, `${path}.text`, MAX_CANVAS_NOTE_TEXT_LENGTH);
  });
}

function validateCanvasFrames(value: unknown, annotationIds: Set<string>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw badRequest("layoutJson.annotations.frames must be an array");
  }
  if (value.length > MAX_CANVAS_FRAME_COUNT) {
    throw badRequest("layoutJson.annotations.frames length limit exceeded");
  }

  value.forEach((frame, index) => {
    const path = `layoutJson.annotations.frames[${index}]`;
    const frameObject = readPlainJsonObject(frame, path);
    assertAllowedFields(frameObject, new Set(["id", "x", "y", "width", "height", "title", "color", "isLocked"]), path);
    readUniqueAnnotationId(frameObject.id, `${path}.id`, annotationIds);
    readFiniteNumber(frameObject.x, `${path}.x`);
    readFiniteNumber(frameObject.y, `${path}.y`);
    readPositiveFiniteNumber(frameObject.width, `${path}.width`);
    readPositiveFiniteNumber(frameObject.height, `${path}.height`);
    readBoundedString(frameObject.title, `${path}.title`, MAX_CANVAS_FRAME_TITLE_LENGTH);
    if (!["slate", "blue", "green", "amber", "rose"].includes(frameObject.color as string)) {
      throw badRequest(`${path}.color is invalid`);
    }
    readBoolean(frameObject.isLocked, `${path}.isLocked`);
  });
}

function readUniqueAnnotationId(value: unknown, field: string, annotationIds: Set<string>): string {
  const annotationId = readIdentifier(value, field);
  if (annotationIds.has(annotationId)) throw badRequest("duplicate annotation id");
  annotationIds.add(annotationId);
  return annotationId;
}

function createUndirectedEndpointKey(
  kind: "table_link" | "column_link",
  from: readonly string[],
  to: readonly string[]
): string {
  const endpoints = [JSON.stringify(from), JSON.stringify(to)].sort();
  return JSON.stringify([kind, ...endpoints]);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  field: string
): void {
  Object.keys(value).forEach((key) => {
    if (!allowedFields.has(key)) {
      throw badRequest(`${field} has unknown field`);
    }
  });
}

function assertJsonPayloadSafety(
  value: unknown,
  field: "modelJson" | "layoutJson" | "settingsJson"
): void {
  const visited = new WeakSet<object>();
  visitJsonValue(value, field, 1, visited);
}

function assertNoForbiddenJsonKeys(
  value: unknown,
  field: string,
  visited = new WeakSet<object>()
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (visited.has(value)) {
    throw badRequest(`${field} must be JSON serializable`);
  }

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForbiddenJsonKeys(item, field, visited));
    return;
  }

  Object.keys(value as Record<string, unknown>).forEach((key) => {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw badRequest(`${field} contains forbidden key`);
    }

    assertNoForbiddenJsonKeys(
      (value as Record<string, unknown>)[key],
      field,
      visited
    );
  });
}

function visitJsonValue(
  value: unknown,
  field: string,
  depth: number,
  visited: WeakSet<object>
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw badRequest(`${field} depth limit exceeded`);
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (visited.has(value)) {
    throw badRequest(`${field} must be JSON serializable`);
  }

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => visitJsonValue(item, field, depth + 1, visited));
    return;
  }

  Object.keys(value as Record<string, unknown>).forEach((key) => {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw badRequest(`${field} contains forbidden key`);
    }

    visitJsonValue(
      (value as Record<string, unknown>)[key],
      field,
      depth + 1,
      visited
    );
  });
}

function readPlainJsonObject(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (!isPlainJsonObject(value)) {
    throw badRequest(`${field} must be an object`);
  }

  return value;
}

function readIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }

  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw badRequest(`${field} length limit exceeded`);
  }

  return value;
}

function readNullableIdentifier(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return readIdentifier(value, field);
}

function readColumnType(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }

  if (value.length > MAX_COLUMN_TYPE_LENGTH) {
    throw badRequest(`${field} length limit exceeded`);
  }

  return value;
}

function readAnnotationLabel(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }

  if (value.length > MAX_ANNOTATION_LABEL_LENGTH) {
    throw badRequest(`${field} length limit exceeded`);
  }

  return value;
}

function readBoundedString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  if (value.length > maximumLength) throw badRequest(`${field} length limit exceeded`);
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }

  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string or null`);
  }

  return value;
}

function readIdentifierArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array`);
  }

  if (value.length === 0) {
    throw badRequest(`${field} must not be empty`);
  }

  return value.map((item, index) => readIdentifier(item, `${field}[${index}]`));
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number`);
  }

  return value;
}

function readPositiveFiniteNumber(value: unknown, field: string): number {
  const number = readFiniteNumber(value, field);
  if (number <= 0) throw badRequest(`${field} must be greater than 0`);
  return number;
}

function isPlainJsonObject(value: unknown): value is SqlErdJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
