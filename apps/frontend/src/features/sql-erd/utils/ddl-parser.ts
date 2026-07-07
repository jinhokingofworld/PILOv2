import sqlParser from "node-sql-parser";

import {
  SQLTOERD_MODEL_JSON_VERSION,
  type ErdColumn,
  type ErdConstraint,
  type ErdRelation,
  type ErdTable,
  type SqltoerdDialect,
  type SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

const { Parser } = sqlParser;

export type SqltoerdDdlParseInput = {
  sourceText: string;
  dialect: SqltoerdDialect;
};

export type SqltoerdDdlParseResult =
  | {
      ok: true;
      modelJson: SqltoerdModelJsonV1;
    }
  | {
      ok: false;
      error: SqltoerdDdlParseError;
    };

export type SqltoerdDdlParseError = {
  code: "EMPTY_SOURCE" | "UNSUPPORTED_DIALECT" | "PARSE_FAILED" | "NO_CREATE_TABLE";
  message: string;
};

type SqlParserAstNode = Record<string, unknown>;

type MutableTableParseState = {
  table: ErdTable;
  columnsByName: Map<string, ErdColumn>;
};

const parser = new Parser();

export function parseSqlDdlToErdModel(
  input: SqltoerdDdlParseInput
): SqltoerdDdlParseResult {
  const sourceText = input.sourceText.trim();

  if (!sourceText) {
    return createParseFailure("EMPTY_SOURCE", "SQL DDL source is empty.");
  }

  const databases = resolveParserDatabases(input.dialect);

  if (databases.length === 0) {
    return createParseFailure(
      "UNSUPPORTED_DIALECT",
      `SQL dialect '${input.dialect}' is not supported by the MVP parser.`
    );
  }

  let astNodes: SqlParserAstNode[] | null = null;
  let lastParseErrorMessage = "Failed to parse SQL DDL.";

  for (const database of databases) {
    try {
      const ast = parser.astify(sourceText, { database });
      astNodes = (Array.isArray(ast) ? ast : [ast]) as unknown as SqlParserAstNode[];
      break;
    } catch (error) {
      lastParseErrorMessage =
        error instanceof Error ? error.message : lastParseErrorMessage;
    }
  }

  if (!astNodes) {
    return createParseFailure(
      "PARSE_FAILED",
      lastParseErrorMessage
    );
  }

  const createTableNodes = astNodes.filter(isCreateTableNode);

  if (createTableNodes.length === 0) {
    return createParseFailure(
      "NO_CREATE_TABLE",
      "SQLtoERD MVP parser expects one or more CREATE TABLE statements."
    );
  }

  const tableStates = createTableNodes.map(createTableState);
  const tableStatesByDisplayName = new Map<string, MutableTableParseState>();
  const relations: ErdRelation[] = [];

  for (const tableState of tableStates) {
    tableStatesByDisplayName.set(
      getTableQualifiedName(tableState.table.schemaName, tableState.table.name),
      tableState
    );
    tableStatesByDisplayName.set(tableState.table.name, tableState);
  }

  for (let index = 0; index < createTableNodes.length; index += 1) {
    applyTableDefinitions(
      createTableNodes[index],
      tableStates[index],
      tableStatesByDisplayName,
      relations
    );
  }

  return {
    ok: true,
    modelJson: {
      version: SQLTOERD_MODEL_JSON_VERSION,
      schema: {
        tables: tableStates.map((tableState) => tableState.table),
        relations
      }
    }
  };
}

function resolveParserDatabases(dialect: SqltoerdDialect) {
  if (dialect === "auto") {
    return ["postgresql", "mysql"];
  }

  if (dialect === "postgresql") {
    return ["postgresql"];
  }

  if (dialect === "mysql") {
    return ["mysql"];
  }

  return [];
}

function createTableState(createTableNode: SqlParserAstNode): MutableTableParseState {
  const tableRef = readFirstObject(createTableNode.table);
  const tableName = readString(tableRef?.table) ?? "unknown_table";
  const schemaName = readString(tableRef?.db) ?? readString(tableRef?.schema);
  const tableId = createTableId(schemaName, tableName);
  const table: ErdTable = {
    id: tableId,
    name: tableName,
    schemaName,
    columns: [],
    constraints: [],
    comment: null
  };

  const tableState = {
    table,
    columnsByName: new Map<string, ErdColumn>()
  };

  for (const definition of readArray(createTableNode.create_definitions)) {
    if (!isColumnDefinition(definition)) {
      continue;
    }

    const columnName = readColumnName(definition.column);

    if (!columnName) {
      continue;
    }

    const column = createColumnFromDefinition(table, columnName, definition);

    table.columns.push(column);
    tableState.columnsByName.set(column.name, column);
  }

  return tableState;
}

function applyTableDefinitions(
  createTableNode: SqlParserAstNode,
  tableState: MutableTableParseState,
  tableStatesByDisplayName: Map<string, MutableTableParseState>,
  relations: ErdRelation[]
) {
  for (const definition of readArray(createTableNode.create_definitions)) {
    if (isColumnDefinition(definition)) {
      applyInlineColumnConstraints(
        tableState,
        definition,
        tableStatesByDisplayName,
        relations
      );
      continue;
    }

    if (isConstraintDefinition(definition)) {
      applyTableConstraint(
        tableState,
        definition,
        tableStatesByDisplayName,
        relations
      );
    }
  }
}

function createColumnFromDefinition(
  table: ErdTable,
  columnName: string,
  definition: SqlParserAstNode
): ErdColumn {
  const dataType = formatColumnDataType(readObject(definition.definition));
  const primaryKey = hasTruthyConstraint(definition.primary_key);
  const unique = hasTruthyConstraint(definition.unique);

  return {
    id: createColumnId(table.schemaName, table.name, columnName),
    name: columnName,
    dataType,
    nullable: primaryKey ? false : !isNotNullDefinition(definition),
    primaryKey,
    foreignKey: Boolean(readObject(definition.reference_definition)),
    unique,
    defaultValue: null,
    comment: null
  };
}

function applyInlineColumnConstraints(
  tableState: MutableTableParseState,
  definition: SqlParserAstNode,
  tableStatesByDisplayName: Map<string, MutableTableParseState>,
  relations: ErdRelation[]
) {
  const columnName = readColumnName(definition.column);

  if (!columnName) {
    return;
  }

  const column = tableState.columnsByName.get(columnName);

  if (!column) {
    return;
  }

  if (hasTruthyConstraint(definition.primary_key)) {
    upsertConstraint(tableState.table, {
      id: `constraint.${getTableIdPart(tableState.table)}.pk`,
      kind: "primary_key",
      columnIds: [column.id],
      name: null
    });
    column.primaryKey = true;
    column.nullable = false;
  }

  if (hasTruthyConstraint(definition.unique)) {
    upsertConstraint(tableState.table, {
      id: `constraint.${getTableIdPart(tableState.table)}.${column.name}.unique`,
      kind: "unique",
      columnIds: [column.id],
      name: null
    });
    column.unique = true;
  }

  const referenceDefinition = readObject(definition.reference_definition);

  if (referenceDefinition) {
    const relation = createRelationFromReference({
      constraintName: null,
      fromColumnNames: [column.name],
      fromTableState: tableState,
      referenceDefinition,
      tableStatesByDisplayName
    });

    if (relation) {
      column.foreignKey = true;
      relations.push(relation);
    }
  }
}

function applyTableConstraint(
  tableState: MutableTableParseState,
  definition: SqlParserAstNode,
  tableStatesByDisplayName: Map<string, MutableTableParseState>,
  relations: ErdRelation[]
) {
  const constraintType = readString(definition.constraint_type)?.toLowerCase() ?? "";
  const constraintName = readString(definition.constraint) ?? readString(definition.index);
  const columnNames = readColumnNames(definition.definition);
  const columns = columnNames
    .map((columnName) => tableState.columnsByName.get(columnName) ?? null)
    .filter((column): column is ErdColumn => column !== null);

  if (constraintType.includes("primary key")) {
    for (const column of columns) {
      column.primaryKey = true;
      column.nullable = false;
    }

    upsertConstraint(tableState.table, {
      id: `constraint.${getTableIdPart(tableState.table)}.pk`,
      kind: "primary_key",
      columnIds: columns.map((column) => column.id),
      name: constraintName
    });
    return;
  }

  if (constraintType.includes("unique")) {
    if (columns.length === 1) {
      columns[0].unique = true;
    }

    upsertConstraint(tableState.table, {
      id: createUniqueConstraintId(tableState.table, columns),
      kind: "unique",
      columnIds: columns.map((column) => column.id),
      name: constraintName
    });
    return;
  }

  if (constraintType.includes("foreign key")) {
    const referenceDefinition = readObject(definition.reference_definition);

    if (!referenceDefinition) {
      return;
    }

    const relation = createRelationFromReference({
      constraintName,
      fromColumnNames: columnNames,
      fromTableState: tableState,
      referenceDefinition,
      tableStatesByDisplayName
    });

    if (relation) {
      for (const column of columns) {
        column.foreignKey = true;
      }

      relations.push(relation);
    }
  }
}

function createRelationFromReference(input: {
  constraintName: string | null;
  fromColumnNames: string[];
  fromTableState: MutableTableParseState;
  referenceDefinition: SqlParserAstNode;
  tableStatesByDisplayName: Map<string, MutableTableParseState>;
}): ErdRelation | null {
  const toTableRef = readFirstObject(input.referenceDefinition.table);
  const toTableName = readString(toTableRef?.table);

  if (!toTableName) {
    return null;
  }

  const toSchemaName = readString(toTableRef?.db) ?? readString(toTableRef?.schema);
  const toTableState =
    input.tableStatesByDisplayName.get(getTableQualifiedName(toSchemaName, toTableName)) ??
    input.tableStatesByDisplayName.get(toTableName);

  if (!toTableState) {
    return null;
  }

  const fromColumns = input.fromColumnNames
    .map((columnName) => input.fromTableState.columnsByName.get(columnName) ?? null)
    .filter((column): column is ErdColumn => column !== null);
  const toColumnNames = readColumnNames(input.referenceDefinition.definition);
  const toColumns = toColumnNames
    .map((columnName) => toTableState.columnsByName.get(columnName) ?? null)
    .filter((column): column is ErdColumn => column !== null);

  if (fromColumns.length === 0 || fromColumns.length !== toColumns.length) {
    return null;
  }

  return {
    id: createRelationId(input.fromTableState.table, fromColumns, toTableState.table, toColumns),
    kind: "foreign_key",
    fromTableId: input.fromTableState.table.id,
    fromColumnIds: fromColumns.map((column) => column.id),
    toTableId: toTableState.table.id,
    toColumnIds: toColumns.map((column) => column.id),
    constraintName: input.constraintName
  };
}

function isCreateTableNode(value: SqlParserAstNode) {
  return (
    readString(value.type)?.toLowerCase() === "create" &&
    readString(value.keyword)?.toLowerCase() === "table"
  );
}

function isColumnDefinition(value: SqlParserAstNode): value is SqlParserAstNode {
  return readString(value.resource)?.toLowerCase() === "column";
}

function isConstraintDefinition(value: SqlParserAstNode): value is SqlParserAstNode {
  return readString(value.resource)?.toLowerCase() === "constraint";
}

function formatColumnDataType(definition: SqlParserAstNode | null) {
  if (!definition) {
    return "UNKNOWN";
  }

  const dataType = readString(definition.dataType)?.toUpperCase() ?? "UNKNOWN";
  const length = readPrimitive(definition.length);
  const scale = readPrimitive(definition.scale);
  const suffix = readStringArray(definition.suffix)
    .map((suffixPart) => suffixPart.toUpperCase())
    .join(" ");
  let formattedDataType = dataType;

  if (length !== null) {
    formattedDataType =
      scale !== null
        ? `${dataType}(${String(length)},${String(scale)})`
        : `${dataType}(${String(length)})`;
  }

  return suffix ? `${formattedDataType} ${suffix}` : formattedDataType;
}

function readColumnNames(value: unknown) {
  return readArray(value)
    .map((entry) => readColumnName(entry))
    .filter((columnName): columnName is string => Boolean(columnName));
}

function readColumnName(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.column === "string") {
    return value.column;
  }

  if (isRecord(value.column)) {
    const expr = readObject(value.column.expr);
    const exprValue = readString(expr?.value);

    if (exprValue) {
      return exprValue;
    }
  }

  if (isRecord(value.expr)) {
    return readColumnName(value.expr);
  }

  return null;
}

