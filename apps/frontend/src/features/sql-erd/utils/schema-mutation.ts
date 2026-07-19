import type {
  ErdTable,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

export type SqlErdSchemaMutationFailureReason =
  | "DUPLICATE_NAME"
  | "INVALID_DATA_TYPE"
  | "INVALID_NAME"
  | "LAST_COLUMN"
  | "LAST_TABLE"
  | "NOT_FOUND";

export type SqlErdSchemaMutationResult =
  | {
      affectedConstraintCount: number;
      affectedRelationCount: number;
      modelJson: SqltoerdModelJsonV1;
      ok: true;
    }
  | {
      ok: false;
      reason: SqlErdSchemaMutationFailureReason;
    };

export type SqlErdSchemaMutationRequest =
  | { type: "delete_batch"; tableIds: readonly string[]; relationIds: readonly string[] }
  | { type: "delete_table"; tableId: string }
  | { type: "delete_column"; tableId: string; columnId: string }
  | { type: "rename_table"; tableId: string; name: string }
  | {
      type: "rename_column";
      tableId: string;
      columnId: string;
      name: string;
    }
  | {
      type: "change_column_type";
      tableId: string;
      columnId: string;
      dataType: string;
    }
  | {
      type: "update_column";
      tableId: string;
      columnId: string;
      name: string;
      dataType: string;
    };

export function applySqlErdSchemaMutation(
  modelJson: SqltoerdModelJsonV1,
  request: SqlErdSchemaMutationRequest
) {
  if (request.type === "delete_batch") {
    return applySqlErdBatchSchemaDelete(modelJson, request);
  }

  if (request.type === "delete_table") {
    return deleteSqlErdTable(modelJson, request.tableId);
  }

  if (request.type === "delete_column") {
    return deleteSqlErdColumn(
      modelJson,
      request.tableId,
      request.columnId
    );
  }

  if (request.type === "rename_table") {
    return renameSqlErdTable(modelJson, request.tableId, request.name);
  }

  if (request.type === "rename_column") {
    return renameSqlErdColumn(
      modelJson,
      request.tableId,
      request.columnId,
      request.name
    );
  }

  if (request.type === "update_column") {
    const renamed = renameSqlErdColumn(
      modelJson,
      request.tableId,
      request.columnId,
      request.name
    );

    return renamed.ok
      ? changeSqlErdColumnType(
          renamed.modelJson,
          request.tableId,
          request.columnId,
          request.dataType
        )
      : renamed;
  }

  return changeSqlErdColumnType(
    modelJson,
    request.tableId,
    request.columnId,
    request.dataType
  );
}

export function applySqlErdBatchSchemaDelete(
  modelJson: SqltoerdModelJsonV1,
  request: {
    tableIds: readonly string[];
    relationIds: readonly string[];
  }
): SqlErdSchemaMutationResult {
  const tableIds = new Set(request.tableIds);
  const relationIds = new Set(request.relationIds);
  const knownTableIds = new Set(
    modelJson.schema.tables.map((table) => table.id)
  );
  const knownRelationIds = new Set(
    modelJson.schema.relations.map((relation) => relation.id)
  );

  if (
    [...tableIds].some((tableId) => !knownTableIds.has(tableId)) ||
    [...relationIds].some((relationId) => !knownRelationIds.has(relationId))
  ) {
    return failure("NOT_FOUND");
  }

  if (
    tableIds.size > 0 &&
    modelJson.schema.tables.length - tableIds.size < 1
  ) {
    return failure("LAST_TABLE");
  }

  const tables = modelJson.schema.tables.filter(
    (table) => !tableIds.has(table.id)
  );
  const relations = modelJson.schema.relations.filter(
    (relation) =>
      !relationIds.has(relation.id) &&
      !tableIds.has(relation.fromTableId) &&
      !tableIds.has(relation.toTableId)
  );
  const affectedConstraintCount = modelJson.schema.tables
    .filter((table) => tableIds.has(table.id))
    .reduce((count, table) => count + table.constraints.length, 0);

  return success(
    normalizeColumnConstraintFlags({
      ...modelJson,
      schema: { relations, tables }
    }),
    modelJson.schema.relations.length - relations.length,
    affectedConstraintCount
  );
}

export function deleteSqlErdTable(
  modelJson: SqltoerdModelJsonV1,
  tableId: string
): SqlErdSchemaMutationResult {
  const table = modelJson.schema.tables.find(
    (candidate) => candidate.id === tableId
  );

  if (!table) {
    return failure("NOT_FOUND");
  }

  if (modelJson.schema.tables.length === 1) {
    return failure("LAST_TABLE");
  }

  const relations = modelJson.schema.relations.filter(
    (relation) =>
      relation.fromTableId !== tableId && relation.toTableId !== tableId
  );
  const nextModel = normalizeColumnConstraintFlags({
    ...modelJson,
    schema: {
      relations,
      tables: modelJson.schema.tables.filter(
        (candidate) => candidate.id !== tableId
      )
    }
  });

  return success(
    nextModel,
    modelJson.schema.relations.length - relations.length,
    table.constraints.length
  );
}

export function deleteSqlErdColumn(
  modelJson: SqltoerdModelJsonV1,
  tableId: string,
  columnId: string
): SqlErdSchemaMutationResult {
  const table = modelJson.schema.tables.find(
    (candidate) => candidate.id === tableId
  );
  const column = table?.columns.find(
    (candidate) => candidate.id === columnId
  );

  if (!table || !column) {
    return failure("NOT_FOUND");
  }

  if (table.columns.length === 1) {
    return failure("LAST_COLUMN");
  }

  const relations = modelJson.schema.relations.filter(
    (relation) =>
      !(
        (relation.fromTableId === tableId &&
          relation.fromColumnIds.includes(columnId)) ||
        (relation.toTableId === tableId &&
          relation.toColumnIds.includes(columnId))
      )
  );
  const constraints = table.constraints.filter(
    (constraint) => !constraint.columnIds.includes(columnId)
  );
  const tables = replaceTable(modelJson.schema.tables, tableId, {
    ...table,
    columns: table.columns.filter((candidate) => candidate.id !== columnId),
    constraints
  });
  const nextModel = normalizeColumnConstraintFlags({
    ...modelJson,
    schema: { relations, tables }
  });

  return success(
    nextModel,
    modelJson.schema.relations.length - relations.length,
    table.constraints.length - constraints.length
  );
}

export function renameSqlErdTable(
  modelJson: SqltoerdModelJsonV1,
  tableId: string,
  nextName: string
): SqlErdSchemaMutationResult {
  const table = modelJson.schema.tables.find(
    (candidate) => candidate.id === tableId
  );

  if (!table) {
    return failure("NOT_FOUND");
  }

  if (!isValidIdentifierName(nextName)) {
    return failure("INVALID_NAME");
  }

  if (
    modelJson.schema.tables.some(
      (candidate) =>
        candidate.id !== tableId &&
        candidate.schemaName === table.schemaName &&
        candidate.name.toLowerCase() === nextName.toLowerCase()
    )
  ) {
    return failure("DUPLICATE_NAME");
  }

  return success({
    ...modelJson,
    schema: {
      ...modelJson.schema,
      tables: replaceTable(modelJson.schema.tables, tableId, {
        ...table,
        name: nextName
      })
    }
  });
}

export function renameSqlErdColumn(
  modelJson: SqltoerdModelJsonV1,
  tableId: string,
  columnId: string,
  nextName: string
): SqlErdSchemaMutationResult {
  const table = modelJson.schema.tables.find(
    (candidate) => candidate.id === tableId
  );
  const column = table?.columns.find(
    (candidate) => candidate.id === columnId
  );

  if (!table || !column) {
    return failure("NOT_FOUND");
  }

  if (!isValidIdentifierName(nextName)) {
    return failure("INVALID_NAME");
  }

  if (
    table.columns.some(
      (candidate) =>
        candidate.id !== columnId &&
        candidate.name.toLowerCase() === nextName.toLowerCase()
    )
  ) {
    return failure("DUPLICATE_NAME");
  }

  return success({
    ...modelJson,
    schema: {
      ...modelJson.schema,
      tables: replaceTable(modelJson.schema.tables, tableId, {
        ...table,
        columns: table.columns.map((candidate) =>
          candidate.id === columnId
            ? { ...candidate, name: nextName }
            : candidate
        )
      })
    }
  });
}

export function changeSqlErdColumnType(
  modelJson: SqltoerdModelJsonV1,
  tableId: string,
  columnId: string,
  nextDataType: string
): SqlErdSchemaMutationResult {
  const table = modelJson.schema.tables.find(
    (candidate) => candidate.id === tableId
  );
  const column = table?.columns.find(
    (candidate) => candidate.id === columnId
  );

  if (!table || !column) {
    return failure("NOT_FOUND");
  }

  if (!isValidDataType(nextDataType)) {
    return failure("INVALID_DATA_TYPE");
  }

  return success({
    ...modelJson,
    schema: {
      ...modelJson.schema,
      tables: replaceTable(modelJson.schema.tables, tableId, {
        ...table,
        columns: table.columns.map((candidate) =>
          candidate.id === columnId
            ? { ...candidate, dataType: nextDataType }
            : candidate
        )
      })
    }
  });
}

function normalizeColumnConstraintFlags(
  modelJson: SqltoerdModelJsonV1
): SqltoerdModelJsonV1 {
  const foreignKeyColumnIdsByTableId = new Map<string, Set<string>>();

  for (const relation of modelJson.schema.relations) {
    const columnIds =
      foreignKeyColumnIdsByTableId.get(relation.fromTableId) ??
      new Set<string>();
    relation.fromColumnIds.forEach((columnId) => columnIds.add(columnId));
    foreignKeyColumnIdsByTableId.set(relation.fromTableId, columnIds);
  }

  return {
    ...modelJson,
    schema: {
      ...modelJson.schema,
      tables: modelJson.schema.tables.map((table) => {
        const primaryKeyColumnIds = new Set(
          table.constraints
            .filter((constraint) => constraint.kind === "primary_key")
            .flatMap((constraint) => constraint.columnIds)
        );
        const uniqueColumnIds = new Set(
          table.constraints
            .filter(
              (constraint) =>
                constraint.kind === "unique" &&
                constraint.columnIds.length === 1
            )
            .flatMap((constraint) => constraint.columnIds)
        );
        const foreignKeyColumnIds =
          foreignKeyColumnIdsByTableId.get(table.id) ?? new Set<string>();

        return {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            foreignKey: foreignKeyColumnIds.has(column.id),
            primaryKey: primaryKeyColumnIds.has(column.id),
            unique: uniqueColumnIds.has(column.id)
          }))
        };
      })
    }
  };
}

function isValidIdentifierName(value: string) {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isValidDataType(value: string) {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !/[;\r\n]/u.test(value) &&
    !/--|\/\*|\*\//u.test(value)
  );
}

function replaceTable(
  tables: ErdTable[],
  tableId: string,
  nextTable: ErdTable
) {
  return tables.map((table) => (table.id === tableId ? nextTable : table));
}

function success(
  modelJson: SqltoerdModelJsonV1,
  affectedRelationCount = 0,
  affectedConstraintCount = 0
): SqlErdSchemaMutationResult {
  return {
    affectedConstraintCount,
    affectedRelationCount,
    modelJson,
    ok: true
  };
}

function failure(
  reason: SqlErdSchemaMutationFailureReason
): SqlErdSchemaMutationResult {
  return { ok: false, reason };
}
