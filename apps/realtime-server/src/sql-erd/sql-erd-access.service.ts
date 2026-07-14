import type { RealtimeDatabase } from "../database/database";
import type { SqlErdAccessContext, SqlErdRoomRef } from "./sql-erd-types";

export type SqlErdAccessService = {
  canJoinSqlErdRoom: (
    context: SqlErdAccessContext,
    room: SqlErdRoomRef,
  ) => Promise<boolean>;
};

type SqlErdAccessRow = {
  id: string;
};

export function createSqlErdAccessService(
  database?: RealtimeDatabase,
): SqlErdAccessService {
  return {
    async canJoinSqlErdRoom(context, room) {
      if (!database || !context.userId || !room.sessionId || !room.workspaceId) {
        return false;
      }

      const session = await database.queryOne<SqlErdAccessRow>(
        `
          SELECT s.id
          FROM sql_erd_sessions AS s
          JOIN workspace_members AS wm
            ON wm.workspace_id = s.workspace_id
           AND wm.user_id = $3
          WHERE s.id = $1
            AND s.workspace_id = $2
            AND s.deleted_at IS NULL
          LIMIT 1
        `,
        [room.sessionId, room.workspaceId, context.userId],
      );

      return Boolean(session);
    },
  };
}
