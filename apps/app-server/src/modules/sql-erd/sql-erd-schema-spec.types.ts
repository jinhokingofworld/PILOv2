import type {
  SqlErdJsonObject,
  SqlErdSessionPayload,
  SqlErdSourcePublishPayload
} from "./sql-erd.types";

export type SqlErdSchemaDialect = "postgresql" | "mysql" | "sqlite";

export type SqlErdSchemaTypeKind =
  | "bigint"
  | "binary"
  | "boolean"
  | "char"
  | "date"
  | "decimal"
  | "double"
  | "integer"
  | "json"
  | "real"
  | "smallint"
  | "text"
  | "time"
  | "timestamp"
  | "timestamp_tz"
  | "uuid"
  | "varchar";

export type SqlErdSchemaUnsupportedFeature =
  | "check_constraints"
  | "comments"
  | "database_execution"
  | "enums"
  | "indexes"
  | "partitions"
  | "permissions_rls"
  | "raw_default_expressions"
  | "stored_procedures"
  | "triggers"
  | "views";

export interface SqlErdSchemaDataTypeSpec {
  kind: SqlErdSchemaTypeKind;
  length: number | null;
  precision: number | null;
  scale: number | null;
}

export type SqlErdSchemaDefaultValueSpec =
  | { kind: "current_date"; value: null }
  | { kind: "current_timestamp"; value: null }
  | { kind: "literal"; value: string | number | boolean | null };

export interface SqlErdSchemaColumnSpec {
  key: string;
  name: string;
  dataType: SqlErdSchemaDataTypeSpec;
  nullable: boolean;
  autoIncrement: boolean;
  defaultValue: SqlErdSchemaDefaultValueSpec | null;
}

export interface SqlErdSchemaKeyConstraintSpec {
  name: string | null;
  columnKeys: string[];
}

export interface SqlErdSchemaTableSpec {
  key: string;
  name: string;
  schemaName: string | null;
  columns: SqlErdSchemaColumnSpec[];
  primaryKey: SqlErdSchemaKeyConstraintSpec | null;
  uniqueConstraints: SqlErdSchemaKeyConstraintSpec[];
}

export interface SqlErdSchemaRelationSpec {
  key: string;
  name: string | null;
  fromTableKey: string;
  fromColumnKeys: string[];
  toTableKey: string;
  toColumnKeys: string[];
}

export interface SqlErdSchemaSpecV1 {
  version: 1;
  title: string;
  requestedDialect: SqlErdSchemaDialect | null;
  tables: SqlErdSchemaTableSpec[];
  relations: SqlErdSchemaRelationSpec[];
  unsupportedFeatures: SqlErdSchemaUnsupportedFeature[];
}

export interface SqlErdGeneratedSchema {
  dialect: SqlErdSchemaDialect;
  layoutJson: SqlErdJsonObject;
  modelJson: SqlErdJsonObject;
  relationCount: number;
  sourceText: string;
  tableCount: number;
  title: string;
  warnings: SqlErdSchemaGenerationWarning[];
}

export interface SqlErdSchemaGenerationWarning {
  code: "PORTABILITY_DOWNGRADE" | "UNSUPPORTED_FEATURE";
  feature?: SqlErdSchemaUnsupportedFeature;
  message: string;
  path?: string;
}

export interface SqlErdAgentSessionCreationPayload {
  session: SqlErdSessionPayload;
  warnings: SqlErdSchemaGenerationWarning[];
}

export interface SqlErdAgentSchemaReplacementPayload
  extends SqlErdSourcePublishPayload {
  warnings: SqlErdSchemaGenerationWarning[];
}
