export const SQLTOERD_MODEL_JSON_VERSION = 1;
export const SQLTOERD_LAYOUT_JSON_VERSION = 1;

export type SqltoerdSourceFormat = "sql";

export type SqltoerdDialect = "auto" | "postgresql" | "mysql";

export type SqltoerdModelJsonV1 = {
  version: typeof SQLTOERD_MODEL_JSON_VERSION;
  schema: {
    tables: ErdTable[];
    relations: ErdRelation[];
  };
};

export type ErdTable = {
  id: string;
  name: string;
  schemaName: string | null;
  columns: ErdColumn[];
  constraints: ErdConstraint[];
  comment: string | null;
};

export type ErdColumn = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  defaultValue: string | null;
  comment: string | null;
};

export type ErdRelation = {
  id: string;
  kind: "foreign_key";
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  constraintName: string | null;
};

export type ErdConstraint = {
  id: string;
  kind: "primary_key" | "unique";
  columnIds: string[];
  name: string | null;
};

export type SqltoerdLayoutJsonV1 = {
  version: typeof SQLTOERD_LAYOUT_JSON_VERSION;
  tableLayouts: SqltoerdTableLayout[];
  viewport?: SqltoerdViewport;
};

export type SqltoerdTableLayout = {
  tableId: string;
  x: number;
  y: number;
  width?: number;
};

export type SqltoerdViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type SqltoerdSettingsJson = Record<string, unknown>;

export type SqltoerdSessionFixture = {
  title: string;
  sourceFormat: SqltoerdSourceFormat;
  dialect: SqltoerdDialect;
  sourceText: string;
  modelJson: SqltoerdModelJsonV1;
  layoutJson: SqltoerdLayoutJsonV1;
  settingsJson: SqltoerdSettingsJson;
};

export type SqltoerdModelCounts = {
  tableCount: number;
  columnCount: number;
  relationCount: number;
};
