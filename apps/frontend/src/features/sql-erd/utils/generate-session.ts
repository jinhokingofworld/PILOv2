import type {
  CreateSqlErdSessionRequest,
  UpdateSqlErdSessionRequest
} from "@/features/sql-erd/api/client";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";
import {
  parseSqlDdlToErdModel,
  type SqltoerdDdlParseError
} from "@/features/sql-erd/utils/ddl-parser";
import { createSqltoerdLayoutForModel } from "@/features/sql-erd/utils/model";

export type SqlErdGenerateWorkspaceRequest =
  | {
      kind: "create";
      ok: true;
      payload: CreateSqlErdSessionRequest;
    }
  | {
      kind: "update";
      ok: true;
      payload: UpdateSqlErdSessionRequest;
      sessionId: string;
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
    layoutJson: createSqltoerdLayoutForModel(
      parseResult.modelJson,
      session.layoutJson
    ),
    settingsJson: session.settingsJson
  };

  if (session.id && session.revision !== null) {
    return {
      kind: "update",
      ok: true,
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
    payload: writePayload
  };
}
