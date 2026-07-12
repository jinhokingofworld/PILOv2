import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";

export type SqltoerdModelToSqlInput = {
  dialect: SqltoerdResolvedDialect;
  modelJson: SqltoerdModelJsonV1;
};

export type SqltoerdModelToSqlResult = {
  sql: string;
  warnings: string[];
};

export function generateSqlDdlFromErdModel(
  input: SqltoerdModelToSqlInput
): SqltoerdModelToSqlResult {
  const tablesById = new Map(input.modelJson.schema.tables.map((table) => [table.id, table]));
  const tableIndexById = new Map(
    input.modelJson.schema.tables.map((table, index) => [table.id, index])
  );
  const deferredRelationIds = new Set(
    input.modelJson.schema.relations
      .filter(
        (relation) =>
          isCyclicRelation(relation, input.modelJson.schema.relations) ||
          isForwardReference(relation, tableIndexById)
      )
      .map((relation) => relation.id)
  );
  const relationsByTableId = groupRelationsByTableId(input.modelJson.schema.relations);
  const createStatements = input.modelJson.schema.tables.map((table) =>
    renderCreateTable(
      table,
      relationsByTableId.get(table.id) ?? [],
      deferredRelationIds,
      tablesById,
      input.dialect
    )
  );
  const alterStatements = input.modelJson.schema.relations
    .filter((relation) => deferredRelationIds.has(relation.id))
    .map((relation) => renderAlterTableRelation(relation, tablesById, input.dialect));

  return {
    sql: [...createStatements, ...alterStatements].join("\n\n"),
    warnings: [
      "The generator emits normalized CREATE TABLE and FOREIGN KEY statements; source formatting, comments, and unsupported statements are not preserved."
    ]
  };
}

function isForwardReference(
  relation: ErdRelation,
  tableIndexById: Map<string, number>
) {
  const fromTableIndex = tableIndexById.get(relation.fromTableId);
  const toTableIndex = tableIndexById.get(relation.toTableId);

  return (
    typeof fromTableIndex === "number" &&
    typeof toTableIndex === "number" &&
    toTableIndex > fromTableIndex
  );
}

function renderCreateTable(
  table: ErdTable,
  relations: ErdRelation[],
  deferredRelationIds: Set<string>,
  tablesById: Map<string, ErdTable>,
  dialect: SqltoerdResolvedDialect
) {
  const lines = [
    ...table.columns.map((column) => renderColumn(column, dialect)),
    ...renderTableConstraints(table, dialect),
    ...relations
      .filter((relation) => !deferredRelationIds.has(relation.id))
      .map((relation) => renderForeignKey(relation, tablesById, dialect))
  ];

  return `CREATE TABLE ${quoteTable(table, dialect)} (\n${lines
    .map((line) => `  ${line}`)
    .join(",\n")}\n);`;
}

function renderColumn(column: ErdColumn, dialect: SqltoerdResolvedDialect) {
  const parts = [quoteIdentifier(column.name, dialect), column.dataType];

  if (!column.nullable) {
    parts.push("NOT NULL");
  }

  if (column.defaultValue !== null) {
    parts.push(`DEFAULT ${column.defaultValue}`);
  }

  return parts.join(" ");
}

function renderTableConstraints(table: ErdTable, dialect: SqltoerdResolvedDialect) {
  const explicitConstraints = table.constraints.map((constraint) => {
    const columnsById = new Map(table.columns.map((column) => [column.id, column]));
    const columnNames = constraint.columnIds.map((columnId) => {
      const column = columnsById.get(columnId);

      if (!column) {
        throw new Error(`Constraint '${constraint.id}' references a missing column.`);
      }

      return quoteIdentifier(column.name, dialect);
    });
    const name = constraint.name
      ? `CONSTRAINT ${quoteIdentifier(constraint.name, dialect)} `
      : "";
    const keyword = constraint.kind === "primary_key" ? "PRIMARY KEY" : "UNIQUE";

    return `${name}${keyword} (${columnNames.join(", ")})`;
  });
  const constrainedColumnIds = new Set(
    table.constraints.flatMap((constraint) => constraint.columnIds)
  );
  const fallbackPrimaryKeyColumns = table.columns.filter(
    (column) => column.primaryKey && !constrainedColumnIds.has(column.id)
  );
  const fallbackUniqueColumns = table.columns.filter(
    (column) => column.unique && !constrainedColumnIds.has(column.id)
  );

  return [
    ...explicitConstraints,
    ...(fallbackPrimaryKeyColumns.length
      ? [
          `PRIMARY KEY (${fallbackPrimaryKeyColumns
            .map((column) => quoteIdentifier(column.name, dialect))
            .join(", ")})`
        ]
      : []),
    ...fallbackUniqueColumns.map(
      (column) => `UNIQUE (${quoteIdentifier(column.name, dialect)})`
    )
  ];
}

