import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, OnModuleDestroy } from "@nestjs/common";

export const PR_REVIEW_ANALYSIS_JOB_TYPE = "pr_review_analysis_requested";
export const PR_REVIEW_ANALYSIS_SCHEMA_VERSION = "pr-review-analysis:v1";

export interface PrReviewAnalysisRequestedJobPayload {
  jobType: typeof PR_REVIEW_ANALYSIS_JOB_TYPE;
  schemaVersion: typeof PR_REVIEW_ANALYSIS_SCHEMA_VERSION;
  jobId: string;
  reviewSessionId: string;
  workspaceId: string;
  headSha: string;
}

interface PrReviewAnalysisJobConfig {
  awsRegion: string;
  queueUrl: string;
  endpoint?: string;
}

type PrReviewAnalysisSqsClient = Pick<SQSClient, "send"> &
  Partial<Pick<SQSClient, "destroy">>;

@Injectable()
export class PrReviewAnalysisJobService implements OnModuleDestroy {
  private sqsClient: PrReviewAnalysisSqsClient | null = null;
  private sqsClientConfigKey: string | null = null;

  async enqueueAnalysisRequestedJob(
    payload: PrReviewAnalysisRequestedJobPayload
  ): Promise<void> {
    const config = this.getConfig();

    await this.getSqsClient(config).send(
      new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: JSON.stringify(payload)
      })
    );
  }

  onModuleDestroy(): void {
    this.sqsClient?.destroy?.();
    this.sqsClient = null;
    this.sqsClientConfigKey = null;
  }

  protected createSqsClient(
    config: PrReviewAnalysisJobConfig
  ): PrReviewAnalysisSqsClient {
    return new SQSClient({
      region: config.awsRegion,
      endpoint: config.endpoint
    });
  }

  private getSqsClient(
    config: PrReviewAnalysisJobConfig
  ): PrReviewAnalysisSqsClient {
    const configKey = `${config.awsRegion}\n${config.endpoint ?? ""}`;

    if (this.sqsClient === null || this.sqsClientConfigKey !== configKey) {
      this.sqsClient?.destroy?.();
      this.sqsClient = this.createSqsClient(config);
      this.sqsClientConfigKey = configKey;
    }

    return this.sqsClient;
  }

  private getConfig(): PrReviewAnalysisJobConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION, "AWS_REGION"),
      queueUrl: this.requireConfig(
        process.env.SQS_PR_REVIEW_ANALYSIS_QUEUE_URL,
        "SQS_PR_REVIEW_ANALYSIS_QUEUE_URL"
      ),
      endpoint: this.optionalConfig(process.env.SQS_ENDPOINT)
    };
  }

  private requireConfig(value: string | undefined, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${name} is not configured`);
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
