import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import type { SyncCanvasShapesBatchRequest } from "../canvas.types";
import { CanvasAgentDraftService } from "./canvas-agent-draft.service";
import { CanvasAgentRepository } from "./canvas-agent.repository";
import { findCanvasAgentToolTarget } from "./canvas-agent-tool-targets";
import type {
  CanvasAgentProgressPayload,
  CanvasAgentRunRow,
  CanvasAgentShapeRow,
  CanvasAgentStepRow,
  CanvasAgentViewport,
  CanvasDraftSpec
} from "./canvas-agent.types";

export type CanvasAgentActionResult = {
  draftSpec?: CanvasDraftSpec;
  progress: CanvasAgentProgressPayload | null;
  resourceRefs: string[];
  shapeBatch?: SyncCanvasShapesBatchRequest;
  shouldContinue: boolean;
  summary: string;
};

@Injectable()
export class CanvasAgentActionService {
  constructor(
    private readonly drafts: CanvasAgentDraftService,
    private readonly repository: CanvasAgentRepository
  ) {}

  async execute(
    run: CanvasAgentRunRow,
    step: CanvasAgentStepRow
  ): Promise<CanvasAgentActionResult> {
    switch (step.action_name) {
      case "find_canvas_tool":
        return this.findCanvasTool(step.input_json);
      case "find_shapes":
        return this.findShapes(run, step.input_json);
      case "select_shapes":
        return this.selectShapes(run, step.input_json);
      case "focus_viewport":
        return this.focusViewport(run, step.input_json);
      case "connect_shapes":
        return this.connectShapes(run, step);
      case "create_draft":
        return this.createDraft(run, step.input_json, "diagram");
      case "finish":
        const summary = this.readText(step.input_json.summary) || "Canvas AI 작업을 완료했습니다.";
        return {
          summary,
          resourceRefs: [],
          shouldContinue: false,
          progress: step.input_json.suppressProgress === true
            ? null
            : this.progress(summary, [], null)
        };
      default:
        throw badRequest("Canvas Agent action is invalid");
    }
  }

  private findCanvasTool(input: Record<string, unknown>): CanvasAgentActionResult {
    const toolTarget = this.readText(input.toolTarget);
    const tool = toolTarget ? findCanvasAgentToolTarget(toolTarget) : null;
    if (!tool) throw badRequest("Canvas Agent find_canvas_tool target is required");

    return {
      summary: tool.message,
      resourceRefs: [tool.target],
      shouldContinue: false,
      progress: this.progress(tool.message, [], null, tool.target, tool.label)
    };
  }

