import { badRequest, payloadTooLarge } from "../../common/api-error";
import {
  SqlErdSchemaColumnSpec,
  SqlErdSchemaDataTypeSpec,
  SqlErdSchemaDefaultValueSpec,
  SqlErdSchemaDialect,
  SqlErdSchemaKeyConstraintSpec,
  SqlErdSchemaRelationSpec,
  SqlErdSchemaSpecV1,
  SqlErdSchemaTableSpec,
  SqlErdSchemaTypeKind,
  SqlErdSchemaUnsupportedFeature
} from "./sql-erd-schema-spec.types";

const MAX_SCHEMA_SPEC_BYTES = 48 * 1024;
const MAX_TITLE_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TABLES = 100;
const MAX_COLUMNS = 1_000;
const MAX_COLUMNS_PER_TABLE = 200;
const MAX_RELATIONS = 300;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DIALECTS = new Set<SqlErdSchemaDialect>([
  "postgresql",
  "mysql",
  "sqlite"
]);
const TYPE_KINDS = new Set<SqlErdSchemaTypeKind>([
  "bigint",
  "binary",
  "boolean",
  "char",
  "date",
  "decimal",
  "double",
  "integer",
  "json",
  "real",
  "smallint",
  "text",
  "time",
  "timestamp",
  "timestamp_tz",
  "uuid",
  "varchar"
]);
const UNSUPPORTED_FEATURES = new Set<SqlErdSchemaUnsupportedFeature>([
  "check_constraints",
  "comments",
  "database_execution",
  "enums",
  "indexes",
  "partitions",
  "permissions_rls",
  "raw_default_expressions",
  "stored_procedures",
  "triggers",
  "views"
]);

export function validateSqlErdSchemaSpec(value: unknown): SqlErdSchemaSpecV1 {
  assertSerializedSize(value);
  const object = readObject(value, "schemaSpec");
  assertKnownFields(object, "schemaSpec", [
    "version",
    "title",
    "requestedDialect",
    "tables",
    "relations",
    "unsupportedFeatures"
  ]);
  if (object.version !== 1) {
    throw badRequest("schemaSpec.version must be 1");
  }

  const title = readString(object.title, "schemaSpec.title", 1, MAX_TITLE_LENGTH);
  const requestedDialect = readNullableDialect(object.requestedDialect);
  const tableValues = readArray(object.tables, "schemaSpec.tables", 1, MAX_TABLES);
  const tables = tableValues.map((table, index) => readTable(table, index));
  const relationValues = readArray(
    object.relations,
    "schemaSpec.relations",
    0,
    MAX_RELATIONS
  );
  const relations = relationValues.map((relation, index) =>
    readRelation(relation, index)
  );
  const unsupportedFeatures = readUnsupportedFeatures(object.unsupportedFeatures);

  assertUnique(tables.map((table) => table.key), "table key");
  assertUnique(relations.map((relation) => relation.key), "relation key");
  assertUnique(
    tables.map((table) => `${table.schemaName ?? ""}\u0000${table.name}`),
    "schema/table name"
  );

  const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0);
  if (totalColumns > MAX_COLUMNS) {
    throw badRequest(`schemaSpec has more than ${MAX_COLUMNS} columns`);
  }

  if (requestedDialect === "sqlite" && tables.some((table) => table.schemaName)) {
    throw badRequest("schemaName is not allowed for sqlite");
  }

  const tablesByKey = new Map(tables.map((table) => [table.key, table]));
  for (const relation of relations) {
    validateRelationReferences(relation, tablesByKey);
  }

  return {
    version: 1,
    title,
    requestedDialect,
    tables,
    relations,
    unsupportedFeatures
  };
}

