import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

const SWEEP_INTERVAL_MS = 60_000;
const PROCESSING_STALE_TIMEOUT_SECONDS = 20 * 60;
const BATCH_SIZE = 20;

@Injectable()
export class MeetingReportOutboxRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingReportOutboxRecoveryService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.interval = setInterval(() => void this.recoverStaleReports().catch(() => {
      this.logger.error("MeetingReport stale recovery sweep failed");
    }), SWEEP_INTERVAL_MS);
    void this.recoverStaleReports().catch(() => this.logger.error("Initial MeetingReport stale recovery sweep failed"));
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async recoverStaleReports(): Promise<number> {
    const rows = await this.database.query<{ id: string }>(
      `WITH candidate AS (
         SELECT report.id
         FROM meeting_reports AS report
         JOIN meeting_report_outbox AS outbox ON outbox.report_id = report.id
         WHERE report.status = 'PROCESSING'
           AND outbox.status = 'delivered'
           AND report.updated_at <= now() - ($1 * INTERVAL '1 second')
         ORDER BY report.updated_at ASC
         LIMIT $2
         FOR UPDATE OF report, outbox SKIP LOCKED
       )
       UPDATE meeting_reports AS report
       SET status = 'FAILED', failed_step = 'STT', error_message = 'Meeting report processing timed out', updated_at = now()
       FROM candidate
       WHERE report.id = candidate.id
         AND report.status = 'PROCESSING'
       RETURNING report.id`,
      [PROCESSING_STALE_TIMEOUT_SECONDS, BATCH_SIZE]
    );
    if (rows.length) this.logger.warn(`Recovered ${rows.length} stale MeetingReport(s)`);
    return rows.length;
  }
}
