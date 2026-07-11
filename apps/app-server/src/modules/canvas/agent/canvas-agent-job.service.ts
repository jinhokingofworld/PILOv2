import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { canvasAgentJobUnavailable } from "./canvas-agent.error";

export const CANVAS_AGENT_JOB_TYPE = "canvas_agent_step_requested";
export const CANVAS_AGENT_SCHEMA_VERSION = "canvas-agent:v1";

export interface CanvasAgentStepRequestedJob {
  jobType: typeof CANVAS_AGENT_JOB_TYPE;
  runId: string;
  workspaceId: string;
  canvasId: string;
  requestedByUserId: string;
  schemaVersion: typeof CANVAS_AGENT_SCHEMA_VERSION;
}

type CanvasAgentJobConfig = { awsRegion: string; endpoint?: string; queueUrl: string };
type CanvasAgentSqsClient = Pick<SQSClient, "send"> & Partial<Pick<SQSClient, "destroy">>;

@Injectable()
export class CanvasAgentJobService implements OnModuleDestroy {
  private client: CanvasAgentSqsClient | null = null;
  private clientKey: string | null = null;

  async enqueueStepRequestedJob(payload: CanvasAgentStepRequestedJob): Promise<void> {
    const config = this.getConfig();
    try {
      await this.getClient(config).send(new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: JSON.stringify(payload)
      }));
    } catch {
      throw canvasAgentJobUnavailable("Canvas AI job could not be enqueued");
    }
  }

  onModuleDestroy(): void {
    this.client?.destroy?.();
    this.client = null;
    this.clientKey = null;
  }

  protected createClient(config: CanvasAgentJobConfig): CanvasAgentSqsClient {
    return new SQSClient({ region: config.awsRegion, endpoint: config.endpoint });
  }

  private getClient(config: CanvasAgentJobConfig): CanvasAgentSqsClient {
    const key = `${config.awsRegion}\n${config.endpoint ?? ""}`;
    if (!this.client || this.clientKey !== key) {
      this.client?.destroy?.();
      this.client = this.createClient(config);
      this.clientKey = key;
    }
    return this.client;
  }

  private getConfig(): CanvasAgentJobConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION),
      queueUrl: this.requireConfig(process.env.SQS_AI_JOBS_QUEUE_URL),
      endpoint: this.optionalConfig(process.env.SQS_ENDPOINT)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (!value?.trim()) throw canvasAgentJobUnavailable("Canvas AI job queue is not configured");
    return value.trim();
  }

  private optionalConfig(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
  }
}
