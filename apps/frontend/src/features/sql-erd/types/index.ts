export const SQLTOERD_MODEL_JSON_VERSION = 1;
export const SQLTOERD_LAYOUT_JSON_VERSION = 1;

export type SqltoerdSourceFormat = "sql";

export type SqltoerdDialect = "auto" | "postgresql" | "mysql" | "sqlite";
export type SqltoerdResolvedDialect = Exclude<SqltoerdDialect, "auto">;

export type SqlErdSelection =
  | { type: "none" }
  | { type: "table"; tableId: string }
  | { type: "column"; tableId: string; columnId: string }
  | { type: "relation"; relationId: string }
  | { type: "annotation"; annotationId: string }
  | { type: "note"; noteId: string }
  | { type: "frame"; frameId: string }
  | { type: "text"; textId: string };

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
  annotations?: SqltoerdAnnotationsV1;
};

export type SqltoerdAnnotationsV1 = {
  version: 1;
  links: SqltoerdAnnotationLink[];
  notes?: SqltoerdCanvasNote[];
  frames?: SqltoerdCanvasFrame[];
  texts?: SqltoerdCanvasText[];
  strokes?: SqltoerdCanvasStroke[];
};

export type SqltoerdCanvasNote = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

export type SqltoerdCanvasFrameColor =
  | "slate"
  | "blue"
  | "green"
  | "amber"
  | "rose";

export type SqltoerdCanvasFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  color: SqltoerdCanvasFrameColor;
  isLocked: boolean;
};

export type SqltoerdCanvasText = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: SqltoerdCanvasFrameColor;
};

export type SqltoerdCanvasStroke = {
  id: string;
  points: { x: number; y: number }[];
  color: SqltoerdCanvasFrameColor;
  size: number;
};

export type SqltoerdLayoutPatch = {
  tablePositions?: SqltoerdTableLayout[];
  linksToAdd?: SqltoerdAnnotationLink[];
  linksById?: Record<string, { label?: string }>;
  deleteLinkIds?: readonly string[];
  notesToAdd?: SqltoerdCanvasNote[];
  framesToAdd?: SqltoerdCanvasFrame[];
  textsToAdd?: SqltoerdCanvasText[];
  strokesToAdd?: SqltoerdCanvasStroke[];
  notesById?: Record<string, Partial<Omit<SqltoerdCanvasNote, "id">>>;
  framesById?: Record<string, Partial<Omit<SqltoerdCanvasFrame, "id">>>;
  textsById?: Record<string, Partial<Omit<SqltoerdCanvasText, "id">>>;
  deleteNoteIds?: readonly string[];
  deleteFrameIds?: readonly string[];
  deleteTextIds?: readonly string[];
  deleteStrokeIds?: readonly string[];
};

export type SqltoerdAnnotationLink =
  | SqltoerdTableAnnotationLink
  | SqltoerdColumnAnnotationLink;

export type SqltoerdTableAnnotationLink = {
  id: string;
  kind: "table_link";
  fromTableId: string;
  toTableId: string;
  label: string;
};

export type SqltoerdColumnAnnotationLink = {
  id: string;
  kind: "column_link";
  fromTableId: string;
  fromColumnId: string;
  toTableId: string;
  toColumnId: string;
  label: string;
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

export type SqltoerdSessionPayload = {
  id: string;
  workspaceId: string;
  title: string;
  sourceFormat: SqltoerdSourceFormat;
  dialect: SqltoerdDialect;
  sourceText: string;
  modelJson: SqltoerdModelJsonV1;
  layoutJson: SqltoerdLayoutJsonV1;
  settingsJson: SqltoerdSettingsJson;
  tableCount: number;
  relationCount: number;
  revision: number;
  writeProtocol: "snapshot" | "operations_v1";
  latestOpSeq: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SqltoerdSessionSummary = Pick<
  SqltoerdSessionPayload,
  | "id"
  | "workspaceId"
  | "title"
  | "sourceFormat"
  | "dialect"
  | "tableCount"
  | "relationCount"
  | "revision"
  | "createdBy"
  | "updatedBy"
  | "createdAt"
  | "updatedAt"
>;

export type SqltoerdSessionListPayload = {
  items: SqltoerdSessionSummary[];
  nextCursor: string | null;
};

export type SqltoerdSessionDeletePayload = {
  id: string;
  deletedAt: string;
  revision: number;
};

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
