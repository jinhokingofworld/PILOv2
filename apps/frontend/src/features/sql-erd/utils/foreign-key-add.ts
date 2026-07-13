import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

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

export function createSqlErdForeignKeyAddCandidate({
  fromColumnId,
  fromTableId,
  modelJson,
  toColumnId,
  toTableId
}: {
  fromColumnId: string;
  fromTableId: string;
  modelJson: SqltoerdModelJsonV1;
  toColumnId: string;
  toTableId: string;
}): SqltoerdForeignKeyAddResult {
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

  if (!areSqltoerdForeignKeyColumnTypesCompatible(fromColumn, toColumn)) {
    return { ok: false, reason: "incompatible_column_type" };
  }

  const relation = createSqltoerdForeignKeyRelation(
    fromTable,
    fromColumn,
    toTable,
    toColumn
  );
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

  return {
    modelJson: nextModelJson,
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
  toColumn: ErdColumn
) {
  return (
    getSqltoerdForeignKeyTypeFamily(fromColumn.dataType) ===
    getSqltoerdForeignKeyTypeFamily(toColumn.dataType)
  );
}

function getSqltoerdForeignKeyTypeFamily(dataType: string) {
  const normalizedDataType = dataType
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/ unsigned$/, "");

  if (normalizedDataType === "int" || normalizedDataType === "integer") {
    return "integer";
  }

  if (normalizedDataType === "decimal" || normalizedDataType === "numeric") {
    return "numeric";
  }

  if (
    normalizedDataType === "varchar" ||
    normalizedDataType === "character varying"
  ) {
    return "varchar";
  }

  if (normalizedDataType === "char" || normalizedDataType === "character") {
    return "char";
  }

  return normalizedDataType;
}

function createSqltoerdForeignKeyRelation(
  fromTable: ErdTable,
  fromColumn: ErdColumn,
  toTable: ErdTable,
  toColumn: ErdColumn
): ErdRelation {
  return {
    constraintName: null,
    fromColumnIds: [fromColumn.id],
    fromTableId: fromTable.id,
    id: [
      "relation",
      getSqltoerdTableIdPart(fromTable),
      fromColumn.name,
      getSqltoerdTableIdPart(toTable),
      toColumn.name
    ].join("."),
    kind: "foreign_key",
    toColumnIds: [toColumn.id],
    toTableId: toTable.id
  };
}

function getSqltoerdTableIdPart(table: ErdTable) {
  return table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
}
