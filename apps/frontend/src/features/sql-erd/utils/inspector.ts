import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqlErdSelection
} from "../types";
import {
  getRelationEndpoints,
  getTableDisplayName,
  type SqltoerdModelIndex,
  type SqltoerdRelationEndpoints
} from "./model";

export type RelationSummary = {
  id: string;
  fromLabel: string;
  toLabel: string;
};

export type SqlErdInspectorViewModel =
  | {
      type: "empty";
    }
  | {
      type: "table";
      columnCount: number;
      relations: RelationSummary[];
      table: ErdTable;
      title: string;
    }
  | {
      type: "column";
      column: ErdColumn;
      relations: RelationSummary[];
      table: ErdTable;
      title: string;
    }
  | {
      type: "relation";
      endpoints: SqltoerdRelationEndpoints | null;
      relation: ErdRelation;
      title: string;
    };

export function createSqlErdInspectorViewModel(
  selection: SqlErdSelection,
  modelIndex: SqltoerdModelIndex
): SqlErdInspectorViewModel {
  if (selection.type === "table") {
    const table = modelIndex.tablesById.get(selection.tableId);

    if (!table) {
      return { type: "empty" };
    }

    return {
      type: "table",
      columnCount: table.columns.length,
      relations: getRelationSummaries(
        modelIndex.relationsByTableId.get(table.id) ?? [],
        modelIndex
      ),
      table,
      title: getTableDisplayName(table)
    };
  }

  if (selection.type === "column") {
    const table = modelIndex.tablesById.get(selection.tableId);
    const column = modelIndex.columnsByTableId
      .get(selection.tableId)
      ?.get(selection.columnId);

    if (!table || !column) {
      return { type: "empty" };
    }

    const relations = (modelIndex.relationsByTableId.get(table.id) ?? []).filter(
      (relation) => isColumnConnectedToRelation(relation, table.id, column.id)
    );

    return {
      type: "column",
      column,
      relations: getRelationSummaries(relations, modelIndex),
      table,
      title: column.name
    };
  }

  if (selection.type === "relation") {
    const relation = modelIndex.relationsById.get(selection.relationId);

    if (!relation) {
      return { type: "empty" };
    }

    return {
      type: "relation",
      endpoints: getRelationEndpoints(relation, modelIndex),
      relation,
      title: relation.constraintName ?? relation.id
    };
  }

  return { type: "empty" };
}

export function isColumnConnectedToRelation(
  relation: ErdRelation,
  tableId: string,
  columnId: string
) {
  return (
    (relation.fromTableId === tableId &&
      relation.fromColumnIds.includes(columnId)) ||
    (relation.toTableId === tableId && relation.toColumnIds.includes(columnId))
  );
}

function getRelationSummaries(
  relations: ErdRelation[],
  modelIndex: SqltoerdModelIndex
) {
  return relations.map((relation) => {
    const endpoints = getRelationEndpoints(relation, modelIndex);

    return {
      id: relation.id,
      fromLabel: endpoints
        ? formatSqlErdRelationEndpoint(endpoints.from.table, endpoints.from.columns)
        : relation.fromTableId,
      toLabel: endpoints
        ? formatSqlErdRelationEndpoint(endpoints.to.table, endpoints.to.columns)
        : relation.toTableId
    };
  });
}

export function formatSqlErdRelationEndpoint(
  table: ErdTable,
  columns: ErdColumn[]
) {
  return `${getTableDisplayName(table)}.${columns
    .map((column) => column.name)
    .join(", ")}`;
}
