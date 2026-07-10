import { PostgreSQL } from "@codemirror/lang-sql";
import sqlParser from "node-sql-parser";

import {
  SQLTOERD_MODEL_JSON_VERSION,
  type ErdColumn,
  type ErdConstraint,
  type ErdRelation,
  type ErdTable,
  type SqltoerdDialect,
  type SqltoerdModelJsonV1,
  type SqltoerdResolvedDialect
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
      resolvedDialect: SqltoerdResolvedDialect;
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

type PostgreSqlSyntaxNode = ReturnType<
  typeof PostgreSQL.language.parser.parse
>["topNode"];

const parser = new Parser();

export function parseSqlDdlToErdModel(
  input: SqltoerdDdlParseInput
): SqltoerdDdlParseResult {
  const sourceText = input.sourceText.trim();

  if (!sourceText) {
    return createParseFailure("EMPTY_SOURCE", "SQL DDL source is empty.");
  }

  const databases = resolveParserDatabases(input.dialect, sourceText);

  if (databases.length === 0) {
    return createParseFailure(
      "UNSUPPORTED_DIALECT",
      `SQL dialect '${input.dialect}' is not supported by the MVP parser.`
    );
  }

  let astNodes: SqlParserAstNode[] | null = null;
  let resolvedDialect: SqltoerdResolvedDialect | null = null;
  let lastParseErrorMessage = "Failed to parse SQL DDL.";

  for (const database of databases) {
    try {
      const parserSourceText =
        database === "postgresql"
          ? preparePostgreSqlParserSource(sourceText)
          : sourceText;
      const ast = parser.astify(parserSourceText, { database });
      astNodes = (Array.isArray(ast) ? ast : [ast]) as unknown as SqlParserAstNode[];
      resolvedDialect = database;
      break;
    } catch (error) {
      lastParseErrorMessage =
        error instanceof Error ? error.message : lastParseErrorMessage;
    }
  }

  if (!astNodes || !resolvedDialect) {
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
    resolvedDialect,
    modelJson: {
      version: SQLTOERD_MODEL_JSON_VERSION,
      schema: {
        tables: tableStates.map((tableState) => tableState.table),
        relations
      }
    }
  };
}

function preparePostgreSqlParserSource(sourceText: string) {
  const declaredTypes = collectPostgreSqlUserDefinedTypeDeclarations(sourceText);

  if (declaredTypes.length === 0) {
    return sourceText;
  }

  // node-sql-parser registers CREATE TYPE names but not CREATE DOMAIN names.
  // Register both in a parser-only prelude so table columns keep their original type.
  const parserPrelude = declaredTypes
    .map(
      (typeName) =>
        `CREATE TYPE ${typeName} AS ENUM ('__pilo_sqltoerd_parser_type__');`
    )
    .join("\n");

  return `${parserPrelude}\n${sourceText}`;
}

export function collectPostgreSqlUserDefinedTypeDeclarations(
  sourceText: string
) {
  const tree = PostgreSQL.language.parser.parse(sourceText);
  const rootCursor = tree.cursor();
  const declaredTypes = new Map<string, string>();

  if (!rootCursor.firstChild()) {
    return [];
  }

  do {
    if (rootCursor.name !== "Statement") {
      continue;
    }

    const statementNodes = getPostgreSqlStatementNodes(rootCursor.node);
    let cursor = 0;

    if (readPostgreSqlKeyword(statementNodes[cursor], sourceText) !== "CREATE") {
      continue;
    }

    cursor += 1;

    if (
      readPostgreSqlKeyword(statementNodes[cursor], sourceText) === "OR" &&
      readPostgreSqlKeyword(statementNodes[cursor + 1], sourceText) === "REPLACE"
    ) {
      cursor += 2;
    }

    const declarationKind = readPostgreSqlKeyword(
      statementNodes[cursor],
      sourceText
    );

    if (declarationKind !== "TYPE" && declarationKind !== "DOMAIN") {
      continue;
    }

    const typeNameNode = statementNodes[cursor + 1];
    const typeKey = createPostgreSqlTypeNameKey(typeNameNode, sourceText);

    if (typeKey && !declaredTypes.has(typeKey)) {
      declaredTypes.set(
        typeKey,
        sourceText.slice(typeNameNode.from, typeNameNode.to)
      );
    }
  } while (rootCursor.nextSibling());

  return [...declaredTypes.values()];
}

function getPostgreSqlStatementNodes(statementNode: PostgreSqlSyntaxNode) {
  const cursor = statementNode.cursor();
  const nodes: PostgreSqlSyntaxNode[] = [];

  if (!cursor.firstChild()) {
    return nodes;
  }

  do {
    if (!cursor.name.endsWith("Comment")) {
      nodes.push(cursor.node);
    }
  } while (cursor.nextSibling());

  return nodes;
}

function readPostgreSqlKeyword(
  node: PostgreSqlSyntaxNode | undefined,
  sourceText: string
) {
  return node?.name === "Keyword"
    ? sourceText.slice(node.from, node.to).toUpperCase()
    : null;
}

function createPostgreSqlTypeNameKey(
  node: PostgreSqlSyntaxNode | undefined,
  sourceText: string
) {
  if (!node) {
    return null;
  }

  if (node.name === "Identifier" || node.name === "QuotedIdentifier") {
    return createPostgreSqlIdentifierKey(node, sourceText);
  }

  if (node.name !== "CompositeIdentifier") {
    return null;
  }

  const cursor = node.cursor();
  const identifiers: string[] = [];

  if (!cursor.firstChild()) {
    return null;
  }

  do {
    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
      identifiers.push(createPostgreSqlIdentifierKey(cursor.node, sourceText));
    }
  } while (cursor.nextSibling());

  return identifiers.length > 0 ? identifiers.join(".") : null;
}

function createPostgreSqlIdentifierKey(
  node: PostgreSqlSyntaxNode,
  sourceText: string
) {
  const identifier = sourceText.slice(node.from, node.to);

  return node.name === "QuotedIdentifier"
    ? `quoted:${identifier.slice(1, -1).replace(/""/g, '"')}`
    : `unquoted:${identifier.toLowerCase()}`;
}

function resolveParserDatabases(
  dialect: SqltoerdDialect,
  sourceText: string
): SqltoerdResolvedDialect[] {
  if (dialect === "auto") {
    return getAutoParserDatabases(sourceText);
  }

  if (dialect === "postgresql") {
    return ["postgresql"];
  }

  if (dialect === "mysql") {
    return ["mysql"];
  }

  return [];
}

function getAutoParserDatabases(
  sourceText: string
): SqltoerdResolvedDialect[] {
  const hasMySqlMarker =
    /\b(?:AUTO_INCREMENT|UNSIGNED|UNIQUE\s+KEY|DATETIME)\b|\bENGINE\s*=|`[^`]+`/i.test(
      sourceText
    );
  const hasPostgreSqlMarker =
    /\b(?:BIGSERIAL|SMALLSERIAL|SERIAL|TIMESTAMPTZ|JSONB|BYTEA)\b|::/i.test(
      sourceText
    );

  if (hasMySqlMarker && !hasPostgreSqlMarker) {
    return ["mysql", "postgresql"];
  }

  return ["postgresql", "mysql"];
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
