import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { clientRequestIdConflict } from "./agent-api-error";
import type {
  AgentJsonObject,
  AgentResourceRef,
  AgentRiskLevel
} from "./types/agent-tool.types";

export type AgentRunStatus =
  | "planning"
  | "waiting_user_input"
  | "waiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AgentStepType = "planner" | "tool" | "answer";

export type AgentLogActorType =
  | "user"
  | "app_server"
  | "ai_worker"
  | "system";

export type AgentLogLevel = "debug" | "info" | "warn" | "error";

export interface CreateAgentRunInput {
  prompt: string;
  timezone?: string;
  clientRequestId?: string | null;
  message?: string;
}

export interface CreateAgentRunResult {
  run: AgentRunPayload;
  created: boolean;
}

export interface StartAgentStepInput {
  runId: string;
  order: number;
  type: AgentStepType;
  toolName?: string | null;
  riskLevel?: AgentRiskLevel | null;
  inputSummary?: AgentJsonObject;
}

export interface StartNextAgentStepInput {
  runId: string;
  type: AgentStepType;
  toolName?: string | null;
  riskLevel?: AgentRiskLevel | null;
  inputSummary?: AgentJsonObject;
}

export interface CompleteAgentStepInput {
  runId: string;
  stepId: string;
  outputSummary?: AgentJsonObject;
  resourceRefs?: AgentResourceRef[];
}

export interface FailAgentStepInput {
  runId: string;
  stepId: string;
  errorCode?: string | null;
  errorMessage: string;
}

export interface CompleteAgentRunInput {
  runId: string;
  finalAnswer: string;
  message?: string;
  riskLevel?: AgentRiskLevel | null;
}

export interface FailAgentRunInput {
  runId: string;
  errorCode?: string | null;
  errorMessage: string;
  message?: string;
}

export interface CancelAgentRunInput {
  runId: string;
  message: string;
}

export interface WaitForAgentUserInput {
  runId: string;
  message: string;
  riskLevel?: AgentRiskLevel | null;
}

export interface QueueNextAgentPlannerTurnInput {
  runId: string;
  riskLevel?: AgentRiskLevel | null;
}

export interface CompleteAgentToolStepAndAdvanceInput
  extends CompleteAgentStepInput {
  riskLevel?: AgentRiskLevel | null;
  waitingMessage: string;
  waitForUserInput?: boolean;
}

export interface CompleteAgentToolStepAndAdvanceResult {
  step: AgentStepPayload;
  run: AgentRunPayload;
  queuedNextPlannerTurn: boolean;
}

