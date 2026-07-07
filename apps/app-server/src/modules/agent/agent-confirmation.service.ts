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
  AgentStepPayload
} from "./agent-logging.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentRiskLevel
} from "./types/agent-tool.types";

type AgentRunStatus =
  | "planning"
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
}

interface AgentConfirmationWithRunRow extends AgentConfirmationRow {
  run_status: AgentRunStatus;
  run_message: string | null;
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
    };
  };
}

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AgentConfirmationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly agentToolRegistryService: AgentToolRegistryService
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

      this.assertExecutablePlan(confirmation.plan_json, confirmation.tool_name);
      const toolInput = this.validateApprovedPlan(confirmation.plan_json);

      const approved = await transaction.queryOne<AgentConfirmationRow>(
        `
          UPDATE agent_confirmations
          SET status = 'approved',
              approved_by_user_id = $2,
              approved_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [confirmation.id, currentUserId]
      );

      if (!approved) {
        throw new Error("Agent confirmation could not be approved");
      }

      const run = await this.updateRunStatus(transaction, runId, {
        status: "running",
        message: "승인된 작업을 실행하고 있습니다.",
        completed: false
      });

      return {
        expired: false,
        payload: this.mapActionPayload(run, approved),
        confirmation: approved,
        toolInput
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
      result.toolInput
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

  private async findConfirmationForUpdate(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      workspaceId: string;
      runId: string;
      confirmationId: string;
    }
  ): Promise<AgentConfirmationWithRunRow | null> {
    return transaction.queryOne<AgentConfirmationWithRunRow>(
      `
        SELECT
          c.*,
          r.status AS run_status,
          r.message AS run_message
        FROM agent_confirmations c
        JOIN agent_runs r
          ON r.id = c.run_id
        WHERE c.id = $1
          AND c.run_id = $2
          AND r.workspace_id = $3
          AND r.requested_by_user_id = $4
        FOR UPDATE OF c, r
      `,
      [
        input.confirmationId,
        input.runId,
        input.workspaceId,
        input.currentUserId
      ]
    );
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
            completed_at = CASE WHEN $4 THEN now() ELSE completed_at END
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

    if (
      typeof plan.summary !== "string" ||
      !this.isPlainObject(plan.target) ||
      !(plan.before === null || this.isPlainObject(plan.before)) ||
      !this.isPlainObject(plan.after) ||
      !this.isPlainObject(plan.call)
    ) {
      throw badRequest("Confirmation plan is not executable");
    }
  }

  private validateApprovedPlan(plan: AgentConfirmationPlan): unknown {
    const definition = this.agentToolRegistryService.getDefinition(plan.toolName);
    if (!definition) {
      throw badRequest(`Agent tool is not executable: ${plan.toolName}`);
    }

    const toolInput = this.buildToolInputFromPlan(plan);
    return definition.validateInput(toolInput);
  }

  private async executeApprovedPlan(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    confirmation: AgentConfirmationRow,
    toolInput: unknown
  ): Promise<AgentConfirmationActionPayload> {
    const definition = this.agentToolRegistryService.getDefinition(
      confirmation.tool_name
    );
    if (!definition) {
      throw badRequest(`Agent tool is not executable: ${confirmation.tool_name}`);
    }

    let step: AgentStepPayload | null = null;

    try {
      step = await this.agentLoggingService.startNextStep(
        currentUserId,
        workspaceId,
        {
          runId,
          type: "tool",
          toolName: confirmation.tool_name,
          riskLevel: confirmation.risk_level,
          inputSummary: this.buildStepInputSummary(confirmation.plan_json)
        }
      );

      const result = await definition.execute(
        {
          currentUserId,
          workspaceId,
          runId
        },
        toolInput
      );

      await this.agentLoggingService.completeStep(currentUserId, workspaceId, {
        runId,
        stepId: step.id,
        outputSummary: result.outputSummary,
        resourceRefs: result.resourceRefs
      });

      const run = await this.agentLoggingService.completeRun(
        currentUserId,
        workspaceId,
        {
          runId,
          riskLevel: confirmation.risk_level,
          finalAnswer: "승인된 Calendar 작업을 완료했습니다.",
          message: "승인된 작업을 완료했습니다."
        }
      );

      return this.mapActionPayloadFromRun(run, confirmation);
    } catch (error) {
      const message = this.toSafeErrorMessage(error);

      if (step) {
        await this.agentLoggingService.failStep(currentUserId, workspaceId, {
          runId,
          stepId: step.id,
          errorCode: "CALENDAR_TOOL_FAILED",
          errorMessage: message
        });
      }

      const run = await this.agentLoggingService.failRun(
        currentUserId,
        workspaceId,
        {
          runId,
          errorCode: "CALENDAR_TOOL_FAILED",
          errorMessage: message,
          message: "승인된 Calendar 작업을 실행하지 못했습니다."
        }
      );

      return this.mapActionPayloadFromRun(run, confirmation);
    }
  }

  private buildToolInputFromPlan(plan: AgentConfirmationPlan): unknown {
    if (plan.toolName === "create_calendar_event") {
      return plan.after;
    }

    if (plan.toolName === "update_calendar_event") {
      return {
        eventId: this.readCalendarEventId(plan),
        before: plan.before ?? {},
        changes: plan.after
      };
    }

    throw badRequest(`Agent tool is not executable: ${plan.toolName}`);
  }

  private buildStepInputSummary(plan: AgentConfirmationPlan): AgentJsonObject {
    return {
      toolName: plan.toolName,
      target: plan.target,
      after: plan.after
    };
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
          rejectedAt: this.toIsoOrNull(confirmation.rejected_at)
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
      updatedAt: this.toIso(confirmation.updated_at)
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
          rejectedAt: this.toIsoOrNull(confirmation.rejected_at)
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

    return "Calendar 작업 실행 중 오류가 발생했습니다.";
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
}
