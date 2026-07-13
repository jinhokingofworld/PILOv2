import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdColumnAnnotationLink,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect,
  SqltoerdSettingsJson
} from "@/features/sql-erd/types";
import { removeSqltoerdAnnotation } from "@/features/sql-erd/utils/model";
import {
  createSqltoerdForeignKeyRelationId,
  normalizeSqltoerdForeignKeyRelationIds
} from "@/features/sql-erd/utils/relation-id";

export const SQLTOERD_RELATION_NOTES_SETTINGS_KEY = "sqltoerdRelationNotes";

export type SqltoerdAnnotationLabelDisposition =
  | "discard"
  | "preserve_as_relation_note";

export type SqltoerdAnnotationForeignKeyConversionFailureReason =
  | SqltoerdForeignKeyAddFailureReason
  | "annotation_not_column_link"
  | "annotation_not_found";

export type SqltoerdAnnotationForeignKeyConversionResult =
  | {
      layoutJson: SqltoerdLayoutJsonV1;
      modelJson: SqltoerdModelJsonV1;
      ok: true;
      relation: ErdRelation;
      settingsJson: SqltoerdSettingsJson;
    }
  | {
      ok: false;
      reason: SqltoerdAnnotationForeignKeyConversionFailureReason;
    };

export type SqltoerdForeignKeyAddFailureReason =
  | "duplicate_relation"
  | "incompatible_column_type"
  | "invalid_endpoint"
  | "same_endpoint"
  | "source_column_already_has_foreign_key"
  | "target_column_not_key";

export type SqltoerdForeignKeyAddResult =
  | {
      modelJson: SqltoerdModelJsonV1;
      ok: true;
      relation: ErdRelation;
    }
  | {
      ok: false;
      reason: SqltoerdForeignKeyAddFailureReason;
    };

export type SqltoerdForeignKeyEditFailureReason =
  | SqltoerdForeignKeyAddFailureReason
  | "relation_not_found"
  | "unchanged_relation"
  | "unsupported_composite_relation";

export type SqltoerdForeignKeyEditResult =
  | {
      modelJson: SqltoerdModelJsonV1;
      ok: true;
      relation: ErdRelation;
    }
  | {
      ok: false;
      reason: SqltoerdForeignKeyEditFailureReason;
    };

export function createSqlErdAnnotationForeignKeyConversionCandidate({
  annotationId,
  dialect = "postgresql",
  labelDisposition,
  layoutJson,
  modelJson,
  settingsJson
}: {
  annotationId: string;
  dialect?: SqltoerdResolvedDialect;
  labelDisposition: SqltoerdAnnotationLabelDisposition;
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  settingsJson: SqltoerdSettingsJson;
}): SqltoerdAnnotationForeignKeyConversionResult {
  const annotation = layoutJson.annotations?.links.find(
    (link) => link.id === annotationId
  );

  if (!annotation) {
    return { ok: false, reason: "annotation_not_found" };
  }

  if (annotation.kind !== "column_link") {
    return { ok: false, reason: "annotation_not_column_link" };
  }

  const candidate = createSqlErdForeignKeyAddCandidate({
    dialect,
    fromColumnId: annotation.fromColumnId,
    fromTableId: annotation.fromTableId,
    modelJson,
    toColumnId: annotation.toColumnId,
    toTableId: annotation.toTableId
  });

  if (!candidate.ok) {
    return candidate;
  }

  return {
    layoutJson: removeSqltoerdAnnotation(layoutJson, annotation.id),
    modelJson: candidate.modelJson,
    ok: true,
    relation: candidate.relation,
    settingsJson: createSqltoerdConversionSettingsJson(
      settingsJson,
      annotation,
      candidate.relation,
      labelDisposition
    )
  };
}

export function getSqltoerdRelationNote(
  settingsJson: SqltoerdSettingsJson,
  relationId: string
) {
  const relationNotes = settingsJson[SQLTOERD_RELATION_NOTES_SETTINGS_KEY];

  if (!isSqltoerdRelationNotes(relationNotes)) {
    return null;
  }

  return relationNotes[relationId] ?? null;
}

