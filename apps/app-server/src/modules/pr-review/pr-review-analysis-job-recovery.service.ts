import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

const RECOVERY_SWEEP_INTERVAL_MS = 60_000;
const RECOVERY_SWEEP_BATCH_SIZE = 20;
export const PROCESSING_STALE_TIMEOUT_SECONDS = 20 * 60;
export const QUEUED_STALE_TIMEOUT_SECONDS = 60 * 60;

const STALE_FAILURE_CODE = "ANALYSIS_PROVIDER_FAILED";
const STALE_FAILURE_MESSAGE =
  "분석을 완료하지 못했습니다. 잠시 후 새 분석을 시작해주세요.";

interface RecoveredAnalysisJobRow {
  job_id: string;
  review_session_id: string;
}

@Injectable()
export class PrReviewAnalysisJobRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrReviewAnalysisJobRecoveryService.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.sweepInterval = setInterval(() => {
      void this.recoverStaleJobs().catch(() => {
        this.logger.error("PR Review stale analysis recovery sweep failed");
      });
    }, RECOVERY_SWEEP_INTERVAL_MS);

    void this.recoverStaleJobs().catch(() => {
      this.logger.error("Initial PR Review stale analysis recovery sweep failed");
    });
  }

  onModuleDestroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  async recoverStaleJobs(): Promise<number> {
    const recovered = await this.database.query<RecoveredAnalysisJobRow>(
      `
        WITH candidate AS (
          SELECT job.id, job.review_session_id
          FROM pr_review_analysis_jobs AS job
          JOIN pr_review_sessions AS review_session
            ON review_session.id = job.review_session_id
          WHERE review_session.status = 'analyzing'
            AND (
              (
                job.status = 'processing'
                AND job.updated_at <= now() - ($1 * INTERVAL '1 second')
              )
              OR (
                job.status = 'queued'
                AND job.published_at <= now() - ($2 * INTERVAL '1 second')
              )
            )
          ORDER BY job.updated_at ASC
          LIMIT $3
          FOR UPDATE OF job, review_session SKIP LOCKED
        ),
        failed_job AS (
          UPDATE pr_review_analysis_jobs AS job
          SET status = 'failed',
              publish_claim_token = NULL,
              publish_claimed_at = NULL,
              error_code = $4,
              error_message = $5
          FROM candidate
          WHERE job.id = candidate.id
            AND job.status IN ('queued', 'processing')
          RETURNING job.id, job.review_session_id
        )
        UPDATE pr_review_sessions AS review_session
        SET status = 'failed',
            analysis_error_code = $4,
            analysis_error_message = $5
        FROM failed_job
        WHERE review_session.id = failed_job.review_session_id
          AND review_session.status = 'analyzing'
        RETURNING
          failed_job.id AS job_id,
          review_session.id AS review_session_id
      `,
      [
        PROCESSING_STALE_TIMEOUT_SECONDS,
        QUEUED_STALE_TIMEOUT_SECONDS,
        RECOVERY_SWEEP_BATCH_SIZE,
        STALE_FAILURE_CODE,
        STALE_FAILURE_MESSAGE
      ]
    );

    if (recovered.length > 0) {
      this.logger.warn(
        `Recovered ${recovered.length} stale PR Review analysis job(s)`
      );
    }

    return recovered.length;
  }
}
