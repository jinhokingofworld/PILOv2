import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import { CanvasAgentRepository } from "./canvas-agent.repository";
import { findCanvasAgentToolTarget } from "./canvas-agent-tool-targets";
import type {
  CanvasAgentProgressPayload,
  CanvasAgentRunRow,
  CanvasAgentShapeRow,
  CanvasAgentStepRow,
  CanvasAgentViewport
} from "./canvas-agent.types";

export type CanvasAgentActionResult = {
  progress: CanvasAgentProgressPayload | null;
  resourceRefs: string[];
  shouldContinue: boolean;
  summary: string;
};

@Injectable()
export class CanvasAgentActionService {
  constructor(private readonly repository: CanvasAgentRepository) {}

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
      case "create_draft":
        throw badRequest("Canvas Agent shape creation is disabled");
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
    const routingPrefix = this.routingPrefix(input);
    const summary = shapes.length
      ? `${routingPrefix}“${query}” 관련 도형 ${shapes.length}개를 찾았습니다.`
      : `${routingPrefix}“${query}” 관련 도형을 찾지 못했습니다.`;

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

  private queryFromPrompt(prompt: string): string {
    const match = prompt.match(/^(.+?)(?:\s*관련)?\s*(?:메모|도형|내용)?\s*(?:을|를)?\s*(?:찾아|찾아줘|검색)/);
    return match?.[1]?.trim() ?? "";
  }

  private routingPrefix(input: Record<string, unknown>): string {
    if (input.routingSource === "shape_embedding") return "임베딩 검색으로 ";
    if (input.routingSource === "deterministic_search") return "Canvas 검색으로 ";
    if (input.routingSource === "llm_planner") return "Canvas Planner가 판단해서 ";
    return "";
  }

  private readText(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 12000) : "";
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))).slice(0, 40);
  }

}