  private async findShapes(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const query = this.readText(input.query) || this.queryFromPrompt(run.prompt);
    if (!query) throw badRequest("Canvas Agent find_shapes query is required");

    const explicitIds = this.readStringArray(input.shapeIds);
    const shapes = explicitIds.length
      ? await this.repository.findShapesByIds(run.canvas_id, explicitIds)
      : await this.repository.searchShapes(run.canvas_id, query);
    const shapeIds = shapes.map((shape) => shape.id);
    const viewport = this.viewportForShapes(shapes);
    const summary = shapes.length
      ? `“${query}” 관련 도형 ${shapes.length}개를 찾았습니다.`
      : `“${query}” 관련 도형을 찾지 못했습니다.`;

    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: input.continuePlanning === true && shapes.length === 0,
      progress: this.progress(summary, shapeIds, viewport)
    };
  }

  private async selectShapes(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const shapes = await this.selectedShapes(run, input);
    const shapeIds = shapes.map((shape) => shape.id);
    const summary = shapeIds.length
      ? `${shapeIds.length}개 도형을 선택했습니다.`
      : "선택할 도형을 찾지 못했습니다.";
    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: false,
      progress: this.progress(summary, shapeIds, this.viewportForShapes(shapes))
    };
  }

  private async focusViewport(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const shapes = await this.selectedShapes(run, input);
    const viewport = this.viewportForShapes(shapes);
    const shapeIds = shapes.map((shape) => shape.id);
    const summary = viewport
      ? "요청한 도형 위치로 화면을 이동했습니다."
      : "이동할 도형을 찾지 못했습니다.";
    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: false,
      progress: this.progress(summary, shapeIds, viewport)
    };
  }

  private async createDraft(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>,
    defaultKind: "diagram" | "code"
  ): Promise<CanvasAgentActionResult> {
    const requestedIds = this.readStringArray(input.sourceShapeIds);
    const contextShapeIds = this.readStringArray(run.context_json.selectedShapeIds);
    const sourceShapes = await this.repository.findShapesByIds(
      run.canvas_id,
      requestedIds.length ? requestedIds : contextShapeIds
    );
    const kind = input.kind === "code" ? "code" : defaultKind;
    const viewport = this.readViewport(run.context_json.viewport);
    const occupiedShapes = await this.repository.listShapesForPlacement(run.canvas_id, viewport);
    const spec = this.drafts.createDraftSpec({
      kind,
      prompt: run.prompt,
      sourceShapes,
      occupiedShapes,
      viewport,
      connections: input.connections,
      nodes: input.nodes,
      recommendedColors: input.recommendedColors,
      summary: this.readText(input.summary) || undefined,
      style: this.readText(input.style) || undefined,
      title: this.readText(input.title) || undefined,
      code: this.readText(input.code) || undefined
    });
    const summary = `${spec.summary}을 만들었습니다. 적용하거나 폐기할 수 있습니다.`;

    return {
      draftSpec: spec,
      summary,
      resourceRefs: spec.sourceShapeIds,
      shouldContinue: false,
      progress: this.progress(summary, spec.sourceShapeIds, this.viewportForSpec(spec))
    };
  }

  private async connectShapes(
    run: CanvasAgentRunRow,
    step: CanvasAgentStepRow
  ): Promise<CanvasAgentActionResult> {
    const selectedIds = this.readStringArray(run.context_json.selectedShapeIds);
    const fromShapeId = this.readText(step.input_json.fromShapeId) || selectedIds[0] || "";
    const toShapeId = this.readText(step.input_json.toShapeId) || selectedIds[1] || "";
    if (!fromShapeId || !toShapeId || fromShapeId === toShapeId) {
      throw badRequest("Canvas Agent connect_shapes requires two different shape ids");
    }

    const shapes = await this.repository.findShapesByIds(run.canvas_id, [fromShapeId, toShapeId]);
    if (shapes.length !== 2) throw badRequest("Canvas Agent connect_shapes target shapes were not found");
    const connectionKind = step.input_json.connectionKind === "line" ? "line" : "arrow";
    const label = this.readText(step.input_json.label) || null;
    const summary = connectionKind === "line"
      ? "요청한 두 도형을 선으로 연결했습니다."
      : "요청한 두 도형을 화살표로 연결했습니다.";
    const shapeBatch = this.drafts.createConnectionBatch({
      clientOperationId: `canvas-agent:${step.id}:connect`,
      connectionKind,
      from: shapes[0],
      label,
      to: shapes[1]
    });
    const connectionShapeIds = (shapeBatch.operations as Array<{ shapeId?: unknown }>)
      .map((operation) => operation.shapeId)
      .filter((shapeId): shapeId is string => typeof shapeId === "string");
    const highlightedShapeIds = [fromShapeId, toShapeId, ...connectionShapeIds];

    return {
      progress: this.progress(summary, highlightedShapeIds, this.viewportForShapes(shapes)),
      resourceRefs: highlightedShapeIds,
      shapeBatch,
      shouldContinue: false,
      summary
    };
  }

  private async selectedShapes(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentShapeRow[]> {
    const explicitIds = this.readStringArray(input.shapeIds);
    const contextIds = this.readStringArray(run.context_json.selectedShapeIds);
    const ids = explicitIds.length ? explicitIds : contextIds;
    if (ids.length) return this.repository.findShapesByIds(run.canvas_id, ids);

    const query = this.readText(input.query);
    return query ? this.repository.searchShapes(run.canvas_id, query) : [];
  }

  private progress(
    message: string,
    highlightedShapeIds: string[],
    targetViewport: CanvasAgentViewport | null,
    toolTarget: string | null = null,
    toolTargetLabel: string | null = null
  ): CanvasAgentProgressPayload {
    return { message, highlightedShapeIds, targetViewport, toolTarget, toolTargetLabel };
  }

  private viewportForShapes(shapes: CanvasAgentShapeRow[]): CanvasAgentViewport | null {
    if (!shapes.length) return null;
    const left = Math.min(...shapes.map((shape) => Number(shape.x)));
    const top = Math.min(...shapes.map((shape) => Number(shape.y)));
    const right = Math.max(...shapes.map((shape) => Number(shape.x) + Number(shape.width ?? 180)));
    const bottom = Math.max(...shapes.map((shape) => Number(shape.y) + Number(shape.height ?? 100)));
    return { x: left - 80, y: top - 80, width: Math.max(320, right - left + 160), height: Math.max(240, bottom - top + 160) };
  }

  private viewportForSpec(spec: CanvasDraftSpec): CanvasAgentViewport | null {
    if (!spec.nodes.length) return null;
    const left = Math.min(...spec.nodes.map((node) => node.x));
    const top = Math.min(...spec.nodes.map((node) => node.y));
    const right = Math.max(...spec.nodes.map((node) => node.x + node.width));
    const bottom = Math.max(...spec.nodes.map((node) => node.y + node.height));
    return { x: left - 80, y: top - 80, width: right - left + 160, height: bottom - top + 160 };
  }

  private queryFromPrompt(prompt: string): string {
    const match = prompt.match(/^(.+?)(?:\s*관련)?\s*(?:메모|도형|내용)?\s*(?:을|를)?\s*(?:찾아|찾아줘|검색)/);
    return match?.[1]?.trim() ?? "";
  }

  private readText(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 12000) : "";
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))).slice(0, 40);
  }

  private readViewport(value: unknown): CanvasAgentViewport | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if ([candidate.x, candidate.y, candidate.width, candidate.height].some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
    if ((candidate.width as number) <= 0 || (candidate.height as number) <= 0) return null;
    return { x: candidate.x as number, y: candidate.y as number, width: candidate.width as number, height: candidate.height as number };
  }
}
