import { HttpException, Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  AgentConfirmationPayload,
  AgentConfirmationService
} from "./agent-confirmation.service";
import {
  AgentLoggingService,
  AgentRunPayload
} from "./agent-logging.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import type {
  AgentJsonObject,
  AgentJsonPrimitive,
  AgentJsonValue,
  AgentResourceRef,
  AgentRiskLevel,
  AgentToolDefinition,
  AgentToolExecutionMode,
  AgentToolExecutionResult
} from "./types/agent-tool.types";

export type AgentExecutionResult =
  | {
      status: "completed";
      run: AgentRunPayload;
    }
  | {
      status: "waiting_confirmation";
      confirmation: AgentConfirmationPayload;
    }
  | {
      status: "failed";
      run: AgentRunPayload;
    }
  | {
      status: "skipped";
      reason: "not_ready" | "already_started";
    };

interface AgentRunRow extends QueryResultRow {
  id: string;
  status: string;
}

interface AgentPlannerStepRow extends QueryResultRow {
  id: string;
  output_json: AgentJsonObject;
}

interface PlannedToolCandidate {
  toolName: string;
  input: AgentJsonObject;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  requiresConfirmation: boolean;
}

const RISK_LEVELS = ["low", "medium", "high"] as const;
const EXECUTION_MODES = ["auto", "confirmation_required"] as const;
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
export class AgentExecutionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly agentConfirmationService: AgentConfirmationService,
    private readonly agentToolRegistryService: AgentToolRegistryService
  ) {}

  async executeLatestPlannedTool(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<AgentExecutionResult> {
    const plannerStep = await this.findReadyPlannerStep(
      currentUserId,
      workspaceId,
      runId
    );
    if (!plannerStep) {
      return {
        status: "skipped",
        reason: "not_ready"
      };
    }

    const executionStarted = await this.hasExecutionStarted(runId);
    if (executionStarted) {
      return {
        status: "skipped",
        reason: "already_started"
      };
    }

    return this.executePlannerOutput(currentUserId, workspaceId, runId, {
      plannerOutput: plannerStep.output_json
    });
  }

  async executePlannerOutput(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    input: { plannerOutput: AgentJsonObject }
  ): Promise<AgentExecutionResult> {
    const candidate = this.parsePlannerOutput(input.plannerOutput);
    const definition = this.agentToolRegistryService.getDefinition(
      candidate.toolName
    );

    if (!definition) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_NOT_EXECUTABLE",
        errorMessage: "Agent tool is not registered",
        message: "요청을 처리할 수 있는 Agent 도구가 없습니다."
      });
    }

    if (!this.matchesRegistry(candidate, definition)) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_PLAN_MISMATCH",
        errorMessage: "Agent tool plan does not match registry metadata",
        message: "Agent tool 계획을 검증하지 못했습니다."
      });
    }

    if (definition.riskLevel === "high") {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_HIGH_RISK",
        errorMessage: "High-risk Agent tool execution is not supported",
        message: "현재 Agent 1차 범위에서 실행할 수 없는 작업입니다."
      });
    }

    const validatedInput = await this.validateToolInput(
      currentUserId,
      workspaceId,
      runId,
      definition,
      candidate.input
    );
    if (!validatedInput.ok) {
      return validatedInput.result;
    }

    if (definition.executionMode === "confirmation_required") {
      return this.createConfirmation(
        currentUserId,
        workspaceId,
        runId,
        definition,
        validatedInput.input
      );
    }

    return this.executeAutoTool(
      currentUserId,
      workspaceId,
      runId,
      definition,
      validatedInput.input,
      candidate.input
    );
  }

  private async findReadyPlannerStep(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<AgentPlannerStepRow | null> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const run = await this.database.queryOne<AgentRunRow>(
      `
        SELECT id, status
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

    if (run.status !== "running") {
      return null;
    }

    return this.findLatestPlannerStep(runId);
  }

  private async findLatestPlannerStep(
    runId: string
  ): Promise<AgentPlannerStepRow | null> {
    const step = await this.database.queryOne<AgentPlannerStepRow>(
      `
        SELECT id, output_json
        FROM agent_steps
        WHERE run_id = $1
          AND step_type = 'planner'
          AND status = 'completed'
        ORDER BY step_order DESC
        LIMIT 1
      `,
      [runId]
    );

    if (!step || step.output_json.status !== "tool_candidate") {
      return null;
    }

    return step;
  }

  private async hasExecutionStarted(runId: string): Promise<boolean> {
    const row = await this.database.queryOne<{ started: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM agent_steps
          WHERE run_id = $1
            AND step_type = 'tool'
        ) OR EXISTS (
          SELECT 1
          FROM agent_confirmations
          WHERE run_id = $1
        ) AS started
      `,
      [runId]
    );

    return row?.started === true;
  }

  private parsePlannerOutput(output: AgentJsonObject): PlannedToolCandidate {
    if (output.status !== "tool_candidate") {
      throw badRequest("Agent planner output is not a tool candidate");
    }

    const toolName = this.readNonEmptyString(output.toolName, "toolName");
    const riskLevel = this.readRiskLevel(output.riskLevel);
    const executionMode = this.readExecutionMode(output.executionMode);
    const requiresConfirmation = this.readBoolean(
      output.requiresConfirmation,
      "requiresConfirmation"
    );
    const toolInputValidation = this.readNonEmptyString(
      output.toolInputValidation,
      "toolInputValidation"
    );

    if (toolInputValidation !== "app_server_required") {
      throw badRequest("Agent planner output requires App Server validation");
    }

    if ((executionMode === "confirmation_required") !== requiresConfirmation) {
      throw badRequest("Agent planner confirmation metadata is inconsistent");
    }

    return {
      toolName,
      input: this.readPlainObject(output.input, "input"),
      riskLevel,
      executionMode,
      requiresConfirmation
    };
  }

  private matchesRegistry(
    candidate: PlannedToolCandidate,
    definition: AgentToolDefinition<unknown>
  ): boolean {
    return (
      candidate.toolName === definition.name &&
      candidate.riskLevel === definition.riskLevel &&
      candidate.executionMode === definition.executionMode
    );
  }

  private async validateToolInput(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    input: AgentJsonObject
  ): Promise<
    | {
        ok: true;
        input: unknown;
      }
    | {
        ok: false;
        result: AgentExecutionResult;
      }
  > {
    try {
      return {
        ok: true,
        input: definition.validateInput(input)
      };
    } catch (error) {
      return {
        ok: false,
        result: await this.failRun(currentUserId, workspaceId, runId, {
          errorCode: "AGENT_TOOL_VALIDATION_FAILED",
          errorMessage: this.toSafeErrorMessage(
            error,
            "Agent tool input validation failed"
          ),
          message: "Agent tool 입력을 검증하지 못했습니다."
        })
      };
    }
  }

  private async createConfirmation(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    input: unknown
  ): Promise<AgentExecutionResult> {
    if (!definition.buildConfirmation) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_CONFIRMATION_UNAVAILABLE",
        errorMessage: "Agent tool confirmation builder is not available",
        message: "승인이 필요한 작업 계획을 만들지 못했습니다."
      });
    }

    try {
      const plan = await definition.buildConfirmation(input);
      const confirmation = await this.agentConfirmationService.createConfirmation(
        currentUserId,
        workspaceId,
        {
          runId,
          toolName: definition.name,
          riskLevel: definition.riskLevel,
          summary: plan.summary,
          plan
        }
      );

      return {
        status: "waiting_confirmation",
        confirmation
      };
    } catch (error) {
      if (this.isAgentErrorCode(error, "CONFIRMATION_NOT_PENDING")) {
        return {
          status: "skipped",
          reason: "already_started"
        };
      }

      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_CONFIRMATION_FAILED",
        errorMessage: this.toSafeErrorMessage(
          error,
          "Agent tool confirmation could not be created"
        ),
        message: "승인이 필요한 작업 계획을 만들지 못했습니다."
      });
    }
  }

  private async executeAutoTool(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    validatedInput: unknown,
    plannerInput: AgentJsonObject
  ): Promise<AgentExecutionResult> {
    const step = await this.agentLoggingService.startNextToolStepIfAbsent(
      currentUserId,
      workspaceId,
      {
        runId,
        toolName: definition.name,
        riskLevel: definition.riskLevel,
        inputSummary: {
          toolName: definition.name,
          riskLevel: definition.riskLevel,
          executionMode: definition.executionMode,
          input: this.sanitizeJsonObject(plannerInput)
        }
      }
    );
    if (!step) {
      return {
        status: "skipped",
        reason: "already_started"
      };
    }

    try {
      const result = await definition.execute(
        {
          currentUserId,
          workspaceId,
          runId
        },
        validatedInput
      );
      const outputSummary = this.buildOutputSummary(result);
      const resourceRefs = this.sanitizeResourceRefs(result.resourceRefs);

      await this.agentLoggingService.completeStep(currentUserId, workspaceId, {
        runId,
        stepId: step.id,
        outputSummary,
        resourceRefs
      });

      const run = await this.agentLoggingService.completeRun(
        currentUserId,
        workspaceId,
        {
          runId,
          riskLevel: definition.riskLevel,
          finalAnswer: this.buildFinalAnswer(definition.name, resourceRefs),
          message: "요청을 완료했습니다."
        }
      );

      return {
        status: "completed",
        run
      };
    } catch (error) {
      const safeMessage = this.toSafeErrorMessage(
        error,
        "Agent tool execution failed"
      );

      await this.agentLoggingService.failStep(currentUserId, workspaceId, {
        runId,
        stepId: step.id,
        errorCode: "AGENT_TOOL_EXECUTION_FAILED",
        errorMessage: safeMessage
      });

      const run = await this.agentLoggingService.failRun(
        currentUserId,
        workspaceId,
        {
          runId,
          errorCode: "AGENT_TOOL_EXECUTION_FAILED",
          errorMessage: safeMessage,
          message: "Agent tool을 실행하지 못했습니다."
        }
      );

      return {
        status: "failed",
        run
      };
    }
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

  private async failRun(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    input: {
      errorCode: string;
      errorMessage: string;
      message: string;
    }
  ): Promise<AgentExecutionResult> {
    const run = await this.agentLoggingService.failRun(
      currentUserId,
      workspaceId,
      {
        runId,
        ...input
      }
    );

    return {
      status: "failed",
      run
    };
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

  private toSafeErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpException) {
      const message = this.readHttpExceptionMessage(error);
      if (message) {
        return message;
      }
    }

    return fallback;
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

  private isAgentErrorCode(error: unknown, code: string): boolean {
    if (!(error instanceof HttpException)) {
      return false;
    }

    const response = error.getResponse();
    if (!this.isPlainObject(response)) {
      return false;
    }

    const maybeError = response.error;
    return (
      this.isPlainObject(maybeError) &&
      maybeError.code === code
    );
  }

  private sanitizeJsonObject(input: unknown): AgentJsonObject {
    const sanitized = this.sanitizeJsonValue(input);
    return this.isPlainObject(sanitized) ? sanitized : {};
  }

  private sanitizeResourceRefs(input: unknown): AgentResourceRef[] {
    const sanitized = this.sanitizeJsonValue(input);
    return Array.isArray(sanitized)
      ? (sanitized as unknown as AgentResourceRef[])
      : [];
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
      return input as AgentJsonPrimitive;
    }

    return null;
  }

  private readPlainObject(value: unknown, field: string): AgentJsonObject {
    if (!this.isPlainObject(value)) {
      throw badRequest(`Agent planner ${field} must be an object`);
    }

    return value;
  }

  private readNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`Agent planner ${field} is invalid`);
    }

    return value.trim();
  }

  private readBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
      throw badRequest(`Agent planner ${field} is invalid`);
    }

    return value;
  }

  private readRiskLevel(value: unknown): AgentRiskLevel {
    const riskLevel = this.readNonEmptyString(value, "riskLevel");
    if (!RISK_LEVELS.some((level) => level === riskLevel)) {
      throw badRequest("Agent planner riskLevel is invalid");
    }

    return riskLevel as AgentRiskLevel;
  }

  private readExecutionMode(value: unknown): AgentToolExecutionMode {
    const executionMode = this.readNonEmptyString(value, "executionMode");
    if (!EXECUTION_MODES.some((mode) => mode === executionMode)) {
      throw badRequest("Agent planner executionMode is invalid");
    }

    return executionMode as AgentToolExecutionMode;
  }

  private isForbiddenJsonKey(key: string): boolean {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    return FORBIDDEN_JSON_KEY_PARTS.some((part) => normalized.includes(part));
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
