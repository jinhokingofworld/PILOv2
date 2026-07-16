import { randomUUID } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";

import {
  ActivityLogService,
  type ActivityLogInput
} from "../../common/activity-log.service";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { mapDriveItem } from "./drive.mapper";
import type {
  CreateDocumentPayload,
  CreateDocumentRequest,
  DocumentPayload,
  DocumentRow,
  DocumentSnapshotRow
} from "./document.types";
import type { DriveItemRow } from "./drive.types";
import { validateCreateDocumentRequest } from "./document.validation";

const EMPTY_TIPTAP_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };
const EMPTY_YJS_STATE = Buffer.from([0, 0]);

export interface DocumentIdFactory {
  createDocumentId: () => string;
  createSnapshotId: () => string;
}

const defaultDocumentIdFactory: DocumentIdFactory = {
  createDocumentId: randomUUID,
  createSnapshotId: randomUUID
};

@Injectable()
export class DocumentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly activityLogService: ActivityLogService,
    @Optional() private readonly idFactory: DocumentIdFactory = defaultDocumentIdFactory
  ) {}

  async createDocument(
    currentUserId: string,
    workspaceId: string,
    body: CreateDocumentRequest
  ): Promise<CreateDocumentPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateDocumentRequest(body);
    if (input.parentId !== null) {
      await this.assertActiveFolder(workspaceId, input.parentId);
    }

    const documentId = this.idFactory.createDocumentId();
    const snapshotId = this.idFactory.createSnapshotId();

    return this.database.transaction(async (transaction) => {
      const item = await transaction.queryOne<DriveItemRow>(
        `
          WITH inserted AS (
            INSERT INTO drive_items (
              id, workspace_id, parent_id, item_type, name, created_by_user_id
            )
            VALUES ($1, $2, $3, 'document', $4, $5)
            RETURNING *
          )
          SELECT
            inserted.id, inserted.workspace_id, inserted.parent_id, inserted.item_type,
            inserted.name, inserted.object_key, inserted.mime_type, inserted.size_bytes,
            inserted.upload_status, inserted.created_by_user_id, inserted.updated_by_user_id,
            inserted.created_at, inserted.updated_at, inserted.deleted_at,
            created_by_user.name AS created_by_user_name,
            created_by_user.avatar_url AS created_by_user_avatar_url,
            updated_by_user.name AS updated_by_user_name,
            updated_by_user.avatar_url AS updated_by_user_avatar_url
          FROM inserted
          JOIN users created_by_user ON created_by_user.id = inserted.created_by_user_id
          LEFT JOIN users updated_by_user ON updated_by_user.id = inserted.updated_by_user_id
        `,
        [documentId, workspaceId, input.parentId, input.name, currentUserId]
      );
      if (!item) throw badRequest("Document could not be created");

      const document = await transaction.queryOne<DocumentRow>(
        `
          INSERT INTO documents (id, workspace_id, drive_item_id)
          VALUES ($1, $2, $3)
          RETURNING *
        `,
        [documentId, workspaceId, documentId]
      );
      if (!document) throw badRequest("Document could not be created");

      const snapshot = await transaction.queryOne<DocumentSnapshotRow>(
        `
          INSERT INTO document_snapshots (
            id, document_id, workspace_id, version, yjs_state, content_json, plain_text
          )
          VALUES ($1, $2, $3, 0, $4, $5::jsonb, '')
          RETURNING id, document_id, workspace_id, version, created_at
        `,
        [snapshotId, documentId, workspaceId, EMPTY_YJS_STATE, JSON.stringify(EMPTY_TIPTAP_DOCUMENT)]
      );
      if (!snapshot) throw badRequest("Document snapshot could not be created");

      await transaction.execute(
        `
          UPDATE documents
          SET latest_snapshot_id = $3
          WHERE id = $1 AND workspace_id = $2
        `,
        [documentId, workspaceId, snapshot.id]
      );

      await this.activityLogService.append(
        transaction,
        this.buildCreatedActivityLog(currentUserId, workspaceId, documentId, input.name, input.parentId)
      );

      return {
        item: mapDriveItem(item),
        document: mapDocument({ ...document, latest_snapshot_id: snapshot.id })
      };
    });
  }

  private async assertActiveFolder(workspaceId: string, parentId: string): Promise<void> {
    const parent = await this.database.queryOne<{ id: string }>(
      `
        SELECT id
        FROM drive_items
        WHERE workspace_id = $1
          AND id = $2
          AND item_type = 'folder'
          AND deleted_at IS NULL
      `,
      [workspaceId, parentId]
    );
    if (!parent) throw notFound("Drive folder not found");
  }

  private buildCreatedActivityLog(
    currentUserId: string,
    workspaceId: string,
    documentId: string,
    name: string,
    parentId: string | null
  ): ActivityLogInput {
    return {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "document_created",
      target: { type: "document", id: documentId },
      dedupeKey: `document:document_created:${documentId}:0`,
      metadata: {
        version: 1,
        summary: `${safeDocumentTitle(name)} 문서를 생성했습니다.`,
        data: { title: safeDocumentTitle(name), source: "blank", ...(parentId ? { parentId } : {}) }
      }
    };
  }
}

function mapDocument(row: DocumentRow): DocumentPayload {
  return {
    id: row.id,
    driveItemId: row.drive_item_id,
    workspaceId: row.workspace_id,
    currentVersion: Number(row.current_version),
    latestSnapshotId: row.latest_snapshot_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toIsoString(row.deleted_at)
  };
}

function safeDocumentTitle(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 160) || "문서";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
