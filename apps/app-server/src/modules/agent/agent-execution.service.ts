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
  AgentRunPayload,
  type AgentExecutionLease
} from "./agent-logging.service";
import { AgentLatencyObserver } from "./agent-latency-observer";
import { isTerminalAgentCapabilityTool } from "./agent-tool-capability-catalog";
import { buildAgentReadResultAnswer } from "./agent-read-result-formatter";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import { AgentGroundedAnswerService } from "./agent-grounded-answer.service";
import { AgentGroundedAnswerOutboxPublisherService } from "./agent-grounded-answer-outbox-publisher.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { AgentCandidateSelectionService } from "./agent-candidate-selection.service";
import { EmbeddingTemporarilyUnavailableError } from "./grounding/query-embedding";
import type {
  AgentJsonObject,
  AgentJsonPrimitive,
  AgentJsonValue,
  AgentConfirmationPlan,
  AgentResourceRef,
  AgentRiskLevel,
  AgentToolDefinition,
  AgentToolClarificationResult,
  AgentToolExecutionMode,
  AgentToolExecutionResult,
  AgentToolPostExecutionDisposition,
  AgentRunRequestContext,
  AgentToolPreparationResult
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
      status: "waiting_user_input";
      run: AgentRunPayload;
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

interface AgentExecutionRunRow extends AgentRunRow {
  prompt: string;
  workspace_id: string;
  requested_by_user_id: string;
  timezone: string;
  request_context_json: AgentRunRequestContext;
}

interface AgentPlannerStepRow extends QueryResultRow {
  id: string;
  output_json: AgentJsonObject;
}

interface PlannedToolCandidate {
  toolName: string;
  toolSchemaVersion: string;
  input: AgentJsonObject;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  requiresConfirmation: boolean | null;
  capabilityIds: string[];
}

const RISK_LEVELS = ["low", "medium", "high"] as const;
const EXECUTION_MODES = ["auto", "confirmation_required", "contextual"] as const;
const LEGACY_MEETING_REPORT_SCHEMA_VERSION = "agent-tools:v6";
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
export class AgentExecutionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly agentConfirmationService: AgentConfirmationService,
    private readonly agentToolRegistryService: AgentToolRegistryService,
    private readonly agentGroundedAnswerService: AgentGroundedAnswerService,
    private readonly agentGroundedAnswerOutboxPublisherService: AgentGroundedAnswerOutboxPublisherService,
    private readonly agentOutboxPublisherService: AgentOutboxPublisherService,
    private readonly agentCandidateSelectionService: AgentCandidateSelectionService,
    private readonly agentLatencyObserver?: AgentLatencyObserver
  ) {}

  async executeReadyRun(runId: string): Promise<AgentExecutionResult> {
    const toolTurnStartedAt = this.agentLatencyObserver?.start();
    const run = await this.database.queryOne<AgentExecutionRunRow>(
      `
        SELECT
          id,
          workspace_id,
          requested_by_user_id,
          status,
          prompt,
          timezone,
          request_context_json
        FROM agent_runs
        WHERE id = $1
      `,
      [runId]
    );

    if (!run) {
      throw notFound("Agent run not found");
    }

    return this.executeLatestPlannedTool(
      run.requested_by_user_id,
      run.workspace_id,
      run.id,
      {
        prompt: run.prompt,
        timezone: run.timezone,
        requestContext: run.request_context_json,
        toolTurnStartedAt
      }
    );
  }

  async executeLatestPlannedTool(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    context: {
      prompt?: string;
      timezone?: string;
      requestContext?: AgentRunRequestContext;
      toolTurnStartedAt?: number;
    } = {}
  ): Promise<AgentExecutionResult> {
    const toolTurnStartedAt =
      context.toolTurnStartedAt ?? this.agentLatencyObserver?.start();
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

    const toolName =
      typeof plannerStep.output_json.toolName === "string"
        ? plannerStep.output_json.toolName
        : "";
    const requestContext =
      context.requestContext === undefined
        ? await this.findRunRequestContext(currentUserId, workspaceId, runId)
        : context.requestContext;
    try {
      const result = await this.executePlannerOutput(
        currentUserId,
        workspaceId,
        runId,
        {
          plannerOutput: plannerStep.output_json,
          prompt: context.prompt,
          timezone: context.timezone,
          requestContext
        }
      );
      this.observeLatency({
        runId,
        requestContext,
        toolName,
        stage: "tool_turn",
        outcome: this.latencyOutcome(result),
        startedAt: toolTurnStartedAt
      });
      return result;
    } catch (error) {
      this.observeLatency({
        runId,
        requestContext,
        toolName,
        stage: "tool_turn",
        outcome: "failure",
        startedAt: toolTurnStartedAt,
        failureType: "domain_error"
      });
      throw error;
    }
  }

  async executePlannerOutput(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    input: {
      plannerOutput: AgentJsonObject;
      prompt?: string;
      timezone?: string;
      requestContext?: AgentRunRequestContext;
    }
  ): Promise<AgentExecutionResult> {
    const candidate = this.parsePlannerOutput(input.plannerOutput);
    const preparationStartedAt = this.agentLatencyObserver?.start();
    const requestContext =
      input.requestContext === undefined
        ? await this.findRunRequestContext(currentUserId, workspaceId, runId)
        : input.requestContext;
    const definition = this.agentToolRegistryService.getDefinitionForContext(
      candidate.toolName,
      requestContext
    );

    if (!definition) {
      this.observeLatency({
        runId,
        requestContext,
        toolName: candidate.toolName,
        stage: "tool_preparation",
        outcome: "failure",
        startedAt: preparationStartedAt,
        failureType: "validation_error"
      });
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_CONTEXT_UNAVAILABLE",
        errorMessage: "Agent tool is unavailable for this context",
        message: "현재 화면에서는 요청을 처리할 수 있는 Agent 도구가 없습니다."
      });
    }
    const completedToolNames =
      candidate.capabilityIds.length > 0
        ? await this.findCompletedToolNames(runId)
        : [];
    const postExecutionDisposition: AgentToolPostExecutionDisposition =
      candidate.capabilityIds.length > 0
        ? isTerminalAgentCapabilityTool(
            candidate.capabilityIds,
            definition.name,
            completedToolNames
          )
          ? "complete_run"
          : "continue_planning"
        : definition.postExecutionDisposition ?? "continue_planning";

    const isLegacyMeetingReportPlan = this.isLegacyMeetingReportPlan(
      candidate,
      definition
    );
    if (!this.matchesRegistry(candidate, definition) && !isLegacyMeetingReportPlan) {
      this.observeLatency({
        runId,
        requestContext,
        toolName: candidate.toolName,
        stage: "tool_preparation",
        outcome: "failure",
        startedAt: preparationStartedAt,
        failureType: "validation_error"
      });
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_PLAN_MISMATCH",
        errorMessage: "Agent tool plan does not match registry metadata",
        message: "Agent tool 계획을 검증하지 못했습니다."
      });
    }

    if (definition.riskLevel === "high") {
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_preparation",
        outcome: "failure",
        startedAt: preparationStartedAt,
        failureType: "validation_error"
      });
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
      candidate.input,
      isLegacyMeetingReportPlan
    );
    if (!validatedInput.ok) {
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_preparation",
        outcome: "failure",
        startedAt: preparationStartedAt,
        failureType: "validation_error"
      });
      return validatedInput.result;
    }

    if (definition.executionMode === "contextual" && !validatedInput.isLegacyAdapter) {
      return this.executeContextualTool(
        currentUserId,
        workspaceId,
        runId,
        definition,
        validatedInput.input,
        validatedInput.plannerInput,
        requestContext,
        input.prompt,
        input.timezone,
        postExecutionDisposition,
        preparationStartedAt
      );
    }

    if (definition.executionMode === "confirmation_required") {
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_preparation",
        outcome: "success",
        startedAt: preparationStartedAt
      });
      return this.createConfirmation(
        currentUserId,
        workspaceId,
        runId,
        definition,
        validatedInput.input,
        validatedInput.plannerInput,
        requestContext,
        input.prompt,
        input.timezone
      );
    }

    this.observeLatency({
      runId,
      requestContext,
      toolName: definition.name,
      stage: "tool_preparation",
      outcome: "success",
      startedAt: preparationStartedAt
    });
    return this.executeAutoTool(
      currentUserId,
      workspaceId,
      runId,
      definition,
      validatedInput.input,
      validatedInput.plannerInput,
      requestContext,
      input.prompt,
      input.timezone,
      postExecutionDisposition
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

  private async findRunRequestContext(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<AgentRunRequestContext> {
    const run = await this.database.queryOne<{
      request_context_json: AgentRunRequestContext;
    }>(
      `
        SELECT request_context_json
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

    return run.request_context_json ?? null;
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
            AND status = 'running'
        ) OR EXISTS (
          SELECT 1
          FROM agent_confirmations
          WHERE run_id = $1
            AND status = 'pending'
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
    const toolSchemaVersion = this.readNonEmptyString(
      output.toolSchemaVersion,
      "toolSchemaVersion"
    );
    const riskLevel = this.readRiskLevel(output.riskLevel);
    const executionMode = this.readExecutionMode(output.executionMode);
    const requiresConfirmation = this.readConfirmationRequirement(
      output.requiresConfirmation,
      executionMode
    );
    const toolInputValidation = this.readNonEmptyString(
      output.toolInputValidation,
      "toolInputValidation"
    );

    if (toolInputValidation !== "app_server_required") {
      throw badRequest("Agent planner output requires App Server validation");
    }

    return {
      toolName,
      toolSchemaVersion,
      input: this.readPlainObject(output.input, "input"),
      riskLevel,
      executionMode,
      requiresConfirmation,
      capabilityIds: this.readCapabilityIds(output.toolRouting)
    };
  }

  private readCapabilityIds(value: AgentJsonValue | undefined): string[] {
    if (!this.isPlainObject(value) || !Array.isArray(value.capabilityIds)) {
      return [];
    }
    return value.capabilityIds.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
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

  private isLegacyMeetingReportPlan(
    candidate: PlannedToolCandidate,
    definition: AgentToolDefinition<unknown>
  ): boolean {
    if (
      candidate.toolSchemaVersion !== LEGACY_MEETING_REPORT_SCHEMA_VERSION ||
      candidate.toolName !== definition.name
    ) {
      return false;
    }
    const matchesLegacyMetadata =
      definition.name === "regenerate_meeting_report"
        ? candidate.riskLevel === "medium" &&
          candidate.executionMode === "confirmation_required" &&
          candidate.requiresConfirmation === true
        : [
              "get_meeting_report",
              "summarize_meeting_report",
              "find_action_items",
              "get_meeting_decision_evidence"
            ].includes(definition.name) &&
          candidate.riskLevel === "low" &&
          candidate.executionMode === "auto" &&
          candidate.requiresConfirmation === false;
    if (!matchesLegacyMetadata) return false;
    return definition.adaptLegacyPlannerInput?.(candidate.input) !== null;
  }

  private async validateToolInput(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    input: AgentJsonObject,
    allowLegacyAdapter: boolean
  ): Promise<
    | {
        ok: true;
        input: unknown;
        plannerInput: AgentJsonObject;
        isLegacyAdapter: boolean;
      }
    | {
        ok: false;
        result: AgentExecutionResult;
      }
  > {
    try {
      return {
        ok: true,
        input: definition.validateInput(input),
        plannerInput: input,
        isLegacyAdapter: false
      };
    } catch (error) {
      const legacyInput = allowLegacyAdapter
        ? definition.adaptLegacyPlannerInput?.(input)
        : null;
      if (legacyInput !== null && legacyInput !== undefined) {
        return {
          ok: true,
          input: legacyInput,
          plannerInput: {
            compatibility: "legacy_persisted_planner_input"
          },
          isLegacyAdapter: true
        };
      }
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

  private async executeContextualTool(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    input: unknown,
    plannerInput: AgentJsonObject,
    requestContext: AgentRunRequestContext,
    prompt?: string,
    timezone?: string,
    postExecutionDisposition: AgentToolPostExecutionDisposition =
      "continue_planning",
    preparationStartedAt?: number
  ): Promise<AgentExecutionResult> {
    if (!definition.prepareExecution) {
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_preparation",
        outcome: "failure",
        startedAt: preparationStartedAt,
        failureType: "validation_error"
      });
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_PREPARATION_UNAVAILABLE",
        errorMessage: "Contextual Agent tool preparation is not available",
        message: "Agent 도구 실행 방법을 결정하지 못했습니다."
      });
    }

    let preparationReturned = false;
    let preparationOutcomeEmitted = false;
    try {
      const preparation: AgentToolPreparationResult =
        await definition.prepareExecution(
          {
            currentUserId,
            workspaceId,
            runId,
            requestContext
          },
          input
        );
      preparationReturned = true;

      if (this.isClarificationResult(preparation)) {
        this.observeLatency({
          runId,
          requestContext,
          toolName: definition.name,
          stage: "tool_preparation",
          outcome: "clarification",
          startedAt: preparationStartedAt
        });
        preparationOutcomeEmitted = true;
        return await this.completeClarification(
          currentUserId,
          workspaceId,
          runId,
          definition,
          plannerInput,
          preparation,
          prompt,
          timezone
        );
      }

      if (preparation.kind === "confirmation") {
        this.observeLatency({
          runId,
          requestContext,
          toolName: definition.name,
          stage: "tool_preparation",
          outcome: "success",
          startedAt: preparationStartedAt
        });
        preparationOutcomeEmitted = true;
        return await this.createConfirmationFromPlan(
          currentUserId,
          workspaceId,
          runId,
          definition,
          preparation.plan
        );
      }

      if (preparation.kind !== "execute") {
        throw badRequest("Agent tool preparation result is invalid");
      }

      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_preparation",
        outcome: "success",
        startedAt: preparationStartedAt
      });
      preparationOutcomeEmitted = true;
      return this.executeAutoTool(
        currentUserId,
        workspaceId,
        runId,
        definition,
        input,
        plannerInput,
        requestContext,
        prompt,
        timezone,
        postExecutionDisposition
      );
    } catch (error) {
      if (!preparationOutcomeEmitted) {
        this.observeLatency({
          runId,
          requestContext,
          toolName: definition.name,
          stage: "tool_preparation",
          outcome: "failure",
          startedAt: preparationStartedAt,
          failureType: preparationReturned ? "validation_error" : "domain_error"
        });
      }
      if (this.isAgentErrorCode(error, "CONFIRMATION_NOT_PENDING")) {
        return {
          status: "skipped",
          reason: "already_started"
        };
      }

      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_PREPARATION_FAILED",
        errorMessage: this.toSafeErrorMessage(
          error,
          "Contextual Agent tool preparation failed"
        ),
        message: "Agent 도구 실행 방법을 결정하지 못했습니다."
      });
    }
  }

  private async createConfirmationFromPlan(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    plan: AgentConfirmationPlan
  ): Promise<AgentExecutionResult> {
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
  }

  private async createConfirmation(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    input: unknown,
    plannerInput: AgentJsonObject,
    requestContext: AgentRunRequestContext,
    prompt?: string,
    timezone?: string
  ): Promise<AgentExecutionResult> {
    if (!definition.buildConfirmation) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_CONFIRMATION_UNAVAILABLE",
        errorMessage: "Agent tool confirmation builder is not available",
        message: "승인이 필요한 작업 계획을 만들지 못했습니다."
      });
    }

    try {
      const planOrClarification = await definition.buildConfirmation(
        {
          currentUserId,
          workspaceId,
          runId,
          requestContext
        },
        input
      );
      if (this.isClarificationResult(planOrClarification)) {
        return this.completeClarification(
          currentUserId,
          workspaceId,
          runId,
          definition,
          plannerInput,
          planOrClarification,
          prompt,
          timezone
        );
      }
      const plan = planOrClarification;
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

  private async completeClarification(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    plannerInput: AgentJsonObject,
    clarification: AgentToolClarificationResult,
    prompt?: string,
    timezone?: string
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

    const candidateContext = {
      currentUserId,
      workspaceId,
      runId,
      requestContext: await this.findRunRequestContext(
        currentUserId,
        workspaceId,
        runId
      )
    };
    const candidateSelections = clarification.candidateResources?.length
      ? clarification.candidateResources.every(
          ({ reference }) => !reference.domain || reference.domain === "meeting"
        )
        ? await this.agentCandidateSelectionService.createMeetingCandidates(
            candidateContext,
            step.id,
            clarification.candidateResources.map(({ reference, candidate }) => ({
              reference: {
                resourceType: reference.resourceType as
                  | "meeting_room"
                  | "meeting"
                  | "meeting_report"
                  | "workspace_member"
                  | "meeting_report_action_item",
                resourceId: reference.resourceId,
                ...(reference.reportId ? { reportId: reference.reportId } : {})
              },
              candidate: {
                resourceType: reference.resourceType as
                  | "meeting_room"
                  | "meeting"
                  | "meeting_report"
                  | "workspace_member"
                  | "meeting_report_action_item",
                label: candidate.label,
                description: candidate.description,
                status: candidate.status
              }
            }))
          )
        : await this.agentCandidateSelectionService.createCandidates(
            candidateContext,
            step.id,
            clarification.candidateResources.map(({ reference, candidate }) => ({
              reference: {
                domain: reference.domain ?? "meeting",
                resourceType: reference.resourceType,
                resourceId: reference.resourceId,
                ...(reference.reportId ? { reportId: reference.reportId } : {})
              },
              candidate: {
                label: candidate.label,
                description: candidate.description,
                status: candidate.status
              }
            }))
          )
      : [];
    const outputSummary = this.sanitizeJsonObject({
      ...clarification.outputSummary,
      ...(candidateSelections.length > 0 ? { candidateSelections } : {})
    });
    const resourceRefs = this.sanitizeResourceRefs(clarification.resourceRefs);
    const answer =
      typeof outputSummary.question === "string" && outputSummary.question.trim()
        ? outputSummary.question.trim()
        : buildAgentReadResultAnswer({
            toolName: definition.name,
            outputSummary,
            resourceRefs,
            prompt,
            timezone
          });
    const advanced = await this.agentLoggingService.completeToolStepAndAdvance(
      currentUserId,
      workspaceId,
      {
        runId,
        stepId: step.id,
        outputSummary,
        resourceRefs,
        riskLevel: definition.riskLevel,
        waitingMessage: answer,
        postExecutionDisposition: "wait_for_user_input"
      }
    );

    return {
      status: "waiting_user_input",
      run: advanced.run
    };
  }

  private async executeAutoTool(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    definition: AgentToolDefinition<unknown>,
    validatedInput: unknown,
    plannerInput: AgentJsonObject,
    requestContext: AgentRunRequestContext,
    prompt?: string,
    timezone?: string,
    postExecutionDisposition: AgentToolPostExecutionDisposition =
      "continue_planning"
  ): Promise<AgentExecutionResult> {
    const claim = await this.agentLoggingService.startNextToolExecutionClaimIfAbsent(
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
    if (!claim) {
      return {
        status: "skipped",
        reason: "already_started"
      };
    }
    const { step, lease } = claim;
    const executionStartedAt = this.agentLatencyObserver?.start();
    let executionCompleted = false;
    let advanceStartedAt: number | undefined;

    try {
      const result = await this.executeWithLeaseHeartbeat(
        runId,
        lease,
        () =>
          definition.execute(
            {
              currentUserId,
              workspaceId,
              runId,
              requestContext
            },
            validatedInput
          )
      );
      executionCompleted = true;
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_execution",
        outcome: "success",
        startedAt: executionStartedAt
      });
      advanceStartedAt = this.agentLatencyObserver?.start();
      const outputSummary = this.buildOutputSummary(result);
      const resourceRefs = this.sanitizeResourceRefs(result.resourceRefs);

      if (result.status === "delegated") {
        await this.agentLoggingService.deferToolStep(
          currentUserId,
          workspaceId,
          {
            runId,
            stepId: step.id,
            outputSummary,
            resourceRefs,
            riskLevel: definition.riskLevel,
            message: "Canvas AI가 요청을 처리하고 있습니다.",
            executionLease: lease
          }
        );
        this.observeLatency({
          runId,
          requestContext,
          toolName: definition.name,
          stage: "tool_advance",
          outcome: "success",
          startedAt: advanceStartedAt
        });
        return { status: "skipped", reason: "already_started" };
      }

      if (definition.requiresGroundedAnswer) {
        await this.agentGroundedAnswerService.completeToolAndQueue({ currentUserId, workspaceId, runId, stepId: step.id, outputSummary, resourceRefs, groundingSources: result.groundingSources, executionLease: lease });
        await this.agentGroundedAnswerOutboxPublisherService
          .publish(runId)
          .catch(() => undefined);
        this.observeLatency({
          runId,
          requestContext,
          toolName: definition.name,
          stage: "tool_advance",
          outcome: "success",
          startedAt: advanceStartedAt
        });
        return { status: "skipped", reason: "already_started" };
      }

      const advanced = await this.agentLoggingService.completeToolStepAndAdvance(
        currentUserId,
        workspaceId,
        {
          runId,
          stepId: step.id,
          outputSummary,
          resourceRefs,
          riskLevel: definition.riskLevel,
          waitingMessage: postExecutionDisposition === "complete_run"
            ? buildAgentReadResultAnswer({
                toolName: definition.name,
                outputSummary,
                resourceRefs,
                prompt,
                timezone
              })
            : "한 요청에서 실행할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.",
          postExecutionDisposition,
          executionLease: lease
        }
      );
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: "tool_advance",
        outcome: advanced.run.status === "waiting_user_input"
          ? "clarification"
          : "success",
        startedAt: advanceStartedAt
      });
      if (advanced.queuedNextPlannerTurn) {
        await this.agentOutboxPublisherService
          .publishCreatedRun(runId)
          .catch(() => undefined);
        return { status: "skipped", reason: "already_started" };
      }

      return advanced.run.status === "completed"
        ? { status: "completed", run: advanced.run }
        : { status: "waiting_user_input", run: advanced.run };
    } catch (error) {
      this.observeLatency({
        runId,
        requestContext,
        toolName: definition.name,
        stage: executionCompleted ? "tool_advance" : "tool_execution",
        outcome: "failure",
        startedAt: executionCompleted ? advanceStartedAt : executionStartedAt,
        failureType: "domain_error"
      });
      const embeddingUnavailable = error instanceof EmbeddingTemporarilyUnavailableError;
      const errorCode = embeddingUnavailable
        ? error.code
        : "AGENT_TOOL_EXECUTION_FAILED";
      const safeMessage = embeddingUnavailable
        ? error.message
        : this.toSafeErrorMessage(error, "Agent tool execution failed");

      const failedStep = await this.agentLoggingService.failStep(
        currentUserId,
        workspaceId,
        {
          runId,
          stepId: step.id,
          errorCode,
          errorMessage: safeMessage,
          executionLease: lease
        }
      );
      if (failedStep.status === "completed") {
        return { status: "skipped", reason: "already_started" };
      }

      const run = await this.agentLoggingService.failRun(
        currentUserId,
        workspaceId,
        {
          runId,
          errorCode,
          errorMessage: safeMessage,
          message: embeddingUnavailable
            ? "근거 검색이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
            : "Agent tool을 실행하지 못했습니다."
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

  private async executeWithLeaseHeartbeat<T>(
    runId: string,
    lease: AgentExecutionLease,
    operation: () => Promise<T>
  ): Promise<T> {
    let leaseLost = false;
    let heartbeatInFlight: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = this.agentLoggingService
        .heartbeatExecutionLease(runId, lease)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatInFlight = null;
        });
    }, EXECUTION_HEARTBEAT_SECONDS * 1000);

    try {
      const result = await operation();
      if (heartbeatInFlight) {
        await heartbeatInFlight;
      }
      if (leaseLost) {
        throw new Error("Agent execution lease was fenced");
      }
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private isClarificationResult(
    input:
      | AgentToolClarificationResult
      | AgentConfirmationPlan
      | AgentToolPreparationResult
  ): input is AgentToolClarificationResult {
    return "kind" in input && input.kind === "needs_clarification";
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
        if (
          this.isForbiddenJsonKey(key) &&
          !this.isSafeSelectionToken(key, value)
        ) {
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

  private readConfirmationRequirement(
    value: unknown,
    executionMode: AgentToolExecutionMode
  ): boolean | null {
    if (executionMode === "contextual") {
      if (value !== null) {
        throw badRequest("Agent planner confirmation metadata is inconsistent");
      }

      return null;
    }

    const requiresConfirmation = this.readBoolean(
      value,
      "requiresConfirmation"
    );
    if (
      (executionMode === "confirmation_required") !== requiresConfirmation
    ) {
      throw badRequest("Agent planner confirmation metadata is inconsistent");
    }

    return requiresConfirmation;
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

  private isSafeSelectionToken(key: string, value: unknown): boolean {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    return (
      normalized === "selectiontoken" &&
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    );
  }

  private observeLatency(input: {
    runId: string;
    requestContext: AgentRunRequestContext;
    toolName: string;
    stage: string;
    outcome: string;
    startedAt?: number;
    failureType?: string;
  }): void {
    if (
      !this.agentLatencyObserver ||
      input.requestContext?.surface !== "sql_erd" ||
      !["inspect_sql_erd_schema", "focus_sql_erd_tables"].includes(
        input.toolName
      )
    ) {
      return;
    }
    this.agentLatencyObserver.observe({
      runId: input.runId,
      stage: input.stage,
      outcome: input.outcome,
      startedAt: input.startedAt,
      surface: "sql_erd",
      toolName: input.toolName,
      failureType: input.failureType
    });
  }

  private latencyOutcome(result: AgentExecutionResult): string {
    if (result.status === "failed") {
      return "failure";
    }
    if (result.status === "waiting_user_input") {
      return "clarification";
    }
    return "success";
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
