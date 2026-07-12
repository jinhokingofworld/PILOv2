import type { RealtimeDatabase } from "../database/database";
import { parseBoardRoomRef } from "./board-payload.parser";
import type { BoardRoomRef } from "./board-types";

export type BoardAccessContext = {
  token: string;
  userId: string;
};

export type BoardAccessService = {
  canJoinBoard: (
    context: BoardAccessContext,
    room: BoardRoomRef,
  ) => Promise<boolean>;
};

export function createBoardAccessService(
  database?: RealtimeDatabase,
): BoardAccessService {
  return {
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