function readTable(value: unknown, index: number): SqlErdSchemaTableSpec {
  const path = `schemaSpec.tables[${index}]`;
  const object = readObject(value, path);
  assertKnownFields(object, path, [
    "key",
    "name",
    "schemaName",
    "columns",
    "primaryKey",
    "uniqueConstraints"
  ]);
  const key = readIdentifier(object.key, `${path}.key`);
  const name = readIdentifier(object.name, `${path}.name`);
  const schemaName = readNullableIdentifier(object.schemaName, `${path}.schemaName`);
  const columnValues = readArray(
    object.columns,
    `${path}.columns`,
    1,
    MAX_COLUMNS_PER_TABLE
  );
  const columns = columnValues.map((column, columnIndex) =>
    readColumn(column, `${path}.columns[${columnIndex}]`)
  );
  assertUnique(columns.map((column) => column.key), `${path} column key`);
  assertUnique(columns.map((column) => column.name), `${path} column name`);
  const columnKeys = new Set(columns.map((column) => column.key));
  const primaryKey =
    object.primaryKey === null
      ? null
      : readKeyConstraint(object.primaryKey, `${path}.primaryKey`, columnKeys);
  const uniqueValues = readArray(
    object.uniqueConstraints,
    `${path}.uniqueConstraints`,
    0,
    MAX_COLUMNS_PER_TABLE
  );
  const uniqueConstraints = uniqueValues.map((constraint, constraintIndex) =>
    readKeyConstraint(
      constraint,
      `${path}.uniqueConstraints[${constraintIndex}]`,
      columnKeys
    )
  );

  if (
    primaryKey?.columnKeys.some(
      (primaryKeyColumn) =>
        columns.find((column) => column.key === primaryKeyColumn)?.nullable
    )
  ) {
    throw badRequest(`${path} primary key columns must not be nullable`);
  }

  const autoIncrementColumns = columns.filter((column) => column.autoIncrement);
  for (const column of autoIncrementColumns) {
    if (
      !new Set(["smallint", "integer", "bigint"]).has(column.dataType.kind) ||
      primaryKey?.columnKeys.length !== 1 ||
      primaryKey.columnKeys[0] !== column.key
    ) {
      throw badRequest(
        `${path} autoIncrement column must be the single primary key column`
      );
    }
  }
  if (autoIncrementColumns.length > 1) {
    throw badRequest(`${path} must not have multiple autoIncrement columns`);
  }

  return {
    key,
    name,
    schemaName,
    columns,
    primaryKey,
    uniqueConstraints
  };
}

function readColumn(value: unknown, path: string): SqlErdSchemaColumnSpec {
  const object = readObject(value, path);
  assertKnownFields(object, path, [
    "key",
    "name",
    "dataType",
    "nullable",
    "autoIncrement",
    "defaultValue"
  ]);
  const dataType = readDataType(object.dataType, `${path}.dataType`);
  const nullable = readBoolean(object.nullable, `${path}.nullable`);
  const defaultValue = readDefaultValue(object.defaultValue, `${path}.defaultValue`);
  validateDefaultValue(dataType.kind, defaultValue, `${path}.defaultValue`);
  return {
    key: readIdentifier(object.key, `${path}.key`),
    name: readIdentifier(object.name, `${path}.name`),
    dataType,
    nullable,
    autoIncrement: readBoolean(object.autoIncrement, `${path}.autoIncrement`),
    defaultValue
  };
}

function readDataType(value: unknown, path: string): SqlErdSchemaDataTypeSpec {
  const object = readObject(value, path);
  assertKnownFields(object, path, ["kind", "length", "precision", "scale"]);
  if (typeof object.kind !== "string" || !TYPE_KINDS.has(object.kind as SqlErdSchemaTypeKind)) {
    throw badRequest(`${path}.kind is invalid`);
  }
  const kind = object.kind as SqlErdSchemaTypeKind;
  const length = readNullableInteger(object.length, `${path}.length`);
  const precision = readNullableInteger(object.precision, `${path}.precision`);
  const scale = readNullableInteger(object.scale, `${path}.scale`);

  if (new Set(["char", "varchar", "binary"]).has(kind)) {
    if (length === null || length < 1 || length > 65_535) {
      throw badRequest(`${path}.length must be between 1 and 65535`);
    }
  } else if (length !== null) {
    throw badRequest(`${path}.length is only allowed for char, varchar, and binary`);
  }

  if (kind === "decimal") {
    if (precision === null || precision < 1 || precision > 1_000) {
      throw badRequest(`${path}.precision must be between 1 and 1000`);
    }
    if (scale === null || scale < 0 || scale > precision) {
      throw badRequest(`${path}.scale must be between 0 and precision`);
    }
  } else if (precision !== null || scale !== null) {
    throw badRequest(`${path}.precision and scale are only allowed for decimal`);
  }

  return { kind, length, precision, scale };
}