export function retainSqltoerdRelationNotesForModel(
  settingsJson: SqltoerdSettingsJson,
  modelJson: SqltoerdModelJsonV1
) {
  const relationNotes = getSqltoerdRelationNotes(settingsJson);
  const currentRelationIds = new Set(
    modelJson.schema.relations.map((relation) => relation.id)
  );
  const retainedNotes = Object.entries(relationNotes).filter(([relationId]) =>
    currentRelationIds.has(relationId)
  );

  if (retainedNotes.length === Object.keys(relationNotes).length) {
    return settingsJson;
  }

  const { [SQLTOERD_RELATION_NOTES_SETTINGS_KEY]: _relationNotes, ...rest } =
    settingsJson;

  if (retainedNotes.length === 0) {
    return rest;
  }

  return {
    ...rest,
    [SQLTOERD_RELATION_NOTES_SETTINGS_KEY]: Object.fromEntries(retainedNotes)
  };
}

export function createSqlErdForeignKeyAddCandidate({
  dialect = "postgresql",
  fromColumnId,
  fromTableId,
  modelJson,
  toColumnId,
  toTableId
}: {
  dialect?: SqltoerdResolvedDialect;
  fromColumnId: string;
  fromTableId: string;
  modelJson: SqltoerdModelJsonV1;
  toColumnId: string;
  toTableId: string;
}): SqltoerdForeignKeyAddResult {
  return createSqlErdForeignKeyCandidate(
    {
      dialect,
      fromColumnId,
      fromTableId,
      modelJson,
      toColumnId,
      toTableId
    },
    { rejectExistingSourceColumnForeignKey: true }
  );
}

function createSqlErdForeignKeyCandidate(
  {
    dialect,
    fromColumnId,
    fromTableId,
    modelJson,
    toColumnId,
    toTableId
  }: {
    dialect: SqltoerdResolvedDialect;
    fromColumnId: string;
    fromTableId: string;
    modelJson: SqltoerdModelJsonV1;
    toColumnId: string;
    toTableId: string;
  },
  {
    rejectExistingSourceColumnForeignKey
  }: {
    rejectExistingSourceColumnForeignKey: boolean;
  }
): SqltoerdForeignKeyAddResult {
  const fromTable = modelJson.schema.tables.find(
    (table) => table.id === fromTableId
  );
  const toTable = modelJson.schema.tables.find((table) => table.id === toTableId);
  const fromColumn = fromTable?.columns.find(
    (column) => column.id === fromColumnId
  );
  const toColumn = toTable?.columns.find((column) => column.id === toColumnId);

  if (!fromTable || !toTable || !fromColumn || !toColumn) {
    return { ok: false, reason: "invalid_endpoint" };
  }

  if (fromTable.id === toTable.id && fromColumn.id === toColumn.id) {
    return { ok: false, reason: "same_endpoint" };
  }

  if (!getSqltoerdForeignKeyTargetColumns(toTable).some((column) => column.id === toColumn.id)) {
    return { ok: false, reason: "target_column_not_key" };
  }

  if (!areSqltoerdForeignKeyColumnTypesCompatible(fromColumn, toColumn, dialect)) {
    return { ok: false, reason: "incompatible_column_type" };
  }

  let relation = createSqltoerdForeignKeyRelation(
    fromTable,
    fromColumn,
    toTable,
    toColumn
  );

  if (modelJson.schema.relations.some((existingRelation) => existingRelation.id === relation.id)) {
    relation = createSqltoerdForeignKeyRelation(
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      true
    );
  }
  const hasDuplicateRelation = modelJson.schema.relations.some(
    (existingRelation) =>
      existingRelation.fromTableId === relation.fromTableId &&
      existingRelation.toTableId === relation.toTableId &&
      existingRelation.fromColumnIds.length === 1 &&
      existingRelation.fromColumnIds[0] === relation.fromColumnIds[0] &&
      existingRelation.toColumnIds.length === 1 &&
      existingRelation.toColumnIds[0] === relation.toColumnIds[0]
  );

  if (hasDuplicateRelation) {
    return { ok: false, reason: "duplicate_relation" };
  }

  if (
    rejectExistingSourceColumnForeignKey &&
    modelJson.schema.relations.some(
      (existingRelation) =>
        existingRelation.fromTableId === fromTable.id &&
        existingRelation.fromColumnIds.includes(fromColumn.id)
    )
  ) {
    return { ok: false, reason: "source_column_already_has_foreign_key" };
  }

  const nextModelJson = structuredClone(modelJson);
  const nextFromTable = nextModelJson.schema.tables.find(
    (table) => table.id === fromTable.id
  );
  const nextFromColumn = nextFromTable?.columns.find(
    (column) => column.id === fromColumn.id
  );

  if (!nextFromColumn) {
    return { ok: false, reason: "invalid_endpoint" };
  }

  nextFromColumn.foreignKey = true;
  nextModelJson.schema.relations.push(relation);
  normalizeSqltoerdForeignKeyRelationIds(nextModelJson);

  return {
    modelJson: nextModelJson,
    ok: true,
    relation
  };
}

