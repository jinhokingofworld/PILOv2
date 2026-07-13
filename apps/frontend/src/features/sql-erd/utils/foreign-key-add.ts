import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";
import {
  createSqltoerdForeignKeyRelationId,
  normalizeSqltoerdForeignKeyRelationIds
} from "@/features/sql-erd/utils/relation-id";

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
