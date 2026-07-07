import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdLayoutJsonV1,
  SqltoerdModelCounts,
  SqltoerdModelJsonV1,
  SqltoerdTableLayout
} from "@/features/sql-erd/types";

export type SqltoerdRelationEndpoint = {
  table: ErdTable;
  columns: ErdColumn[];
};

export type SqltoerdRelationEndpoints = {
  from: SqltoerdRelationEndpoint;
  to: SqltoerdRelationEndpoint;
};

export type SqltoerdModelIndex = {
  tablesById: Map<string, ErdTable>;
  columnsByTableId: Map<string, Map<string, ErdColumn>>;
  relationsById: Map<string, ErdRelation>;
  relationsByTableId: Map<string, ErdRelation[]>;
};

export function getSqltoerdModelCounts(
  modelJson: SqltoerdModelJsonV1
): SqltoerdModelCounts {
  return {
    tableCount: modelJson.schema.tables.length,
    columnCount: modelJson.schema.tables.reduce(
      (totalColumns, table) => totalColumns + table.columns.length,
      0
    ),
    relationCount: modelJson.schema.relations.length
  };
}

export function createSqltoerdModelIndex(
  modelJson: SqltoerdModelJsonV1
): SqltoerdModelIndex {
  const tablesById = new Map<string, ErdTable>();
  const columnsByTableId = new Map<string, Map<string, ErdColumn>>();
  const relationsById = new Map<string, ErdRelation>();
  const relationsByTableId = new Map<string, ErdRelation[]>();

  for (const table of modelJson.schema.tables) {
    tablesById.set(table.id, table);
    columnsByTableId.set(table.id, createColumnsById(table));
    relationsByTableId.set(table.id, []);
  }

  for (const relation of modelJson.schema.relations) {
    relationsById.set(relation.id, relation);
    appendRelation(relationsByTableId, relation.fromTableId, relation);

    if (relation.fromTableId === relation.toTableId) {
      continue;
    }

    appendRelation(relationsByTableId, relation.toTableId, relation);
  }

  return {
    tablesById,
    columnsByTableId,
    relationsById,
    relationsByTableId
  };
}

export function findErdTable(
  modelJson: SqltoerdModelJsonV1,
  tableId: string
) {
  return modelJson.schema.tables.find((table) => table.id === tableId) ?? null;
}

export function findErdColumn(table: ErdTable, columnId: string) {
  return table.columns.find((column) => column.id === columnId) ?? null;
}

export function getTableLayout(
  layoutJson: SqltoerdLayoutJsonV1,
  tableId: string
): SqltoerdTableLayout | null {
  return (
    layoutJson.tableLayouts.find((tableLayout) => tableLayout.tableId === tableId) ??
    null
  );
}

export function getTableDisplayName(table: ErdTable) {
  return table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
}

export function getRelationEndpoints(
  relation: ErdRelation,
  modelIndex: SqltoerdModelIndex
): SqltoerdRelationEndpoints | null {
  const fromTable = modelIndex.tablesById.get(relation.fromTableId);
  const toTable = modelIndex.tablesById.get(relation.toTableId);

  if (!fromTable || !toTable) {
    return null;
  }

  const fromColumns: ErdColumn[] = [];
  const toColumns: ErdColumn[] = [];
  const fromColumnsById = modelIndex.columnsByTableId.get(fromTable.id);
  const toColumnsById = modelIndex.columnsByTableId.get(toTable.id);

  if (!fromColumnsById || !toColumnsById) {
    return null;
  }

  for (const columnId of relation.fromColumnIds) {
    const column = fromColumnsById.get(columnId);

    if (!column) {
      return null;
    }

    fromColumns.push(column);
  }

  for (const columnId of relation.toColumnIds) {
    const column = toColumnsById.get(columnId);

    if (!column) {
      return null;
    }

    toColumns.push(column);
  }

  return {
    from: {
      table: fromTable,
      columns: fromColumns
    },
    to: {
      table: toTable,
      columns: toColumns
    }
  };
}

function createColumnsById(table: ErdTable) {
  const columnsById = new Map<string, ErdColumn>();

  for (const column of table.columns) {
    columnsById.set(column.id, column);
  }

  return columnsById;
}

function appendRelation(
  relationsByTableId: Map<string, ErdRelation[]>,
  tableId: string,
  relation: ErdRelation
) {
  const relations = relationsByTableId.get(tableId);

  if (relations) {
    relations.push(relation);
    return;
  }

  relationsByTableId.set(tableId, [relation]);
}
