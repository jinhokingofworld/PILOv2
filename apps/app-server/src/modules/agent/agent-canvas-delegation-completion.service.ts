import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import { AgentLoggingService } from "./agent-logging.service";

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 20;

interface CompletedDelegationRow extends QueryResultRow {
  agent_run_id: string;
  agent_step_id: string;
  workspace_id: string;
  requested_by_user_id: string;
  canvas_agent_run_id: string;
  canvas_id: string;
  canvas_status: "completed" | "failed" | "cancelled" | "expired";
  result_summary: string | null;
  error_message: string | null;
  has_artifact: boolean;
}

@Injectable()
export class AgentCanvasDelegationCompletionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AgentCanvasDelegationCompletionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly agentLoggingService: AgentLoggingService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processCompletedDelegations(), POLL_INTERVAL_MS);
    void this.processCompletedDelegations();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processCompletedDelegations(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const rows = await this.database.query<CompletedDelegationRow>(
        `
          SELECT
            agent_run.id AS agent_run_id,
            step.id AS agent_step_id,
            agent_run.workspace_id,
            agent_run.requested_by_user_id,
            child.id AS canvas_agent_run_id,
            child.canvas_id,
            child.status AS canvas_status,
            child.result_summary,
            child.error_message,
            (child.result_json ? 'artifact') AS has_artifact
          FROM agent_steps AS step
          JOIN agent_runs AS agent_run
            ON agent_run.id = step.run_id
          JOIN canvas_agent_runs AS child
            ON child.parent_agent_run_id = agent_run.id
           AND child.id::text = step.output_json ->> 'canvasAgentRunId'
          WHERE step.tool_name = 'delegate_canvas_agent'
            AND step.status = 'running'
            AND agent_run.status = 'running'
            AND agent_run.requested_by_user_id IS NOT NULL
            AND child.status IN ('completed', 'failed', 'cancelled', 'expired')
          ORDER BY child.completed_at ASC NULLS LAST, child.created_at ASC
          LIMIT $1
        `,
        [BATCH_SIZE]
      );

      for (const row of rows) {
        try {
          const finalAnswer = row.result_summary?.trim() || this.fallbackMessage(row.canvas_status);
          await this.agentLoggingService.settleDelegatedToolStep(
            row.requested_by_user_id,
            row.workspace_id,
            {
              runId: row.agent_run_id,
              stepId: row.agent_step_id,
              childStatus: row.canvas_status,
              finalAnswer,
              errorMessage: row.error_message,
              outputSummary: {
                canvasAgentRunId: row.canvas_agent_run_id,
                canvasId: row.canvas_id,
                status: row.canvas_status,
                summary: finalAnswer,
                hasArtifact: row.has_artifact
              }
            }
          );
        } catch (error) {
          this.logger.error(
            `Canvas Agent delegation completion failed for parent ${row.agent_run_id}`,
            error
          );
        }
      }
    } catch (error) {
      this.logger.error("Canvas Agent delegation completion sweep failed", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private fallbackMessage(
    status: CompletedDelegationRow["canvas_status"]
  ): string {
    switch (status) {
      case "completed":
        return "Canvas AI 작업을 완료했습니다.";
      case "cancelled":
        return "Canvas AI 작업을 취소했습니다.";
      case "expired":
        return "Canvas AI 작업 시간이 만료되었습니다.";
      case "failed":
        return "Canvas AI 작업을 완료하지 못했습니다.";
    }
  }
}
