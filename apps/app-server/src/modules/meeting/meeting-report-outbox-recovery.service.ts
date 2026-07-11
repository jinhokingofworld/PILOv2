import { createHash } from "node:crypto";
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
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;
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
    const recovered = await this.database.transaction(async transaction => {
      const candidates = await transaction.query<{ id: string }>(
        `SELECT report.id
         FROM meeting_reports AS report
         JOIN meeting_report_outbox AS outbox ON outbox.report_id = report.id
         WHERE report.status = 'PROCESSING'
           AND outbox.status = 'delivered'
           AND report.updated_at <= now() - ($1 * INTERVAL '1 second')
         ORDER BY report.updated_at ASC
         LIMIT $2
         FOR UPDATE OF report, outbox SKIP LOCKED`,
        [PROCESSING_STALE_TIMEOUT_SECONDS, BATCH_SIZE]
      );
      let count = 0;
      for (const candidate of candidates) {
        const lockKey = createHash("sha256").update(candidate.id).digest().readBigInt64BE(0);
        const lock = await transaction.queryOne<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock($1::bigint) AS acquired", [lockKey]
        );
        if (!lock?.acquired) continue;
        try {
          const report = await transaction.queryOne<{ id: string }>(
            `UPDATE meeting_reports SET status = 'FAILED', failed_step = 'STT', error_message = 'Meeting report processing timed out', updated_at = now()
             WHERE id = $1 AND status = 'PROCESSING' RETURNING id`, [candidate.id]
          );
          if (report) count += 1;
        } finally {
          await transaction.execute("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
        }
      }
      return count;
    });
    if (recovered) this.logger.warn(`Recovered ${recovered} stale MeetingReport(s)`);
    return recovered;
  }
}
