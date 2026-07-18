import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { agentJobUnavailable } from "./agent-api-error";
import type {
  AgentRiskLevel,
  AgentToolExecutionMode,
  AgentToolInputSchema,
  AgentPlannerRequestContext
} from "./types/agent-tool.types";
import type { AgentToolCapabilityCatalogSnapshot } from "./agent-tool-capability-catalog";

export const AGENT_TOOL_SCHEMA_VERSION = "agent-tools:v7";

export interface AgentToolSchemaSnapshotItem {
  name: string;
  description: string;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  inputSchema: AgentToolInputSchema;
}

export interface AgentRunRequestedJobPayload {
  jobType: "agent_run_requested";
  runId: string;
  workspaceId: string;
  requestedByUserId: string;
  requestContext: AgentPlannerRequestContext;
  turnSequence: number;
  toolSchemaVersion: string;
  tools: AgentToolSchemaSnapshotItem[];
  toolCapabilityCatalog?: AgentToolCapabilityCatalogSnapshot;
}

export interface AgentGroundedAnswerRequestedJobPayload {
  jobType: "agent_grounded_answer_requested";
  runId: string;
}

interface AgentJobConfig {
  awsRegion: string;
  queueUrl: string;
  endpoint?: string;
}

type AgentJobSqsClient = Pick<SQSClient, "send"> &
  Partial<Pick<SQSClient, "destroy">>;

@Injectable()
export class AgentJobService implements OnModuleDestroy {
  private sqsClient: AgentJobSqsClient | null = null;
  private sqsClientConfigKey: string | null = null;

  async enqueueAgentRunRequestedJob(
    payload: AgentRunRequestedJobPayload
  ): Promise<void> {
    const config = this.getConfig();
    const client = this.getSqsClient(config);

    try {
      await client.send(
        new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: JSON.stringify(payload)
        })
      );
    } catch {
      throw agentJobUnavailable("Agent job could not be enqueued");
    }
  }

  async enqueueAgentGroundedAnswerRequestedJob(payload: AgentGroundedAnswerRequestedJobPayload): Promise<void> {
    const config = this.getConfig();
    try { await this.getSqsClient(config).send(new SendMessageCommand({ QueueUrl: config.queueUrl, MessageBody: JSON.stringify(payload) })); }
    catch { throw agentJobUnavailable("Agent grounded answer job could not be enqueued"); }
  }

  onModuleDestroy(): void {
    this.sqsClient?.destroy?.();
    this.sqsClient = null;
    this.sqsClientConfigKey = null;
  }

  protected createSqsClient(config: AgentJobConfig): AgentJobSqsClient {
    return new SQSClient({
      region: config.awsRegion,
      endpoint: config.endpoint
    });
  }

  private getSqsClient(config: AgentJobConfig): AgentJobSqsClient {
    const configKey = `${config.awsRegion}\n${config.endpoint ?? ""}`;

    if (this.sqsClient === null || this.sqsClientConfigKey !== configKey) {
      this.sqsClient?.destroy?.();
      this.sqsClient = this.createSqsClient(config);
      this.sqsClientConfigKey = configKey;
    }

    return this.sqsClient;
  }

  private getConfig(): AgentJobConfig {
    return {
      awsRegion: this.requireConfig(process.env.AWS_REGION),
      queueUrl: this.requireConfig(process.env.SQS_AGENT_JOBS_QUEUE_URL),
      endpoint: this.optionalConfig(process.env.SQS_ENDPOINT)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw agentJobUnavailable("Agent job queue is not configured");
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
