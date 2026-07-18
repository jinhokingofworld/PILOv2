import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceIndexingJobService } from "../workspace-indexing/workspace-indexing-job.service";

const SWEEP_INTERVAL_MS = 15_000;
const CLAIM_TIMEOUT_SECONDS = 60;
const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];
const PUBLISH_FAILURE_CODE = "WORKSPACE_INDEXING_PUBLISH_FAILED";
const PUBLISH_FAILURE_MESSAGE = "Workspace indexing job could not be published";

interface DocumentEmbeddingOutboxClaim {
  id: string;
  job_id: string;
  workspace_id: string;
  attempt_count: number | string;
  claim_token: string;
}

@Injectable()
export class DocumentEmbeddingOutboxPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentEmbeddingOutboxPublisherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceIndexingJobs: WorkspaceIndexingJobService
  ) {}

  onModuleInit(): void {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;
    this.interval = setInterval(() => {
      void this.publishDue().catch(() => {
        this.logger.error("Document embedding outbox recovery sweep failed");
      });
    }, SWEEP_INTERVAL_MS);
    void this.publishDue().catch(() => {
      this.logger.error("Initial document embedding outbox sweep failed");
    });
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async publishDue(): Promise<void> {
    await this.recoverCurrentSupersededJobs();

    const rows = await this.database.query<{ id: string }>(
      `
        SELECT outbox.id
        FROM document_embedding_outbox AS outbox
        JOIN document_embedding_jobs AS job
          ON job.id = outbox.job_id
          AND job.workspace_id = outbox.workspace_id
        WHERE job.status = 'queued'
          AND job.available_at <= now()
          AND (
            (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
            OR (
              outbox.status = 'publishing'
              AND outbox.claimed_at <= now() - ($1 * INTERVAL '1 second')
            )
          )
        ORDER BY outbox.next_attempt_at ASC
        LIMIT $2
      `,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );

    for (const row of rows) {
      await this.publishOne(row.id);
    }
  }

  private async recoverCurrentSupersededJobs(): Promise<void> {
    await this.database.execute(
      `
        WITH recovered_jobs AS (
          UPDATE document_embedding_jobs AS job
          SET status = 'queued',
              claimed_at = NULL,
              completed_at = NULL,
              error_code = NULL,
              error_message = NULL
          FROM documents AS document
          WHERE job.status = 'superseded'
            AND document.id = job.document_id
            AND document.workspace_id = job.workspace_id
            AND document.deleted_at IS NULL
            AND document.latest_snapshot_id = job.snapshot_id
          RETURNING job.id
        )
        UPDATE document_embedding_outbox AS outbox
        SET status = 'pending',
            attempt_count = 0,
            next_attempt_at = now(),
            claim_token = NULL,
            claimed_at = NULL,
            delivered_at = NULL
        FROM recovered_jobs
        WHERE outbox.job_id = recovered_jobs.id
      `
    );
  }

  private async publishOne(outboxId: string): Promise<void> {
    const claim = await this.claim(outboxId);
    if (!claim) return;

    try {
      await this.workspaceIndexingJobs.enqueue({
        version: 1,
        source: "document",
        jobId: claim.job_id
      });
      await this.markDelivered(claim);
    } catch {
      await this.markPublishFailure(claim);
    }
  }

  private async claim(outboxId: string): Promise<DocumentEmbeddingOutboxClaim | null> {
    const claimToken = randomUUID();
    return this.database.transaction((transaction) =>
      transaction.queryOne<DocumentEmbeddingOutboxClaim>(
        `
          WITH candidate AS (
            SELECT outbox.id
            FROM document_embedding_outbox AS outbox
            JOIN document_embedding_jobs AS job
              ON job.id = outbox.job_id
              AND job.workspace_id = outbox.workspace_id
            WHERE outbox.id = $1
              AND job.status = 'queued'
              AND job.available_at <= now()
              AND (
                (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
                OR (
                  outbox.status = 'publishing'
                  AND outbox.claimed_at <= now() - ($2 * INTERVAL '1 second')
                )
              )
            FOR UPDATE OF outbox SKIP LOCKED
          )
          UPDATE document_embedding_outbox AS outbox
          SET status = 'publishing',
              attempt_count = outbox.attempt_count + 1,
              claim_token = $3,
              claimed_at = now()
          FROM candidate
          WHERE outbox.id = candidate.id
          RETURNING
            outbox.id,
            outbox.job_id,
            outbox.workspace_id,
            outbox.attempt_count,
            outbox.claim_token
        `,
        [outboxId, CLAIM_TIMEOUT_SECONDS, claimToken]
      )
    );
  }

  private async markDelivered(claim: DocumentEmbeddingOutboxClaim): Promise<void> {
    await this.database.execute(
      `
        UPDATE document_embedding_outbox
        SET status = 'delivered',
            delivered_at = now(),
            claim_token = NULL,
            claimed_at = NULL
        WHERE id = $1
          AND status = 'publishing'
          AND claim_token = $2
      `,
      [claim.id, claim.claim_token]
    );
  }

  private async markPublishFailure(claim: DocumentEmbeddingOutboxClaim): Promise<void> {
    const attempts = Number(claim.attempt_count);
    if (attempts <= MAX_RETRIES) {
      await this.database.execute(
        `
          UPDATE document_embedding_outbox
          SET status = 'pending',
              next_attempt_at = $2,
              claim_token = NULL,
              claimed_at = NULL
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $3
        `,
        [
          claim.id,
          new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]),
          claim.claim_token
        ]
      );
      return;
    }

    await this.database.transaction(async (transaction) => {
      const outbox = await transaction.queryOne<{ job_id: string }>(
        `
          UPDATE document_embedding_outbox
          SET status = 'failed',
              claim_token = NULL,
              claimed_at = NULL
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $2
          RETURNING job_id
        `,
        [claim.id, claim.claim_token]
      );
      if (!outbox) return;

      await transaction.execute(
        `
          UPDATE document_embedding_jobs
          SET status = 'failed',
              completed_at = now(),
              error_code = $2,
              error_message = $3
          WHERE id = $1
            AND status = 'queued'
        `,
        [outbox.job_id, PUBLISH_FAILURE_CODE, PUBLISH_FAILURE_MESSAGE]
      );
    });
  }
}
