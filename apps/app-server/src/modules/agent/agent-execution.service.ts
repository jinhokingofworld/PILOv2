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
import { buildAgentReadResultAnswer } from "./agent-read-result-formatter";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import { AgentGroundedAnswerService } from "./agent-grounded-answer.service";
import { AgentGroundedAnswerOutboxPublisherService } from "./agent-grounded-answer-outbox-publisher.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { AgentCandidateSelectionService } from "./agent-candidate-selection.service";
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
}

const RISK_LEVELS = ["low", "medium", "high"] as const;
const EXECUTION_MODES = ["auto", "confirmation_required", "contextual"] as const;
const LEGACY_MEETING_REPORT_SCHEMA_VERSION = "agent-tools:v6";
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
    private readonly agentToolRegistryService: AgentToolRegistryService,
    private readonly agentGroundedAnswerService: AgentGroundedAnswerService,
    private readonly agentGroundedAnswerOutboxPublisherService: AgentGroundedAnswerOutboxPublisherService,
    private readonly agentOutboxPublisherService: AgentOutboxPublisherService,
    private readonly agentCandidateSelectionService: AgentCandidateSelectionService
  ) {}

  async executeReadyRun(runId: string): Promise<AgentExecutionResult> {
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
        requestContext: run.request_context_json
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
    } = {}
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
      plannerOutput: plannerStep.output_json,
      prompt: context.prompt,
      timezone: context.timezone,
      requestContext: context.requestContext
    });
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
    const requestContext =
      input.requestContext === undefined
        ? await this.findRunRequestContext(currentUserId, workspaceId, runId)
        : input.requestContext;
    const definition = this.agentToolRegistryService.getDefinitionForContext(
      candidate.toolName,
      requestContext
    );

    if (!definition) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_CONTEXT_UNAVAILABLE",
        errorMessage: "Agent tool is unavailable for this context",
        message: "현재 화면에서는 요청을 처리할 수 있는 Agent 도구가 없습니다."
      });
    }

    const isLegacyMeetingReportPlan = this.isLegacyMeetingReportPlan(
      candidate,
      definition
    );
    if (!this.matchesRegistry(candidate, definition) && !isLegacyMeetingReportPlan) {
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
      candidate.input,
      isLegacyMeetingReportPlan
    );
    if (!validatedInput.ok) {
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
        input.timezone
      );
    }

    if (definition.executionMode === "confirmation_required") {
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

    return this.executeAutoTool(
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
    timezone?: string
  ): Promise<AgentExecutionResult> {
    if (!definition.prepareExecution) {
      return this.failRun(currentUserId, workspaceId, runId, {
        errorCode: "AGENT_TOOL_PREPARATION_UNAVAILABLE",
        errorMessage: "Contextual Agent tool preparation is not available",
        message: "Agent 도구 실행 방법을 결정하지 못했습니다."
      });
    }

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

      if (this.isClarificationResult(preparation)) {
        return this.completeClarification(
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
        return this.createConfirmationFromPlan(
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

      return this.executeAutoTool(
        currentUserId,
        workspaceId,
        runId,
        definition,
        input,
        plannerInput,
        requestContext,
        prompt,
        timezone
      );
    } catch (error) {
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
        waitForUserInput: true
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

    try {
      const result = await definition.execute(
        {
          currentUserId,
          workspaceId,
          runId,
          requestContext
        },
        validatedInput
      );
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
            message: "Canvas AI가 요청을 처리하고 있습니다."
          }
        );
        return { status: "skipped", reason: "already_started" };
      }

      if (definition.requiresGroundedAnswer) {
        await this.agentGroundedAnswerService.completeToolAndQueue({ currentUserId, workspaceId, runId, stepId: step.id, outputSummary, resourceRefs });
        await this.agentGroundedAnswerOutboxPublisherService
          .publish(runId)
          .catch(() => undefined);
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
          waitingMessage: definition.completesRunAfterExecution
            ? buildAgentReadResultAnswer({
                toolName: definition.name,
                outputSummary,
                resourceRefs,
                prompt,
                timezone
              })
            : "한 요청에서 실행할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.",
          waitForUserInput: definition.completesRunAfterExecution === true
        }
      );
      if (advanced.queuedNextPlannerTurn) {
        await this.agentOutboxPublisherService
          .publishCreatedRun(runId)
          .catch(() => undefined);
        return { status: "skipped", reason: "already_started" };
      }

      return {
        status: "waiting_user_input",
        run: advanced.run
      };
    } catch (error) {
      const safeMessage = this.toSafeErrorMessage(
        error,
        "Agent tool execution failed"
      );

      const failedStep = await this.agentLoggingService.failStep(
        currentUserId,
        workspaceId,
        {
          runId,
          stepId: step.id,
          errorCode: "AGENT_TOOL_EXECUTION_FAILED",
          errorMessage: safeMessage
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

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
