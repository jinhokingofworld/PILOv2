import { randomUUID } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";

import {
  ActivityLogService,
  type ActivityLogInput
} from "../../common/activity-log.service";
import { badRequest, conflict, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { mapDriveItem } from "./drive.mapper";
import type {
  CreateDocumentPayload,
  CreateDocumentRequest,
  DocumentBootstrapPayload,
  DocumentBootstrapRow,
  DocumentPayload,
  DocumentRow,
  DocumentSnapshotPayload,
  DocumentSnapshotRow,
  LockedDocumentRow,
  SaveDocumentSnapshotPayload,
  SaveDocumentSnapshotRequest
} from "./document.types";
import type { DriveItemRow } from "./drive.types";
import {
  validateCreateDocumentRequest,
  extractDriveFileAttachmentIds,
  validateSaveDocumentSnapshotRequest
} from "./document.validation";

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

  async getDocument(
    currentUserId: string,
    workspaceId: string,
    documentId: string
  ): Promise<DocumentBootstrapPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.database.queryOne<DocumentBootstrapRow>(
      `
        SELECT
          item.id, item.workspace_id, item.parent_id, item.item_type, item.name,
          item.object_key, item.mime_type, item.size_bytes, item.upload_status,
          item.created_by_user_id, item.updated_by_user_id, item.created_at,
          item.updated_at, item.deleted_at,
          created_by_user.name AS created_by_user_name,
          created_by_user.avatar_url AS created_by_user_avatar_url,
          updated_by_user.name AS updated_by_user_name,
          updated_by_user.avatar_url AS updated_by_user_avatar_url,
          document.id AS document_id,
          document.current_version AS document_current_version,
          document.latest_snapshot_id AS document_latest_snapshot_id,
          document.created_at AS document_created_at,
          document.updated_at AS document_updated_at,
          document.deleted_at AS document_deleted_at,
          snapshot.id AS snapshot_id,
          snapshot.version AS snapshot_version,
          snapshot.yjs_state AS snapshot_yjs_state,
          snapshot.content_json AS snapshot_content_json,
          snapshot.plain_text AS snapshot_plain_text,
          snapshot.source_update_sequence AS snapshot_source_update_sequence,
          snapshot.created_at AS snapshot_created_at
        FROM documents document
        JOIN drive_items item
          ON item.id = document.drive_item_id
          AND item.workspace_id = document.workspace_id
        JOIN document_snapshots snapshot
          ON snapshot.id = document.latest_snapshot_id
          AND snapshot.document_id = document.id
          AND snapshot.workspace_id = document.workspace_id
        JOIN users created_by_user ON created_by_user.id = item.created_by_user_id
        LEFT JOIN users updated_by_user ON updated_by_user.id = item.updated_by_user_id
        WHERE document.id = $1
          AND document.workspace_id = $2
          AND document.deleted_at IS NULL
          AND item.deleted_at IS NULL
          AND item.item_type = 'document'
      `,
      [documentId, workspaceId]
    );
    if (!row) throw notFound("Document not found");

    return {
      item: mapDriveItem(row),
      document: mapDocument({
        id: row.document_id,
        drive_item_id: row.id,
        workspace_id: row.workspace_id,
        current_version: row.document_current_version,
        latest_snapshot_id: row.document_latest_snapshot_id,
        created_at: row.document_created_at,
        updated_at: row.document_updated_at,
        deleted_at: row.document_deleted_at
      }),
      snapshot: mapDocumentSnapshot({
        id: row.snapshot_id,
        document_id: row.document_id,
        workspace_id: row.workspace_id,
        version: row.snapshot_version,
        yjs_state: row.snapshot_yjs_state,
        content_json: row.snapshot_content_json,
        plain_text: row.snapshot_plain_text,
        source_update_sequence: row.snapshot_source_update_sequence,
        created_at: row.snapshot_created_at
      })
    };
  }

  async saveDocumentSnapshot(
    currentUserId: string,
    workspaceId: string,
    documentId: string,
    body: SaveDocumentSnapshotRequest
  ): Promise<SaveDocumentSnapshotPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateSaveDocumentSnapshotRequest(body);
    const snapshotId = this.idFactory.createSnapshotId();

    return this.database.transaction(async (transaction) => {
      const lockedDocument = await transaction.queryOne<LockedDocumentRow>(
        `
          SELECT
            document.*,
            item.name,
            snapshot.content_json AS current_snapshot_content_json
          FROM documents document
          JOIN drive_items item
            ON item.id = document.drive_item_id
            AND item.workspace_id = document.workspace_id
          JOIN document_snapshots snapshot
            ON snapshot.id = document.latest_snapshot_id
            AND snapshot.document_id = document.id
            AND snapshot.workspace_id = document.workspace_id
          WHERE document.id = $1
            AND document.workspace_id = $2
            AND document.deleted_at IS NULL
            AND item.deleted_at IS NULL
            AND item.item_type = 'document'
          FOR UPDATE OF document, item
        `,
        [documentId, workspaceId]
      );
      if (!lockedDocument) throw notFound("Document not found");

      const currentVersion = Number(lockedDocument.current_version);
      if (currentVersion !== input.expectedVersion) {
        throw conflict("Document version is outdated");
      }

      await this.assertActiveReadyFiles(
        transaction,
        workspaceId,
        input.attachmentFileIds
      );

      const nextVersion = currentVersion + 1;
      const snapshot = await transaction.queryOne<DocumentSnapshotRow>(
        `
          INSERT INTO document_snapshots (
            id, document_id, workspace_id, version, yjs_state, content_json, plain_text,
            source_update_sequence
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0)
          RETURNING
            id, document_id, workspace_id, version, yjs_state, content_json, plain_text,
            source_update_sequence, created_at
        `,
        [
          snapshotId,
          documentId,
          workspaceId,
          nextVersion,
          input.yjsState,
          JSON.stringify(input.contentJson),
          input.plainText
        ]
      );
      if (!snapshot) throw badRequest("Document snapshot could not be saved");

      const document = await transaction.queryOne<DocumentRow>(
        `
          UPDATE documents
          SET current_version = $3, latest_snapshot_id = $4
          WHERE id = $1 AND workspace_id = $2
          RETURNING *
        `,
        [documentId, workspaceId, nextVersion, snapshot.id]
      );
      if (!document) throw badRequest("Document could not be saved");

      await transaction.execute(
        `
          UPDATE drive_items
          SET updated_by_user_id = $3
          WHERE id = $1 AND workspace_id = $2
        `,
        [documentId, workspaceId, currentUserId]
      );

      const previousAttachmentFileIds = new Set(
        extractDriveFileAttachmentIds(
          lockedDocument.current_snapshot_content_json ?? EMPTY_TIPTAP_DOCUMENT
        )
      );
      const currentAttachmentFileIds = new Set(input.attachmentFileIds);
      const attachedFileIds = input.attachmentFileIds.filter(
        (fileId) => !previousAttachmentFileIds.has(fileId)
      );
      const detachedFileIds = [...previousAttachmentFileIds].filter(
        (fileId) => !currentAttachmentFileIds.has(fileId)
      );

      if (attachedFileIds.length > 0 || detachedFileIds.length > 0) {
        for (const fileId of attachedFileIds) {
          await this.activityLogService.append(
            transaction,
            this.buildAttachmentUpdatedActivityLog(
              currentUserId,
              workspaceId,
              documentId,
              lockedDocument.name,
              nextVersion,
              fileId,
              "attached"
            )
          );
        }
        for (const fileId of detachedFileIds) {
          await this.activityLogService.append(
            transaction,
            this.buildAttachmentUpdatedActivityLog(
              currentUserId,
              workspaceId,
              documentId,
              lockedDocument.name,
              nextVersion,
              fileId,
              "detached"
            )
          );
        }
      } else {
        await this.activityLogService.append(
          transaction,
          this.buildContentUpdatedActivityLog(
            currentUserId,
            workspaceId,
            documentId,
            lockedDocument.name,
            nextVersion
          )
        );
      }

      return {
        document: mapDocument(document),
        snapshot: mapDocumentSnapshot(snapshot)
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

  private async assertActiveReadyFiles(
    transaction: DatabaseTransaction,
    workspaceId: string,
    fileIds: string[]
  ): Promise<void> {
    if (fileIds.length === 0) return;

    const files = await transaction.query<{ id: string }>(
      `
        SELECT id
        FROM drive_items
        WHERE workspace_id = $1
          AND id = ANY($2::uuid[])
          AND item_type = 'file'
          AND upload_status = 'ready'
          AND deleted_at IS NULL
      `,
      [workspaceId, fileIds]
    );

    if (files.length !== fileIds.length) {
      throw badRequest("Document attachment is invalid");
    }
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

  private buildContentUpdatedActivityLog(
    currentUserId: string,
    workspaceId: string,
    documentId: string,
    name: string,
    version: number
  ): ActivityLogInput {
    const title = safeDocumentTitle(name);

    return {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "document_content_updated",
      target: { type: "document", id: documentId },
      dedupeKey: `document:document_content_updated:${documentId}:${version}`,
      metadata: {
        version: 1,
        summary: `${title} 문서 내용을 수정했습니다.`,
        data: { version }
      }
    };
  }

  private buildAttachmentUpdatedActivityLog(
    currentUserId: string,
    workspaceId: string,
    documentId: string,
    name: string,
    version: number,
    driveItemId: string,
    operation: "attached" | "detached"
  ): ActivityLogInput {
    const title = safeDocumentTitle(name);
    const summary =
      operation === "attached"
        ? `${title} 문서에 파일을 첨부했습니다.`
        : `${title} 문서에서 파일 첨부를 제거했습니다.`;

    return {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "document_attachment_updated",
      target: { type: "document", id: documentId },
      dedupeKey: `document:document_attachment_updated:${documentId}:${version}:${driveItemId}:${operation}`,
      metadata: {
        version: 1,
        summary,
        data: { driveItemId, operation, version }
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

function mapDocumentSnapshot(row: DocumentSnapshotRow): DocumentSnapshotPayload {
  return {
    id: row.id,
    version: Number(row.version),
    yjsState: Buffer.from(row.yjs_state).toString("base64"),
    contentJson: row.content_json,
    plainText: row.plain_text,
    sourceUpdateSequence: Number(row.source_update_sequence),
    createdAt: toIsoString(row.created_at)
  };
}

function safeDocumentTitle(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 160) || "문서";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
