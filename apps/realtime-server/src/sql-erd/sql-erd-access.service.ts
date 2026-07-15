import type { RealtimeDatabase } from "../database/database";
import type { SqlErdAccessContext, SqlErdRoomRef } from "./sql-erd-types";

export type SqlErdAccessService = {
  canJoinSqlErdRoom: (
    context: SqlErdAccessContext,
    room: SqlErdRoomRef,
  ) => Promise<{ latestOpSeq: number } | null>;
};

type SqlErdAccessRow = {
  id: string;
  latest_op_seq: number | string;
};

export function createSqlErdAccessService(
  database?: RealtimeDatabase,
): SqlErdAccessService {
  return {
    async canJoinSqlErdRoom(context, room) {
      if (!database || !context.userId || !room.sessionId || !room.workspaceId) {
        return null;
      }

      const session = await database.queryOne<SqlErdAccessRow>(
        `
          SELECT s.id, s.latest_op_seq
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

      return session ? { latestOpSeq: Number(session.latest_op_seq) } : null;
    },
  };
}
