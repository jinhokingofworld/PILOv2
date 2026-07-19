import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { CanvasAgentService } from "../../canvas/agent/canvas-agent.service";
import type { CreateCanvasAgentRunRequest } from "../../canvas/agent/canvas-agent.types";
import type {
  AgentJsonObject,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolInputSchema,
  AgentToolPreparationResult
} from "../types/agent-tool.types";

type CanvasDelegationInput = Record<string, never>;

type CanvasCandidate = {
  id: string;
  title: string;
};

type CanvasResolution =
  | {
      kind: "resolved";
      canvas: CanvasCandidate;
    }
  | {
      kind: "needs_clarification";
      question: string;
    };

const INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
};

@Injectable()
export class CanvasAgentDelegationToolsService {
  constructor(
    private readonly canvasAgentService: CanvasAgentService,
    private readonly database: DatabaseService
  ) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      {
        name: "delegate_canvas_agent",
        description:
          "Use for requests about the Workspace Canvas or its active selection: finding existing shapes, Canvas toolbar help when the UI context enables toolHelpMode, and generating static HTML/CSS from an explicit Canvas selection. The App Server prioritizes the active classic freeform Canvas context, otherwise resolves the Workspace's single classic freeform Canvas, and delegates the user's original wording to Canvas AI. It does not create diagrams or arbitrary Canvas shapes. Do not rewrite the prompt or include identifiers in the tool input.",
        riskLevel: "low",
        executionMode: "contextual",
        inputSchema: INPUT_SCHEMA,
        validateInput: (input) => this.validateInput(input),
        prepareExecution: (context, input) =>
          this.prepareExecution(context, this.validateInput(input)),
        execute: (context, input) =>
          this.execute(context, this.validateInput(input))
      }
    ];
  }

  private validateInput(input: unknown): CanvasDelegationInput {
    if (!this.isRecord(input)) {
      throw badRequest("delegate_canvas_agent input must be an object");
    }
    const unexpected = Object.keys(input)[0];
    if (unexpected) {
      throw badRequest(`delegate_canvas_agent input field is invalid: ${unexpected}`);
    }
    return {};
  }

  private async prepareExecution(
    context: AgentToolContext,
    _input: CanvasDelegationInput
  ): Promise<AgentToolPreparationResult> {
    const resolution = await this.resolveCanvas(context);
    if (resolution.kind === "needs_clarification") {
      return this.toClarification(resolution.question);
    }
    return { kind: "execute" };
  }

  private async execute(
    context: AgentToolContext,
    _input: CanvasDelegationInput
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveCanvas(context);
    if (resolution.kind === "needs_clarification") {
      return {
        status: "needs_clarification",
        outputSummary: {
          status: "needs_clarification",
          question: resolution.question
        },
        resourceRefs: []
      };
    }
    const canvas = resolution.canvas;
    const prompt = await this.readOriginalPrompt(context.runId);
    const canvasContext =
      context.requestContext?.surface === "canvas" &&
      context.requestContext.canvasId === canvas.id
        ? context.requestContext.canvasContext
        : {};
    const run = await this.canvasAgentService.createDelegatedRun(
      context.currentUserId,
      context.workspaceId,
      canvas.id,
      context.runId,
      this.buildCanvasRequest(prompt, canvasContext, context.runId, canvas.id)
    );

    return {
      status: "delegated",
      outputSummary: {
        canvasAgentRunId: run.id,
        canvasId: canvas.id,
        canvasTitle: canvas.title,
        status: run.status
      },
      resourceRefs: [
        {
          domain: "canvas",
          resourceType: "canvas_agent_run",
          resourceId: run.id,
          label: canvas.title,
          url: `/canvas?canvasId=${encodeURIComponent(canvas.id)}`,
          status: run.status,
          metadata: { canvasId: canvas.id }
        }
      ]
    };
  }

  private buildCanvasRequest(
    prompt: string,
    context: AgentJsonObject,
    parentRunId: string,
    canvasId: string
  ): CreateCanvasAgentRunRequest {
    const allowedKeys = [
      "selectedShapeIds",
      "shapeSummaries",
      "selectedScene",
      "selectedSceneError",
      "viewport",
      "toolHelpMode",
      "conversationContext"
    ] as const;
    const request: Record<string, unknown> = {
      prompt,
      presentationMode: context.presentationMode === "interactive"
        ? "interactive"
        : "background"
    };
    for (const key of allowedKeys) {
      if (key in context) {
        request[key] = context[key];
      }
    }
    const digest = createHash("sha256")
      .update(`${parentRunId}\n${canvasId}\n${prompt}`)
      .digest("hex")
      .slice(0, 32);
    request.clientRequestId = `agent-delegate:${parentRunId}:${digest}`;
    return request as CreateCanvasAgentRunRequest;
  }

  private async resolveCanvas(
    context: AgentToolContext
  ): Promise<CanvasResolution> {
    if (context.requestContext?.surface === "canvas") {
      const canvases = await this.database.query<CanvasCandidate>(
        `
          SELECT id, title
          FROM canvas
          WHERE id = $1
            AND workspace_id = $2
            AND board_type = 'freeform'
            AND engine_type = 'classic'
          LIMIT 1
        `,
        [context.requestContext.canvasId, context.workspaceId]
      );
      const canvas = canvases[0];
      return canvas
        ? { kind: "resolved", canvas }
        : {
            kind: "needs_clarification",
            question:
              "현재 열린 Canvas를 확인할 수 없습니다. Canvas를 새로고침한 뒤 다시 요청해주세요."
          };
    }

    const canvases = await this.database.query<CanvasCandidate>(
      `
        SELECT id, title
        FROM canvas
        WHERE workspace_id = $1
          AND board_type = 'freeform'
          AND engine_type = 'classic'
        ORDER BY id ASC
        LIMIT 2
      `,
      [context.workspaceId]
    );
    if (canvases.length === 1) {
      return { kind: "resolved", canvas: canvases[0] };
    }
    return {
      kind: "needs_clarification",
      question:
        canvases.length === 0
          ? "현재 Workspace의 Canvas를 찾을 수 없습니다. Canvas 화면을 한 번 연 뒤 다시 요청해주세요."
          : "현재 Workspace의 Canvas를 하나로 결정할 수 없습니다. 사용할 Canvas 화면에서 다시 요청해주세요."
    };
  }

  private toClarification(question: string): AgentToolPreparationResult {
    return {
      kind: "needs_clarification",
      outputSummary: {
        status: "needs_clarification",
        question
      },
      resourceRefs: []
    };
  }

  private async readOriginalPrompt(runId: string): Promise<string> {
    const row = await this.database.queryOne<{ prompt: string }>(
      `
        SELECT COALESCE(
          (
            SELECT content
            FROM agent_run_messages
            WHERE run_id = run.id
              AND role = 'user'
            ORDER BY sequence DESC
            LIMIT 1
          ),
          run.prompt
        ) AS prompt
        FROM agent_runs AS run
        WHERE run.id = $1
      `,
      [runId]
    );
    if (!row?.prompt?.trim()) {
      throw badRequest("Agent prompt is unavailable");
    }
    return row.prompt.trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