function isNotNullDefinition(definition: SqlParserAstNode) {
  const nullable = readObject(definition.nullable);
  return readString(nullable?.type)?.toLowerCase() === "not null";
}

function hasTruthyConstraint(value: unknown) {
  return value !== null && value !== undefined && value !== false;
}

function upsertConstraint(table: ErdTable, constraint: ErdConstraint) {
  const existingIndex = table.constraints.findIndex(
    (currentConstraint) => currentConstraint.id === constraint.id
  );

  if (existingIndex >= 0) {
    table.constraints[existingIndex] = constraint;
    return;
  }

  table.constraints.push(constraint);
}

function createTableId(schemaName: string | null, tableName: string) {
  return `table.${createTableIdPart(schemaName, tableName)}`;
}

function createColumnId(
  schemaName: string | null,
  tableName: string,
  columnName: string
) {
  return `column.${createTableIdPart(schemaName, tableName)}.${columnName}`;
}

function createRelationId(
  fromTable: ErdTable,
  fromColumns: ErdColumn[],
  toTable: ErdTable,
  toColumns: ErdColumn[]
) {
  return [
    "relation",
    getTableIdPart(fromTable),
    fromColumns.map((column) => column.name).join("_"),
    getTableIdPart(toTable),
    toColumns.map((column) => column.name).join("_")
  ].join(".");
}

function createUniqueConstraintId(table: ErdTable, columns: ErdColumn[]) {
  return [
    "constraint",
    getTableIdPart(table),
    columns.map((column) => column.name).join("_"),
    "unique"
  ].join(".");
}

function getTableIdPart(table: ErdTable) {
  return createTableIdPart(table.schemaName, table.name);
}

function createTableIdPart(schemaName: string | null, tableName: string) {
  return schemaName ? `${schemaName}.${tableName}` : tableName;
}

function getTableQualifiedName(schemaName: string | null, tableName: string) {
  return schemaName ? `${schemaName}.${tableName}` : tableName;
}

function createParseFailure(
  code: SqltoerdDdlParseError["code"],
  message: string
): SqltoerdDdlParseResult {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

function readFirstObject(value: unknown) {
  return readObject(readArray(value)[0]);
}

function readObject(value: unknown): SqlParserAstNode | null {
  return isRecord(value) ? value : null;
}

function readArray(value: unknown): SqlParserAstNode[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is SqlParserAstNode => isRecord(entry))
    : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readPrimitive(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is SqlParserAstNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
