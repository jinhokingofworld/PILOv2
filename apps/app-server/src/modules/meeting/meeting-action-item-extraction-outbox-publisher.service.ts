import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { MeetingReportJobService } from "./meeting-report-job.service";
import { MeetingReportRealtimePublisherService } from "./meeting-report-realtime-publisher.service";

const SWEEP_INTERVAL_MS = 60_000;
const CLAIM_TIMEOUT_SECONDS = 60;
const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];

type Claim = {
  id: string;
  meeting_report_id: string;
  attempt_count: number | string;
  claim_token: string;
};

@Injectable()
export class MeetingActionItemExtractionOutboxPublisherService
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingActionItemExtractionOutboxPublisherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly meetingReportJobService: MeetingReportJobService,
    private readonly meetingReportRealtimePublisher?: MeetingReportRealtimePublisherService
  ) {}

  onModuleInit(): void {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;
    this.interval = setInterval(() => void this.publishDue().catch(() => {
      this.logger.error("Meeting action item extraction outbox recovery sweep failed");
    }), SWEEP_INTERVAL_MS);
    void this.publishDue().catch(() => {
      this.logger.error("Initial Meeting action item extraction outbox sweep failed");
    });
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async publishDue(): Promise<void> {
    const rows = await this.database.query<{ id: string }>(
      `SELECT id FROM meeting_report_action_item_extractions
       WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'publishing' AND claimed_at <= now() - ($1 * INTERVAL '1 second'))
       ORDER BY next_attempt_at ASC
       LIMIT $2`,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );
    for (const row of rows) await this.publishOne(row.id);
  }

  private async publishOne(id: string): Promise<void> {
    const claim = await this.claim(id);
    if (!claim) return;
    try {
      await this.meetingReportJobService.enqueueMeetingActionItemExtractionJob({
        jobType: "meeting_action_item_extraction",
        reportId: claim.meeting_report_id
      });
      await this.database.execute(
        `UPDATE meeting_report_action_item_extractions
         SET status = 'queued', delivered_at = now(), claim_token = NULL, claimed_at = NULL,
             failure_code = NULL, failure_detail = NULL, updated_at = now()
         WHERE id = $1 AND status = 'publishing' AND claim_token = $2`,
        [claim.id, claim.claim_token]
      );
    } catch {
      await this.failOrRetry(claim);
    }
  }

  private async claim(id: string): Promise<Claim | null> {
    const claimToken = randomUUID();
    return this.database.transaction(transaction => transaction.queryOne<Claim>(
      `WITH candidate AS (
         SELECT id FROM meeting_report_action_item_extractions
         WHERE id = $1
           AND (
             (status = 'pending' AND next_attempt_at <= now())
             OR (status = 'publishing' AND claimed_at <= now() - ($2 * INTERVAL '1 second'))
           )
         FOR UPDATE SKIP LOCKED
       )
       UPDATE meeting_report_action_item_extractions AS extraction
       SET status = 'publishing', attempt_count = extraction.attempt_count + 1,
           claim_token = $3, claimed_at = now(), updated_at = now()
       FROM candidate
       WHERE extraction.id = candidate.id
       RETURNING extraction.id, extraction.meeting_report_id, extraction.attempt_count, extraction.claim_token`,
      [id, CLAIM_TIMEOUT_SECONDS, claimToken]
    ));
  }

  private async failOrRetry(claim: Claim): Promise<void> {
    const attempts = Number(claim.attempt_count);
    if (attempts <= MAX_RETRIES) {
      await this.database.execute(
        `UPDATE meeting_report_action_item_extractions
         SET status = 'pending', next_attempt_at = $2, claim_token = NULL, claimed_at = NULL,
             failure_code = 'ACTION_ITEM_EXTRACTION_ENQUEUE_FAILED',
             failure_detail = '{"category":"queue_delivery","retryable":true,"providerStatusCode":null}'::jsonb,
             updated_at = now()
         WHERE id = $1 AND status = 'publishing' AND claim_token = $3`,
        [claim.id, new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]), claim.claim_token]
      );
      return;
    }
    const failed = await this.database.execute(
      `UPDATE meeting_report_action_item_extractions
       SET status = 'failed', completed_at = now(), claim_token = NULL, claimed_at = NULL,
           failure_code = 'ACTION_ITEM_EXTRACTION_ENQUEUE_FAILED',
           failure_detail = '{"category":"queue_delivery","retryable":false,"providerStatusCode":null}'::jsonb,
           updated_at = now()
       WHERE id = $1 AND status = 'publishing' AND claim_token = $2`,
      [claim.id, claim.claim_token]
    );
    if (failed.rowCount) {
      await this.meetingReportRealtimePublisher?.publishReportUpdatedSafely(
        claim.meeting_report_id
      );
    }
  }
}
