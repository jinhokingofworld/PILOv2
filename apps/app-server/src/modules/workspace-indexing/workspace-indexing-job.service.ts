import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, OnModuleDestroy } from "@nestjs/common";

export type WorkspaceIndexingSource = "calendar" | "document";

export interface WorkspaceIndexingJobPayload {
  version: 1;
  source: WorkspaceIndexingSource;
  jobId: string;
}

interface WorkspaceIndexingQueueConfig {
  awsRegion: string;
  endpoint?: string;
  queueUrl: string;
}

@Injectable()
export class WorkspaceIndexingJobService implements OnModuleDestroy {
  private sqs: SQSClient | null = null;

  async enqueue(payload: WorkspaceIndexingJobPayload): Promise<void> {
    const config = this.getConfig();
    await this.getClient(config).send(
      new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: JSON.stringify(payload)
      })
    );
  }

  onModuleDestroy(): void {
    this.sqs?.destroy();
    this.sqs = null;
  }

  private getClient(config: WorkspaceIndexingQueueConfig): SQSClient {
    if (!this.sqs) {
      this.sqs = new SQSClient({
        region: config.awsRegion,
        endpoint: config.endpoint
      });
    }
    return this.sqs;
  }

  private getConfig(): WorkspaceIndexingQueueConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION, "AWS_REGION"),
      queueUrl: this.requireConfig(
        process.env.SQS_WORKSPACE_INDEXING_QUEUE_URL,
        "SQS_WORKSPACE_INDEXING_QUEUE_URL"
      ),
      endpoint: this.optionalConfig(process.env.SQS_ENDPOINT)
    };
  }

  private optionalConfig(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private requireConfig(value: string | undefined, name: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error(`${name} is required for workspace indexing jobs`);
    }
    return trimmed;
  }
}
