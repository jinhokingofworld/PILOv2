import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { DatabaseService } from "../../database/database.service";

export const MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events";
export type MeetingReportRealtimeStatus =
  | "PROCESSING"
  | "QUEUED"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "COMPLETED"
  | "FAILED";

@Injectable()
export class MeetingReportRealtimePublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(MeetingReportRealtimePublisherService.name);
  private client: RedisClientType | null = null;

  constructor(private readonly database: DatabaseService) {}

  async publishReportUpdated(reportId: string): Promise<void> {
    const report = await this.database.queryOne<{
      id: string; workspace_id: string; meeting_id: string; recording_id: string;
      status: MeetingReportRealtimeStatus;
      failed_step: string | null;
      updated_at: Date | string;
    }>(
      `SELECT report.id, meeting.workspace_id, report.meeting_id, report.recording_id, report.status, report.failed_step, report.updated_at
       FROM meeting_reports report
       JOIN meetings meeting ON meeting.id = report.meeting_id
       WHERE report.id = $1`,
      [reportId]
    );
    if (!report) return;
    const client = await this.getClient();
    if (!client) return;
    await client.publish(
      MEETING_REPORT_REDIS_CHANNEL,
      JSON.stringify({
        event: "meeting:report:updated",
        workspaceId: report.workspace_id,
        reportId: report.id,
        meetingId: report.meeting_id,
        recordingId: report.recording_id,
        status: report.status,
        failedStep: report.failed_step,
        updatedAt: new Date(report.updated_at).toISOString()
      })
    );
  }

  async publishReportUpdatedSafely(reportId: string): Promise<void> {
    try {
      await this.publishReportUpdated(reportId);
    } catch {
      this.logger.warn(`MeetingReport realtime publish failed report_id=${reportId}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.client) return this.client;
    const client = createClient({ url });
    client.on("error", error => this.logger.error("MeetingReport Redis publish failed", error));
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
