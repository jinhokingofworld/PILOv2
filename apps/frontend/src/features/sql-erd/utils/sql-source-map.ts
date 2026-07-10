import { MySQL, PostgreSQL } from "@codemirror/lang-sql";

import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqlErdSelection,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";

type SqlSyntaxNode = ReturnType<
  typeof PostgreSQL.language.parser.parse
>["topNode"];

type SqlIdentifier = {
  quoted: boolean;
  value: string;
};

type PendingRelationRange = {
  constraintRange: SqltoerdSourceRange;
  fromColumnIds: string[];
  fromTableId: string;
  toColumnIds: string[];
  toTableId: string;
};

export type SqltoerdSourceRange = {
  from: number;
  to: number;
};

export type SqltoerdRelationSourceRanges = {
  constraintRange: SqltoerdSourceRange;
  fromColumnRanges: SqltoerdSourceRange[];
  toColumnRanges: SqltoerdSourceRange[];
};

export type SqltoerdSourceMap = {
  columnsById: Record<string, SqltoerdSourceRange>;
  dialect: SqltoerdResolvedDialect;
  relationsById: Record<string, SqltoerdRelationSourceRanges>;
  sourceText: string;
};

export function createSqltoerdSourceMap(input: {
  dialect: SqltoerdResolvedDialect;
  modelJson: SqltoerdModelJsonV1;
  sourceText: string;
}): SqltoerdSourceMap {
  const language = input.dialect === "mysql" ? MySQL.language : PostgreSQL.language;
  const tree = language.parser.parse(input.sourceText);
  const columnsById: Record<string, SqltoerdSourceRange> = {};
  const pendingRelations: PendingRelationRange[] = [];
  const rootCursor = tree.cursor();

  if (rootCursor.firstChild()) {
    do {
      if (rootCursor.name !== "Statement") {
        continue;
      }

      collectCreateTableRanges({
        columnsById,
        modelJson: input.modelJson,
        pendingRelations,
        sourceText: input.sourceText,
        statementNode: rootCursor.node
      });
    } while (rootCursor.nextSibling());
  }

  return {
    columnsById,
    dialect: input.dialect,
    relationsById: createRelationRanges(
      input.modelJson.schema.relations,
      pendingRelations,
      columnsById
    ),
    sourceText: input.sourceText
  };
}

export function getSelectedSqlErdRelationSourceRanges(input: {
  selection: SqlErdSelection;
  sourceMap: SqltoerdSourceMap | null;
  sourceText: string;
}) {
  if (
    input.selection.type !== "relation" ||
    !input.sourceMap ||
    input.sourceMap.sourceText !== input.sourceText
  ) {
    return [];
  }

  const relationRanges =
    input.sourceMap.relationsById[input.selection.relationId];

  return relationRanges
    ? [
        ...relationRanges.fromColumnRanges,
        ...relationRanges.toColumnRanges,
        relationRanges.constraintRange
      ]
    : [];
}

function collectCreateTableRanges(input: {
  columnsById: Record<string, SqltoerdSourceRange>;
  modelJson: SqltoerdModelJsonV1;
  pendingRelations: PendingRelationRange[];
  sourceText: string;
  statementNode: SqlSyntaxNode;
}) {
  const statementNodes = getDirectSyntaxNodes(input.statementNode);
  let cursor = 0;

  if (readKeyword(statementNodes[cursor], input.sourceText) !== "CREATE") {
    return;
  }

  cursor += 1;

  while (["TEMP", "TEMPORARY", "UNLOGGED"].includes(
    readKeyword(statementNodes[cursor], input.sourceText) ?? ""
  )) {
    cursor += 1;
  }

  if (readKeyword(statementNodes[cursor], input.sourceText) !== "TABLE") {
    return;
  }

  cursor += 1;

  if (
    readKeyword(statementNodes[cursor], input.sourceText) === "IF" &&
    readKeyword(statementNodes[cursor + 1], input.sourceText) === "NOT" &&
    readKeyword(statementNodes[cursor + 2], input.sourceText) === "EXISTS"
  ) {
    cursor += 3;
  }

  const tableName = readSqlName(statementNodes[cursor], input.sourceText);
  const table = findTable(input.modelJson.schema.tables, tableName);
  const bodyNode = statementNodes[cursor + 1];

  if (!table || bodyNode?.name !== "Parens") {
    return;
  }

  for (const segment of splitDefinitionSegments(bodyNode, input.sourceText)) {
    const firstKeyword = readNodeText(segment[0], input.sourceText).toUpperCase();

    if (firstKeyword === "CONSTRAINT" || firstKeyword === "FOREIGN") {
      const pendingRelation = readTableRelationRange(
        segment,
        table,
        input.modelJson.schema.tables,
        input.sourceText
      );

      if (pendingRelation) {
        input.pendingRelations.push(pendingRelation);
      }

      continue;
    }

    if (["PRIMARY", "UNIQUE", "CHECK", "EXCLUDE"].includes(firstKeyword)) {
      continue;
    }

    const columnName = readSqlIdentifier(segment[0], input.sourceText);
    const column = findColumn(table, columnName);

    if (!column) {
      continue;
    }

    input.columnsById[column.id] = {
      from: segment[0].from,
      to: segment[0].to
    };

    const pendingRelation = readInlineRelationRange(
      segment,
      table,
      column,
      input.modelJson.schema.tables,
      input.sourceText
    );

    if (pendingRelation) {
      input.pendingRelations.push(pendingRelation);
    }
  }
}

