import type { CanvasRoomRef } from "./canvas-types";
import type { RealtimeDatabase } from "../database/database";

export type CanvasAccessContext = {
  token: string;
  userId: string;
};

export type CanvasAccessService = {
  canJoinCanvas: (
    context: CanvasAccessContext,
    room: CanvasRoomRef,
  ) => Promise<boolean>;
};

export function createCanvasAccessService(
  database?: RealtimeDatabase,
): CanvasAccessService {
  return {
    async canJoinCanvas(context, room) {
      if (!context.userId || !room.workspaceId || !room.canvasId) {
        return false;
      }

      if (!database) {
        return true;
      }

      const access = await database.queryOne<{ id: string }>(
        `
          SELECT c.id
          FROM canvas c
          JOIN workspace_members wm
            ON wm.workspace_id = c.workspace_id
           AND wm.user_id = $3
          WHERE c.workspace_id = $1
            AND c.id = $2
            AND c.board_type = 'freeform'
          LIMIT 1
        `,
        [room.workspaceId, room.canvasId, context.userId],
      );

      return Boolean(access);
    },
  };
}
