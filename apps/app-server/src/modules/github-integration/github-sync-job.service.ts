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
import { isGithubGraphqlRateLimitError } from "./github-app.client";
import { GithubProjectV2PollingService } from "./github-project-v2-polling.service";
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
  lease_generation: string;
  is_polling: boolean;
}

class TerminalSyncJobError extends Error {}
class LostSyncJobLeaseError extends Error {
  constructor() { super("GitHub sync job lease ownership was lost"); }
}

interface GithubSyncJobLeaseHeartbeat {
  timer: ReturnType<typeof setInterval>;
  assertLease: () => Promise<void>;
}

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
    private readonly webhookReconcileService: GithubProjectV2WebhookReconcileService,
    private readonly pollingService?: GithubProjectV2PollingService
  ) {}

  async enqueueSyncJob(
    syncRunId: string,
    requestedByUserId: string,
    options?: { skipIfRunIsNoLongerQueued?: boolean }
  ): Promise<boolean> {
    const job = await this.database.queryOne<{ id: string; lease_generation: string }>(
      `WITH locked_polling_schedule AS MATERIALIZED (
        SELECT schedule.active_sync_run_id
        FROM github_project_v2_polling_schedules AS schedule
        WHERE schedule.active_sync_run_id=$1
        FOR UPDATE OF schedule
      ), queued_run AS (
        SELECT run.id
        FROM github_sync_runs AS run
        WHERE run.id=$1
          AND (
            run.status='queued'
            OR (
              run.status='running'
              AND EXISTS (
                SELECT 1
                FROM github_sync_jobs AS existing_job
                WHERE existing_job.sync_run_id=run.id
                  AND existing_job.status IN ('queued', 'running')
                  AND (existing_job.lease_expires_at IS NULL OR existing_job.lease_expires_at < now())
              )
            )
          )
          AND (
            EXISTS (SELECT 1 FROM locked_polling_schedule)
            OR NOT EXISTS (
              SELECT 1
              FROM github_project_v2_polling_schedules AS schedule
              WHERE schedule.active_sync_run_id=run.id
            )
          )
      )
      INSERT INTO github_sync_jobs (sync_run_id, requested_by_user_id)
        SELECT queued_run.id, $2 FROM queued_run
        ON CONFLICT (sync_run_id) DO UPDATE
        SET status='queued', lease_owner=NULL, lease_expires_at=NULL, finished_at=NULL, last_error=NULL,
          lease_generation=github_sync_jobs.lease_generation+1
       WHERE github_sync_jobs.status='queued'
          OR (github_sync_jobs.status='running' AND github_sync_jobs.lease_expires_at < now())
       RETURNING id, lease_generation`,
      [syncRunId, requestedByUserId]
    );
    if (!job) {
      if (options?.skipIfRunIsNoLongerQueued) return false;
      throw badRequest("GitHub sync job could not be created");
    }
    try {
      await this.client().send(new SendMessageCommand({
        QueueUrl: this.requireEnv("SQS_GITHUB_SYNC_JOBS_QUEUE_URL"),
        MessageBody: JSON.stringify({ jobId: job.id })
      }));
    } catch {
      await this.failEnqueue(syncRunId, job.id, job.lease_generation);
      throw new GithubSyncJobEnqueueError(syncRunId);
    }
    return true;
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
    const heartbeat = this.startLeaseHeartbeat(job);
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
        assertLease: heartbeat.assertLease,
        reportProgress: async (progress) => {
          await heartbeat.assertLease();
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
      if (error instanceof LostSyncJobLeaseError) return "terminal";
      const isRateLimited = isGithubGraphqlRateLimitError(error);
      if (error instanceof TerminalSyncJobError || isRateLimited) {
        await this.completeFailure(job, this.errorMessage(error), isRateLimited);
        return "terminal";
      }
      if (job.attempt_count >= 3) {
        await this.completeFailure(job, this.errorMessage(error));
        return "terminal";
      }
      this.logger.warn(`GitHub sync job ${job.id} will be retried: ${this.errorMessage(error)}`);
      return "retry";
    } finally {
      clearInterval(heartbeat.timer);
    }
  }

  async processWebhookDelivery(deliveryId: string): Promise<"terminal" | "retry"> {
    return this.webhookReconcileService.processDelivery(deliveryId);
  }

  async pollOnce(): Promise<void> {
    await this.recoverWebhookOutbox();
    await this.enqueueDueProjectV2PollingSchedules();
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

  private async enqueueDueProjectV2PollingSchedules(): Promise<void> {
    if (!this.pollingService) return;
    const claims = await this.pollingService.claimDueSchedules(10);
    for (const claim of claims) {
      try {
        await this.enqueueSyncJob(claim.syncRunId, claim.requestedByUserId, {
          skipIfRunIsNoLongerQueued: true
        });
      } catch (error) {
        this.logger.warn(
          `GitHub ProjectV2 polling run ${claim.syncRunId} could not be enqueued: ${this.errorMessage(error)}`
        );
      }
    }
  }

  private async acquireLease(jobId: string): Promise<SyncJobRow | null> {
    return this.database.queryOne<SyncJobRow>(
      `WITH locked_polling_schedule AS MATERIALIZED (
        SELECT schedule.active_sync_run_id
        FROM github_project_v2_polling_schedules AS schedule
        INNER JOIN github_sync_jobs AS job ON job.sync_run_id=schedule.active_sync_run_id
        WHERE job.id=$1
          AND job.status IN ('queued', 'running')
          AND (job.lease_expires_at IS NULL OR job.lease_expires_at < now())
        FOR UPDATE OF schedule
      ), leased AS (
        UPDATE github_sync_jobs AS job
        SET status='running', attempt_count=job.attempt_count+1, lease_owner=$2,
          lease_generation=lease_generation+1,
          lease_expires_at=now() + interval '10 minutes', started_at=COALESCE(job.started_at, now())
        FROM github_sync_runs AS run
        WHERE job.id=$1 AND job.status IN ('queued', 'running')
          AND (job.lease_expires_at IS NULL OR job.lease_expires_at < now())
          AND run.id=job.sync_run_id AND run.status IN ('queued', 'running')
          AND (
            EXISTS (
              SELECT 1
              FROM locked_polling_schedule AS schedule
              WHERE schedule.active_sync_run_id=job.sync_run_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM github_project_v2_polling_schedules AS schedule
              WHERE schedule.active_sync_run_id=job.sync_run_id
            )
          )
        RETURNING job.id, job.sync_run_id, job.requested_by_user_id, job.attempt_count, job.lease_generation
      ), leased_schedule AS (
        UPDATE github_project_v2_polling_schedules AS schedule
        SET lease_owner=$2, lease_expires_at=now() + interval '10 minutes', updated_at=now()
        FROM leased
        WHERE schedule.active_sync_run_id=leased.sync_run_id
        RETURNING schedule.active_sync_run_id
      ), started_run AS (
        UPDATE github_sync_runs AS run SET status='running', started_at=now()
        FROM leased WHERE run.id=leased.sync_run_id
        RETURNING run.workspace_id, run.installation_id, run.repository_id, run.project_v2_id, run.target, run.id
      )
      SELECT leased.id, leased.sync_run_id, leased.requested_by_user_id, leased.attempt_count, leased.lease_generation,
        started_run.workspace_id, started_run.installation_id, started_run.repository_id, started_run.project_v2_id, started_run.target,
        EXISTS (SELECT 1 FROM leased_schedule WHERE leased_schedule.active_sync_run_id=leased.sync_run_id) AS is_polling
      FROM leased
      INNER JOIN started_run ON started_run.id=leased.sync_run_id`, [jobId, this.workerId]
    );
  }

  private startLeaseHeartbeat(job: SyncJobRow): GithubSyncJobLeaseHeartbeat {
    let leaseLost = false;
    const assertLease = async (): Promise<void> => {
      if (leaseLost || !(await this.hasLease(job))) {
        leaseLost = true;
        throw new LostSyncJobLeaseError();
      }
    };
    const timer = setInterval(async () => {
      try {
        await this.renewLease(job);
      } catch (error) {
        if (error instanceof LostSyncJobLeaseError) leaseLost = true;
        this.logger.warn(`GitHub sync job ${job.id} lease renewal failed`);
      }
    }, 5 * 60 * 1000);
    return { timer, assertLease };
  }

  private async renewLease(job: SyncJobRow): Promise<void> {
    if (job.is_polling) {
      const result = await this.database.execute(
        `WITH owned_schedule AS MATERIALIZED (
           SELECT schedule.active_sync_run_id
           FROM github_project_v2_polling_schedules AS schedule
           INNER JOIN github_sync_jobs AS job ON job.sync_run_id=schedule.active_sync_run_id
           WHERE job.id=$1 AND job.status='running' AND job.lease_owner=$2 AND job.lease_generation=$3
             AND schedule.lease_owner=$2
             FOR UPDATE OF schedule
           ), renewed_job AS (
             UPDATE github_sync_jobs
             SET lease_expires_at=now() + interval '10 minutes'
             FROM owned_schedule AS schedule
             WHERE github_sync_jobs.id=$1 AND github_sync_jobs.sync_run_id=schedule.active_sync_run_id
               AND github_sync_jobs.status='running' AND github_sync_jobs.lease_owner=$2
               AND github_sync_jobs.lease_generation=$3
             RETURNING sync_run_id
         ), renewed_schedule AS (
           UPDATE github_project_v2_polling_schedules AS schedule
           SET lease_expires_at=now() + interval '10 minutes', updated_at=now()
           FROM renewed_job
           WHERE schedule.active_sync_run_id=renewed_job.sync_run_id AND schedule.lease_owner=$2
           RETURNING schedule.active_sync_run_id
          )
          SELECT 1 FROM renewed_schedule`,
         [job.id, this.workerId, job.lease_generation]
      );
      if (result.rowCount === 0) throw new LostSyncJobLeaseError();
      return;
    }
    const result = await this.database.execute(
      `WITH renewed_job AS (
         UPDATE github_sync_jobs
         SET lease_expires_at=now() + interval '10 minutes'
          WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_generation=$3
         RETURNING sync_run_id
        ), renewed_schedule AS (
          UPDATE github_project_v2_polling_schedules AS schedule
          SET lease_expires_at=now() + interval '10 minutes', updated_at=now()
          FROM renewed_job
          WHERE schedule.active_sync_run_id=renewed_job.sync_run_id
            AND schedule.lease_owner=$2
        )
        SELECT 1 FROM renewed_job`,
       [job.id, this.workerId, job.lease_generation]
    );
    if (result.rowCount === 0) throw new LostSyncJobLeaseError();
  }

  private async hasLease(job: SyncJobRow): Promise<boolean> {
    if (job.is_polling) {
      return Boolean(await this.database.queryOne(
        `SELECT 1
         FROM github_sync_jobs AS job
         INNER JOIN github_project_v2_polling_schedules AS schedule
           ON schedule.active_sync_run_id=job.sync_run_id
         WHERE job.id=$1 AND job.status='running' AND job.lease_owner=$2 AND job.lease_generation=$3
           AND job.lease_expires_at >= now()
           AND schedule.lease_owner=$2 AND schedule.lease_expires_at >= now()`,
        [job.id, this.workerId, job.lease_generation]
      ));
    }
    return Boolean(await this.database.queryOne(
      `SELECT 1 FROM github_sync_jobs
       WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_generation=$3
         AND lease_expires_at >= now()`,
      [job.id, this.workerId, job.lease_generation]
    ));
  }

  private async completeSuccess(job: SyncJobRow, summary: GithubSyncRunSummary): Promise<void> {
    await this.database.transaction(async (transaction) => {
      if (job.is_polling) {
        await transaction.execute(`WITH locked_schedule AS MATERIALIZED (
          SELECT schedule.active_sync_run_id
          FROM github_project_v2_polling_schedules AS schedule
          WHERE schedule.active_sync_run_id=$4
          FOR UPDATE OF schedule
        ), terminal_job AS (
          UPDATE github_sync_jobs AS job SET status='success', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=NULL
          FROM locked_schedule AS schedule
          WHERE job.id=$1 AND job.sync_run_id=schedule.active_sync_run_id
            AND job.status='running' AND job.lease_owner=$2 AND job.lease_generation=$3
          RETURNING job.sync_run_id
        ), terminal_run AS (
          UPDATE github_sync_runs AS run SET status='success', finished_at=now(), fetched_count=$5, created_count=$6,
            updated_count=$7, skipped_count=$8, error_message=NULL, cursor=$9::jsonb
          FROM terminal_job WHERE run.id=terminal_job.sync_run_id
          RETURNING run.id
        ), terminal_schedule AS (
          UPDATE github_project_v2_polling_schedules AS schedule
          SET active_sync_run_id=NULL, lease_owner=NULL, lease_expires_at=NULL,
            next_poll_at=now() + interval '1 minute', failure_count=0, last_error=NULL, updated_at=now()
          FROM terminal_run
          WHERE schedule.active_sync_run_id=terminal_run.id
        )
        SELECT 1 FROM terminal_run`, [job.id, this.workerId, job.lease_generation, job.sync_run_id, summary.fetchedCount, summary.createdCount, summary.updatedCount, summary.skippedCount, JSON.stringify(summary.cursor)]);
        return;
      }
      await transaction.execute(`WITH terminal_job AS (
        UPDATE github_sync_jobs SET status='success', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=NULL
        WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_generation=$3
        RETURNING sync_run_id
      ), terminal_run AS (
        UPDATE github_sync_runs AS run SET status='success', finished_at=now(), fetched_count=$4, created_count=$5,
          updated_count=$6, skipped_count=$7, error_message=NULL, cursor=$8::jsonb
        FROM terminal_job WHERE run.id=terminal_job.sync_run_id
        RETURNING run.id
      ), terminal_schedule AS (
        UPDATE github_project_v2_polling_schedules AS schedule
        SET active_sync_run_id=NULL, lease_owner=NULL, lease_expires_at=NULL,
          next_poll_at=now() + interval '1 minute', failure_count=0, last_error=NULL, updated_at=now()
        FROM terminal_run
        WHERE schedule.active_sync_run_id=terminal_run.id
      )
      SELECT 1 FROM terminal_run`, [job.id, this.workerId, job.lease_generation, summary.fetchedCount, summary.createdCount, summary.updatedCount, summary.skippedCount, JSON.stringify(summary.cursor)]);
    });
  }
  private async completeFailure(job: SyncJobRow, message: string, isRateLimited = false): Promise<void> {
    const retryInterval = isRateLimited ? "30 minutes" : "5 minutes";
    await this.database.transaction(async (transaction) => {
      if (job.is_polling) {
        await transaction.execute(`WITH locked_schedule AS MATERIALIZED (
          SELECT schedule.active_sync_run_id
          FROM github_project_v2_polling_schedules AS schedule
          WHERE schedule.active_sync_run_id=$4
          FOR UPDATE OF schedule
        ), terminal_job AS (
          UPDATE github_sync_jobs AS job SET status='failed', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=$5
          FROM locked_schedule AS schedule
          WHERE job.id=$1 AND job.sync_run_id=schedule.active_sync_run_id
            AND job.status='running' AND job.lease_owner=$2 AND job.lease_generation=$3
          RETURNING job.sync_run_id
        ), terminal_run AS (
          UPDATE github_sync_runs AS run SET status='failed', finished_at=now(), error_message=$5
          FROM terminal_job WHERE run.id=terminal_job.sync_run_id
          RETURNING run.id
        ), terminal_schedule AS (
          UPDATE github_project_v2_polling_schedules AS schedule
          SET active_sync_run_id=NULL, lease_owner=NULL, lease_expires_at=NULL,
            next_poll_at=now() + interval '${retryInterval}', failure_count=failure_count + 1,
            last_error=$5, updated_at=now()
          FROM terminal_run
          WHERE schedule.active_sync_run_id=terminal_run.id
        )
        SELECT 1 FROM terminal_run`, [job.id, this.workerId, job.lease_generation, job.sync_run_id, message.slice(0, 1000)]);
        return;
      }
      await transaction.execute(`WITH terminal_job AS (
        UPDATE github_sync_jobs SET status='failed', finished_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=$4
        WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_generation=$3
        RETURNING sync_run_id
      ), terminal_run AS (
        UPDATE github_sync_runs AS run SET status='failed', finished_at=now(), error_message=$4
        FROM terminal_job WHERE run.id=terminal_job.sync_run_id
        RETURNING run.id
      ), terminal_schedule AS (
        UPDATE github_project_v2_polling_schedules AS schedule
        SET active_sync_run_id=NULL, lease_owner=NULL, lease_expires_at=NULL,
          next_poll_at=now() + interval '${retryInterval}', failure_count=failure_count + 1,
          last_error=$4, updated_at=now()
        FROM terminal_run
        WHERE schedule.active_sync_run_id=terminal_run.id
      )
      SELECT 1 FROM terminal_run`, [job.id, this.workerId, job.lease_generation, message.slice(0, 1000)]);
    });
  }
  private async failEnqueue(runId: string, jobId: string, leaseGeneration: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(`WITH locked_polling_schedule AS MATERIALIZED (
        SELECT schedule.active_sync_run_id
        FROM github_project_v2_polling_schedules AS schedule
        WHERE schedule.active_sync_run_id=$2
        FOR UPDATE OF schedule
      ), terminal_job AS (
        UPDATE github_sync_jobs AS job
        SET status='failed', finished_at=now(), last_error='GitHub sync job could not be enqueued'
        FROM github_sync_runs AS run
        WHERE job.id=$1 AND job.sync_run_id=$2 AND job.status='queued' AND job.lease_owner IS NULL
          AND job.lease_expires_at IS NULL AND job.lease_generation=$3
          AND run.id=job.sync_run_id AND run.status='queued'
          AND (
            EXISTS (
              SELECT 1
              FROM locked_polling_schedule AS schedule
              WHERE schedule.active_sync_run_id=job.sync_run_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM github_project_v2_polling_schedules AS schedule
              WHERE schedule.active_sync_run_id=job.sync_run_id
            )
          )
        RETURNING job.sync_run_id
      ), terminal_run AS (
        UPDATE github_sync_runs AS run
        SET status='failed', finished_at=now(), error_message='GitHub sync job could not be enqueued'
        FROM terminal_job WHERE run.id=terminal_job.sync_run_id
        RETURNING run.id
      ), terminal_schedule AS (
        UPDATE github_project_v2_polling_schedules AS schedule
        SET active_sync_run_id=NULL, lease_owner=NULL, lease_expires_at=NULL,
          next_poll_at=now() + interval '5 minutes', failure_count=failure_count + 1,
          last_error='GitHub sync job could not be enqueued', updated_at=now()
        FROM terminal_run
        WHERE schedule.active_sync_run_id=terminal_run.id
      )
      SELECT 1 FROM terminal_run`, [jobId, runId, leaseGeneration]);
    });
  }
  private installation(workspaceId: string, id: string): Promise<GithubSyncInstallationRow | null> { return this.database.queryOne(`SELECT id, workspace_id, github_installation_id, account_login, account_type FROM github_installations WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private repository(workspaceId: string, id: string): Promise<GithubSyncRepositoryContextRow | null> { return this.database.queryOne(`SELECT id, workspace_id, installation_id, github_node_id, owner_login, name, full_name FROM github_repositories WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private project(workspaceId: string, id: string): Promise<GithubSyncProjectV2ContextRow | null> { return this.database.queryOne(`SELECT id, workspace_id, installation_id, github_project_node_id FROM github_projects_v2 WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]); }
  private client(): GithubSqsClient { if (!this.sqs) this.sqs = new SQSClient({ region: this.requireEnv("AWS_REGION"), endpoint: process.env.SQS_ENDPOINT?.trim() || undefined }); return this.sqs; }
  private requireEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw badRequest(`GitHub queue configuration is missing: ${name}`); return value; }
  private errorMessage(error: unknown): string { return (error instanceof Error ? error.message : "GitHub sync failed").slice(0, 1000); }
}
