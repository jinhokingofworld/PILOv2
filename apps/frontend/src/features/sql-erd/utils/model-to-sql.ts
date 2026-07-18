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
  modelJson: SqltoerdModelJsonV1;
  sql: string;
  warnings: string[];
};

export class SqltoerdModelToSqlGenerationError extends Error {
  readonly code = "SQLITE_DEFERRED_FOREIGN_KEY";

  constructor(readonly relationIds: string[]) {
    super(
      "지원하지 않는 ALTER TABLE FOREIGN KEY 구문이 필요해 SQLite DDL로 재생성할 수 없습니다. 테이블 순서를 조정하거나 SQL 원문을 직접 수정하세요."
    );
    this.name = "SqltoerdModelToSqlGenerationError";
  }
}

export function generateSqlDdlFromErdModel(
  input: SqltoerdModelToSqlInput
): SqltoerdModelToSqlResult {
  const normalized = normalizeSqlErdModelDataTypes(input.modelJson, input.dialect);
  const modelJson = normalized.modelJson;
  const tablesById = new Map(modelJson.schema.tables.map((table) => [table.id, table]));
  const tableIndexById = new Map(
    modelJson.schema.tables.map((table, index) => [table.id, index])
  );
  const deferredRelationIds = new Set(
    modelJson.schema.relations
      .filter(
        (relation) =>
          isCyclicRelation(relation, modelJson.schema.relations) ||
          isForwardReference(relation, tableIndexById)
      )
      .map((relation) => relation.id)
  );

  if (input.dialect === "sqlite" && deferredRelationIds.size > 0) {
    throw new SqltoerdModelToSqlGenerationError([...deferredRelationIds]);
  }
  const relationsByTableId = groupRelationsByTableId(modelJson.schema.relations);
  const createStatements = modelJson.schema.tables.map((table) =>
    renderCreateTable(
      table,
      relationsByTableId.get(table.id) ?? [],
      deferredRelationIds,
      tablesById,
      input.dialect
    )
  );
  const alterStatements = modelJson.schema.relations
    .filter((relation) => deferredRelationIds.has(relation.id))
    .map((relation) => renderAlterTableRelation(relation, tablesById, input.dialect));

  return {
    modelJson,
    sql: [...createStatements, ...alterStatements].join("\n\n"),
    warnings: [
      "정규화된 CREATE TABLE 및 FOREIGN KEY 구문으로 SQL을 재생성합니다. 기존 SQL의 서식, 주석, 지원하지 않는 구문은 보존되지 않을 수 있습니다.",
      ...normalized.warnings
    ]
  };
}

function normalizeSqlErdModelDataTypes(
  modelJson: SqltoerdModelJsonV1,
  dialect: SqltoerdResolvedDialect
) {
  const warnings: string[] = [];
  let hasChanges = false;
  const tables = modelJson.schema.tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => {
      const dataType = normalizeSqlErdDataType(column.dataType, dialect);

      if (dataType === column.dataType) {
        return column;
      }

      hasChanges = true;
      warnings.push(
        `${getTableDisplayName(table)}.${column.name}의 UUID 타입을 ${dataType}(으)로 정규화했습니다.`
      );
      return { ...column, dataType };
    })
  }));

  return {
    modelJson: hasChanges
      ? { ...modelJson, schema: { ...modelJson.schema, tables } }
      : modelJson,
    warnings
  };
}

function normalizeSqlErdDataType(
  dataType: string,
  dialect: SqltoerdResolvedDialect
) {
  if (dataType.trim().toUpperCase() !== "UUID") {
    return dataType;
  }

  if (dialect === "mysql") {
    return "CHAR(36)";
  }

  if (dialect === "sqlite") {
    return "TEXT";
  }

  return dataType;
}

function getTableDisplayName(table: ErdTable) {
  return table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
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
  if (relation.fromTableId === relation.toTableId) {
    return false;
  }

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
