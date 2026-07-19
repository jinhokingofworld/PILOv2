import { diffLines } from "diff";

import type {
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect,
  SqltoerdSettingsJson
} from "@/features/sql-erd/types";
import {
  collectPostgreSqlUserDefinedTypeStatements,
  parseSqlDdlToErdModel
} from "@/features/sql-erd/utils/ddl-parser";
import { retainSqltoerdRelationNotesForModel } from "@/features/sql-erd/utils/foreign-key-add";
import {
  generateSqlDdlFromErdModel,
  SqltoerdModelToSqlGenerationError
} from "@/features/sql-erd/utils/model-to-sql";
import { areSqlErdJsonValuesEqual } from "@/features/sql-erd/utils/model";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";

const SQL_ERD_MODEL_SQL_HISTORY_LIMIT = 20;

export type SqlErdNormalizedSqlPreview = {
  baseSnapshot: SqlErdViewSession;
  generationBlocked: boolean;
  generatedSourceText: string;
  hasChanges: boolean;
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  resolvedDialect: SqltoerdResolvedDialect;
  settingsJson: SqltoerdSettingsJson;
  warnings: string[];
};

export type SqlErdModelSqlApplyResult =
  | {
      ok: true;
      snapshot: SqlErdViewSession;
    }
  | {
      error: string;
      ok: false;
    };

export function createSqlErdVerifiedNormalizedSnapshot({
  parsedModelJson,
  targetModelJson,
  targetSnapshot
}: {
  parsedModelJson: SqltoerdModelJsonV1;
  targetModelJson: SqltoerdModelJsonV1;
  targetSnapshot: SqlErdViewSession;
}): SqlErdModelSqlApplyResult {
  if (
    createSqlErdSchemaSemanticSignature(parsedModelJson) !==
    createSqlErdSchemaSemanticSignature(targetModelJson)
  ) {
    return {
      error:
        "재생성된 SQL이 요청한 ERD 변경과 일치하지 않습니다. 변경 내용을 다시 확인하세요.",
      ok: false
    };
  }

  return {
    ok: true,
    snapshot: {
      ...targetSnapshot,
      modelJson: targetModelJson
    }
  };
}

export type SqlErdModelSqlHistory = {
  future: SqlErdViewSession[];
  past: SqlErdViewSession[];
};

export type SqlErdModelSqlHistoryTransition = {
  history: SqlErdModelSqlHistory;
  snapshot: SqlErdViewSession | null;
};

export type SqlErdSqlDiffLine = {
  kind: "added" | "removed" | "unchanged";
  value: string;
};

export type SqlErdSplitDiffCell = {
  kind: "added" | "empty" | "removed" | "unchanged";
  lineNumber: number | null;
  value: string;
};

export type SqlErdSplitDiffRow = {
  after: SqlErdSplitDiffCell;
  before: SqlErdSplitDiffCell;
};

export function createSqlErdNormalizedSqlPreview({
  layoutJson,
  modelJson,
  resolvedDialect,
  session,
  settingsJson
}: {
  layoutJson?: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  resolvedDialect: SqltoerdResolvedDialect;
  session: SqlErdViewSession;
  settingsJson?: SqltoerdSettingsJson;
}): SqlErdNormalizedSqlPreview {
  try {
    const generated = generateSqlDdlFromErdModel({
      dialect: resolvedDialect,
      modelJson
    });
    const generatedSourceText =
      resolvedDialect === "postgresql"
        ? [
            ...collectPostgreSqlUserDefinedTypeStatements(
              session.sourceText
            ),
            generated.sql
          ]
            .filter(Boolean)
            .join("\n\n")
        : generated.sql;

    return {
      baseSnapshot: session,
      generationBlocked: false,
      generatedSourceText,
      hasChanges: generatedSourceText !== session.sourceText,
      layoutJson: layoutJson ?? session.layoutJson,
      modelJson: generated.modelJson,
      resolvedDialect,
      settingsJson: retainSqltoerdRelationNotesForModel(
        settingsJson ?? session.settingsJson,
        generated.modelJson
      ),
      warnings: generated.warnings
    };
  } catch (error) {
    if (!(error instanceof SqltoerdModelToSqlGenerationError)) {
      throw error;
    }

    return {
      baseSnapshot: session,
      generationBlocked: true,
      generatedSourceText: session.sourceText,
      hasChanges: false,
      layoutJson: layoutJson ?? session.layoutJson,
      modelJson,
      resolvedDialect,
      settingsJson: retainSqltoerdRelationNotesForModel(
        settingsJson ?? session.settingsJson,
        modelJson
      ),
      warnings: [error.message]
    };
  }
}