function readInlineRelationRange(
  segment: SqlSyntaxNode[],
  fromTable: ErdTable,
  fromColumn: ErdColumn,
  tables: ErdTable[],
  sourceText: string
): PendingRelationRange | null {
  const referencesIndex = findKeywordIndex(segment, "REFERENCES", sourceText);

  if (referencesIndex < 0) {
    return null;
  }

  return createPendingRelationRange({
    constraintRange: {
      from: segment[referencesIndex].from,
      to: segment.at(-1)?.to ?? segment[referencesIndex].to
    },
    fromColumnIds: [fromColumn.id],
    fromTable,
    sourceText,
    tables,
    targetColumnsNode: segment[referencesIndex + 2],
    targetTableNode: segment[referencesIndex + 1]
  });
}

function readTableRelationRange(
  segment: SqlSyntaxNode[],
  fromTable: ErdTable,
  tables: ErdTable[],
  sourceText: string
): PendingRelationRange | null {
  const foreignIndex = findKeywordIndex(segment, "FOREIGN", sourceText);
  const referencesIndex = findKeywordIndex(segment, "REFERENCES", sourceText);

  if (
    foreignIndex < 0 ||
    referencesIndex < 0 ||
    readKeyword(segment[foreignIndex + 1], sourceText) !== "KEY"
  ) {
    return null;
  }

  const fromColumnIds = readColumnIdentifiers(
    segment[foreignIndex + 2],
    sourceText
  )
    .map((columnName) => findColumn(fromTable, columnName)?.id ?? null)
    .filter((columnId): columnId is string => columnId !== null);

  if (fromColumnIds.length === 0) {
    return null;
  }

  return createPendingRelationRange({
    constraintRange: {
      from: segment[0].from,
      to: segment.at(-1)?.to ?? segment[0].to
    },
    fromColumnIds,
    fromTable,
    sourceText,
    tables,
    targetColumnsNode: segment[referencesIndex + 2],
    targetTableNode: segment[referencesIndex + 1]
  });
}

function createPendingRelationRange(input: {
  constraintRange: SqltoerdSourceRange;
  fromColumnIds: string[];
  fromTable: ErdTable;
  sourceText: string;
  tables: ErdTable[];
  targetColumnsNode: SqlSyntaxNode | undefined;
  targetTableNode: SqlSyntaxNode | undefined;
}): PendingRelationRange | null {
  const targetTable = findTable(
    input.tables,
    readSqlName(input.targetTableNode, input.sourceText)
  );

  if (!targetTable) {
    return null;
  }

  const toColumnIds = readColumnIdentifiers(
    input.targetColumnsNode,
    input.sourceText
  )
    .map((columnName) => findColumn(targetTable, columnName)?.id ?? null)
    .filter((columnId): columnId is string => columnId !== null);

  if (
    input.fromColumnIds.length === 0 ||
    input.fromColumnIds.length !== toColumnIds.length
  ) {
    return null;
  }

  return {
    constraintRange: input.constraintRange,
    fromColumnIds: input.fromColumnIds,
    fromTableId: input.fromTable.id,
    toColumnIds,
    toTableId: targetTable.id
  };
}

function createRelationRanges(
  relations: ErdRelation[],
  pendingRelations: PendingRelationRange[],
  columnsById: Record<string, SqltoerdSourceRange>
) {
  const relationsById: Record<string, SqltoerdRelationSourceRanges> = {};

  for (const pendingRelation of pendingRelations) {
    const relation = relations.find(
      (candidate) =>
        candidate.fromTableId === pendingRelation.fromTableId &&
        candidate.toTableId === pendingRelation.toTableId &&
        areStringArraysEqual(
          candidate.fromColumnIds,
          pendingRelation.fromColumnIds
        ) &&
        areStringArraysEqual(candidate.toColumnIds, pendingRelation.toColumnIds)
    );

    if (!relation) {
      continue;
    }

    const fromColumnRanges = relation.fromColumnIds
      .map((columnId) => columnsById[columnId])
      .filter((range): range is SqltoerdSourceRange => Boolean(range));
    const toColumnRanges = relation.toColumnIds
      .map((columnId) => columnsById[columnId])
      .filter((range): range is SqltoerdSourceRange => Boolean(range));

    if (
      fromColumnRanges.length !== relation.fromColumnIds.length ||
      toColumnRanges.length !== relation.toColumnIds.length
    ) {
      continue;
    }

    relationsById[relation.id] = {
      constraintRange: pendingRelation.constraintRange,
      fromColumnRanges,
      toColumnRanges
    };
  }

  return relationsById;
}

