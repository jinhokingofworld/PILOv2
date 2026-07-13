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
    const config = this.getConfig();
    const client = this.getSqsClient(config);

    try {
      this.logger.log(
        `MeetingReport job event=enqueue_requested report_id=${payload.reportId} meeting_id=${payload.meetingId} recording_id=${payload.recordingId} retry_count=${payload.retryCount}`
      );
      const result = await client.send(
        new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: JSON.stringify(payload)
        })
      );
      this.logger.log(
        `MeetingReport job event=enqueued report_id=${payload.reportId} meeting_id=${payload.meetingId} recording_id=${payload.recordingId} retry_count=${payload.retryCount} sqs_message_id=${result.MessageId ?? "unknown"}`
      );
    } catch {
      this.logger.warn(
        `MeetingReport job event=enqueue_failed report_id=${payload.reportId} meeting_id=${payload.meetingId} recording_id=${payload.recordingId} retry_count=${payload.retryCount}`
      );
      throw badRequest("Meeting report job could not be enqueued");
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
