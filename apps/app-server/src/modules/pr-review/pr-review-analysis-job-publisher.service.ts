import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import {
  PR_REVIEW_ANALYSIS_JOB_TYPE,
  PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
  PrReviewAnalysisJobService
} from "./pr-review-analysis-job.service";

const PUBLISH_SWEEP_INTERVAL_MS = 60_000;
const PUBLISH_CLAIM_TIMEOUT_SECONDS = 60;
const PUBLISH_SWEEP_BATCH_SIZE = 20;
const PUBLISH_MAX_RETRIES = 5;
const PUBLISH_RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];
const PUBLISH_FAILURE_CODE = "ANALYSIS_ENQUEUE_FAILED";
const PUBLISH_FAILURE_MESSAGE = "분석 작업을 시작하지 못했습니다. 새 분석을 시작해주세요.";

interface PrReviewAnalysisJobClaimRow extends QueryResultRow {
  id: string;
  review_session_id: string;
  workspace_id: string;
  head_sha: string;
  publish_attempt_count: number | string;
  publish_claim_token: string;
}

@Injectable()
export class PrReviewAnalysisJobPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrReviewAnalysisJobPublisherService.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly analysisJobService: PrReviewAnalysisJobService
  ) {}

  onModuleInit(): void {
    this.sweepInterval = setInterval(() => {
      void this.publishDueJobs().catch((error: unknown) => {
        this.logger.error("PR Review analysis publish recovery sweep failed", error);
      });
    }, PUBLISH_SWEEP_INTERVAL_MS);

    void this.publishDueJobs().catch((error: unknown) => {
      this.logger.error("Initial PR Review analysis publish recovery sweep failed", error);
    });
  }

  onModuleDestroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  async publishCreatedJob(jobId: string): Promise<void> {
    try {
      await this.publishOne(jobId);
    } catch (error: unknown) {
      this.logger.error(`Immediate PR Review analysis publish failed job_id=${jobId}`, error);
    }
  }

  async publishDueJobs(): Promise<void> {
    const rows = await this.database.query<{ id: string }>(
      `
        SELECT job.id
        FROM pr_review_analysis_jobs AS job
        JOIN pr_review_sessions AS review_session
          ON review_session.id = job.review_session_id
        WHERE review_session.status = 'analyzing'
          AND (
            (job.status = 'pending' AND job.next_publish_attempt_at <= now())
            OR (
              job.status = 'publishing'
              AND job.publish_claimed_at <= now() - ($1 * INTERVAL '1 second')
            )
          )
        ORDER BY job.next_publish_attempt_at ASC
        LIMIT $2
      `,
      [PUBLISH_CLAIM_TIMEOUT_SECONDS, PUBLISH_SWEEP_BATCH_SIZE]
    );

    for (const row of rows) {
      await this.publishOne(row.id);
    }
  }

  private async publishOne(jobId: string): Promise<void> {
    const claim = await this.claimDueJob(jobId);
    if (!claim) {
      return;
    }

    try {
      await this.analysisJobService.enqueueAnalysisRequestedJob({
        jobType: PR_REVIEW_ANALYSIS_JOB_TYPE,
        schemaVersion: PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
        jobId: claim.id,
        reviewSessionId: claim.review_session_id,
        workspaceId: claim.workspace_id,
        headSha: claim.head_sha
      });
      await this.markQueued(claim);
      this.logger.log(
        `PR Review analysis published job_id=${claim.id} session_id=${claim.review_session_id}`
      );
    } catch (error: unknown) {
      this.logger.error(
        `PR Review analysis publish enqueue failed job_id=${claim.id} session_id=${claim.review_session_id}`,
        error
      );
      await this.markPublishFailure(claim);
    }
  }

  private async claimDueJob(
    jobId: string
  ): Promise<PrReviewAnalysisJobClaimRow | null> {
    const claimToken = randomUUID();

    return this.database.transaction(async (transaction) =>
      transaction.queryOne<PrReviewAnalysisJobClaimRow>(
        `
          WITH candidate AS (
            SELECT job.id
            FROM pr_review_analysis_jobs AS job
            JOIN pr_review_sessions AS review_session
              ON review_session.id = job.review_session_id
            WHERE job.id = $1
              AND review_session.status = 'analyzing'
              AND (
                (job.status = 'pending' AND job.next_publish_attempt_at <= now())
                OR (
                  job.status = 'publishing'
                  AND job.publish_claimed_at <= now() - ($2 * INTERVAL '1 second')
                )
              )
            FOR UPDATE OF job SKIP LOCKED
          )
          UPDATE pr_review_analysis_jobs AS job
          SET status = 'publishing',
              publish_attempt_count = job.publish_attempt_count + 1,
              publish_claim_token = $3,
              publish_claimed_at = now()
          FROM candidate
          WHERE job.id = candidate.id
          RETURNING
            job.id,
            job.review_session_id,
            job.workspace_id,
            job.head_sha,
            job.publish_attempt_count,
            job.publish_claim_token
        `,
        [jobId, PUBLISH_CLAIM_TIMEOUT_SECONDS, claimToken]
      )
    );
  }

  private async markQueued(claim: PrReviewAnalysisJobClaimRow): Promise<void> {
    await this.database.execute(
      `
        UPDATE pr_review_analysis_jobs
        SET status = 'queued',
            published_at = now(),
            publish_claim_token = NULL,
            publish_claimed_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = $1
          AND status = 'publishing'
          AND publish_claim_token = $2
      `,
      [claim.id, claim.publish_claim_token]
    );
  }

  private async markPublishFailure(
    claim: PrReviewAnalysisJobClaimRow
  ): Promise<void> {
    const attemptCount = Number(claim.publish_attempt_count);

    if (attemptCount <= PUBLISH_MAX_RETRIES) {
      const retryDelayMs = PUBLISH_RETRY_DELAYS_MS[attemptCount - 1];
      await this.database.execute(
        `
          UPDATE pr_review_analysis_jobs
          SET status = 'pending',
              next_publish_attempt_at = $2,
              publish_claim_token = NULL,
              publish_claimed_at = NULL,
              error_code = $3,
              error_message = $4
          WHERE id = $1
            AND status = 'publishing'
            AND publish_claim_token = $5
        `,
        [
          claim.id,
          new Date(Date.now() + retryDelayMs),
          PUBLISH_FAILURE_CODE,
          PUBLISH_FAILURE_MESSAGE,
          claim.publish_claim_token
        ]
      );
      this.logger.warn(
        `PR Review analysis publish retry scheduled job_id=${claim.id} session_id=${claim.review_session_id} attempt=${attemptCount}`
      );
      return;
    }

    const failed = await this.database.transaction(async (transaction) => {
      const job = await transaction.queryOne<{
        review_session_id: string;
      }>(
        `
          UPDATE pr_review_analysis_jobs
          SET status = 'failed',
              publish_claim_token = NULL,
              publish_claimed_at = NULL,
              error_code = $2,
              error_message = $3
          WHERE id = $1
            AND status = 'publishing'
            AND publish_claim_token = $4
          RETURNING review_session_id
        `,
        [
          claim.id,
          PUBLISH_FAILURE_CODE,
          PUBLISH_FAILURE_MESSAGE,
          claim.publish_claim_token
        ]
      );

      if (!job) {
        return false;
      }

      await transaction.execute(
        `
          UPDATE pr_review_sessions
          SET status = 'failed',
              analysis_error_code = $2,
              analysis_error_message = $3
          WHERE id = $1
            AND status = 'analyzing'
        `,
        [job.review_session_id, PUBLISH_FAILURE_CODE, PUBLISH_FAILURE_MESSAGE]
      );

      return true;
    });

    if (failed) {
      this.logger.warn(
        `PR Review analysis publish retries exhausted job_id=${claim.id} session_id=${claim.review_session_id}`
      );
    }
  }
}