function splitDefinitionSegments(bodyNode: SqlSyntaxNode, sourceText: string) {
  const segments: SqlSyntaxNode[][] = [];
  let segment: SqlSyntaxNode[] = [];

  for (const node of getDirectSyntaxNodes(bodyNode)) {
    const nodeText = readNodeText(node, sourceText);

    if (nodeText === "(" || nodeText === ")") {
      continue;
    }

    if (node.name === "Punctuation" && nodeText === ",") {
      if (segment.length > 0) {
        segments.push(segment);
        segment = [];
      }
      continue;
    }

    segment.push(node);
  }

  if (segment.length > 0) {
    segments.push(segment);
  }

  return segments;
}

function getDirectSyntaxNodes(node: SqlSyntaxNode) {
  const nodes: SqlSyntaxNode[] = [];
  const cursor = node.cursor();

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

function readColumnIdentifiers(
  node: SqlSyntaxNode | undefined,
  sourceText: string
) {
  if (node?.name !== "Parens") {
    return [];
  }

  return getDirectSyntaxNodes(node)
    .map((candidate) => readSqlIdentifier(candidate, sourceText))
    .filter((identifier): identifier is SqlIdentifier => identifier !== null);
}

function readSqlName(node: SqlSyntaxNode | undefined, sourceText: string) {
  if (!node) {
    return [];
  }

  if (node.name !== "CompositeIdentifier") {
    const identifier = readSqlIdentifier(node, sourceText);
    return identifier ? [identifier] : [];
  }

  return getDirectSyntaxNodes(node)
    .map((candidate) => readSqlIdentifier(candidate, sourceText))
    .filter((identifier): identifier is SqlIdentifier => identifier !== null);
}

function readSqlIdentifier(
  node: SqlSyntaxNode | undefined,
  sourceText: string
): SqlIdentifier | null {
  if (
    !node ||
    !["Identifier", "Keyword", "QuotedIdentifier"].includes(node.name)
  ) {
    return null;
  }

  const rawIdentifier = readNodeText(node, sourceText);
  const quoted = node.name === "QuotedIdentifier";

  return {
    quoted,
    value: quoted ? unquoteSqlIdentifier(rawIdentifier) : rawIdentifier
  };
}

function unquoteSqlIdentifier(identifier: string) {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replace(/""/g, '"');
  }

  if (identifier.startsWith("`") && identifier.endsWith("`")) {
    return identifier.slice(1, -1).replace(/``/g, "`");
  }

  if (identifier.startsWith("[") && identifier.endsWith("]")) {
    return identifier.slice(1, -1).replace(/]]/g, "]");
  }

  return identifier;
}

function findTable(tables: ErdTable[], sqlName: SqlIdentifier[]) {
  const tableName = sqlName.at(-1);
  const schemaName = sqlName.length > 1 ? sqlName.at(-2) : null;

  if (!tableName) {
    return null;
  }

  return tables.find(
    (table) =>
      doesIdentifierMatch(tableName, table.name) &&
      (!schemaName ||
        (table.schemaName !== null &&
          doesIdentifierMatch(schemaName, table.schemaName)))
  ) ?? null;
}

function findColumn(table: ErdTable, sqlName: SqlIdentifier | null) {
  if (!sqlName) {
    return null;
  }

  return table.columns.find((column) =>
    doesIdentifierMatch(sqlName, column.name)
  ) ?? null;
}

function doesIdentifierMatch(identifier: SqlIdentifier, modelName: string) {
  return identifier.quoted
    ? identifier.value === modelName
    : identifier.value.toLowerCase() === modelName.toLowerCase();
}

function findKeywordIndex(
  nodes: SqlSyntaxNode[],
  keyword: string,
  sourceText: string
) {
  return nodes.findIndex(
    (node) => readKeyword(node, sourceText) === keyword
  );
}

function readKeyword(node: SqlSyntaxNode | undefined, sourceText: string) {
  return node?.name === "Keyword"
    ? readNodeText(node, sourceText).toUpperCase()
    : null;
}

function readNodeText(node: SqlSyntaxNode | undefined, sourceText: string) {
  return node ? sourceText.slice(node.from, node.to) : "";
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
