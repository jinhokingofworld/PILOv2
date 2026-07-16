import type { RealtimeDatabase } from "../database/database";
import type {
  DocumentAccessContext,
  DocumentRoomAccess,
  DocumentRoomRef,
} from "./document-types";

export type DocumentAccessService = {
  getDocumentRoomAccess: (
    context: DocumentAccessContext,
    room: DocumentRoomRef,
  ) => Promise<DocumentRoomAccess | null>;
};

type ActiveDocumentRow = {
  id: string;
};

export function createDocumentAccessService({
  database,
}: {
  database: RealtimeDatabase;
}): DocumentAccessService {
  return {
    async getDocumentRoomAccess(context, room) {
      if (!context.userId || !room.workspaceId || !room.documentId) {
        return null;
      }

      const document = await database.queryOne<ActiveDocumentRow>(
        `
          SELECT document.id
          FROM documents AS document
          JOIN drive_items AS item
            ON item.id = document.drive_item_id
           AND item.workspace_id = document.workspace_id
          JOIN workspace_members wm
            ON wm.workspace_id = document.workspace_id
           AND wm.user_id = $3
          WHERE document.workspace_id = $1
            AND document.id = $2
            AND document.deleted_at IS NULL
            AND item.item_type = 'document'
            AND item.deleted_at IS NULL
          LIMIT 1
        `,
        [room.workspaceId, room.documentId, context.userId],
      );

      return document ? { readOnly: false } : null;
    },
  };
}
