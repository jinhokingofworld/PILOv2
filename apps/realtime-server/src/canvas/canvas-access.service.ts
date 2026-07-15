import type { CanvasRoomRef } from "./canvas-types";
import type { RealtimeDatabase } from "../database/database";

export type CanvasAccessContext = {
  token: string;
  userId: string;
};

export type CanvasRoomAccess = {
  readOnly: boolean;
};

export type CanvasAccessService = {
  getCanvasRoomAccess: (
    context: CanvasAccessContext,
    room: CanvasRoomRef,
  ) => Promise<CanvasRoomAccess | null>;
  getCanvasTldrawSyncRoomAccess: (
    context: CanvasAccessContext,
    room: CanvasRoomRef,
  ) => Promise<CanvasRoomAccess | null>;
};

type CanvasAccessRow = {
  board_type: string;
  review_room_status: string | null;
};

type CanvasTldrawSyncAccessRow = {
  board_type: string;
  engine_type: string;
};

export function createCanvasAccessService(
  database?: RealtimeDatabase,
): CanvasAccessService {
  return {
    async getCanvasRoomAccess(context, room) {
      if (!context.userId || !room.workspaceId || !room.canvasId) {
        return null;
      }

      if (!database) {
        return { readOnly: false };
      }

      const access = await database.queryOne<CanvasAccessRow>(
        `
          SELECT
            c.board_type,
            review_room.status AS review_room_status
          FROM canvas c
          JOIN workspace_members wm
            ON wm.workspace_id = c.workspace_id
           AND wm.user_id = $3
          LEFT JOIN pr_review_rooms AS review_room
            ON review_room.workspace_id = c.workspace_id
           AND review_room.canvas_id = c.id
          WHERE c.workspace_id = $1
            AND c.id = $2
            AND (
              c.board_type = 'freeform'
              OR (
                c.board_type = 'review'
                AND review_room.id IS NOT NULL
                AND review_room.status IN ('active', 'completed')
              )
            )
          LIMIT 1
        `,
        [room.workspaceId, room.canvasId, context.userId],
      );

      if (!access) {
        return null;
      }

      if (access.board_type === "freeform") {
        return { readOnly: false };
      }

      if (access.board_type === "review") {
        if (access.review_room_status === "active") {
          return { readOnly: false };
        }

        if (access.review_room_status === "completed") {
          return { readOnly: true };
        }
      }

      return null;
    },
    async getCanvasTldrawSyncRoomAccess(context, room) {
      if (!context.userId || !room.workspaceId || !room.canvasId) {
        return null;
      }

      if (!database) {
        return { readOnly: false };
      }

      const access = await database.queryOne<CanvasTldrawSyncAccessRow>(
        `
          SELECT
            c.board_type,
            c.engine_type
          FROM canvas c
          JOIN workspace_members wm
            ON wm.workspace_id = c.workspace_id
           AND wm.user_id = $3
          WHERE c.workspace_id = $1
            AND c.id = $2
            AND c.board_type = 'freeform'
            AND c.engine_type = 'tldraw_sync'
          LIMIT 1
        `,
        [room.workspaceId, room.canvasId, context.userId],
      );

      if (!access) {
        return null;
      }

      return { readOnly: false };
    },
  };
}
