import type { RealtimeDatabase } from "../database/database";
import { parseBoardRoomRef } from "./board-payload.parser";
import type { BoardRoomRef } from "./board-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BoardAccessContext = {
  token: string;
  userId: string;
};

export type BoardAccessService = {
  canJoinBoard: (
    context: BoardAccessContext,
    room: BoardRoomRef,
  ) => Promise<boolean>;
  canJoinWorkspace: (context: BoardAccessContext, workspaceId: string) => Promise<boolean>;
};

export function createBoardAccessService(
  database?: RealtimeDatabase,
): BoardAccessService {
  return {
    async canJoinWorkspace(context, workspaceId) {
      if (!context.userId || !UUID_PATTERN.test(workspaceId)) return false;
      if (!database) return true;
      return Boolean(await database.queryOne<{ id: string }>(
        `SELECT workspace_id AS id FROM workspace_members WHERE workspace_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [workspaceId, context.userId]
      ));
    },
    async canJoinBoard(context, room) {
      const canonicalRoom = parseBoardRoomRef(room);

      if (!context.userId || !canonicalRoom) {
        return false;
      }

      if (!database) {
        return true;
      }

      const access = await database.queryOne<{ id: string }>(
        `
          SELECT b.id
          FROM boards b
          JOIN workspace_members wm
            ON wm.workspace_id = b.workspace_id
           AND wm.user_id = $3
          WHERE b.workspace_id = $1
            AND b.id = $2::bigint
          LIMIT 1
        `,
        [canonicalRoom.workspaceId, canonicalRoom.boardId, context.userId],
      );

      return Boolean(access);
    },
  };
}