export function createSqlErdForeignKeyUpdateCandidate({
  dialect = "postgresql",
  modelJson,
  relationId,
  toColumnId,
  toTableId
}: {
  dialect?: SqltoerdResolvedDialect;
  modelJson: SqltoerdModelJsonV1;
  relationId: string;
  toColumnId: string;
  toTableId: string;
}): SqltoerdForeignKeyEditResult {
  const relation = modelJson.schema.relations.find(
    (candidate) => candidate.id === relationId
  );

  if (!relation) {
    return { ok: false, reason: "relation_not_found" };
  }

  if (!isSingleColumnForeignKeyRelation(relation)) {
    return { ok: false, reason: "unsupported_composite_relation" };
  }

  if (
    relation.toTableId === toTableId &&
    relation.toColumnIds[0] === toColumnId
  ) {
    return { ok: false, reason: "unchanged_relation" };
  }

  const modelWithoutRelation = removeForeignKeyRelation(
    modelJson,
    relation
  );
  const candidate = createSqlErdForeignKeyCandidate(
    {
      dialect,
      fromColumnId: relation.fromColumnIds[0],
      fromTableId: relation.fromTableId,
      modelJson: modelWithoutRelation,
      toColumnId,
      toTableId
    },
    { rejectExistingSourceColumnForeignKey: false }
  );

  if (!candidate.ok) {
    return candidate;
  }

  candidate.relation.constraintName = relation.constraintName;

  return candidate;
}

export function createSqlErdForeignKeyDeleteCandidate({
  modelJson,
  relationId
}: {
  modelJson: SqltoerdModelJsonV1;
  relationId: string;
}): SqltoerdForeignKeyEditResult {
  const relation = modelJson.schema.relations.find(
    (candidate) => candidate.id === relationId
  );

  if (!relation) {
    return { ok: false, reason: "relation_not_found" };
  }

  if (!isSingleColumnForeignKeyRelation(relation)) {
    return { ok: false, reason: "unsupported_composite_relation" };
  }

  return {
    modelJson: removeForeignKeyRelation(modelJson, relation),
    ok: true,
    relation
  };
}

export function getSqltoerdForeignKeyTargetColumns(table: ErdTable) {
  return table.columns.filter((column) => isSqltoerdForeignKeyTarget(table, column));
}

function createSqltoerdConversionSettingsJson(
  settingsJson: SqltoerdSettingsJson,
  annotation: SqltoerdColumnAnnotationLink,
  relation: ErdRelation,
  labelDisposition: SqltoerdAnnotationLabelDisposition
) {
  const label = annotation.label.trim();

  if (labelDisposition !== "preserve_as_relation_note" || !label) {
    return settingsJson;
  }

  const relationNotes = getSqltoerdRelationNotes(settingsJson);

  return {
    ...settingsJson,
    [SQLTOERD_RELATION_NOTES_SETTINGS_KEY]: {
      ...relationNotes,
      [relation.id]: label
    }
  };
}

function getSqltoerdRelationNotes(settingsJson: SqltoerdSettingsJson) {
  const relationNotes = settingsJson[SQLTOERD_RELATION_NOTES_SETTINGS_KEY];

  return isSqltoerdRelationNotes(relationNotes) ? relationNotes : {};
}

function isSqltoerdRelationNotes(
  value: unknown
): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((note) => typeof note === "string")
  );
}

