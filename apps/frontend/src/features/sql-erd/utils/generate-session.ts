import type {
  CreateSqlErdSessionRequest,
  UpdateSqlErdSessionRequest
} from "@/features/sql-erd/api/client";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";
import type { SqltoerdResolvedDialect } from "@/features/sql-erd/types";
import type { SqltoerdSourceMap } from "@/features/sql-erd/utils/sql-source-map";
import {
  parseSqlDdlToErdModel,
  type SqltoerdDdlParseError
} from "@/features/sql-erd/utils/ddl-parser";
import {
  createSqltoerdAutoLayoutTableSizes,
  createSqltoerdIncrementalLayout
} from "@/features/sql-erd/utils/auto-layout";

export type SqlErdGenerateWorkspaceRequest =
  | {
      kind: "create";
      ok: true;
      payload: CreateSqlErdSessionRequest;
      resolvedDialect: SqltoerdResolvedDialect;
      sourceMap: SqltoerdSourceMap;
    }
  | {
      kind: "update";
      ok: true;
      payload: UpdateSqlErdSessionRequest;
      resolvedDialect: SqltoerdResolvedDialect;
      sessionId: string;
      sourceMap: SqltoerdSourceMap;
    }
  | {
      error: SqltoerdDdlParseError;
      ok: false;
    };

export function createSqlErdGenerateWorkspaceRequest(
  session: SqlErdViewSession
): SqlErdGenerateWorkspaceRequest {
  const parseResult = parseSqlDdlToErdModel({
    dialect: session.dialect,
    sourceText: session.sourceText
  });

  if (!parseResult.ok) {
    return {
      error: parseResult.error,
      ok: false
    };
  }

  const writePayload: CreateSqlErdSessionRequest = {
    title: session.title,
    sourceFormat: session.sourceFormat,
    dialect: session.dialect,
    sourceText: session.sourceText,
    modelJson: parseResult.modelJson,
    layoutJson: createSqltoerdIncrementalLayout({
      layoutJson: session.layoutJson,
      modelJson: parseResult.modelJson,
      tableSizes: createSqltoerdAutoLayoutTableSizes(
        parseResult.modelJson,
        session.layoutJson
      )
    }),
    settingsJson: session.settingsJson
  };

  if (session.id && session.revision !== null) {
    return {
      kind: "update",
      ok: true,
      resolvedDialect: parseResult.resolvedDialect,
      sourceMap: parseResult.sourceMap,
      payload: {
        baseRevision: session.revision,
        ...writePayload
      },
      sessionId: session.id
    };
  }

  return {
    kind: "create",
    ok: true,
    resolvedDialect: parseResult.resolvedDialect,
    sourceMap: parseResult.sourceMap,
    payload: writePayload
  };
}
