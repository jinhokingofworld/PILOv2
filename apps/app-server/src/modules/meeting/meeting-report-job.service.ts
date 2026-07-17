import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface MeetingReportJobPayload {
  jobType: "meeting_report";
  reportId: string;
  meetingId: string;
  recordingId: string;
  audioFileKey: string;
  retryCount: number;
}

export interface MeetingActionItemExtractionJobPayload {
  jobType: "meeting_action_item_extraction";
  reportId: string;
}

interface MeetingReportJobConfig {
  awsRegion: string;
  queueUrl: string;
  endpoint?: string;
}

type MeetingReportSqsClient = Pick<SQSClient, "send"> &
  Partial<Pick<SQSClient, "destroy">>;

@Injectable()
export class MeetingReportJobService implements OnModuleDestroy {
  private readonly logger = new Logger(MeetingReportJobService.name);
  private sqsClient: MeetingReportSqsClient | null = null;
  private sqsClientConfigKey: string | null = null;

  async enqueueMeetingReportJob(payload: MeetingReportJobPayload): Promise<void> {
    await this.enqueueJob(payload);
  }

  async enqueueMeetingActionItemExtractionJob(
    payload: MeetingActionItemExtractionJobPayload
  ): Promise<void> {
    await this.enqueueJob(payload);
  }

  private async enqueueJob(
    payload: MeetingReportJobPayload | MeetingActionItemExtractionJobPayload
  ): Promise<void> {
    const config = this.getConfig();
    const client = this.getSqsClient(config);

    try {
      this.logger.log(`Meeting job event=enqueue_requested job_type=${payload.jobType} report_id=${payload.reportId}`);
      const result = await client.send(
        new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: JSON.stringify(payload)
        })
      );
      this.logger.log(`Meeting job event=enqueued job_type=${payload.jobType} report_id=${payload.reportId} sqs_message_id=${result.MessageId ?? "unknown"}`);
    } catch {
      this.logger.warn(`Meeting job event=enqueue_failed job_type=${payload.jobType} report_id=${payload.reportId}`);
      throw badRequest(
        payload.jobType === "meeting_report"
          ? "Meeting report job could not be enqueued"
          : "Meeting action item extraction job could not be enqueued"
      );
    }
  }

  onModuleDestroy(): void {
    this.sqsClient?.destroy?.();
    this.sqsClient = null;
    this.sqsClientConfigKey = null;
  }

  protected createSqsClient(config: MeetingReportJobConfig): MeetingReportSqsClient {
    return new SQSClient({
      region: config.awsRegion,
      endpoint: config.endpoint
    });
  }

  private getSqsClient(config: MeetingReportJobConfig): MeetingReportSqsClient {
    const configKey = `${config.awsRegion}\n${config.endpoint ?? ""}`;

    if (this.sqsClient === null || this.sqsClientConfigKey !== configKey) {
      this.sqsClient?.destroy?.();
      this.sqsClient = this.createSqsClient(config);
      this.sqsClientConfigKey = configKey;
    }

    return this.sqsClient;
  }

  private getConfig(): MeetingReportJobConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION),
      queueUrl: this.requireConfig(process.env.SQS_MEETING_JOBS_QUEUE_URL),
      endpoint: this.optionalConfig(process.env.SQS_ENDPOINT)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest("Meeting report job queue is not configured");
    }

    return value.trim();
  }

  private optionalConfig(value: string | undefined): string | undefined {
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }

    return value.trim();
  }
}
