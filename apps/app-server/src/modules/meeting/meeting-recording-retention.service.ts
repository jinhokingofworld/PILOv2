import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService, DatabaseTransaction } from "../../database/database.service";

const RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 60 * 60 * 1_000;
const CLAIM_TIMEOUT_SECONDS = 15 * 60;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8;
const RETRY_DELAYS_MS = [
  5 * 60 * 1_000,
  15 * 60 * 1_000,
  60 * 60 * 1_000,
  4 * 60 * 60 * 1_000,
  12 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000
];

interface RecordingRetentionConfig {
  awsRegion: string;
  bucket: string;
  endpoint?: string;
}

interface MeetingRecordingPurgeClaim {
  id: string;
  workspace_id: string;
  meeting_id: string;
  recording_id: string;
  audio_file_key: string;
  attempt_count: number | string;
  claim_token: string;
}

type PurgeAttemptResult = "completed" | "blocked" | "s3_failed" | "finalize_failed";

type RecordingRetentionS3Client = Pick<S3Client, "send"> &
  Partial<Pick<S3Client, "destroy">>;

@Injectable()
export class MeetingRecordingRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingRecordingRetentionService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private s3Client: RecordingRetentionS3Client | null = null;
  private s3ClientConfigKey: string | null = null;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;

    this.interval = setInterval(() => void this.purgeDueRecordings().catch(() => {
      this.logger.error("Meeting recording retention sweep failed");
    }), SWEEP_INTERVAL_MS);
    void this.purgeDueRecordings().catch(() => {
      this.logger.error("Initial Meeting recording retention sweep failed");
    });
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.s3Client?.destroy?.();
    this.s3Client = null;
    this.s3ClientConfigKey = null;
  }

  async purgeDueRecordings(): Promise<void> {
    await this.seedDuePurgeJobs();
    const jobs = await this.database.query<{ id: string }>(
      `SELECT id
       FROM meeting_recording_purge_jobs
       WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'processing' AND claimed_at <= now() - ($1 * INTERVAL '1 second'))
       ORDER BY next_attempt_at ASC
       LIMIT $2`,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );

    for (const job of jobs) {
      await this.purgeOne(job.id);
    }
  }

  protected createS3Client(config: RecordingRetentionConfig): RecordingRetentionS3Client {
    return new S3Client({
      region: config.awsRegion,
      endpoint: config.endpoint
    });
  }

  private async seedDuePurgeJobs(): Promise<void> {
    await this.database.execute(
      `INSERT INTO meeting_recording_purge_jobs (
         workspace_id, meeting_id, recording_id, audio_file_key, scheduled_at
       )
       SELECT
         meeting.workspace_id,
         meeting.id,
         recording.id,
         recording.audio_file_key,
         meeting.ended_at + ($1 * INTERVAL '1 day')
       FROM meetings AS meeting
       JOIN meeting_recordings AS recording ON recording.meeting_id = meeting.id
       WHERE meeting.ended_at <= now() - ($1 * INTERVAL '1 day')
         AND recording.status = 'COMPLETED'
         AND recording.audio_file_key IS NOT NULL
         AND recording.audio_deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM meeting_reports AS report
           WHERE report.recording_id = recording.id
             AND report.status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM meeting_report_outbox AS outbox
           WHERE outbox.recording_id = recording.id
             AND outbox.status IN ('pending', 'publishing')
         )
       ON CONFLICT (recording_id) DO NOTHING`,
      [RETENTION_DAYS]
    );
  }

  private async purgeOne(id: string): Promise<void> {
    const claim = await this.claim(id);
    if (!claim) return;

    this.logger.log(
      `Meeting recording retention event=claimed purge_job_id=${claim.id} workspace_id=${claim.workspace_id} meeting_id=${claim.meeting_id} recording_id=${claim.recording_id} attempt_count=${claim.attempt_count}`
    );

    try {
      const result = await this.database.transaction(async transaction => {
        const recording = await transaction.queryOne<{
          id: string;
          audio_file_key: string | null;
          audio_deleted_at: Date | string | null;
        }>(
          `SELECT id, audio_file_key, audio_deleted_at
           FROM meeting_recordings
           WHERE id = $1
             AND status = 'COMPLETED'
           FOR UPDATE`,
          [claim.recording_id]
        );
        if (!recording) return "finalize_failed" as const;

        if (recording.audio_file_key === null && recording.audio_deleted_at !== null) {
          return await this.completePurgeJob(transaction, claim)
            ? "completed" as const
            : "finalize_failed" as const;
        }
        if (recording.audio_file_key !== claim.audio_file_key) return "finalize_failed" as const;

        const activeReport = await transaction.queryOne<{ id: string }>(
          `SELECT id
           FROM meeting_reports
           WHERE recording_id = $1
             AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
           LIMIT 1`,
          [claim.recording_id]
        );
        const activeOutbox = await transaction.queryOne<{ id: string }>(
          `SELECT id
           FROM meeting_report_outbox
           WHERE recording_id = $1
             AND status IN ('pending', 'publishing')
           LIMIT 1`,
          [claim.recording_id]
        );
        if (activeReport || activeOutbox) return "blocked" as const;

        try {
          const config = this.getConfig();
          await this.getS3Client(config).send(
            new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: claim.audio_file_key
            })
          );
        } catch {
          return "s3_failed" as const;
        }

        const deleted = await transaction.queryOne<{ id: string }>(
          `UPDATE meeting_recordings
           SET audio_file_key = NULL,
               audio_file_url = NULL,
               audio_deleted_at = COALESCE(audio_deleted_at, now()),
               updated_at = now()
           WHERE id = $1
             AND audio_file_key = $2
           RETURNING id`,
          [claim.recording_id, claim.audio_file_key]
        );
        if (!deleted) return "finalize_failed" as const;

        return await this.completePurgeJob(transaction, claim)
          ? "completed" as const
          : "finalize_failed" as const;
      });

      if (result === "completed") {
        this.logger.log(
          `Meeting recording retention event=completed purge_job_id=${claim.id} workspace_id=${claim.workspace_id} meeting_id=${claim.meeting_id} recording_id=${claim.recording_id} attempt_count=${claim.attempt_count}`
        );
        return;
      }
      if (result === "blocked") {
        await this.deferForActiveReport(claim);
        return;
      }
      if (result === "s3_failed") {
        await this.failOrRetry(claim, "S3_DELETE_FAILED", "Meeting recording audio delete failed");
        return;
      }
    } catch {
      await this.failOrRetry(
        claim,
        "RETENTION_FINALIZE_FAILED",
        "Meeting recording audio delete could not be finalized"
      );
      return;
    }

    await this.failOrRetry(
      claim,
      "RETENTION_FINALIZE_FAILED",
      "Meeting recording audio delete could not be finalized"
    );
  }

  private async completePurgeJob(
    transaction: DatabaseTransaction,
    claim: MeetingRecordingPurgeClaim
  ): Promise<boolean> {
    const job = await transaction.queryOne<{ id: string }>(
      `UPDATE meeting_recording_purge_jobs
       SET status = 'completed',
           claim_token = NULL,
           claimed_at = NULL,
           deleted_at = now(),
           error_code = NULL,
           error_message = NULL
       WHERE id = $1
         AND status = 'processing'
         AND claim_token = $2
       RETURNING id`,
      [claim.id, claim.claim_token]
    );
    return Boolean(job);
  }

  private async deferForActiveReport(claim: MeetingRecordingPurgeClaim): Promise<void> {
    const result = await this.database.execute(
      `UPDATE meeting_recording_purge_jobs
       SET status = 'pending',
           next_attempt_at = now() + INTERVAL '1 hour',
           claim_token = NULL,
           claimed_at = NULL,
           error_code = 'RETENTION_BLOCKED_BY_ACTIVE_REPORT',
           error_message = 'Meeting recording audio is referenced by active report processing'
       WHERE id = $1 AND status = 'processing' AND claim_token = $2`,
      [claim.id, claim.claim_token]
    );
    if (!result.rowCount) return;

    this.logger.log(
      `Meeting recording retention event=deferred_active_report purge_job_id=${claim.id} workspace_id=${claim.workspace_id} meeting_id=${claim.meeting_id} recording_id=${claim.recording_id} attempt_count=${claim.attempt_count}`
    );
  }

  private async claim(id: string): Promise<MeetingRecordingPurgeClaim | null> {
    const claimToken = randomUUID();
    return this.database.transaction(transaction => transaction.queryOne<MeetingRecordingPurgeClaim>(
      `WITH candidate AS (
         SELECT id
         FROM meeting_recording_purge_jobs
         WHERE id = $1
           AND (
             (status = 'pending' AND next_attempt_at <= now())
             OR (status = 'processing' AND claimed_at <= now() - ($2 * INTERVAL '1 second'))
           )
         FOR UPDATE SKIP LOCKED
       )
       UPDATE meeting_recording_purge_jobs AS job
       SET status = 'processing',
           attempt_count = job.attempt_count + 1,
           claim_token = $3,
           claimed_at = now(),
           error_code = NULL,
           error_message = NULL
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.id, job.workspace_id, job.meeting_id, job.recording_id,
                 job.audio_file_key, job.attempt_count, job.claim_token`,
      [id, CLAIM_TIMEOUT_SECONDS, claimToken]
    ));
  }

  private async failOrRetry(
    claim: MeetingRecordingPurgeClaim,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    const attempts = Number(claim.attempt_count);
    const terminal = attempts >= MAX_ATTEMPTS;
    const result = await this.database.execute(
      terminal
        ? `UPDATE meeting_recording_purge_jobs
           SET status = 'failed',
               claim_token = NULL,
               claimed_at = NULL,
               error_code = $3,
               error_message = $4
           WHERE id = $1 AND status = 'processing' AND claim_token = $2`
        : `UPDATE meeting_recording_purge_jobs
           SET status = 'pending',
               next_attempt_at = $3,
               claim_token = NULL,
               claimed_at = NULL,
               error_code = $4,
               error_message = $5
           WHERE id = $1 AND status = 'processing' AND claim_token = $2`,
      terminal
        ? [claim.id, claim.claim_token, errorCode, errorMessage]
        : [
            claim.id,
            claim.claim_token,
            new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]),
            errorCode,
            errorMessage
          ]
    );
    if (!result.rowCount) return;

    this.logger.warn(
      `Meeting recording retention event=${terminal ? "retry_exhausted" : "retry_scheduled"} purge_job_id=${claim.id} workspace_id=${claim.workspace_id} meeting_id=${claim.meeting_id} recording_id=${claim.recording_id} attempt_count=${attempts} error_code=${errorCode}`
    );
  }

  private getS3Client(config: RecordingRetentionConfig): RecordingRetentionS3Client {
    const configKey = `${config.awsRegion}\n${config.bucket}\n${config.endpoint ?? ""}`;
    if (this.s3Client === null || this.s3ClientConfigKey !== configKey) {
      this.s3Client?.destroy?.();
      this.s3Client = this.createS3Client(config);
      this.s3ClientConfigKey = configKey;
    }
    return this.s3Client;
  }

  private getConfig(): RecordingRetentionConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION),
      bucket: this.requireConfig(process.env.S3_UPLOADS_BUCKET),
      endpoint: this.optionalConfig(process.env.S3_ENDPOINT)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Meeting recording retention storage is not configured");
    }
    return value.trim();
  }

  private optionalConfig(value: string | undefined): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;
    return value.trim();
  }
}