function renderAlterTableRelation(
  relation: ErdRelation,
  tablesById: Map<string, ErdTable>,
  dialect: SqltoerdResolvedDialect
) {
  const fromTable = getRelationTable(tablesById, relation.fromTableId, relation.id);

  return `ALTER TABLE ${quoteTable(fromTable, dialect)} ADD ${renderForeignKey(
    relation,
    tablesById,
    dialect
  )};`;
}

function renderForeignKey(
  relation: ErdRelation,
  tablesById: Map<string, ErdTable>,
  dialect: SqltoerdResolvedDialect
) {
  const fromTable = getRelationTable(tablesById, relation.fromTableId, relation.id);
  const toTable = getRelationTable(tablesById, relation.toTableId, relation.id);
  const fromColumns = getRelationColumns(fromTable, relation.fromColumnIds, relation.id, dialect);
  const toColumns = getRelationColumns(toTable, relation.toColumnIds, relation.id, dialect);
  const name = relation.constraintName
    ? `CONSTRAINT ${quoteIdentifier(relation.constraintName, dialect)} `
    : "";

  return `${name}FOREIGN KEY (${fromColumns.join(", ")}) REFERENCES ${quoteTable(
    toTable,
    dialect
  )} (${toColumns.join(", ")})`;
}

function getRelationTable(tablesById: Map<string, ErdTable>, tableId: string, relationId: string) {
  const table = tablesById.get(tableId);

  if (!table) {
    throw new Error(`Relation '${relationId}' references a missing table.`);
  }

  return table;
}

function getRelationColumns(
  table: ErdTable,
  columnIds: string[],
  relationId: string,
  dialect: SqltoerdResolvedDialect
) {
  const columnsById = new Map(table.columns.map((column) => [column.id, column]));

  return columnIds.map((columnId) => {
    const column = columnsById.get(columnId);

    if (!column) {
      throw new Error(`Relation '${relationId}' references a missing column.`);
    }

    return quoteIdentifier(column.name, dialect);
  });
}

function groupRelationsByTableId(relations: ErdRelation[]) {
  const result = new Map<string, ErdRelation[]>();

  for (const relation of relations) {
    const tableRelations = result.get(relation.fromTableId) ?? [];
    tableRelations.push(relation);
    result.set(relation.fromTableId, tableRelations);
  }

  return result;
}

function isCyclicRelation(relation: ErdRelation, relations: ErdRelation[]) {
  return canReachTable(relation.toTableId, relation.fromTableId, relations, new Set());
}

function canReachTable(
  currentTableId: string,
  targetTableId: string,
  relations: ErdRelation[],
  visitedTableIds: Set<string>
): boolean {
  if (currentTableId === targetTableId) {
    return true;
  }

  if (visitedTableIds.has(currentTableId)) {
    return false;
  }

  visitedTableIds.add(currentTableId);

  return relations
    .filter((relation) => relation.fromTableId === currentTableId)
    .some((relation) =>
      canReachTable(relation.toTableId, targetTableId, relations, visitedTableIds)
    );
}

function quoteTable(table: ErdTable, dialect: SqltoerdResolvedDialect) {
  return [table.schemaName, table.name]
    .filter((name): name is string => Boolean(name))
    .map((name) => quoteIdentifier(name, dialect))
    .join(".");
}

function quoteIdentifier(name: string, dialect: SqltoerdResolvedDialect) {
  if (dialect === "mysql") {
    return `\`${name.replaceAll("`", "``")}\``;
  }

  return `"${name.replaceAll('"', '""')}"`;
}
