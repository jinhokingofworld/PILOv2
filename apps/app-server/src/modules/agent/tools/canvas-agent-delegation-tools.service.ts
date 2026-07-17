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

type CanvasDelegationInput = {
  canvasId: string | null;
  canvasTitle: string | null;
};

type CanvasCandidate = {
  id: string;
  title: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    canvasId: {
      type: ["string", "null"],
      description:
        "Exact Canvas UUID only when it is already known. Never invent this value."
    },
    canvasTitle: {
      type: ["string", "null"],
      description:
        "Canvas title only when the user explicitly named one. Omit it for the active Canvas."
    }
  }
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
          "Use for requests about Canvas content or the active Canvas selection: finding existing shapes, Canvas toolbar help when the UI context enables toolHelpMode, and generating static HTML/CSS from an explicit Canvas selection. This tool delegates the user's original wording to Canvas AI; it does not create diagrams or arbitrary Canvas shapes. Do not rewrite the prompt or include a prompt in the tool input.",
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
    const unexpected = Object.keys(input).find(
      (key) => key !== "canvasId" && key !== "canvasTitle"
    );
    if (unexpected) {
      throw badRequest(`delegate_canvas_agent input field is invalid: ${unexpected}`);
    }
    const canvasId = this.optionalString(input.canvasId, 64);
    if (canvasId && !UUID_PATTERN.test(canvasId)) {
      throw badRequest("delegate_canvas_agent canvasId is invalid");
    }
    return {
      canvasId,
      canvasTitle: this.optionalString(input.canvasTitle, 200)
    };
  }

  private async prepareExecution(
    context: AgentToolContext,
    input: CanvasDelegationInput
  ): Promise<AgentToolPreparationResult> {
    const candidates = await this.resolveCanvasCandidates(context, input);
    if (candidates.length === 1) {
      return { kind: "execute" };
    }

    const available = await this.listCanvasCandidates(context.workspaceId);
    const question = candidates.length > 1
      ? "같은 이름의 캔버스가 여러 개입니다. 어느 캔버스에 적용할지 알려주세요."
      : available.length
        ? "어느 캔버스에서 처리할까요? 캔버스 이름을 알려주세요."
        : "현재 워크스페이스에 사용할 수 있는 캔버스가 없습니다.";
    return {
      kind: "needs_clarification",
      outputSummary: {
        question,
        canvases: available.slice(0, 10).map((canvas) => ({
          id: canvas.id,
          title: canvas.title
        }))
      },
      resourceRefs: []
    };
  }

  private async execute(
    context: AgentToolContext,
    input: CanvasDelegationInput
  ): Promise<AgentToolExecutionResult> {
    const candidates = await this.resolveCanvasCandidates(context, input);
    if (candidates.length !== 1) {
      return {
        status: "needs_clarification",
        outputSummary: {
          question: "어느 캔버스에서 처리할지 캔버스 이름을 알려주세요."
        },
        resourceRefs: []
      };
    }

    const canvas = candidates[0];
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

  private async resolveCanvasCandidates(
    context: AgentToolContext,
    input: CanvasDelegationInput
  ): Promise<CanvasCandidate[]> {
    if (input.canvasId) {
      return this.database.query<CanvasCandidate>(
        `
          SELECT id, title
          FROM canvas
          WHERE id = $1
            AND workspace_id = $2
            AND board_type = 'freeform'
        `,
        [input.canvasId, context.workspaceId]
      );
    }
    if (input.canvasTitle) {
      return this.database.query<CanvasCandidate>(
        `
          SELECT id, title
          FROM canvas
          WHERE workspace_id = $1
            AND board_type = 'freeform'
            AND lower(btrim(title)) = lower(btrim($2))
          ORDER BY updated_at DESC, id ASC
          LIMIT 11
        `,
        [context.workspaceId, input.canvasTitle]
      );
    }
    const contextCanvasId =
      context.requestContext?.surface === "canvas"
        ? context.requestContext.canvasId
        : null;
    if (!contextCanvasId) {
      return [];
    }
    return this.database.query<CanvasCandidate>(
      `
        SELECT id, title
        FROM canvas
        WHERE id = $1
          AND workspace_id = $2
          AND board_type = 'freeform'
      `,
      [contextCanvasId, context.workspaceId]
    );
  }

  private listCanvasCandidates(workspaceId: string): Promise<CanvasCandidate[]> {
    return this.database.query<CanvasCandidate>(
      `
        SELECT id, title
        FROM canvas
        WHERE workspace_id = $1
          AND board_type = 'freeform'
        ORDER BY updated_at DESC, id ASC
        LIMIT 10
      `,
      [workspaceId]
    );
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

  private optionalString(value: unknown, maxLength: number): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
      throw badRequest("delegate_canvas_agent input contains invalid text");
    }
    return value.trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
