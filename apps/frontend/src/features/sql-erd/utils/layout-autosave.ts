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
