import { HttpException, Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  confirmationExpired,
  confirmationNotPending
} from "./agent-api-error";
import {
  AgentLoggingService,
  AgentRunPayload,
  type AgentExecutionLease,
  type AgentToolExecutionClaim
} from "./agent-logging.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { isTerminalAgentCapabilityTool } from "./agent-tool-capability-catalog";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentJsonValue,
  AgentResourceRef,
  AgentRiskLevel,
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolPostExecutionDisposition,
  AgentRunRequestContext,
  AgentChoiceConfirmationPlan
} from "./types/agent-tool.types";

type AgentRunStatus =
  | "planning"
  | "waiting_user_input"
  | "waiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type AgentConfirmationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

interface AgentRunRow extends QueryResultRow {
  id: string;
  status: AgentRunStatus;
  message: string | null;
}

interface AgentConfirmationRow extends QueryResultRow {
  id: string;
  run_id: string;
  tool_name: string;
  status: AgentConfirmationStatus;
  risk_level: AgentRiskLevel;
  summary: string;
  plan_json: AgentConfirmationPlan;
  expires_at: Date | string;
  approved_at: Date | string | null;
  rejected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  selected_choice_id: string | null;
}

interface AgentConfirmationWithRunRow extends AgentConfirmationRow {
  run_status: AgentRunStatus;
  run_message: string | null;
  run_request_context_json: AgentRunRequestContext;
}

interface ApprovedToolExecution {
  definition: AgentToolDefinition<unknown>;
  toolInput: unknown;
}

interface StaleAgentExecutionRow extends QueryResultRow {
  run_id: string;
  workspace_id: string;
  requested_by_user_id: string;
  tool_step_id: string | null;
  tool_step_status: string | null;
  execution_lease_token: string;
  execution_lease_generation: number | string;
}

export interface CreateAgentConfirmationInput {
  runId: string;
  toolName: string;
  riskLevel: AgentRiskLevel;
  summary: string;
  plan: AgentConfirmationPlan;
  expiresAt?: Date;
}

export interface AgentConfirmationPayload {
  id: string;
  runId: string;
  status: AgentConfirmationStatus;
  riskLevel: AgentRiskLevel;
  plan: AgentConfirmationPlan;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  selectedChoiceId: string | null;
}

