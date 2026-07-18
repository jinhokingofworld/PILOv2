import { MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
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
import {
  createSqltoerdSourceMap,
  type SqltoerdSourceMap
} from "@/features/sql-erd/utils/sql-source-map";
import { createSqltoerdForeignKeyRelationId } from "@/features/sql-erd/utils/relation-id";

const { Parser } = sqlParser;

export type SqltoerdDdlParseInput = {
  sourceText: string;
  dialect: SqltoerdDialect;
  sourceMapModelJson?: SqltoerdModelJsonV1;
};

export type SqltoerdDdlParseResult =
  | {
      ok: true;
      modelJson: SqltoerdModelJsonV1;
      resolvedDialect: SqltoerdResolvedDialect;
      sourceMap: SqltoerdSourceMap;
    }
  | {
      ok: false;
      error: SqltoerdDdlParseError;
    };

export type SqltoerdDdlParseError = {
  code:
    | "EMPTY_SOURCE"
    | "UNSUPPORTED_DIALECT"
    | "PARSE_FAILED"
    | "NO_CREATE_TABLE"
    | "SOURCE_TOO_LARGE";
  message: string;
};

export const SQL_ERD_SOURCE_TEXT_MAX_BYTES = 1024 * 1024;

type SqlParserAstNode = Record<string, unknown>;

type MutableTableParseState = {
  table: ErdTable;
  columnsByName: Map<string, ErdColumn>;
};

type SqlSyntaxNode = ReturnType<
  typeof PostgreSQL.language.parser.parse
>["topNode"];

type PostgreSqlSyntaxNode = SqlSyntaxNode;

type PostgreSqlParserSourceParts = {
  declaredTypes: string[];
  erdStatements: string[];
};

const parser = new Parser();

export function parseSqlDdlToErdModel(
  input: SqltoerdDdlParseInput
): SqltoerdDdlParseResult {
  if (isSqlErdSourceTextTooLarge(input.sourceText)) {
    return createParseFailure(
      "SOURCE_TOO_LARGE",
      "SQL DDL source exceeds the 1 MiB UTF-8 limit."
    );
  }

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
  let hasParserSource = false;
  let hasParserError = false;

  for (const database of databases) {
    try {
      const parserSourceText = prepareParserSource(database, sourceText);
      if (!parserSourceText.trim()) {
        continue;
      }
      hasParserSource = true;
      const ast = parser.astify(parserSourceText, { database });
      astNodes = (Array.isArray(ast) ? ast : [ast]) as unknown as SqlParserAstNode[];
      resolvedDialect = database;
      break;
    } catch (error) {
      hasParserError = true;
      lastParseErrorMessage =
        error instanceof Error ? error.message : lastParseErrorMessage;
    }
  }

  if (!astNodes || !resolvedDialect) {
    if (!hasParserSource && !hasParserError) {
      return createParseFailure(
        "NO_CREATE_TABLE",
        "SQLtoERD MVP parser expects one or more CREATE TABLE statements."
      );
    }

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

  for (const alterTableNode of astNodes.filter(isAlterTableNode)) {
    applyAlterTableConstraints(alterTableNode, tableStatesByDisplayName, relations);
  }

  const modelJson: SqltoerdModelJsonV1 = {
    version: SQLTOERD_MODEL_JSON_VERSION,
    schema: {
      tables: tableStates.map((tableState) => tableState.table),
      relations
    }
  };

  return {
    ok: true,
    resolvedDialect,
    modelJson,
    sourceMap: createSqltoerdSourceMap({
      dialect: resolvedDialect,
      modelJson: input.sourceMapModelJson ?? modelJson,
      sourceText: input.sourceText
    })
  };
}

export function isSqlErdSourceTextTooLarge(sourceText: string) {
  return (
    new TextEncoder().encode(sourceText).byteLength >
    SQL_ERD_SOURCE_TEXT_MAX_BYTES
  );
}

function prepareParserSource(
  database: SqltoerdResolvedDialect,
  sourceText: string
) {
  if (database === "postgresql") {
    return preparePostgreSqlParserSource(sourceText);
  }

  if (database === "mysql") {
    return prepareMySqlParserSource(sourceText);
  }

  return prepareSqliteParserSource(sourceText);
}

function prepareMySqlParserSource(sourceText: string) {
  return splitMySqlStatements(sourceText)
    .filter(isMySqlErdStatement)
    .map((statement) => `${statement};`)
    .join("\n");
}

function splitMySqlStatements(sourceText: string) {
  const statements: string[] = [];
  let delimiter = ";";
  let chunks: string[] = [];
  let index = 0;
  let lineStart = true;
  let state:
    | "normal"
    | "single_quote"
    | "double_quote"
    | "backtick"
    | "line_comment"
    | "block_comment" = "normal";

  const finishStatement = () => {
    const statement = chunks.join("").trim();

    if (statement) {
      statements.push(statement);
    }

    chunks = [];
  };

  while (index < sourceText.length) {
    if (state === "normal" && lineStart) {
      const lineEnd = sourceText.indexOf("\n", index);
      const line = sourceText.slice(
        index,
        lineEnd === -1 ? sourceText.length : lineEnd
      );
      const delimiterDirective =
        /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);

      if (delimiterDirective) {
        finishStatement();
        delimiter = delimiterDirective[1];
        index = lineEnd === -1 ? sourceText.length : lineEnd + 1;
        lineStart = true;
        continue;
      }
    }

    const character = sourceText[index];
    const nextCharacter = sourceText[index + 1];

    if (state === "line_comment") {
      chunks.push(character);
      index += 1;

      if (character === "\n") {
        state = "normal";
        lineStart = true;
      }
      continue;
    }

    if (state === "block_comment") {
      chunks.push(character);

      if (character === "*" && nextCharacter === "/") {
        chunks.push(nextCharacter);
        index += 2;
        state = "normal";
      } else {
        index += 1;
      }

      lineStart = character === "\n";
      continue;
    }

    if (
      state === "single_quote" ||
      state === "double_quote" ||
      state === "backtick"
    ) {
      const quote =
        state === "single_quote" ? "'" : state === "double_quote" ? '"' : "`";
      chunks.push(character);

      if (character === "\\" && nextCharacter !== undefined) {
        chunks.push(nextCharacter);
        index += 2;
        lineStart = nextCharacter === "\n";
        continue;
      }

      if (character === quote && nextCharacter === quote) {
        chunks.push(nextCharacter);
        index += 2;
        lineStart = false;
        continue;
      }

      index += 1;
      lineStart = character === "\n";

      if (character === quote) {
        state = "normal";
      }
      continue;
    }

    if (sourceText.startsWith(delimiter, index)) {
      finishStatement();
      index += delimiter.length;
      lineStart = false;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      chunks.push(character);
      state =
        character === "'"
          ? "single_quote"
          : character === '"'
            ? "double_quote"
            : "backtick";
      index += 1;
      lineStart = false;
      continue;
    }

    if (
      character === "#" ||
      (character === "-" &&
        nextCharacter === "-" &&
        (sourceText[index + 2] === undefined ||
          /\s/.test(sourceText[index + 2])))
    ) {
      chunks.push(character);
      state = "line_comment";
      index += 1;
      lineStart = false;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      chunks.push(character, nextCharacter);
      state = "block_comment";
      index += 2;
      lineStart = false;
      continue;
    }

    chunks.push(character);
    index += 1;
    lineStart = character === "\n";
  }

  finishStatement();
  return statements;
}

function isMySqlErdStatement(sourceText: string) {
  const tree = MySQL.language.parser.parse(sourceText);
  const rootCursor = tree.cursor();

  if (!rootCursor.firstChild()) {
    return false;
  }

  do {
    if (rootCursor.name !== "Statement") {
      continue;
    }

    return isErdDdlStatement(rootCursor.node, sourceText);
  } while (rootCursor.nextSibling());

  return false;
}

function prepareSqliteParserSource(sourceText: string) {
  const tree = SQLite.language.parser.parse(sourceText);
  const rootCursor = tree.cursor();
  const erdStatements: string[] = [];

  if (!rootCursor.firstChild()) {
    return "";
  }

  do {
    if (
      rootCursor.name === "Statement" &&
      isErdDdlStatement(rootCursor.node, sourceText)
    ) {
      erdStatements.push(
        sourceText.slice(rootCursor.from, rootCursor.to).trim()
      );
    }
  } while (rootCursor.nextSibling());

  return erdStatements.join("\n");
}

function isErdDdlStatement(
  statementNode: SqlSyntaxNode,
  sourceText: string
) {
  const statementNodes = getErdDdlStatementNodes(statementNode);
  let cursor = 0;
  const firstKeyword = readErdDdlKeyword(
    statementNodes[cursor],
    sourceText
  );

  if (firstKeyword === "ALTER") {
    return readErdDdlKeyword(statementNodes[cursor + 1], sourceText) === "TABLE";
  }

  if (firstKeyword !== "CREATE") {
    return false;
  }

  cursor += 1;

  while (
    ["TEMP", "TEMPORARY"].includes(
      readErdDdlKeyword(statementNodes[cursor], sourceText) ?? ""
    )
  ) {
    cursor += 1;
  }

  return readErdDdlKeyword(statementNodes[cursor], sourceText) === "TABLE";
}

function getErdDdlStatementNodes(statementNode: SqlSyntaxNode) {
  const cursor = statementNode.cursor();
  const nodes: SqlSyntaxNode[] = [];

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

function readErdDdlKeyword(
  node: SqlSyntaxNode | undefined,
  sourceText: string
) {
  return node?.name === "Keyword"
    ? sourceText.slice(node.from, node.to).toUpperCase()
    : null;
}

function preparePostgreSqlParserSource(sourceText: string) {
  const { declaredTypes, erdStatements } =
    collectPostgreSqlParserSourceParts(sourceText);

  // node-sql-parser registers CREATE TYPE names but not CREATE DOMAIN names.
  // Register both in a parser-only prelude so table columns keep their original type.
  const parserPrelude = declaredTypes
    .map(
      (typeName) =>
        `CREATE TYPE ${typeName} AS ENUM ('__pilo_sqltoerd_parser_type__');`
    )
    .join("\n");

  return [parserPrelude, ...erdStatements].filter(Boolean).join("\n");
}

export function collectPostgreSqlUserDefinedTypeDeclarations(
  sourceText: string
) {
  return collectPostgreSqlParserSourceParts(sourceText).declaredTypes;
}

function collectPostgreSqlParserSourceParts(
  sourceText: string
): PostgreSqlParserSourceParts {
  const tree = PostgreSQL.language.parser.parse(sourceText);
  const rootCursor = tree.cursor();
  const declaredTypes = new Map<string, string>();
  const erdStatements: string[] = [];

  if (!rootCursor.firstChild()) {
    return { declaredTypes: [], erdStatements };
  }

  do {
    if (rootCursor.name !== "Statement") {
      continue;
    }

    const statementNodes = getPostgreSqlStatementNodes(rootCursor.node);
    let cursor = 0;
    const firstKeyword = readPostgreSqlKeyword(
      statementNodes[cursor],
      sourceText
    );

    if (firstKeyword === "ALTER") {
      if (
        readPostgreSqlKeyword(statementNodes[cursor + 1], sourceText) ===
        "TABLE"
      ) {
        erdStatements.push(
          sourceText.slice(rootCursor.from, rootCursor.to).trim()
        );
      }
      continue;
    }

    if (firstKeyword !== "CREATE") {
      continue;
    }

    cursor += 1;

    if (
      readPostgreSqlKeyword(statementNodes[cursor], sourceText) === "OR" &&
      readPostgreSqlKeyword(statementNodes[cursor + 1], sourceText) === "REPLACE"
    ) {
      cursor += 2;
    }

    while (
      ["TEMP", "TEMPORARY", "UNLOGGED"].includes(
        readPostgreSqlKeyword(statementNodes[cursor], sourceText) ?? ""
      )
    ) {
      cursor += 1;
    }

    const declarationKind = readPostgreSqlKeyword(
      statementNodes[cursor],
      sourceText
    );

    if (declarationKind === "TABLE") {
      erdStatements.push(
        sourceText.slice(rootCursor.from, rootCursor.to).trim()
      );
      continue;
    }

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

  return {
    declaredTypes: [...declaredTypes.values()],
    erdStatements
  };
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

  if (dialect === "sqlite") {
    return ["sqlite"];
  }

  return [];
}

function getAutoParserDatabases(
  sourceText: string
): SqltoerdResolvedDialect[] {
  const hasMySqlDumpMarker =
    /^\s*DELIMITER\s+\S+\s*$/im.test(sourceText) ||
    /\/\*!\d{5}\s/.test(sourceText) ||
    /^\s*(?:LOCK|UNLOCK)\s+TABLES\b/im.test(sourceText);
  const hasSqliteDumpMarker =
    /^\s*PRAGMA\b/im.test(sourceText) ||
    /\bsqlite_sequence\b/i.test(sourceText);
  const hasMySqlMarker =
    /\b(?:AUTO_INCREMENT|UNSIGNED|UNIQUE\s+KEY|DATETIME)\b|\bENGINE\s*=|`[^`]+`/i.test(
      sourceText
    );
  const hasPostgreSqlMarker =
    /\b(?:BIGSERIAL|SMALLSERIAL|SERIAL|TIMESTAMPTZ|JSONB|BYTEA)\b|::/i.test(
      sourceText
    );
  const hasSqliteMarker =
    /\b(?:AUTOINCREMENT|WITHOUT\s+ROWID|STRICT)\b|\bON\s+CONFLICT\b/i.test(
      sourceText
    );

  if (hasMySqlDumpMarker) {
    return ["mysql", "postgresql"];
  }

  if (hasSqliteDumpMarker) {
    return ["sqlite", "postgresql", "mysql"];
  }

  if (hasSqliteMarker && !hasMySqlMarker && !hasPostgreSqlMarker) {
    return ["sqlite", "postgresql", "mysql"];
  }

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
    defaultValue: formatDefaultValue(readObject(definition.default_val)),
    comment: null
  };
}

function applyAlterTableConstraints(
  definition: SqlParserAstNode,
  tableStatesByDisplayName: Map<string, MutableTableParseState>,
  relations: ErdRelation[]
) {
  const tableRef = readFirstObject(definition.table);
  const tableName = readString(tableRef?.table);

  if (!tableName) {
    return;
  }

  const schemaName = readString(tableRef?.db) ?? readString(tableRef?.schema);
  const tableState =
    tableStatesByDisplayName.get(getTableQualifiedName(schemaName, tableName)) ??
    tableStatesByDisplayName.get(tableName);

  if (!tableState) {
    return;
  }

  for (const expression of Array.isArray(definition.expr)
    ? definition.expr.map(readObject).filter((value): value is SqlParserAstNode => value !== null)
    : []) {
    if (readString(expression.action)?.toLowerCase() !== "add") {
      continue;
    }

    const constraint = readObject(expression.create_definitions);

    if (constraint && isConstraintDefinition(constraint)) {
      applyTableConstraint(tableState, constraint, tableStatesByDisplayName, relations);
    }
  }
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

function isAlterTableNode(value: SqlParserAstNode) {
  return (
    readString(value.type)?.toLowerCase() === "alter" &&
    readFirstObject(value.table) !== null
  );
}

function isColumnDefinition(value: SqlParserAstNode): value is SqlParserAstNode {
  return readString(value.resource)?.toLowerCase() === "column";
}

function isConstraintDefinition(value: SqlParserAstNode): value is SqlParserAstNode {
  return readString(value.resource)?.toLowerCase() === "constraint";
}

function formatDefaultValue(defaultDefinition: SqlParserAstNode | null) {
  const value = readObject(defaultDefinition?.value);

  if (!value) {
    return null;
  }

  const valueType = readString(value.type)?.toLowerCase();

  if (
    valueType === "number" &&
    (typeof value.value === "number" || typeof value.value === "string")
  ) {
    return String(value.value);
  }

  if (valueType === "single_quote_string") {
    const stringValue = readString(value.value);

    return stringValue === null ? null : `'${stringValue.replaceAll("'", "''")}'`;
  }

  if (valueType === "bool" && typeof value.value === "boolean") {
    return value.value ? "TRUE" : "FALSE";
  }

  if (valueType === "null") {
    return "NULL";
  }

  if (valueType === "function") {
    const functionName = readArray(readObject(value.name)?.name)
      .map((part) => readString(readObject(part)?.value))
      .filter((part): part is string => Boolean(part))
      .join(".")
      .toUpperCase();

    if (!functionName) {
      return null;
    }

    return ["CURRENT_DATE", "CURRENT_TIMESTAMP"].includes(functionName)
      ? functionName
      : `${functionName}()`;
  }

  return readString(value.value);
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
  return createSqltoerdForeignKeyRelationId({
    fromColumns,
    fromTable,
    toColumns,
    toTable
  });
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
