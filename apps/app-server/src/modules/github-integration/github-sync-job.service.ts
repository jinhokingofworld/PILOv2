import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from "@aws-sdk/client-sqs";
import { HttpStatus, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { ApiError, badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { GithubProjectV2WebhookReconcileService } from "./github-project-v2-webhook-reconcile.service";
import {
  GithubSyncExecutorService,
  type GithubSyncInstallationRow,
  type GithubSyncProjectV2ContextRow,
  type GithubSyncRepositoryContextRow,
  type GithubSyncRunSummary
} from "./github-sync-executor.service";
import { createGithubSyncProgressCursor } from "./github-sync-progress";
import type { GithubSyncTarget } from "./types";

type GithubSqsClient = Pick<SQSClient, "send"> & Partial<Pick<SQSClient, "destroy">>;

interface SyncJobRow extends QueryResultRow {
  id: string;
  sync_run_id: string;
  requested_by_user_id: string;
  workspace_id: string;
  installation_id: string;
  repository_id: string | null;
  project_v2_id: string | null;
  target: GithubSyncTarget;
  attempt_count: number;
}

class TerminalSyncJobError extends Error {}

export class GithubSyncJobEnqueueError extends ApiError {
  constructor(readonly syncRunId: string) {
    super(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "GitHub sync job could not be enqueued");
    this.message = "GitHub sync job could not be enqueued";
  }
}

@Injectable()
export class GithubSyncJobService implements OnModuleDestroy {
  private readonly logger = new Logger(GithubSyncJobService.name);
  private readonly workerId = `${process.env.HOSTNAME ?? "github-sync-worker"}-${process.pid}`;
  private sqs: GithubSqsClient | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly executor: GithubSyncExecutorService,
    private readonly tokenService: GithubProjectV2SyncTokenService,
    private readonly webhookReconcileService: GithubProjectV2WebhookReconcileService
  ) {}

  async enqueueSyncJob(syncRunId: string, requestedByUserId: string): Promise<void> {
    const job = await this.database.queryOne<{ id: string }>(
      `INSERT INTO github_sync_jobs (sync_run_id, requested_by_user_id)
       VALUES ($1, $2)
       ON CONFLICT (sync_run_id) DO UPDATE SET sync_run_id = EXCLUDED.sync_run_id
       RETURNING id`,
      [syncRunId, requestedByUserId]
    );
    if (!job) throw badRequest("GitHub sync job could not be created");
    try {
      await this.client().send(new SendMessageCommand({
        QueueUrl: this.requireEnv("SQS_GITHUB_SYNC_JOBS_QUEUE_URL"),
        MessageBody: JSON.stringify({ jobId: job.id })
      }));
    } catch {
      await this.failEnqueue(syncRunId, job.id);
      throw new GithubSyncJobEnqueueError(syncRunId);
    }
  }

  async enqueueWebhookDelivery(deliveryId: string): Promise<void> {
    await this.client().send(new SendMessageCommand({
      QueueUrl: this.requireEnv("SQS_GITHUB_WEBHOOKS_QUEUE_URL"),
      MessageBody: JSON.stringify({ deliveryId })
    }));
  }

  async processSyncJob(jobId: string): Promise<"terminal" | "retry"> {
    const job = await this.acquireLease(jobId);
    if (!job) return "terminal";
    try {
      const [installation, repository, projectV2] = await Promise.all([
        this.installation(job.workspace_id, job.installation_id),
        job.repository_id ? this.repository(job.workspace_id, job.repository_id) : null,
        job.project_v2_id ? this.project(job.workspace_id, job.project_v2_id) : null
      ]);
      if (!installation) throw new TerminalSyncJobError("GitHub App installation not found");
      const token = await this.tokenService.resolvePersonalProjectV2UserAccessToken({
        currentUserId: job.requested_by_user_id,
        installation,
        requiresProjectV2Access: ["full", "project_v2", "project_v2_fields", "project_v2_items"].includes(job.target)
      });
      const summary = await this.executor.runGithubSyncTarget(job.target, {
        currentUserId: job.requested_by_user_id, workspaceId: job.workspace_id,
        installation, repository, projectV2, githubUserAccessToken: token,
        config: this.configService.getGithubAppConfig(),
        reportProgress: async (progress) => {
          await this.database.execute(
            `UPDATE github_sync_runs SET fetched_count=$2, created_count=$3, updated_count=$4, skipped_count=$5,
               cursor=jsonb_set(cursor, '{progress}', $6::jsonb, true) WHERE id=$1 AND status='running'`,
            [job.sync_run_id, progress.summary.fetchedCount, progress.summary.createdCount, progress.summary.updatedCount,
              progress.summary.skippedCount, JSON.stringify(createGithubSyncProgressCursor(progress.progressPercent, progress.progressStage))]
          );
        }
      });
      await this.completeSuccess(job, summary);
      return "terminal";
    } catch (error) {
      if (error instanceof TerminalSyncJobError) {
        await this.completeFailure(job, this.errorMessage(error));
        return "terminal";
      }
      if (job.attempt_count >= 3) {
        await this.completeFailure(job, this.errorMessage(error));
        return "terminal";
      }
      this.logger.warn(`GitHub sync job ${job.id} will be retried: ${this.errorMessage(error)}`);
      return "retry";
    }
  }

  async processWebhookDelivery(deliveryId: string): Promise<"terminal" | "retry"> {
    return this.webhookReconcileService.processDelivery(deliveryId);
  }

  async pollOnce(): Promise<void> {
    await this.recoverWebhookOutbox();
    await this.pollQueue(this.requireEnv("SQS_GITHUB_SYNC_JOBS_QUEUE_URL"), "jobId", (id) => this.processSyncJob(id));
    await this.pollQueue(this.requireEnv("SQS_GITHUB_WEBHOOKS_QUEUE_URL"), "deliveryId", (id) => this.processWebhookDelivery(id));
  }

  onModuleDestroy(): void { this.sqs?.destroy?.(); this.sqs = null; }

  private async pollQueue(queueUrl: string, field: "jobId" | "deliveryId", handler: (id: string) => Promise<"terminal" | "retry">): Promise<void> {
    const response = await this.client().send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 10 }));
    for (const message of response.Messages ?? []) {
      try {
        const value = JSON.parse(message.Body ?? "{}") as Record<string, unknown>;
        const id = value[field];
        if (typeof id !== "string" || !id || await handler(id) !== "terminal") continue;
        if (message.ReceiptHandle) await this.client().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (error) { this.logger.warn(`GitHub queue message will be retried: ${this.errorMessage(error)}`); }
    }
  }

  private async recoverWebhookOutbox(): Promise<void> {
    const failures = await this.webhookReconcileService.recoverDeliveries(
      (deliveryId) => this.enqueueWebhookDelivery(deliveryId)
    );
    for (const failure of failures) {
      this.logger.warn(
        `GitHub webhook delivery ${failure.deliveryId} remains queued for recovery: ${this.errorMessage(failure.error)}`
      );
    }
  }

  private async acquireLease(jobId: string): Promise<SyncJobRow | null> {
    return this.database.queryOne<SyncJobRow>(
      `WITH leased AS (
        UPDATE github_sync_jobs SET status='running', attempt_count=attempt_count+1, lease_owner=$2,
          lease_expires_at=now() + interval '10 minutes', started_at=COALESCE(started_at, now())
        WHERE id=$1 AND status IN ('queued', 'running') AND (lease_expires_at IS NULL OR lease_expires_at < now())
        RETURNING id, sync_run_id, requested_by_user_id, attempt_count)
       UPDATE github_sync_runs run SET status='running', started_at=now()
       FROM leased, github_sync_jobs job WHERE run.id=leased.sync_run_id AND job.id=leased.id
       RETURNING leased.id, leased.sync_run_id, leased.requested_by_user_id, leased.attempt_count, run.workspace_id, run.installation_id,
         run.repository_id, run.project_v2_id, run.target`, [jobId, this.workerId]
    );
  }

  private async completeSuccess(job: SyncJobRow, summary: GithubSyncRunSummary): Promise<void> {
    await this.database.execute(`UPDATE github_sync_runs SET status='success', finished_at=now(), fetched_count=$2, created_count=$3, updated_count=$4, skipped_count=$5, error_message=NULL, cursor=$6::jsonb WHERE id=$1`, [job.sync_run_id, summary.fetchedCount, summary.createdCount, summary.updatedCount, summary.skippedCount, JSON.stringify(summary.cursor)]);
    await this.database.execute(`UPDATE github_sync_jobs SET status='success', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=NULL WHERE id=$1`, [job.id]);
  }
  private async completeFailure(job: SyncJobRow, message: string): Promise<void> {
    await this.database.execute(`UPDATE github_sync_runs SET status='failed', finished_at=now(), error_message=$2 WHERE id=$1`, [job.sync_run_id, message]);
    await this.database.execute(`UPDATE github_sync_jobs SET status='failed', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=$2 WHERE id=$1`, [job.id, message]);
  }
  private async failEnqueue(runId: string, jobId: string): Promise<void> { await this.database.execute(`UPDATE github_sync_runs SET status='failed', finished_at=now(), error_message='GitHub sync job could not be enqueued' WHERE id=$1`, [runId]); await this.database.execute(`UPDATE github_sync_jobs SET status='failed', finished_at=now(), last_error='GitHub sync job could not be enqueued' WHERE id=$1`, [jobId]); }
  private installation(workspaceId: string, id: string): Promise<GithubSyncInstallationRow | null> { return this.database.queryOne(`SELECT id, workspace_id, github_installation_id, account_login, account_type FROM github_installations WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private repository(workspaceId: string, id: string): Promise<GithubSyncRepositoryContextRow | null> { return this.database.queryOne(`SELECT id, workspace_id, installation_id, github_node_id, owner_login, name, full_name FROM github_repositories WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private project(workspaceId: string, id: string): Promise<GithubSyncProjectV2ContextRow | null> { return this.database.queryOne(`SELECT id, workspace_id, installation_id, github_project_node_id FROM github_projects_v2 WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private client(): GithubSqsClient { if (!this.sqs) this.sqs = new SQSClient({ region: this.requireEnv("AWS_REGION"), endpoint: process.env.SQS_ENDPOINT?.trim() || undefined }); return this.sqs; }
  private requireEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw badRequest(`GitHub queue configuration is missing: ${name}`); return value; }
  private errorMessage(error: unknown): string { return (error instanceof Error ? error.message : "GitHub sync failed").slice(0, 1000); }
}