export interface AgentConfirmationActionPayload {
  run: {
    id: string;
    status: AgentRunStatus;
    message: string | null;
    confirmation: {
      id: string;
      status: AgentConfirmationStatus;
      approvedAt: string | null;
      rejectedAt: string | null;
      selectedChoiceId: string | null;
    };
  };
}

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const EXECUTION_HEARTBEAT_SECONDS = positiveIntegerEnvironment(
  "AGENT_EXECUTION_HEARTBEAT_SECONDS",
  30
);
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

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class AgentConfirmationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly agentToolRegistryService: AgentToolRegistryService,
    private readonly agentOutboxPublisherService: AgentOutboxPublisherService
  ) {}

  async createConfirmation(
    currentUserId: string,
    workspaceId: string,
    input: CreateAgentConfirmationInput
  ): Promise<AgentConfirmationPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    this.assertExecutablePlan(input.plan, input.toolName);

    const expiresAt =
      input.expiresAt ?? new Date(Date.now() + CONFIRMATION_TTL_MS);

    const confirmation = await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<AgentRunRow>(
        `
          SELECT id, status, message
          FROM agent_runs
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
          FOR UPDATE
        `,
        [input.runId, workspaceId, currentUserId]
      );

      if (!run) {
        throw notFound("Agent run not found");
      }

      const pending = await transaction.queryOne<{ id: string }>(
        `
          SELECT id
          FROM agent_confirmations
          WHERE run_id = $1
            AND status = 'pending'
          FOR UPDATE
        `,
        [input.runId]
      );

      if (pending) {
        throw confirmationNotPending("Pending confirmation already exists");
      }

      const created = await transaction.queryOne<AgentConfirmationRow>(
        `
          INSERT INTO agent_confirmations (
            run_id,
            tool_name,
            risk_level,
            summary,
            plan_json,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `,
        [
          input.runId,
          input.toolName,
          input.riskLevel,
          input.summary,
          input.plan,
          expiresAt
        ]
      );

      if (!created) {
        throw new Error("Agent confirmation could not be created");
      }

      await this.updateRunStatus(transaction, input.runId, {
        status: "waiting_confirmation",
        message: "승인이 필요한 작업이 있습니다.",
        completed: false
      });

      return created;
    });

    return this.mapConfirmation(confirmation);
  }

  async approveConfirmation(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    confirmationId: string,
    body: unknown
  ): Promise<AgentConfirmationActionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const result = await this.database.transaction(async (transaction) => {
      const confirmation = await this.findConfirmationForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId,
        confirmationId
      });

      if (!confirmation) {
        throw notFound("Agent confirmation not found");
      }

      if (confirmation.status !== "pending") {
        throw confirmationNotPending("Confirmation is not pending");
      }

      if (this.isExpired(confirmation.expires_at)) {
        await this.expireConfirmation(transaction, confirmation);
        return {
          expired: true
        } as const;
      }

      this.assertExecutablePlan(confirmation.plan_json, confirmation.tool_name);
      const selectedChoiceId = this.readSelectedChoiceId(
        confirmation.plan_json,
        body
      );
      const toolExecution = this.validateApprovedPlan(
        confirmation,
        selectedChoiceId
      );

      const approved = await transaction.queryOne<AgentConfirmationRow>(
        `
          UPDATE agent_confirmations
          SET status = 'approved',
              approved_by_user_id = $2,
              approved_at = now(),
              selected_choice_id = $3
          WHERE id = $1
          RETURNING *
        `,
        [confirmation.id, currentUserId, selectedChoiceId]
      );

      if (!approved) {
        throw new Error("Agent confirmation could not be approved");
      }

      const run = await this.updateRunStatus(transaction, runId, {
        status: "running",
        message: "승인된 작업을 실행하고 있습니다.",
        completed: false
      });
      const claim = await this.agentLoggingService.createToolExecutionClaim(
        transaction,
        workspaceId,
        {
          runId,
          toolName: approved.tool_name,
          riskLevel: approved.risk_level,
          inputSummary: this.buildStepInputSummary(
            approved.plan_json,
            selectedChoiceId
          )
        }
      );

      return {
        expired: false,
        payload: this.mapActionPayload(run, approved),
        confirmation: {
          ...approved,
          run_request_context_json: confirmation.run_request_context_json,
          run_status: run.status,
          run_message: run.message
        },
        toolExecution,
        claim
      } as const;
    });

    if (result.expired) {
      throw confirmationExpired("Confirmation expired");
    }

    return this.executeApprovedPlan(
      currentUserId,
      workspaceId,
      runId,
      result.confirmation,
      result.toolExecution,
      result.claim
    );
  }

  async rejectConfirmation(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    confirmationId: string,
    body: unknown
  ): Promise<AgentConfirmationActionPayload> {
    this.assertEmptyBody(body);
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const result = await this.database.transaction(async (transaction) => {
      const confirmation = await this.findConfirmationForUpdate(transaction, {
        currentUserId,
        workspaceId,
        runId,
        confirmationId
      });

      if (!confirmation) {
        throw notFound("Agent confirmation not found");
      }

      if (confirmation.status !== "pending") {
        throw confirmationNotPending("Confirmation is not pending");
      }

      if (this.isExpired(confirmation.expires_at)) {
        await this.expireConfirmation(transaction, confirmation);
        return {
          expired: true
        } as const;
      }

      const rejected = await transaction.queryOne<AgentConfirmationRow>(
        `
          UPDATE agent_confirmations
          SET status = 'rejected',
              rejected_by_user_id = $2,
              rejected_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [confirmation.id, currentUserId]
      );

      if (!rejected) {
        throw new Error("Agent confirmation could not be rejected");
      }

      const run = await this.updateRunStatus(transaction, runId, {
        status: "cancelled",
        message: "사용자가 실행을 취소했습니다.",
        completed: true
      });

      return {
        expired: false,
        payload: this.mapActionPayload(run, rejected)
      } as const;
    });

    if (result.expired) {
      throw confirmationExpired("Confirmation expired");
    }

    return result.payload;
  }

  async recoverStaleApprovedExecutions(): Promise<number> {
    const candidates = await this.database.query<{
      run_id: string;
      execution_lease_token: string;
      execution_lease_generation: number | string;
    }>(
      `
        SELECT
          r.id AS run_id,
          r.execution_lease_token,
          r.execution_lease_generation
        FROM agent_runs r
        WHERE r.status = 'running'
          AND r.execution_lease_token IS NOT NULL
          AND r.execution_lease_expires_at <= now()
        ORDER BY r.execution_lease_expires_at ASC
        LIMIT 50
      `
    );

    let recoveredCount = 0;
    for (const candidate of candidates) {
      const recovered = await this.database.transaction(async (transaction) => {
        const row = await transaction.queryOne<StaleAgentExecutionRow>(
          `
            SELECT
              r.id AS run_id,
              r.workspace_id,
              r.requested_by_user_id,
              s.id AS tool_step_id,
              s.status AS tool_step_status,
              r.execution_lease_token,
              r.execution_lease_generation
            FROM agent_runs r
            LEFT JOIN LATERAL (
              SELECT id, status
              FROM agent_steps
              WHERE run_id = r.id
                AND step_type = 'tool'
              ORDER BY step_order DESC
              LIMIT 1
            ) s ON true
            WHERE r.id = $1
              AND r.status = 'running'
              AND r.execution_lease_token = $2::uuid
              AND r.execution_lease_generation = $3
              AND r.execution_lease_expires_at <= now()
            FOR UPDATE OF r
          `,
          [
            candidate.run_id,
            candidate.execution_lease_token,
            Number(candidate.execution_lease_generation)
          ]
        );

        if (!row || row.tool_step_status === "completed") {
          return false;
        }

        if (row.tool_step_id) {
          const step = await transaction.queryOne<{ id: string }>(
            `
              UPDATE agent_steps
              SET status = 'failed',
                  error_code = 'AGENT_EXECUTION_STALE',
                  error_message = 'Agent execution did not finish before the recovery timeout',
                  completed_at = now()
              WHERE id = $1
                AND status = 'running'
              RETURNING id
            `,
            [row.tool_step_id]
          );

          if (!step) {
            return false;
          }
        }

        const run = await transaction.queryOne<{ id: string }>(
          `
            UPDATE agent_runs
            SET status = 'failed',
                error_code = 'AGENT_EXECUTION_STALE',
                error_message = 'Agent execution did not finish before the recovery timeout',
                message = '작업이 시간 안에 완료되지 않아 실행을 종료했습니다.',
                completed_at = now(),
                execution_lease_token = NULL,
                execution_lease_expires_at = NULL,
                execution_heartbeat_at = NULL,
                updated_at = now()
            WHERE id = $1
              AND status = 'running'
              AND execution_lease_token = $2::uuid
              AND execution_lease_generation = $3
            RETURNING id
          `,
          [
            row.run_id,
            row.execution_lease_token,
            Number(row.execution_lease_generation)
          ]
        );

        return run !== null;
      });

      if (recovered) {
        recoveredCount += 1;
      }
    }

    return recoveredCount;
  }

  private async findConfirmationForUpdate(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      workspaceId: string;
      runId: string;
      confirmationId: string;
    }
  ): Promise<AgentConfirmationWithRunRow | null> {
    const run = await transaction.queryOne<{
      status: AgentRunStatus;
      message: string | null;
      request_context_json: AgentRunRequestContext;
    }>(
      `
        SELECT status, message, request_context_json
        FROM agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND requested_by_user_id = $3
        FOR UPDATE
      `,
      [input.runId, input.workspaceId, input.currentUserId]
    );
    if (!run) return null;
    const confirmation =
      await transaction.queryOne<AgentConfirmationRow>(
        `
          SELECT *
          FROM agent_confirmations
          WHERE id = $1
            AND run_id = $2
          FOR UPDATE
        `,
        [input.confirmationId, input.runId]
      );
    return confirmation
      ? {
          ...confirmation,
          run_status: run.status,
          run_message: run.message,
          run_request_context_json: run.request_context_json
        }
      : null;
  }

  private async expireConfirmation(
    transaction: DatabaseTransaction,
    confirmation: AgentConfirmationWithRunRow
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE agent_confirmations
        SET status = 'expired'
        WHERE id = $1
      `,
      [confirmation.id]
    );

    await this.updateRunStatus(transaction, confirmation.run_id, {
      status: "cancelled",
      message: "승인 대기 시간이 만료되었습니다.",
      completed: true
    });
  }

  private async updateRunStatus(
    transaction: DatabaseTransaction,
    runId: string,
    input: {
      status: AgentRunStatus;
      message: string;
      completed: boolean;
    }
  ): Promise<AgentRunRow> {
    const run = await transaction.queryOne<AgentRunRow>(
      `
        UPDATE agent_runs
        SET status = $2,
            message = $3,
            completed_at = CASE WHEN $4 THEN now() ELSE completed_at END,
            execution_lease_token = CASE WHEN $2 = 'running' THEN execution_lease_token ELSE NULL END,
            execution_lease_expires_at = CASE WHEN $2 = 'running' THEN execution_lease_expires_at ELSE NULL END,
            execution_heartbeat_at = CASE WHEN $2 = 'running' THEN execution_heartbeat_at ELSE NULL END,
            updated_at = now()
        WHERE id = $1
        RETURNING id, status, message
      `,
      [runId, input.status, input.message, input.completed]
    );

    if (!run) {
      throw new Error("Agent run status could not be updated");
    }

    return run;
  }

  private assertEmptyBody(body: unknown): void {
    if (body === undefined || body === null) {
      return;
    }

    if (this.isPlainObject(body) && Object.keys(body).length === 0) {
      return;
    }

    throw badRequest("Request body must be empty");
  }

  private readSelectedChoiceId(
    plan: AgentConfirmationPlan,
    body: unknown
  ): string | null {
    if (!this.isChoicePlan(plan)) {
      this.assertEmptyBody(body);
      return null;
    }

    if (
      !this.isPlainObject(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.choiceId !== "string" ||
      !body.choiceId.trim() ||
      body.choiceId !== body.choiceId.trim() ||
      !plan.choices.some((choice) => choice.id === body.choiceId)
    ) {
      throw badRequest("choiceId must select an available choice");
    }

    return body.choiceId;
  }

  private isChoicePlan(
    plan: AgentConfirmationPlan
  ): plan is AgentChoiceConfirmationPlan {
    return plan.kind === "choice" && Array.isArray(plan.choices);
  }

  private assertExecutablePlan(
    plan: AgentConfirmationPlan,
    toolName: string
  ): void {
    if (!this.isPlainObject(plan)) {
      throw badRequest("Confirmation plan is not executable");
    }

    if (plan.toolName !== toolName) {
      throw badRequest("Confirmation plan tool does not match confirmation");
    }

    const planKind = (plan as AgentJsonObject).kind;
    if (
      planKind !== undefined &&
      planKind !== "approval" &&
      planKind !== "choice"
    ) {
      throw badRequest("Confirmation plan is not executable");
    }

    if (
      typeof plan.summary !== "string" ||
      !this.isPlainObject(plan.target) ||
      !this.isPlainObject(plan.call)
    ) {
      throw badRequest("Confirmation plan is not executable");
    }

    if (this.isChoicePlan(plan)) {
      const choiceIds = new Set<string>();
      if (
        plan.choices.length === 0 ||
        plan.choices.length > 10 ||
        plan.choices.some((choice) => {
          if (
            !this.isPlainObject(choice) ||
            typeof choice.id !== "string" ||
            !choice.id.trim() ||
            choice.id !== choice.id.trim() ||
            Buffer.byteLength(choice.id, "utf8") > 128 ||
            typeof choice.label !== "string" ||
            !choice.label.trim() ||
            !this.isPlainObject(choice.input) ||
            choiceIds.has(choice.id)
          ) {
            return true;
          }

          choiceIds.add(choice.id);
          return false;
        })
      ) {
        throw badRequest("Confirmation plan choices are not executable");
      }
      return;
    }

    if (
      !(plan.before === null || this.isPlainObject(plan.before)) ||
      !this.isPlainObject(plan.after)
    ) {
      throw badRequest("Confirmation plan is not executable");
    }
  }

  private validateApprovedPlan(
    confirmation: AgentConfirmationWithRunRow,
    selectedChoiceId: string | null
  ): ApprovedToolExecution {
    const plan = confirmation.plan_json;
    const definition = this.agentToolRegistryService.getDefinitionForContext(
      plan.toolName,
      confirmation.run_request_context_json ?? null
    );
    if (!definition) {
      throw badRequest(`Agent tool is not executable: ${plan.toolName}`);
    }

    if (
      definition.name !== confirmation.tool_name ||
      definition.name !== plan.toolName
    ) {
      throw badRequest("Confirmation plan tool does not match registered tool");
    }

    if (definition.riskLevel !== confirmation.risk_level) {
      throw badRequest("Confirmation risk level does not match registered tool");
    }

    if (
      definition.executionMode !== "confirmation_required" &&
      !(definition.executionMode === "contextual" && this.isChoicePlan(plan))
    ) {
      throw badRequest(`Agent tool is not executable: ${plan.toolName}`);
    }

    if (definition.riskLevel === "high") {
      throw badRequest("High-risk Agent tool execution is not supported");
    }

    const toolInput = this.buildToolInputFromPlan(
      plan,
      definition,
      selectedChoiceId
    );
    return {
      definition,
      toolInput: definition.validateConfirmationInput
        ? definition.validateConfirmationInput(toolInput)
        : definition.validateInput(toolInput)
    };
  }

  private async executeApprovedPlan(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    confirmation: AgentConfirmationWithRunRow,
    toolExecution: ApprovedToolExecution,
    claim: AgentToolExecutionClaim
  ): Promise<AgentConfirmationActionPayload> {
    const { step, lease } = claim;
    try {
      const result = await this.executeWithLeaseHeartbeat(
        runId,
        lease,
        () =>
          toolExecution.definition.execute(
            {
              currentUserId,
              workspaceId,
              runId,
              requestContext: confirmation.run_request_context_json ?? null
            },
            toolExecution.toolInput
          )
      );
      const outputSummary = this.buildOutputSummary(result);
      const resourceRefs = this.sanitizeResourceRefs(result.resourceRefs);
      const capabilityIds = await this.findLatestPlannerCapabilityIds(runId);
      const completedToolNames =
        capabilityIds.length > 0
          ? await this.findCompletedToolNames(runId)
          : [];
      const postExecutionDisposition: AgentToolPostExecutionDisposition =
        capabilityIds.length > 0
          ? isTerminalAgentCapabilityTool(
              capabilityIds,
              toolExecution.definition.name,
              completedToolNames
            )
            ? "complete_run"
            : "continue_planning"
          : toolExecution.definition.postExecutionDisposition ??
            "continue_planning";

      const advanced = await this.agentLoggingService.completeToolStepAndAdvance(
        currentUserId,
        workspaceId,
        {
          runId,
          stepId: step.id,
          outputSummary,
          resourceRefs,
          riskLevel: confirmation.risk_level,
          waitingMessage: postExecutionDisposition === "complete_run"
            ? this.buildFinalAnswer(
                toolExecution.definition.name,
                resourceRefs
              )
            : "한 요청에서 실행할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.",
          postExecutionDisposition,
          executionLease: lease
        }
      );
      if (advanced.queuedNextPlannerTurn) {
        await this.agentOutboxPublisherService
          .publishCreatedRun(runId)
          .catch(() => undefined);
        return this.mapActionPayloadFromRun(advanced.run, confirmation);
      }
      return this.mapActionPayloadFromRun(advanced.run, confirmation);
    } catch (error) {
      const message = this.toSafeErrorMessage(error);

      const failedStep = await this.agentLoggingService.failStep(
        currentUserId,
        workspaceId,
        {
          runId,
          stepId: step.id,
          errorCode: "AGENT_TOOL_EXECUTION_FAILED",
          errorMessage: message,
          executionLease: lease
        }
      );
      if (failedStep.status === "completed") {
        const reconciledRun = await this.agentLoggingService.getOwnedRun(
          currentUserId,
          workspaceId,
          runId
        );
        return this.mapActionPayloadFromRun(reconciledRun, confirmation);
      }

      if (this.shouldReconfirmBoardMutation(error, confirmation)) {
        const retryConfirmation = await this.tryCreateRetryConfirmation(
          currentUserId,
          workspaceId,
          runId,
          confirmation
        );
        if (retryConfirmation) {
          return {
            run: {
              id: runId,
              status: "waiting_confirmation",
              message: "Approval is required before retrying the Board mutation.",
              confirmation: {
                id: retryConfirmation.id,
                status: retryConfirmation.status,
                approvedAt: retryConfirmation.approvedAt,
                rejectedAt: retryConfirmation.rejectedAt,
                selectedChoiceId: retryConfirmation.selectedChoiceId
              }
            }
          };
        }
      }

      const run = await this.agentLoggingService.failRun(
        currentUserId,
        workspaceId,
        {
          runId,
          errorCode: "AGENT_TOOL_EXECUTION_FAILED",
          errorMessage: message,
          message: "승인된 작업을 실행하지 못했습니다."
        }
      );

      return this.mapActionPayloadFromRun(run, confirmation);
    }
  }

  private shouldReconfirmBoardMutation(
    error: unknown,
    confirmation: AgentConfirmationRow
  ): boolean {
    if (
      confirmation.tool_name !== "create_board_issue" &&
      confirmation.tool_name !== "assign_board_issue_safely"
    ) {
      return false;
    }

    if (!(error instanceof HttpException)) {
      return true;
    }

    const status = error.getStatus();
    return status === 409 || status >= 500;
  }

  private async tryCreateRetryConfirmation(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    confirmation: AgentConfirmationRow
  ): Promise<AgentConfirmationPayload | null> {
    try {
      return await this.createConfirmation(currentUserId, workspaceId, {
        runId,
        toolName: confirmation.tool_name,
        riskLevel: confirmation.risk_level,
        summary: confirmation.summary,
        plan: confirmation.plan_json
      });
    } catch {
      return null;
    }
  }

  private buildToolInputFromPlan(
    plan: AgentConfirmationPlan,
    definition: AgentToolDefinition<unknown>,
    selectedChoiceId: string | null
  ): unknown {
    if (definition.buildConfirmationInput) {
      return definition.buildConfirmationInput(plan, selectedChoiceId);
    }

    if (this.isChoicePlan(plan)) {
      const choice = plan.choices.find(
        (candidate) => candidate.id === selectedChoiceId
      );
      if (!choice) {
        throw badRequest("choiceId must select an available choice");
      }
      return choice.input;
    }

    if (definition.name === "create_calendar_event") {
      return plan.after;
    }

    if (definition.name === "update_calendar_event") {
      return {
        eventId: this.readCalendarEventId(plan),
        changes: plan.after
      };
    }

    if (this.isPlainObject(plan.call.input)) {
      return plan.call.input;
    }

    throw badRequest(`Agent tool is not executable: ${plan.toolName}`);
  }

  private buildStepInputSummary(
    plan: AgentConfirmationPlan,
    selectedChoiceId: string | null
  ): AgentJsonObject {
    if (this.isChoicePlan(plan)) {
      return {
        toolName: plan.toolName,
        target: plan.target,
        selectedChoiceId
      };
    }

    return {
      toolName: plan.toolName,
      target: plan.target,
      after: plan.after
    };
  }

  private buildOutputSummary(
    result: AgentToolExecutionResult
  ): AgentJsonObject {
    const outputSummary = this.sanitizeJsonObject(result.outputSummary);
    if (result.status && !("status" in outputSummary)) {
      outputSummary.status = result.status;
    }

    return outputSummary;
  }

  private async findLatestPlannerCapabilityIds(runId: string): Promise<string[]> {
    const row = await this.database.queryOne<{ output_json: AgentJsonObject }>(
      `
        SELECT output_json
        FROM agent_steps
        WHERE run_id = $1
          AND step_type = 'planner'
          AND status = 'completed'
        ORDER BY step_order DESC
        LIMIT 1
      `,
      [runId]
    );
    for (const source of [
      row?.output_json?.toolRouting,
      row?.output_json?.toolRetrieval
    ]) {
      if (!this.isPlainObject(source) || !Array.isArray(source.capabilityIds)) {
        continue;
      }
      const capabilityIds = source.capabilityIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0
      );
      if (capabilityIds.length > 0) {
        return capabilityIds;
      }
    }
    return [];
  }

  private async findCompletedToolNames(runId: string): Promise<string[]> {
    const rows = await this.database.query<{ tool_name: string }>(
      `
        SELECT DISTINCT tool_name
        FROM agent_steps
        WHERE run_id = $1
          AND step_type = 'tool'
          AND status = 'completed'
          AND tool_name IS NOT NULL
      `,
      [runId]
    );
    return rows.map((row) => row.tool_name);
  }

  private async executeWithLeaseHeartbeat<T>(
    runId: string,
    lease: AgentExecutionLease,
    operation: () => Promise<T>
  ): Promise<T> {
    let leaseLost = false;
    let heartbeatInFlight: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = this.agentLoggingService
        .heartbeatExecutionLease(runId, lease)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatInFlight = null;
        });
    }, EXECUTION_HEARTBEAT_SECONDS * 1000);

    try {
      const result = await operation();
      if (heartbeatInFlight) await heartbeatInFlight;
      if (leaseLost) throw new Error("Agent execution lease was fenced");
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private sanitizeResourceRefs(input: unknown): AgentResourceRef[] {
    const sanitized = this.sanitizeJsonValue(input);
    return Array.isArray(sanitized)
      ? (sanitized as unknown as AgentResourceRef[])
      : [];
  }

  private buildFinalAnswer(
    toolName: string,
    resourceRefs: AgentResourceRef[]
  ): string {
    if (resourceRefs.length === 0) {
      return `${toolName} 실행을 완료했습니다.`;
    }

    return `${toolName} 실행을 완료했습니다. 관련 리소스 ${resourceRefs.length}개를 확인했습니다.`;
  }

  private readCalendarEventId(plan: AgentConfirmationPlan): string {
    const targetId = plan.target.resourceId;
    if (typeof targetId === "string") {
      return targetId;
    }

    const callEventId = plan.call.eventId;
    if (typeof callEventId === "string") {
      return callEventId;
    }

    throw badRequest("Calendar event id is required for update plan");
  }

  private isExpired(value: Date | string): boolean {
    return new Date(value).getTime() <= Date.now();
  }

  private mapActionPayload(
    run: AgentRunRow,
    confirmation: AgentConfirmationRow
  ): AgentConfirmationActionPayload {
    return {
      run: {
        id: run.id,
        status: run.status,
        message: run.message,
        confirmation: {
          id: confirmation.id,
          status: confirmation.status,
          approvedAt: this.toIsoOrNull(confirmation.approved_at),
          rejectedAt: this.toIsoOrNull(confirmation.rejected_at),
          selectedChoiceId: confirmation.selected_choice_id
        }
      }
    };
  }

  private mapConfirmation(
    confirmation: AgentConfirmationRow
  ): AgentConfirmationPayload {
    return {
      id: confirmation.id,
      runId: confirmation.run_id,
      status: confirmation.status,
      riskLevel: confirmation.risk_level,
      plan: confirmation.plan_json,
      expiresAt: this.toIso(confirmation.expires_at),
      approvedAt: this.toIsoOrNull(confirmation.approved_at),
      rejectedAt: this.toIsoOrNull(confirmation.rejected_at),
      createdAt: this.toIso(confirmation.created_at),
      updatedAt: this.toIso(confirmation.updated_at),
      selectedChoiceId: confirmation.selected_choice_id
    };
  }

  private mapActionPayloadFromRun(
    run: Pick<AgentRunPayload, "id" | "status" | "message">,
    confirmation: AgentConfirmationRow
  ): AgentConfirmationActionPayload {
    return {
      run: {
        id: run.id,
        status: run.status,
        message: run.message,
        confirmation: {
          id: confirmation.id,
          status: confirmation.status,
          approvedAt: this.toIsoOrNull(confirmation.approved_at),
          rejectedAt: this.toIsoOrNull(confirmation.rejected_at),
          selectedChoiceId: confirmation.selected_choice_id
        }
      }
    };
  }

  private toSafeErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const message = this.readHttpExceptionMessage(error);
      if (message) {
        return message;
      }
    }

    return "Agent tool execution failed";
  }

  private readHttpExceptionMessage(error: HttpException): string | null {
    const response = error.getResponse();

    if (typeof response === "object" && response !== null) {
      const maybeError = "error" in response ? response.error : null;
      if (this.isPlainObject(maybeError)) {
        const message = maybeError.message;
        if (typeof message === "string" && message.trim()) {
          return message;
        }
      }

      const maybeMessage = "message" in response ? response.message : null;
      if (typeof maybeMessage === "string" && maybeMessage.trim()) {
        return maybeMessage;
      }
    }

    if (typeof response === "string" && response.trim()) {
      return response;
    }

    return null;
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

  private sanitizeJsonObject(input: unknown): AgentJsonObject {
    const sanitized = this.sanitizeJsonValue(input);
    return this.isPlainObject(sanitized) ? sanitized : {};
  }

  private sanitizeJsonValue(input: unknown): AgentJsonValue {
    if (Array.isArray(input)) {
      return input
        .slice(0, 100)
        .map((item) => this.sanitizeJsonValue(item)) as AgentJsonValue[];
    }

    if (this.isPlainObject(input)) {
      const sanitized: AgentJsonObject = {};
      for (const [key, value] of Object.entries(input)) {
        if (this.isForbiddenJsonKey(key)) {
          continue;
        }

        sanitized[key] = this.sanitizeJsonValue(value);
      }

      return sanitized;
    }

    if (typeof input === "string") {
      return input.slice(0, 2000);
    }

    if (
      typeof input === "number" ||
      typeof input === "boolean" ||
      input === null
    ) {
      return input;
    }

    return null;
  }

  private isForbiddenJsonKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return FORBIDDEN_JSON_KEY_PARTS.some((part) => normalized.includes(part));
  }
}
