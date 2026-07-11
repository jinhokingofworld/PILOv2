import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { MeetingReportJobPayload, MeetingReportJobService } from "./meeting-report-job.service";

const SWEEP_INTERVAL_MS = 60_000;
const CLAIM_TIMEOUT_SECONDS = 60;
const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];

interface Claim {
  id: string;
  report_id: string;
  meeting_id: string;
  recording_id: string;
  audio_file_key: string;
  attempt_count: number | string;
  claim_token: string;
}

@Injectable()
export class MeetingReportOutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingReportOutboxPublisherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly meetingReportJobService: MeetingReportJobService
  ) {}

  onModuleInit(): void {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;
    this.interval = setInterval(() => void this.publishDue().catch(() => {
      this.logger.error("MeetingReport outbox recovery sweep failed");
    }), SWEEP_INTERVAL_MS);
    void this.publishDue().catch(() => this.logger.error("Initial MeetingReport outbox sweep failed"));
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async publishDue(): Promise<void> {
    const rows = await this.database.query<{ id: string }>(
      `SELECT id FROM meeting_report_outbox
       WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'publishing' AND claimed_at <= now() - ($1 * INTERVAL '1 second'))
       ORDER BY next_attempt_at ASC LIMIT $2`,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );
    for (const row of rows) await this.publishOne(row.id);
  }

  private async publishOne(id: string): Promise<void> {
    const claim = await this.claim(id);
    if (!claim) return;
    try {
      const payload: MeetingReportJobPayload = {
        jobType: "meeting_report", reportId: claim.report_id, meetingId: claim.meeting_id,
        recordingId: claim.recording_id, audioFileKey: claim.audio_file_key, retryCount: 0
      };
      await this.meetingReportJobService.enqueueMeetingReportJob(payload);
      await this.database.execute(
        `UPDATE meeting_report_outbox SET status = 'delivered', delivered_at = now(), claim_token = NULL, claimed_at = NULL, error_code = NULL, error_message = NULL
         WHERE id = $1 AND status = 'publishing' AND claim_token = $2`, [claim.id, claim.claim_token]
      );
    } catch {
      await this.failOrRetry(claim);
    }
  }

  private async claim(id: string): Promise<Claim | null> {
    const token = randomUUID();
    return this.database.transaction(transaction => transaction.queryOne<Claim>(
      `WITH candidate AS (
         SELECT id FROM meeting_report_outbox
         WHERE id = $1 AND ((status = 'pending' AND next_attempt_at <= now()) OR (status = 'publishing' AND claimed_at <= now() - ($2 * INTERVAL '1 second')))
         FOR UPDATE SKIP LOCKED
       )
       UPDATE meeting_report_outbox AS outbox SET status = 'publishing', attempt_count = outbox.attempt_count + 1, claim_token = $3, claimed_at = now()
       FROM candidate WHERE outbox.id = candidate.id
       RETURNING outbox.id, outbox.report_id, outbox.meeting_id, outbox.recording_id, outbox.audio_file_key, outbox.attempt_count, outbox.claim_token`,
      [id, CLAIM_TIMEOUT_SECONDS, token]
    ));
  }

  private async failOrRetry(claim: Claim): Promise<void> {
    const attempts = Number(claim.attempt_count);
    if (attempts <= MAX_RETRIES) {
      await this.database.execute(
        `UPDATE meeting_report_outbox SET status = 'pending', next_attempt_at = $2, claim_token = NULL, claimed_at = NULL, error_code = 'MEETING_REPORT_ENQUEUE_FAILED', error_message = 'Meeting report job could not be enqueued'
         WHERE id = $1 AND status = 'publishing' AND claim_token = $3`,
        [claim.id, new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]), claim.claim_token]
      );
      return;
    }
    await this.database.transaction(async transaction => {
      const outbox = await transaction.queryOne<{ report_id: string }>(
        `UPDATE meeting_report_outbox SET status = 'failed', claim_token = NULL, claimed_at = NULL, error_code = 'MEETING_REPORT_ENQUEUE_FAILED', error_message = 'Meeting report job could not be enqueued'
         WHERE id = $1 AND status = 'publishing' AND claim_token = $2 RETURNING report_id`, [claim.id, claim.claim_token]);
      if (!outbox) return;
      await transaction.execute(
        `UPDATE meeting_reports SET status = 'FAILED', failed_step = 'STT', error_message = 'Meeting report job could not be enqueued', updated_at = now()
         WHERE id = $1 AND status = 'PROCESSING'`, [outbox.report_id]);
    });
  }
}
