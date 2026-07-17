import { Injectable } from "@nestjs/common";
import type { DatabaseTransaction } from "../../database/database.service";

export interface QueueDocumentEmbeddingSnapshotInput {
  workspaceId: string;
  documentId: string;
  snapshotId: string;
}

@Injectable()
export class DocumentEmbeddingService {
  async queueSnapshot(
    transaction: DatabaseTransaction,
    input: QueueDocumentEmbeddingSnapshotInput
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE document_embedding_jobs
        SET status = 'superseded', completed_at = now()
        WHERE document_id = $1
          AND snapshot_id <> $2
          AND status IN ('queued', 'processing')
      `,
      [input.documentId, input.snapshotId]
    );

    const job = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO document_embedding_jobs (
          workspace_id, document_id, snapshot_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (document_id, snapshot_id)
        DO UPDATE SET document_id = EXCLUDED.document_id
        RETURNING id
      `,
      [input.workspaceId, input.documentId, input.snapshotId]
    );

    if (!job) {
      throw new Error("Document embedding job could not be queued");
    }

    await transaction.execute(
      `
        INSERT INTO document_embedding_outbox (job_id, workspace_id)
        VALUES ($1, $2)
        ON CONFLICT (job_id) DO NOTHING
      `,
      [job.id, input.workspaceId]
    );
  }
}
