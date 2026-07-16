import type { RealtimeDatabase } from "../database/database";
import type { PdfCollaborationRoomRef } from "./pdf-collaboration-types";

export type PdfCollaborationAccessContext = {
  userId: string;
};

export type PdfCollaborationRoomAccess = {
  readOnly: boolean;
};

export type PdfCollaborationAccessService = {
  getPdfCollaborationRoomAccess: (
    context: PdfCollaborationAccessContext,
    room: PdfCollaborationRoomRef,
  ) => Promise<PdfCollaborationRoomAccess | null>;
};

type ActivePdfRow = { id: string };

export function createPdfCollaborationAccessService({
  database,
}: {
  database: RealtimeDatabase;
}): PdfCollaborationAccessService {
  return {
    async getPdfCollaborationRoomAccess(context, room) {
      if (!context.userId || !room.workspaceId || !room.fileId) return null;

      const file = await database.queryOne<ActivePdfRow>(
        `
          SELECT item.id
          FROM drive_items AS item
          JOIN workspace_members wm
            ON wm.workspace_id = item.workspace_id
           AND wm.user_id = $3
          WHERE item.workspace_id = $1
            AND item.id = $2
            AND item.item_type = 'file'
            AND item.mime_type = 'application/pdf'
            AND item.upload_status = 'ready'
            AND item.deleted_at IS NULL
          LIMIT 1
        `,
        [room.workspaceId, room.fileId, context.userId],
      );

      return file ? { readOnly: false } : null;
    },
  };
}
