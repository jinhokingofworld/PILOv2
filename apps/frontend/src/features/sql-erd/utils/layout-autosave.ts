import type { UpdateSqlErdSessionRequest } from "@/features/sql-erd/api/client";
import type { SqltoerdLayoutJsonV1 } from "@/features/sql-erd/types";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";

export type SqlErdLayoutAutosaveRequest =
  | {
      ok: true;
      payload: Pick<UpdateSqlErdSessionRequest, "baseRevision" | "layoutJson">;
      sessionId: string;
    }
  | {
      ok: false;
      reason: "missing_workspace_session";
    };

export type SqlErdSourceAutosaveRequest =
  | {
      ok: true;
      payload: Pick<
        UpdateSqlErdSessionRequest,
        "baseRevision" | "dialect" | "layoutJson" | "modelJson" | "sourceText"
      >;
      sessionId: string;
    }
  | {
      ok: false;
      reason: "missing_workspace_session" | "session_mismatch";
    };

export function createSqlErdLayoutAutosaveRequest(
  session: SqlErdViewSession,
  layoutJson: SqltoerdLayoutJsonV1
): SqlErdLayoutAutosaveRequest {
  if (!session.id || session.revision === null) {
    return {
      ok: false,
      reason: "missing_workspace_session"
    };
  }

  return {
    ok: true,
    payload: {
      baseRevision: session.revision,
      layoutJson
    },
    sessionId: session.id
  };
}

export function createSqlErdSourceAutosaveRequest(
  parsedSnapshot: SqlErdViewSession,
  currentSession: SqlErdViewSession
): SqlErdSourceAutosaveRequest {
  if (
    !parsedSnapshot.id ||
    parsedSnapshot.revision === null ||
    !currentSession.id ||
    currentSession.revision === null
  ) {
    return {
      ok: false,
      reason: "missing_workspace_session"
    };
  }

  if (parsedSnapshot.id !== currentSession.id) {
    return {
      ok: false,
      reason: "session_mismatch"
    };
  }

  return {
    ok: true,
    payload: {
      baseRevision: currentSession.revision,
      dialect: parsedSnapshot.dialect,
      layoutJson: currentSession.layoutJson,
      modelJson: parsedSnapshot.modelJson,
      sourceText: parsedSnapshot.sourceText
    },
    sessionId: currentSession.id
  };
}