export function createSqlErdSqlLineDiff(
  beforeSourceText: string,
  afterSourceText: string
): SqlErdSqlDiffLine[] {
  const beforeLines = beforeSourceText.split("\n");
  const afterLines = afterSourceText.split("\n");
  let prefixLength = 0;

  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - suffixLength - 1] ===
      afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return [
    ...beforeLines.slice(0, prefixLength).map((value) => ({
      kind: "unchanged" as const,
      value
    })),
    ...beforeLines
      .slice(prefixLength, beforeLines.length - suffixLength)
      .map((value) => ({ kind: "removed" as const, value })),
    ...afterLines
      .slice(prefixLength, afterLines.length - suffixLength)
      .map((value) => ({ kind: "added" as const, value })),
    ...beforeLines.slice(beforeLines.length - suffixLength).map((value) => ({
      kind: "unchanged" as const,
      value
    }))
  ];
}

export function createSqlErdSplitDiffRows(
  beforeSourceText: string,
  afterSourceText: string
): SqlErdSplitDiffRow[] {
  const rows: SqlErdSplitDiffRow[] = [];
  let beforeLineNumber = 1;
  let afterLineNumber = 1;
  let removedCells: SqlErdSplitDiffCell[] = [];
  let addedCells: SqlErdSplitDiffCell[] = [];

  const flushChangedRows = () => {
    const rowCount = Math.max(removedCells.length, addedCells.length);

    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        before: removedCells[index] ?? createEmptyDiffCell(),
        after: addedCells[index] ?? createEmptyDiffCell()
      });
    }

    removedCells = [];
    addedCells = [];
  };

  for (const change of diffLines(beforeSourceText, afterSourceText)) {
    const lines = splitSqlDiffLines(change.value);

    if (change.removed) {
      removedCells.push(
        ...lines.map((value) => ({
          kind: "removed" as const,
          lineNumber: beforeLineNumber++,
          value
        }))
      );
      continue;
    }

    if (change.added) {
      addedCells.push(
        ...lines.map((value) => ({
          kind: "added" as const,
          lineNumber: afterLineNumber++,
          value
        }))
      );
      continue;
    }

    flushChangedRows();
    for (const value of lines) {
      rows.push({
        before: {
          kind: "unchanged",
          lineNumber: beforeLineNumber++,
          value
        },
        after: {
          kind: "unchanged",
          lineNumber: afterLineNumber++,
          value
        }
      });
    }
  }

  flushChangedRows();
  return rows;
}

