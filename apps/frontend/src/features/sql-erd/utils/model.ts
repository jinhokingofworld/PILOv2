import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdAnnotationLink,
  SqltoerdAnnotationsV1,
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

export type SqlErdRelationCardinality =
  | "one"
  | "zero_or_one"
  | "zero_or_many";

export type SqlErdRelationCardinalityEndpoints = {
  from: SqlErdRelationCardinality;
  to: SqlErdRelationCardinality;
};

export type SqltoerdModelIndex = {
  tablesById: Map<string, ErdTable>;
  columnsByTableId: Map<string, Map<string, ErdColumn>>;
  relationsById: Map<string, ErdRelation>;
  relationsByTableId: Map<string, ErdRelation[]>;
};

export type SqltoerdTablePosition = Pick<
  SqltoerdTableLayout,
  "tableId" | "x" | "y"
>;

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

export function createSqltoerdLayoutForModel(
  modelJson: SqltoerdModelJsonV1,
  previousLayoutJson?: SqltoerdLayoutJsonV1
): SqltoerdLayoutJsonV1 {
  const previousLayoutsByTableId = new Map(
    previousLayoutJson?.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ]) ?? []
  );
  const annotations = filterSqltoerdAnnotationsForModel(
    modelJson,
    previousLayoutJson?.annotations
  );

  return {
    version: 1 as SqltoerdLayoutJsonV1["version"],
    tableLayouts: modelJson.schema.tables.map((table, index) => {
      const previousLayout = previousLayoutsByTableId.get(table.id);

      if (previousLayout) {
        return previousLayout;
      }

      return {
        tableId: table.id,
        x: 80 + (index % 3) * 360,
        y: 80 + Math.floor(index / 3) * 280
      };
    }),
    ...(annotations ? { annotations } : {})
  };
}

export function updateSqltoerdLayoutWithTablePositions(
  modelJson: SqltoerdModelJsonV1,
  previousLayoutJson: SqltoerdLayoutJsonV1,
  tablePositions: SqltoerdTablePosition[]
): SqltoerdLayoutJsonV1 {
  const tablePositionsById = new Map(
    tablePositions.map((tablePosition) => [
      tablePosition.tableId,
      tablePosition
    ])
  );
  const baseLayoutJson = createSqltoerdLayoutForModel(
    modelJson,
    previousLayoutJson
  );

  return {
    ...baseLayoutJson,
    tableLayouts: baseLayoutJson.tableLayouts.map((tableLayout) => {
      const tablePosition = tablePositionsById.get(tableLayout.tableId);

      if (!tablePosition) {
        return tableLayout;
      }

      return {
        ...tableLayout,
        x: tablePosition.x,
        y: tablePosition.y
      };
    }),
    ...(previousLayoutJson.viewport
      ? { viewport: previousLayoutJson.viewport }
      : {}),
    ...(previousLayoutJson.annotations
      ? { annotations: previousLayoutJson.annotations }
      : {})
  };
}