function readDefaultValue(
  value: unknown,
  path: string
): SqlErdSchemaDefaultValueSpec | null {
  if (value === null) {
    return null;
  }
  const object = readObject(value, path);
  assertKnownFields(object, path, ["kind", "value"]);
  if (object.kind === "current_date" || object.kind === "current_timestamp") {
    if (object.value !== null) {
      throw badRequest(`${path}.value must be null for ${object.kind}`);
    }
    return { kind: object.kind, value: null };
  }
  if (object.kind !== "literal") {
    throw badRequest(`${path}.kind is invalid`);
  }
  if (
    object.value !== null &&
    typeof object.value !== "string" &&
    typeof object.value !== "number" &&
    typeof object.value !== "boolean"
  ) {
    throw badRequest(`${path}.value must be a scalar literal`);
  }
  if (typeof object.value === "number" && !Number.isFinite(object.value)) {
    throw badRequest(`${path}.value must be finite`);
  }
  return { kind: "literal", value: object.value };
}

function validateDefaultValue(
  kind: SqlErdSchemaTypeKind,
  defaultValue: SqlErdSchemaDefaultValueSpec | null,
  path: string
) {
  if (!defaultValue) {
    return;
  }
  if (defaultValue.kind === "current_date") {
    if (!new Set(["date", "timestamp", "timestamp_tz"]).has(kind)) {
      throw badRequest(`${path} current_date is incompatible with ${kind}`);
    }
    return;
  }
  if (defaultValue.kind === "current_timestamp") {
    if (!new Set(["timestamp", "timestamp_tz"]).has(kind)) {
      throw badRequest(`${path} current_timestamp is incompatible with ${kind}`);
    }
    return;
  }

  if (defaultValue.value === null) {
    return;
  }

  const literalType = typeof defaultValue.value;
  const integerKinds = new Set(["smallint", "integer", "bigint"]);
  const numericKinds = new Set([
    "smallint",
    "integer",
    "bigint",
    "decimal",
    "real",
    "double"
  ]);
  if (
    integerKinds.has(kind) &&
    typeof defaultValue.value === "number" &&
    !Number.isInteger(defaultValue.value)
  ) {
    throw badRequest(`${path} integer literal must be an integer`);
  }
  if (
    (kind === "boolean" && literalType !== "boolean") ||
    (numericKinds.has(kind) && literalType !== "number") ||
    (!numericKinds.has(kind) && kind !== "boolean" && literalType !== "string")
  ) {
    throw badRequest(`${path} literal is incompatible with ${kind}`);
  }
}

function readKeyConstraint(
  value: unknown,
  path: string,
  columnKeys: Set<string>
): SqlErdSchemaKeyConstraintSpec {
  const object = readObject(value, path);
  assertKnownFields(object, path, ["name", "columnKeys"]);
  const keys = readArray(object.columnKeys, `${path}.columnKeys`, 1, MAX_COLUMNS_PER_TABLE).map(
    (key, index) => readIdentifier(key, `${path}.columnKeys[${index}]`)
  );
  assertUnique(keys, `${path} column key`);
  for (const key of keys) {
    if (!columnKeys.has(key)) {
      throw badRequest(`${path}.columnKeys references an unknown column key`);
    }
  }
  return {
    name: readNullableIdentifier(object.name, `${path}.name`),
    columnKeys: keys
  };
}

function readRelation(value: unknown, index: number): SqlErdSchemaRelationSpec {
  const path = `schemaSpec.relations[${index}]`;
  const object = readObject(value, path);
  assertKnownFields(object, path, [
    "key",
    "name",
    "fromTableKey",
    "fromColumnKeys",
    "toTableKey",
    "toColumnKeys"
  ]);
  const fromColumnKeys = readIdentifierArray(object.fromColumnKeys, `${path}.fromColumnKeys`);
  const toColumnKeys = readIdentifierArray(object.toColumnKeys, `${path}.toColumnKeys`);
  if (fromColumnKeys.length !== toColumnKeys.length) {
    throw badRequest(`${path} column reference counts must match`);
  }
  return {
    key: readIdentifier(object.key, `${path}.key`),
    name: readNullableIdentifier(object.name, `${path}.name`),
    fromTableKey: readIdentifier(object.fromTableKey, `${path}.fromTableKey`),
    fromColumnKeys,
    toTableKey: readIdentifier(object.toTableKey, `${path}.toTableKey`),
    toColumnKeys
  };
}