function isSqltoerdForeignKeyTarget(table: ErdTable, column: ErdColumn) {
  const keyConstraints = table.constraints.filter(
    (constraint) =>
      (constraint.kind === "primary_key" || constraint.kind === "unique") &&
      constraint.columnIds.includes(column.id)
  );

  if (keyConstraints.length > 0) {
    return keyConstraints.some((constraint) => constraint.columnIds.length === 1);
  }

  return column.primaryKey || column.unique;
}

function areSqltoerdForeignKeyColumnTypesCompatible(
  fromColumn: ErdColumn,
  toColumn: ErdColumn,
  dialect: SqltoerdResolvedDialect
) {
  const fromType = parseSqltoerdForeignKeyColumnType(fromColumn.dataType);
  const toType = parseSqltoerdForeignKeyColumnType(toColumn.dataType);

  if (fromType.family !== toType.family) {
    return false;
  }

  if (dialect !== "mysql" || !isMySqlFixedPrecisionType(fromType.family)) {
    return true;
  }

  return (
    fromType.parameters === toType.parameters &&
    fromType.unsigned === toType.unsigned
  );
}

function parseSqltoerdForeignKeyColumnType(dataType: string) {
  const normalizedDataType = dataType
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const unsigned = /\bunsigned\b/.test(normalizedDataType);
  const typeWithoutUnsigned = normalizedDataType.replace(/\s+unsigned\b/g, "").trim();
  const parameters = typeWithoutUnsigned.match(/\(([^()]*)\)/)?.[1]?.replace(/\s+/g, "") ?? null;
  const baseType = typeWithoutUnsigned.replace(/\([^()]*\)/g, "").trim();

  return {
    family: getSqltoerdForeignKeyTypeFamily(baseType),
    parameters,
    unsigned
  };
}

function getSqltoerdForeignKeyTypeFamily(baseType: string) {
  if (baseType === "int" || baseType === "integer") {
    return "integer";
  }

  if (baseType === "decimal" || baseType === "numeric") {
    return "numeric";
  }

  if (
    baseType === "varchar" ||
    baseType === "character varying"
  ) {
    return "varchar";
  }

  if (baseType === "char" || baseType === "character") {
    return "char";
  }

  return baseType;
}

function isMySqlFixedPrecisionType(typeFamily: string) {
  return new Set([
    "tinyint",
    "smallint",
    "mediumint",
    "integer",
    "bigint",
    "numeric"
  ]).has(typeFamily);
}

function createSqltoerdForeignKeyRelation(
  fromTable: ErdTable,
  fromColumn: ErdColumn,
  toTable: ErdTable,
  toColumn: ErdColumn,
  forceHashed = false
): ErdRelation {
  return {
    constraintName: null,
    fromColumnIds: [fromColumn.id],
    fromTableId: fromTable.id,
    id: createSqltoerdForeignKeyRelationId({
      forceHashed,
      fromColumns: [fromColumn],
      fromTable,
      toColumns: [toColumn],
      toTable
    }),
    kind: "foreign_key",
    toColumnIds: [toColumn.id],
    toTableId: toTable.id
  };
}

function isSingleColumnForeignKeyRelation(relation: ErdRelation) {
  return relation.fromColumnIds.length === 1 && relation.toColumnIds.length === 1;
}

function removeForeignKeyRelation(
  modelJson: SqltoerdModelJsonV1,
  relation: ErdRelation
) {
  const nextModelJson = structuredClone(modelJson);
  const relationIndex = nextModelJson.schema.relations.findIndex(
    (candidate) => candidate.id === relation.id
  );

  if (relationIndex < 0) {
    return nextModelJson;
  }

  nextModelJson.schema.relations.splice(relationIndex, 1);

  const fromColumn = nextModelJson.schema.tables
    .find((table) => table.id === relation.fromTableId)
    ?.columns.find((column) => column.id === relation.fromColumnIds[0]);

  if (fromColumn) {
    fromColumn.foreignKey = nextModelJson.schema.relations.some(
      (candidate) =>
        candidate.fromTableId === relation.fromTableId &&
        candidate.fromColumnIds.includes(fromColumn.id)
    );
  }

  return nextModelJson;
}