export interface AgentRunPayload {
  id: string;
  workspaceId: string;
  requestedByUserId: string | null;
  clientRequestId: string | null;
  status: AgentRunStatus;
  riskLevel: AgentRiskLevel | null;
  prompt: string;
  timezone: string;
  message: string | null;
  finalAnswer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStepPayload {
  id: string;
  runId: string;
  order: number;
  type: AgentStepType;
  status: AgentStepStatus;
  toolName: string | null;
  riskLevel: AgentRiskLevel | null;
  inputSummary: AgentJsonObject;
  outputSummary: AgentJsonObject;
  resourceRefs: AgentResourceRef[];
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRunRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  requested_by_user_id: string | null;
  client_request_id: string | null;
  status: AgentRunStatus;
  risk_level: AgentRiskLevel | null;
  prompt: string;
  timezone: string;
  message: string | null;
  final_answer: string | null;
  error_code: string | null;
  error_message: string | null;
  expires_at: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentStepRow extends QueryResultRow {
  id: string;
  run_id: string;
  step_order: number;
  step_type: AgentStepType;
  status: AgentStepStatus;
  tool_name: string | null;
  risk_level: AgentRiskLevel | null;
  input_json: AgentJsonObject;
  output_json: AgentJsonObject;
  resource_refs: AgentResourceRef[];
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const DEFAULT_TIMEZONE = "Asia/Seoul";
const DEFAULT_RUN_MESSAGE = "요청을 분석하고 있습니다.";

const INPUT_JSON_MAX_BYTES = 32768;
const OUTPUT_JSON_MAX_BYTES = 65536;
const RESOURCE_REFS_MAX_BYTES = 65536;
const LOG_METADATA_MAX_BYTES = 32768;
const LOG_RESOURCE_REFS_MAX_BYTES = 32768;

const FORBIDDEN_JSON_KEY_PARTS = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "providerraw",
  "rawresponse",
  "secret",
  "token",
  "transcript",
  "transcripttext"
];

@Injectable()
export class AgentLoggingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async createRun(
    currentUserId: string,
    workspaceId: string,
    input: CreateAgentRunInput
  ): Promise<CreateAgentRunResult> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const prompt = this.normalizeRequiredText(input.prompt, "prompt");
    const timezone = this.normalizeRequiredText(
      input.timezone ?? DEFAULT_TIMEZONE,
      "timezone"
    );
    const clientRequestId = this.normalizeOptionalText(input.clientRequestId);
    const message = input.message ?? DEFAULT_RUN_MESSAGE;

    return this.database.transaction(async (transaction) => {
      if (clientRequestId) {
        const existing = await this.findRunByClientRequest(
          transaction,
          workspaceId,
          currentUserId,
          clientRequestId
        );

        if (existing) {
          return this.mapIdempotentRun(existing, prompt, timezone);
        }
      }

      const run = await transaction.queryOne<AgentRunRow>(
        `
          INSERT INTO agent_runs (
            workspace_id,
            requested_by_user_id,
            client_request_id,
            status,
            prompt,
            timezone,
            message
          )
          VALUES ($1, $2, $3, 'planning', $4, $5, $6)
          ON CONFLICT (workspace_id, requested_by_user_id, client_request_id)
          WHERE client_request_id IS NOT NULL
            AND requested_by_user_id IS NOT NULL
          DO NOTHING
          RETURNING *
        `,
        [workspaceId, currentUserId, clientRequestId, prompt, timezone, message]
      );

      if (!run) {
        if (clientRequestId) {
          const existing = await this.findRunByClientRequest(
            transaction,
            workspaceId,
            currentUserId,
            clientRequestId
          );

          if (existing) {
            return this.mapIdempotentRun(existing, prompt, timezone);
          }
        }

        throw new Error("Agent run could not be created");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: run.id,
        actorType: "user",
        actorUserId: currentUserId,
        level: "info",
        eventType: "run_created",
        message: "Agent run created",
        metadata: {
          promptLength: prompt.length,
          timezone,
          hasClientRequestId: Boolean(clientRequestId)
        },
        resourceRefs: []
      });

      await transaction.execute(
        `
          INSERT INTO agent_run_outbox (run_id, workspace_id)
          VALUES ($1, $2)
        `,
        [run.id, workspaceId]
      );

      return {
        run: this.mapRun(run),
        created: true
      };
    });
  }

  private mapIdempotentRun(
    run: AgentRunRow,
    prompt: string,
    timezone: string
  ): CreateAgentRunResult {
    if (run.prompt !== prompt || run.timezone !== timezone) {
      throw clientRequestIdConflict(
        "clientRequestId was already used for a different Agent run"
      );
    }

    return {
      run: this.mapRun(run),
      created: false
    };
  }

  async startStep(
    currentUserId: string,
    workspaceId: string,
    input: StartAgentStepInput
  ): Promise<AgentStepPayload> {
    this.assertPositiveInteger(input.order, "step order");
    const inputSummary = this.assertSafeObject(
      input.inputSummary ?? {},
      INPUT_JSON_MAX_BYTES,
      "step input"
    );

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      return this.insertRunningStep(transaction, workspaceId, {
        ...input,
        inputSummary
      });
    });
  }

  async startNextStep(
    currentUserId: string,
    workspaceId: string,
    input: StartNextAgentStepInput
  ): Promise<AgentStepPayload> {
    const inputSummary = this.assertSafeObject(
      input.inputSummary ?? {},
      INPUT_JSON_MAX_BYTES,
      "step input"
    );

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const nextOrder = await transaction.queryOne<{ next_order: number | string }>(
        `
          SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order
          FROM agent_steps
          WHERE run_id = $1
        `,
        [input.runId]
      );

      return this.insertRunningStep(transaction, workspaceId, {
        ...input,
        order: Number(nextOrder?.next_order ?? 1),
        inputSummary
      });
    });
  }

  async startNextToolStepIfAbsent(
    currentUserId: string,
    workspaceId: string,
    input: Omit<StartNextAgentStepInput, "type">
  ): Promise<AgentStepPayload | null> {
    const inputSummary = this.assertSafeObject(
      input.inputSummary ?? {},
      INPUT_JSON_MAX_BYTES,
      "step input"
    );

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const existing = await transaction.queryOne<{ id: string }>(
        `
          SELECT id
          FROM agent_steps
          WHERE run_id = $1
            AND step_type = 'tool'
            AND status = 'running'
          LIMIT 1
        `,
        [input.runId]
      );

      if (existing) {
        return null;
      }

      const nextOrder = await transaction.queryOne<{ next_order: number | string }>(
        `
          SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order
          FROM agent_steps
          WHERE run_id = $1
        `,
        [input.runId]
      );

      return this.insertRunningStep(transaction, workspaceId, {
        ...input,
        type: "tool",
        order: Number(nextOrder?.next_order ?? 1),
        inputSummary
      });
    });
  }

  async waitForUserInput(
    currentUserId: string,
    workspaceId: string,
    input: WaitForAgentUserInput
  ): Promise<AgentRunPayload> {
    const message = this.normalizeRequiredText(input.message, "message");
    return this.database.transaction(async (transaction) => {
      const run = await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });
      const nextSequence = await transaction.queryOne<{ sequence: number | string }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_messages WHERE run_id = $1`,
        [input.runId]
      );
      await transaction.execute(
        `INSERT INTO agent_run_messages (run_id, sequence, role, content) VALUES ($1, $2, 'assistant', $3)`,
        [input.runId, Number(nextSequence?.sequence ?? 1), message]
      );
      const updated = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'waiting_user_input',
              risk_level = COALESCE($2, risk_level),
              message = $3,
              final_answer = NULL,
              completed_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND status IN ('planning', 'running')
          RETURNING *
        `,
        [run.id, input.riskLevel ?? null, message]
      );
      if (!updated) throw new Error("Agent run could not wait for user input");
      return this.mapRun(updated);
    });
  }

  /**
   * A completed tool is not necessarily the end of an Agent run.  Re-open the
   * same run for one bounded planner turn, and re-arm its existing outbox row.
   */
  async queueNextPlannerTurn(
    currentUserId: string,
    workspaceId: string,
    input: QueueNextAgentPlannerTurnInput
  ): Promise<AgentRunPayload | null> {
    return this.database.transaction(async (transaction) => {
      const run = await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });
      const updated = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'planning',
              tool_call_count = tool_call_count + 1,
              risk_level = COALESCE($2, risk_level),
              message = '다음 작업을 확인하고 있습니다.',
              final_answer = NULL,
              error_code = NULL,
              error_message = NULL,
              completed_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'running'
            AND tool_call_count < 4
          RETURNING *
        `,
        [run.id, input.riskLevel ?? null]
      );
      if (!updated) {
        return null;
      }

      const outbox = await transaction.queryOne<{ id: string }>(
        `
          UPDATE agent_run_outbox
          SET status = 'pending',
              attempt_count = 0,
              next_attempt_at = now(),
              claim_token = NULL,
              claimed_at = NULL,
              delivered_at = NULL,
              error_code = NULL,
              error_message = NULL,
              turn_sequence = turn_sequence + 1,
              reason = 'tool_result'
          WHERE run_id = $1
          RETURNING id
        `,
        [run.id]
      );
      if (!outbox) {
        throw new Error("Agent run outbox could not be re-armed");
      }
      return this.mapRun(updated);
    });
  }

  async createToolExecutionClaim(
    transaction: DatabaseTransaction,
    workspaceId: string,
    input: Omit<StartNextAgentStepInput, "type" | "order">
  ): Promise<AgentStepPayload> {
    const inputSummary = this.assertSafeObject(
      input.inputSummary ?? {},
      INPUT_JSON_MAX_BYTES,
      "step input"
    );
    const nextOrder = await transaction.queryOne<{ next_order: number | string }>(
      `
        SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order
        FROM agent_steps
        WHERE run_id = $1
      `,
      [input.runId]
    );

    return this.insertRunningStep(transaction, workspaceId, {
      ...input,
      type: "tool",
      order: Number(nextOrder?.next_order ?? 1),
      inputSummary
    });
  }

  async completeStep(
    currentUserId: string,
    workspaceId: string,
    input: CompleteAgentStepInput
  ): Promise<AgentStepPayload> {
    const outputSummary = this.assertSafeObject(
      input.outputSummary ?? {},
      OUTPUT_JSON_MAX_BYTES,
      "step output"
    );
    const resourceRefs = this.assertSafeResourceRefs(
      input.resourceRefs ?? [],
      RESOURCE_REFS_MAX_BYTES,
      "step resource refs"
    );

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const step = await transaction.queryOne<AgentStepRow>(
        `
          UPDATE agent_steps
          SET status = 'completed',
              output_json = $3,
              resource_refs = $4::jsonb,
              error_code = NULL,
              error_message = NULL,
              completed_at = now()
          WHERE id = $1
            AND run_id = $2
            AND status = 'running'
          RETURNING *
        `,
        [
          input.stepId,
          input.runId,
          outputSummary,
          this.serializeResourceRefs(resourceRefs)
        ]
      );

      if (!step) {
        throw notFound("Agent step not found");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        stepId: step.id,
        actorType: "app_server",
        actorUserId: null,
        level: "info",
        eventType: "step_completed",
        message: "Agent step completed",
        metadata: {
          stepOrder: step.step_order,
          stepType: step.step_type,
          toolName: step.tool_name
        },
        resourceRefs
      });

      return this.mapStep(step);
    });
  }

  /**
   * Persist a successful tool result and its next durable run state in one
   * transaction. This prevents a process crash from leaving an externally
   * completed tool attached to a still-running planner generation.
   */
  async completeToolStepAndAdvance(
    currentUserId: string,
    workspaceId: string,
    input: CompleteAgentToolStepAndAdvanceInput
  ): Promise<CompleteAgentToolStepAndAdvanceResult> {
    const outputSummary = this.assertSafeObject(
      input.outputSummary ?? {},
      OUTPUT_JSON_MAX_BYTES,
      "step output"
    );
    const resourceRefs = this.assertSafeResourceRefs(
      input.resourceRefs ?? [],
      RESOURCE_REFS_MAX_BYTES,
      "step resource refs"
    );
    const waitingMessage = this.normalizeRequiredText(
      input.waitingMessage,
      "waiting message"
    );

    return this.database.transaction(async (transaction) => {
      const lockedRun = await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });
      if (lockedRun.status !== "running") {
        throw new Error("Agent run is not running");
      }

      const step = await transaction.queryOne<AgentStepRow>(
        `
          UPDATE agent_steps
          SET status = 'completed',
              output_json = $3,
              resource_refs = $4::jsonb,
              error_code = NULL,
              error_message = NULL,
              completed_at = now()
          WHERE id = $1
            AND run_id = $2
            AND status = 'running'
          RETURNING *
        `,
        [
          input.stepId,
          input.runId,
          outputSummary,
          this.serializeResourceRefs(resourceRefs)
        ]
      );
      if (!step) {
        throw notFound("Agent step not found");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        stepId: step.id,
        actorType: "app_server",
        actorUserId: null,
        level: "info",
        eventType: "step_completed",
        message: "Agent step completed",
        metadata: {
          stepOrder: step.step_order,
          stepType: step.step_type,
          toolName: step.tool_name
        },
        resourceRefs
      });

      if (!input.waitForUserInput) {
        const planningRun = await transaction.queryOne<AgentRunRow>(
          `
            UPDATE agent_runs
            SET status = 'planning',
                tool_call_count = tool_call_count + 1,
                risk_level = COALESCE($2, risk_level),
                message = '다음 작업을 확인하고 있습니다.',
                final_answer = NULL,
                error_code = NULL,
                error_message = NULL,
                completed_at = NULL,
                updated_at = now()
            WHERE id = $1
              AND status = 'running'
              AND tool_call_count < 4
            RETURNING *
          `,
          [input.runId, input.riskLevel ?? null]
        );
        if (planningRun) {
          const outbox = await transaction.queryOne<{ id: string }>(
            `
              UPDATE agent_run_outbox
              SET status = 'pending',
                  attempt_count = 0,
                  next_attempt_at = now(),
                  claim_token = NULL,
                  claimed_at = NULL,
                  delivered_at = NULL,
                  error_code = NULL,
                  error_message = NULL,
                  turn_sequence = turn_sequence + 1,
                  reason = 'tool_result'
              WHERE run_id = $1
              RETURNING id
            `,
            [input.runId]
          );
          if (!outbox) {
            throw new Error("Agent run outbox could not be re-armed");
          }
          return {
            step: this.mapStep(step),
            run: this.mapRun(planningRun),
            queuedNextPlannerTurn: true
          };
        }
      }

      const waitingRun = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'waiting_user_input',
              tool_call_count = LEAST(
                tool_call_count + CASE WHEN $4::boolean THEN 0 ELSE 1 END,
                5
              ),
              risk_level = COALESCE($2, risk_level),
              message = $3,
              final_answer = NULL,
              completed_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'running'
          RETURNING *
        `,
        [
          input.runId,
          input.riskLevel ?? null,
          waitingMessage,
          input.waitForUserInput === true
        ]
      );
      if (!waitingRun) {
        throw new Error("Agent run could not wait for user input");
      }
      const nextSequence = await transaction.queryOne<{
        sequence: number | string;
      }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_messages WHERE run_id = $1`,
        [input.runId]
      );
      await transaction.execute(
        `INSERT INTO agent_run_messages (run_id, sequence, role, content) VALUES ($1, $2, 'assistant', $3)`,
        [input.runId, Number(nextSequence?.sequence ?? 1), waitingMessage]
      );
      return {
        step: this.mapStep(step),
        run: this.mapRun(waitingRun),
        queuedNextPlannerTurn: false
      };
    });
  }

  async getOwnedRun(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<AgentRunPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const run = await this.database.queryOne<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND requested_by_user_id = $3
      `,
      [runId, workspaceId, currentUserId]
    );
    if (!run) {
      throw notFound("Agent run not found");
    }
    return this.mapRun(run);
  }

  async failStep(
    currentUserId: string,
    workspaceId: string,
    input: FailAgentStepInput
  ): Promise<AgentStepPayload> {
    const errorMessage = this.normalizeRequiredText(
      input.errorMessage,
      "error message"
    );
    const errorCode = this.normalizeOptionalText(input.errorCode);

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const step = await transaction.queryOne<AgentStepRow>(
        `
          UPDATE agent_steps
          SET status = 'failed',
              error_code = $3,
              error_message = $4,
              completed_at = now()
          WHERE id = $1
            AND run_id = $2
            AND status = 'running'
          RETURNING *
        `,
        [input.stepId, input.runId, errorCode, errorMessage]
      );

      if (!step) {
        const terminalStep = await transaction.queryOne<AgentStepRow>(
          `SELECT * FROM agent_steps WHERE id = $1 AND run_id = $2`,
          [input.stepId, input.runId]
        );
        if (!terminalStep) {
          throw notFound("Agent step not found");
        }
        return this.mapStep(terminalStep);
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        stepId: step.id,
        actorType: "app_server",
        actorUserId: null,
        level: "error",
        eventType: "step_failed",
        message: "Agent step failed",
        metadata: {
          stepOrder: step.step_order,
          stepType: step.step_type,
          toolName: step.tool_name,
          errorCode
        },
        resourceRefs: []
      });

      return this.mapStep(step);
    });
  }

  async completeRun(
    currentUserId: string,
    workspaceId: string,
    input: CompleteAgentRunInput
  ): Promise<AgentRunPayload> {
    const finalAnswer = this.normalizeRequiredText(
      input.finalAnswer,
      "final answer"
    );

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const run = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'completed',
              risk_level = COALESCE($3, risk_level),
              message = $4,
              final_answer = $5,
              error_code = NULL,
              error_message = NULL,
              completed_at = now()
          WHERE id = $1
            AND workspace_id = $2
            AND status = 'running'
          RETURNING *
        `,
        [
          input.runId,
          workspaceId,
          input.riskLevel ?? null,
          input.message ?? "요청을 완료했습니다.",
          finalAnswer
        ]
      );

      if (!run) {
        throw notFound("Agent run not found");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        actorType: "app_server",
        actorUserId: null,
        level: "info",
        eventType: "run_completed",
        message: "Agent run completed",
        metadata: {
          finalAnswerLength: finalAnswer.length
        },
        resourceRefs: []
      });

      return this.mapRun(run);
    });
  }

  async failRun(
    currentUserId: string,
    workspaceId: string,
    input: FailAgentRunInput
  ): Promise<AgentRunPayload> {
    const errorMessage = this.normalizeRequiredText(
      input.errorMessage,
      "error message"
    );
    const errorCode = this.normalizeOptionalText(input.errorCode);

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const run = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'failed',
              message = $3,
              error_code = $4,
              error_message = $5,
              completed_at = now()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [
          input.runId,
          workspaceId,
          input.message ?? "요청을 처리하지 못했습니다.",
          errorCode,
          errorMessage
        ]
      );

      if (!run) {
        throw notFound("Agent run not found");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        actorType: "app_server",
        actorUserId: null,
        level: "error",
        eventType: "run_failed",
        message: "Agent run failed",
        metadata: {
          errorCode
        },
        resourceRefs: []
      });

      return this.mapRun(run);
    });
  }

  async cancelRun(
    currentUserId: string,
    workspaceId: string,
    input: CancelAgentRunInput
  ): Promise<AgentRunPayload> {
    const message = this.normalizeRequiredText(input.message, "message");

    return this.database.transaction(async (transaction) => {
      await this.findOwnedRunForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId: input.runId
      });

      const run = await transaction.queryOne<AgentRunRow>(
        `
          UPDATE agent_runs
          SET status = 'cancelled',
              message = $3,
              completed_at = now()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [input.runId, workspaceId, message]
      );

      if (!run) {
        throw notFound("Agent run not found");
      }

      await this.insertLog(transaction, {
        workspaceId,
        runId: input.runId,
        actorType: "app_server",
        actorUserId: null,
        level: "info",
        eventType: "run_cancelled",
        message: "Agent run cancelled",
        metadata: {},
        resourceRefs: []
      });

      return this.mapRun(run);
    });
  }

  private async findRunByClientRequest(
    transaction: DatabaseTransaction,
    workspaceId: string,
    currentUserId: string,
    clientRequestId: string
  ): Promise<AgentRunRow | null> {
    return transaction.queryOne<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE workspace_id = $1
          AND requested_by_user_id = $2
          AND client_request_id = $3
      `,
      [workspaceId, currentUserId, clientRequestId]
    );
  }

  private async insertRunningStep(
    transaction: DatabaseTransaction,
    workspaceId: string,
    input: StartAgentStepInput & { inputSummary: AgentJsonObject }
  ): Promise<AgentStepPayload> {
    const step = await transaction.queryOne<AgentStepRow>(
      `
        INSERT INTO agent_steps (
          run_id,
          step_order,
          step_type,
          status,
          tool_name,
          risk_level,
          input_json,
          started_at
        )
        VALUES ($1, $2, $3, 'running', $4, $5, $6, now())
        RETURNING *
      `,
      [
        input.runId,
        input.order,
        input.type,
        input.toolName ?? null,
        input.riskLevel ?? null,
        input.inputSummary
      ]
    );

    if (!step) {
      throw new Error("Agent step could not be created");
    }

    await this.insertLog(transaction, {
      workspaceId,
      runId: input.runId,
      stepId: step.id,
      actorType: "app_server",
      actorUserId: null,
      level: "info",
      eventType: "step_started",
      message: "Agent step started",
      metadata: {
        stepOrder: input.order,
        stepType: input.type,
        toolName: input.toolName ?? null
      },
      resourceRefs: []
    });

    return this.mapStep(step);
  }

  private async findOwnedRunForUpdate(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      workspaceId: string;
      runId: string;
    }
  ): Promise<AgentRunRow> {
    const run = await transaction.queryOne<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND requested_by_user_id = $3
        FOR UPDATE
      `,
      [input.runId, input.workspaceId, input.currentUserId]
    );

    if (!run) {
      throw notFound("Agent run not found");
    }

    return run;
  }

  private async insertLog(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      runId: string;
      stepId?: string | null;
      confirmationId?: string | null;
      actorType: AgentLogActorType;
      actorUserId: string | null;
      level: AgentLogLevel;
      eventType: string;
      message: string;
      metadata: AgentJsonObject;
      resourceRefs: AgentResourceRef[];
    }
  ): Promise<void> {
    const metadata = this.assertSafeObject(
      input.metadata,
      LOG_METADATA_MAX_BYTES,
      "log metadata"
    );
    const resourceRefs = this.assertSafeResourceRefs(
      input.resourceRefs,
      LOG_RESOURCE_REFS_MAX_BYTES,
      "log resource refs"
    );

    await transaction.execute(
      `
        INSERT INTO agent_logs (
          workspace_id,
          run_id,
          step_id,
          confirmation_id,
          actor_type,
          actor_user_id,
          level,
          event_type,
          message,
          metadata_json,
          resource_refs
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `,
      [
        input.workspaceId,
        input.runId,
        input.stepId ?? null,
        input.confirmationId ?? null,
        input.actorType,
        input.actorUserId,
        input.level,
        this.normalizeRequiredText(input.eventType, "log event type"),
        this.normalizeRequiredText(input.message, "log message"),
        metadata,
        this.serializeResourceRefs(resourceRefs)
      ]
    );
  }

  private serializeResourceRefs(resourceRefs: AgentResourceRef[]): string {
    // node-postgres otherwise encodes JavaScript arrays as PostgreSQL arrays.
    return JSON.stringify(resourceRefs);
  }

  private assertSafeObject(
    value: unknown,
    maxBytes: number,
    label: string
  ): AgentJsonObject {
    if (!this.isPlainObject(value)) {
      throw badRequest(`${label} must be an object`);
    }

    this.assertSafeJson(value, label);
    this.assertJsonSize(value, maxBytes, label);

    return value;
  }

  private assertSafeResourceRefs(
    value: unknown,
    maxBytes: number,
    label: string
  ): AgentResourceRef[] {
    if (!Array.isArray(value)) {
      throw badRequest(`${label} must be an array`);
    }

    this.assertSafeJson(value, label);
    this.assertJsonSize(value, maxBytes, label);

    return value as AgentResourceRef[];
  }

  private assertSafeJson(value: unknown, label: string): void {
    this.walkJson(value, label);
  }

  private walkJson(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        this.walkJson(entry, `${path}[${index}]`);
      });
      return;
    }

    if (!this.isPlainObject(value)) {
      return;
    }

    Object.entries(value).forEach(([key, entry]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

      if (
        FORBIDDEN_JSON_KEY_PARTS.some((forbidden) =>
          normalizedKey.includes(forbidden)
        )
      ) {
        throw badRequest(`${path} contains forbidden key: ${key}`);
      }

      this.walkJson(entry, `${path}.${key}`);
    });
  }

  private assertJsonSize(value: unknown, maxBytes: number, label: string): void {
    const size = Buffer.byteLength(JSON.stringify(value), "utf8");

    if (size > maxBytes) {
      throw badRequest(`${label} is too large`);
    }
  }

  private assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw badRequest(`${label} must be a positive integer`);
    }
  }

  private normalizeRequiredText(value: string, label: string): string {
    const normalized = value.trim();

    if (!normalized) {
      throw badRequest(`${label} is required`);
    }

    return normalized;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private mapRun(run: AgentRunRow): AgentRunPayload {
    return {
      id: run.id,
      workspaceId: run.workspace_id,
      requestedByUserId: run.requested_by_user_id,
      clientRequestId: run.client_request_id,
      status: run.status,
      riskLevel: run.risk_level,
      prompt: run.prompt,
      timezone: run.timezone,
      message: run.message,
      finalAnswer: run.final_answer,
      errorCode: run.error_code,
      errorMessage: run.error_message,
      expiresAt: this.toIso(run.expires_at),
      completedAt: this.toIsoOrNull(run.completed_at),
      createdAt: this.toIso(run.created_at),
      updatedAt: this.toIso(run.updated_at)
    };
  }

  private mapStep(step: AgentStepRow): AgentStepPayload {
    return {
      id: step.id,
      runId: step.run_id,
      order: step.step_order,
      type: step.step_type,
      status: step.status,
      toolName: step.tool_name,
      riskLevel: step.risk_level,
      inputSummary: step.input_json,
      outputSummary: step.output_json,
      resourceRefs: step.resource_refs,
      errorCode: step.error_code,
      errorMessage: step.error_message,
      startedAt: this.toIsoOrNull(step.started_at),
      completedAt: this.toIsoOrNull(step.completed_at),
      createdAt: this.toIso(step.created_at),
      updatedAt: this.toIso(step.updated_at)
    };
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toIsoOrNull(value: Date | string | null): string | null {
    return value === null ? null : this.toIso(value);
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