function validateRelationReferences(
  relation: SqlErdSchemaRelationSpec,
  tablesByKey: Map<string, SqlErdSchemaTableSpec>
) {
  const fromTable = tablesByKey.get(relation.fromTableKey);
  const toTable = tablesByKey.get(relation.toTableKey);
  if (!fromTable) {
    throw badRequest("relation fromTableKey references an unknown table key");
  }
  if (!toTable) {
    throw badRequest("relation toTableKey references an unknown table key");
  }
  const fromColumnKeys = new Set(fromTable.columns.map((column) => column.key));
  const toColumnKeys = new Set(toTable.columns.map((column) => column.key));
  if (relation.fromColumnKeys.some((key) => !fromColumnKeys.has(key))) {
    throw badRequest("relation fromColumnKeys references an unknown column key");
  }
  if (relation.toColumnKeys.some((key) => !toColumnKeys.has(key))) {
    throw badRequest("relation toColumnKeys references an unknown column key");
  }
}

function readUnsupportedFeatures(value: unknown): SqlErdSchemaUnsupportedFeature[] {
  const values = readArray(value, "schemaSpec.unsupportedFeatures", 0, UNSUPPORTED_FEATURES.size);
  const features = values.map((feature, index) => {
    if (
      typeof feature !== "string" ||
      !UNSUPPORTED_FEATURES.has(feature as SqlErdSchemaUnsupportedFeature)
    ) {
      throw badRequest(`schemaSpec.unsupportedFeatures[${index}] is invalid`);
    }
    return feature as SqlErdSchemaUnsupportedFeature;
  });
  assertUnique(features, "unsupported feature");
  return features;
}

function readIdentifierArray(value: unknown, path: string) {
  const values = readArray(value, path, 1, MAX_COLUMNS_PER_TABLE);
  const result = values.map((entry, index) =>
    readIdentifier(entry, `${path}[${index}]`)
  );
  assertUnique(result, `${path} column key`);
  return result;
}

function readNullableDialect(value: unknown): SqlErdSchemaDialect | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !DIALECTS.has(value as SqlErdSchemaDialect)) {
    throw badRequest("schemaSpec.requestedDialect is invalid");
  }
  return value as SqlErdSchemaDialect;
}

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(
  object: Record<string, unknown>,
  path: string,
  allowedFields: readonly string[]
) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(object)) {
    if (FORBIDDEN_KEYS.has(field) || !allowed.has(field)) {
      throw badRequest(`${path} has unknown field: ${field}`);
    }
  }
  for (const field of allowedFields) {
    if (!(field in object)) {
      throw badRequest(`${path}.${field} is required`);
    }
  }
}

function readArray(
  value: unknown,
  path: string,
  minimumLength: number,
  maximumLength: number
) {
  if (!Array.isArray(value)) {
    throw badRequest(`${path} must be an array`);
  }
  if (value.length < minimumLength || value.length > maximumLength) {
    throw badRequest(
      `${path} must contain between ${minimumLength} and ${maximumLength} items`
    );
  }
  return value;
}

function readString(
  value: unknown,
  path: string,
  minimumLength: number,
  maximumLength: number
) {
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    throw badRequest(`${path} must contain between ${minimumLength} and ${maximumLength} characters`);
  }
  return value;
}

function readIdentifier(value: unknown, path: string) {
  return readString(value, path, 1, MAX_IDENTIFIER_LENGTH);
}

function readNullableIdentifier(value: unknown, path: string) {
  return value === null ? null : readIdentifier(value, path);
}

function readBoolean(value: unknown, path: string) {
  if (typeof value !== "boolean") {
    throw badRequest(`${path} must be a boolean`);
  }
  return value;
}

function readNullableInteger(value: unknown, path: string) {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    throw badRequest(`${path} must be an integer or null`);
  }
  return value as number;
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw badRequest(`schemaSpec has duplicate ${label}`);
  }
}

function assertSerializedSize(value: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw badRequest("schemaSpec must be JSON serializable");
  }
  if (serialized === undefined) {
    throw badRequest("schemaSpec must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_SPEC_BYTES) {
    throw payloadTooLarge("schemaSpec is too large");
  }
}