export function areSqltoerdLayoutsEqual(
  leftLayoutJson: SqltoerdLayoutJsonV1,
  rightLayoutJson: SqltoerdLayoutJsonV1
) {
  if (
    leftLayoutJson.version !== rightLayoutJson.version ||
    leftLayoutJson.tableLayouts.length !== rightLayoutJson.tableLayouts.length
  ) {
    return false;
  }

  for (let index = 0; index < leftLayoutJson.tableLayouts.length; index += 1) {
    if (
      !areSqltoerdTableLayoutsEqual(
        leftLayoutJson.tableLayouts[index],
        rightLayoutJson.tableLayouts[index]
      )
    ) {
      return false;
    }
  }

  return areSqltoerdViewportsEqual(
    leftLayoutJson.viewport,
    rightLayoutJson.viewport
  ) && areSqltoerdAnnotationsEqual(
    leftLayoutJson.annotations,
    rightLayoutJson.annotations
  );
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

export function inferSqlErdRelationCardinality(
  relation: ErdRelation,
  modelIndex: SqltoerdModelIndex
): SqlErdRelationCardinalityEndpoints | null {
  if (
    relation.fromColumnIds.length !== 1 ||
    relation.toColumnIds.length !== 1
  ) {
    return null;
  }

  const endpoints = getRelationEndpoints(relation, modelIndex);

  if (
    !endpoints ||
    endpoints.from.columns.length !== 1 ||
    endpoints.to.columns.length !== 1
  ) {
    return null;
  }

  const fromColumn = endpoints.from.columns[0];
  const isFromColumnUnique =
    fromColumn.unique ||
    endpoints.from.table.constraints.some(
      (constraint) =>
        (constraint.kind === "primary_key" || constraint.kind === "unique") &&
        constraint.columnIds.length === 1 &&
        constraint.columnIds[0] === fromColumn.id
    );

  return {
    from: isFromColumnUnique ? "zero_or_one" : "zero_or_many",
    to: fromColumn.nullable ? "zero_or_one" : "one"
  };
}

function areOptionalNumbersEqual(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return Math.abs(left - right) < 0.01;
}

function areSqltoerdTableLayoutsEqual(
  leftTableLayout: SqltoerdTableLayout,
  rightTableLayout: SqltoerdTableLayout
) {
  return (
    leftTableLayout.tableId === rightTableLayout.tableId &&
    Math.abs(leftTableLayout.x - rightTableLayout.x) < 0.01 &&
    Math.abs(leftTableLayout.y - rightTableLayout.y) < 0.01 &&
    areOptionalNumbersEqual(leftTableLayout.width, rightTableLayout.width)
  );
}

function areSqltoerdViewportsEqual(
  leftViewport: SqltoerdLayoutJsonV1["viewport"],
  rightViewport: SqltoerdLayoutJsonV1["viewport"]
) {
  if (!leftViewport || !rightViewport) {
    return leftViewport === rightViewport;
  }

  return (
    Math.abs(leftViewport.x - rightViewport.x) < 0.01 &&
    Math.abs(leftViewport.y - rightViewport.y) < 0.01 &&
    Math.abs(leftViewport.zoom - rightViewport.zoom) < 0.01
  );
}

function filterSqltoerdAnnotationsForModel(
  modelJson: SqltoerdModelJsonV1,
  annotations: SqltoerdAnnotationsV1 | undefined
): SqltoerdAnnotationsV1 | undefined {
  if (!annotations) {
    return undefined;
  }

  const modelIndex = createSqltoerdModelIndex(modelJson);
  return {
    version: annotations.version,
    links: annotations.links.filter((annotation) =>
      isSqltoerdAnnotationEndpointPresent(annotation, modelIndex)
    )
  };
}

function isSqltoerdAnnotationEndpointPresent(
  annotation: SqltoerdAnnotationLink,
  modelIndex: SqltoerdModelIndex
) {
  if (
    !modelIndex.tablesById.has(annotation.fromTableId) ||
    !modelIndex.tablesById.has(annotation.toTableId)
  ) {
    return false;
  }

  if (annotation.kind === "table_link") {
    return true;
  }

  return (
    modelIndex.columnsByTableId
      .get(annotation.fromTableId)
      ?.has(annotation.fromColumnId) === true &&
    modelIndex.columnsByTableId
      .get(annotation.toTableId)
      ?.has(annotation.toColumnId) === true
  );
}

function areSqltoerdAnnotationsEqual(
  leftAnnotations: SqltoerdAnnotationsV1 | undefined,
  rightAnnotations: SqltoerdAnnotationsV1 | undefined
) {
  const leftLinks = leftAnnotations?.links ?? [];
  const rightLinks = rightAnnotations?.links ?? [];

  if (leftLinks.length !== rightLinks.length) {
    return false;
  }

  return leftLinks.every((leftLink, index) =>
    areSqltoerdAnnotationLinksEqual(leftLink, rightLinks[index])
  );
}

function areSqltoerdAnnotationLinksEqual(
  leftLink: SqltoerdAnnotationLink,
  rightLink: SqltoerdAnnotationLink | undefined
) {
  if (
    !rightLink ||
    leftLink.id !== rightLink.id ||
    leftLink.kind !== rightLink.kind ||
    leftLink.fromTableId !== rightLink.fromTableId ||
    leftLink.toTableId !== rightLink.toTableId ||
    leftLink.label !== rightLink.label
  ) {
    return false;
  }

  if (leftLink.kind === "table_link" || rightLink.kind === "table_link") {
    return leftLink.kind === rightLink.kind;
  }

  return (
    leftLink.fromColumnId === rightLink.fromColumnId &&
    leftLink.toColumnId === rightLink.toColumnId
  );
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
