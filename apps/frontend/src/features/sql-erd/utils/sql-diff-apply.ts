import type {
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";
import { parseSqlDdlToErdModel } from "@/features/sql-erd/utils/ddl-parser";
import { createSqltoerdLayoutForModel } from "@/features/sql-erd/utils/model";
import { generateSqlDdlFromErdModel } from "@/features/sql-erd/utils/model-to-sql";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";

const SQL_ERD_MODEL_SQL_HISTORY_LIMIT = 20;

export type SqlErdNormalizedSqlPreview = {
  baseSnapshot: SqlErdViewSession;
  generatedSourceText: string;
  hasChanges: boolean;
  modelJson: SqltoerdModelJsonV1;
  resolvedDialect: SqltoerdResolvedDialect;
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

export function createSqlErdNormalizedSqlPreview({
  modelJson,
  resolvedDialect,
  session
}: {
  modelJson: SqltoerdModelJsonV1;
  resolvedDialect: SqltoerdResolvedDialect;
  session: SqlErdViewSession;
}): SqlErdNormalizedSqlPreview {
  const generated = generateSqlDdlFromErdModel({
    dialect: resolvedDialect,
    modelJson
  });

  return {
    baseSnapshot: session,
    generatedSourceText: generated.sql,
    hasChanges: generated.sql !== session.sourceText,
    modelJson,
    resolvedDialect,
    warnings: generated.warnings
  };
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

export function applySqlErdNormalizedSqlPreview(
  preview: SqlErdNormalizedSqlPreview
): SqlErdModelSqlApplyResult {
  const parseResult = parseSqlDdlToErdModel({
    dialect: preview.resolvedDialect,
    sourceMapModelJson: preview.modelJson,
    sourceText: preview.generatedSourceText
  });

  if (!parseResult.ok) {
    return {
      error: parseResult.error.message,
      ok: false
    };
  }

  return {
    ok: true,
    snapshot: {
      ...preview.baseSnapshot,
      dialect: preview.resolvedDialect,
      layoutJson: createSqltoerdLayoutForModel(
        parseResult.modelJson,
        preview.baseSnapshot.layoutJson
      ),
      modelJson: parseResult.modelJson,
      sourceText: preview.generatedSourceText
    }
  };
}

export function isSqlErdNormalizedSqlPreviewCurrent(
  preview: SqlErdNormalizedSqlPreview,
  session: SqlErdViewSession
) {
  return isSqlErdViewSessionCurrent(preview.baseSnapshot, session);
}

export function isSqlErdViewSessionCurrent(
  base: SqlErdViewSession,
  session: SqlErdViewSession
) {
  return (
    base.id === session.id &&
    base.revision === session.revision &&
    base.dialect === session.dialect &&
    base.sourceText === session.sourceText &&
    JSON.stringify(base.modelJson) === JSON.stringify(session.modelJson) &&
    JSON.stringify(base.layoutJson) === JSON.stringify(session.layoutJson)
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