function splitSqlDiffLines(value: string) {
  const lines = value.split("\n");

  if (value.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function createEmptyDiffCell(): SqlErdSplitDiffCell {
  return { kind: "empty", lineNumber: null, value: "" };
}

export function applySqlErdNormalizedSqlPreview(
  preview: SqlErdNormalizedSqlPreview
): SqlErdModelSqlApplyResult {
  if (preview.generationBlocked) {
    return {
      error:
        preview.warnings[0] ??
        "현재 ERD model에서는 SQL을 재생성할 수 없습니다.",
      ok: false
    };
  }

  const parseResult = parseSqlDdlToErdModel({
    dialect: preview.resolvedDialect,
    sourceMapModelJson: preview.modelJson,
    sourceText: preview.generatedSourceText
  });

  if (!parseResult.ok) {
    return {
      error: createSqlErdGeneratedSqlParseError(preview, parseResult.error.message),
      ok: false
    };
  }

  return createSqlErdVerifiedNormalizedSnapshot({
    parsedModelJson: parseResult.modelJson,
    targetModelJson: preview.modelJson,
    targetSnapshot: {
      ...preview.baseSnapshot,
      dialect: preview.resolvedDialect,
      layoutJson: preview.layoutJson,
      settingsJson: preview.settingsJson,
      sourceText: preview.generatedSourceText
    }
  });
}

export function createSqlErdGeneratedSqlParseError(
  preview: Pick<
    SqlErdNormalizedSqlPreview,
    "modelJson" | "resolvedDialect"
  >,
  parserMessage: string
) {
  const dialectLabel =
    preview.resolvedDialect === "postgresql"
      ? "PostgreSQL"
      : preview.resolvedDialect === "mysql"
        ? "MySQL"
        : "SQLite";
  const unexpectedToken = /but\s+"([^"]+)"\s+found/iu.exec(parserMessage)?.[1]
    ?.trim()
    .toUpperCase();
  const candidates = preview.modelJson.schema.tables
    .flatMap((table) =>
      table.columns.map((column) => ({
        label: `${table.schemaName ? `${table.schemaName}.` : ""}${table.name}.${column.name} (${column.dataType})`,
        type: column.dataType.trim().toUpperCase()
      }))
    )
    .filter(
      (column) =>
        unexpectedToken && column.type.startsWith(unexpectedToken)
    )
    .slice(0, 3)
    .map((column) => column.label);
  const candidateMessage = candidates.length
    ? ` 확인할 컬럼: ${candidates.join(", ")}.`
    : "";

  return `생성된 ${dialectLabel} SQL을 검증하지 못했습니다. 선택한 dialect에서 지원되지 않는 컬럼 타입 또는 기본값이 있는지 확인하세요.${candidateMessage}`;
}

export function createSqlErdSchemaSemanticSignature(
  modelJson: SqltoerdModelJsonV1
) {
  const tableNamesById = new Map(
    modelJson.schema.tables.map((table) => [
      table.id,
      { name: table.name, schemaName: table.schemaName }
    ])
  );
  const columnNamesByTableId = new Map(
    modelJson.schema.tables.map((table) => [
      table.id,
      new Map(table.columns.map((column) => [column.id, column.name]))
    ])
  );
  const resolveTableName = (tableId: string) =>
    tableNamesById.get(tableId) ?? { missingTableId: tableId };
  const resolveColumnNames = (tableId: string, columnIds: string[]) => {
    const columnNamesById = columnNamesByTableId.get(tableId);

    return columnIds.map(
      (columnId) =>
        columnNamesById?.get(columnId) ?? { missingColumnId: columnId }
    );
  };
  const tables = modelJson.schema.tables
    .map((table) => ({
      columns: table.columns
        .map((column) => ({
          dataType: normalizeSqlSemanticText(column.dataType),
          defaultValue:
            column.defaultValue === null
              ? null
              : normalizeSqlSemanticText(column.defaultValue),
          foreignKey: column.foreignKey,
          name: column.name,
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          unique: column.unique
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      constraints: table.constraints
        .map((constraint) => ({
          columnNames: resolveColumnNames(table.id, constraint.columnIds),
          kind: constraint.kind,
          name: constraint.name
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        ),
      name: table.name,
      schemaName: table.schemaName
    }))
    .sort((left, right) =>
      JSON.stringify([left.schemaName, left.name]).localeCompare(
        JSON.stringify([right.schemaName, right.name])
      )
    );
  const relations = modelJson.schema.relations
    .map((relation) => ({
      constraintName: relation.constraintName,
      fromColumnNames: resolveColumnNames(
        relation.fromTableId,
        relation.fromColumnIds
      ),
      fromTable: resolveTableName(relation.fromTableId),
      kind: relation.kind,
      toColumnNames: resolveColumnNames(
        relation.toTableId,
        relation.toColumnIds
      ),
      toTable: resolveTableName(relation.toTableId)
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );

  return JSON.stringify({ relations, tables });
}

function normalizeSqlSemanticText(value: string) {
  return value.trim().replace(/\s+/gu, " ").toUpperCase();
}

export function isSqlErdNormalizedSqlPreviewCurrent(
  preview: SqlErdNormalizedSqlPreview,
  session: SqlErdViewSession
) {
  return isSqlErdViewSessionCurrent(preview.baseSnapshot, session);
}

export function rebaseSqlErdNormalizedSqlPreviewAfterSave(
  preview: SqlErdNormalizedSqlPreview,
  savedSession: SqlErdViewSession
): SqlErdNormalizedSqlPreview | null {
  const base = preview.baseSnapshot;
  const hasSameSourceState =
    base.id === savedSession.id &&
    base.dialect === savedSession.dialect &&
    base.sourceFormat === savedSession.sourceFormat &&
    base.sourceText === savedSession.sourceText &&
    base.writeProtocol === savedSession.writeProtocol &&
    areSqlErdJsonValuesEqual(base.modelJson, savedSession.modelJson) &&
    areSqlErdJsonValuesEqual(base.settingsJson, savedSession.settingsJson);

  return hasSameSourceState
    ? { ...preview, baseSnapshot: savedSession }
    : null;
}

export function isSqlErdViewSessionCurrent(
  base: SqlErdViewSession,
  session: SqlErdViewSession
) {
  return (
    base.id === session.id &&
    base.revision === session.revision &&
    base.dialect === session.dialect &&
    base.sourceFormat === session.sourceFormat &&
    base.sourceText === session.sourceText &&
    base.writeProtocol === session.writeProtocol &&
    areSqlErdJsonValuesEqual(base.modelJson, session.modelJson) &&
    areSqlErdJsonValuesEqual(base.layoutJson, session.layoutJson) &&
    areSqlErdJsonValuesEqual(base.settingsJson, session.settingsJson)
  );
}

export function createSqlErdModelSqlHistory(): SqlErdModelSqlHistory {
  return {
    future: [],
    past: []
  };
}

export function recordSqlErdModelSqlHistory(
  history: SqlErdModelSqlHistory,
  previousSnapshot: SqlErdViewSession
): SqlErdModelSqlHistory {
  return {
    future: [],
    past: [...history.past, previousSnapshot].slice(
      -SQL_ERD_MODEL_SQL_HISTORY_LIMIT
    )
  };
}

export function undoSqlErdModelSqlHistory(
  history: SqlErdModelSqlHistory,
  currentSnapshot: SqlErdViewSession
): SqlErdModelSqlHistoryTransition {
  const snapshot = history.past.at(-1) ?? null;

  if (!snapshot) {
    return { history, snapshot: null };
  }

  return {
    history: {
      future: [currentSnapshot, ...history.future].slice(
        0,
        SQL_ERD_MODEL_SQL_HISTORY_LIMIT
      ),
      past: history.past.slice(0, -1)
    },
    snapshot
  };
}

export function redoSqlErdModelSqlHistory(
  history: SqlErdModelSqlHistory,
  currentSnapshot: SqlErdViewSession
): SqlErdModelSqlHistoryTransition {
  const snapshot = history.future[0] ?? null;

  if (!snapshot) {
    return { history, snapshot: null };
  }

  return {
    history: {
      future: history.future.slice(1),
      past: [...history.past, currentSnapshot].slice(
        -SQL_ERD_MODEL_SQL_HISTORY_LIMIT
      )
    },
    snapshot
  };
}
