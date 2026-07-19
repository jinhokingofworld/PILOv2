import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import { DriveService } from "../../drive/drive.service";
import { CanvasAgentRepository } from "./canvas-agent.repository";
import { findCanvasAgentToolTarget } from "./canvas-agent-tool-targets";
import { CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE } from "./canvas-agent.constants";
import { buildCanvasAgentSearchFocus } from "./canvas-agent-geometry";
import type {
  CanvasAgentHtmlArtifact,
  CanvasAgentClientAction,
  CanvasAgentProgressPayload,
  CanvasAgentRunRow,
  CanvasAgentShapeSummary,
  CanvasAgentShapeRow,
  CanvasAgentStepRow,
  CanvasAgentViewport
} from "./canvas-agent.types";

export type CanvasAgentActionResult = {
  artifact?: CanvasAgentHtmlArtifact | null;
  clientAction?: CanvasAgentClientAction | null;
  progress: CanvasAgentProgressPayload | null;
  resourceRefs: string[];
  shouldContinue: boolean;
  summary: string;
};

@Injectable()
export class CanvasAgentActionService {
  constructor(
    private readonly repository: CanvasAgentRepository,
    private readonly driveService: DriveService
  ) {}

  async execute(
    run: CanvasAgentRunRow,
    step: CanvasAgentStepRow
  ): Promise<CanvasAgentActionResult> {
    switch (step.action_name) {
      case "route_intent":
        return this.routeIntent(run, step.input_json);
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

  private async routeIntent(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const intent = this.readText(input.intent);
    const argumentsValue = input.arguments;
    const intentArguments = argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)
      ? argumentsValue as Record<string, unknown>
      : null;
    if (!intentArguments) throw badRequest("Canvas Agent intent arguments are required");

    switch (intent) {
      case "chat": {
        const answer = this.readText(intentArguments.answer);
        const contextScope = this.readText(intentArguments.contextScope);
        const reasonCode = this.readText(intentArguments.reasonCode);
        if (!answer || Buffer.byteLength(answer, "utf8") > 12_000) {
          throw badRequest("Canvas Agent chat answer is invalid");
        }
        if (contextScope !== "none" && contextScope !== "selected_scene") {
          throw badRequest("Canvas Agent chat contextScope is invalid");
        }
        if (!["general_question", "selection_question", "follow_up_question"].includes(reasonCode)) {
          throw badRequest("Canvas Agent chat reasonCode is invalid");
        }
        return {
          artifact: null,
          summary: answer,
          resourceRefs: [],
          shouldContinue: false,
          progress: this.progress(answer, [], null)
        };
      }
      case "find_shapes": {
        const query = this.readText(intentArguments.query);
        if (!query) throw badRequest("Canvas Agent find_shapes intent query is required");
        return this.findShapes(run, { ...intentArguments, query });
      }
      case "generate_html": {
        const selectionError = this.readText(intentArguments.selectionError);
        if (intentArguments.missingSelection === true || selectionError) {
          const summary = selectionError || "HTML로 만들 캔버스 영역을 먼저 선택해주세요.";
          return {
            artifact: null,
            summary,
            resourceRefs: [],
            shouldContinue: false,
            progress: this.progress(summary, [], null)
          };
        }
        const artifact = this.readHtmlArtifact(intentArguments.artifact);
        const selectedSceneIds = this.readSelectedSceneIds(run.context_json.selectedScene);
        if (!selectedSceneIds.length
          || artifact.sourceShapeIds.some((shapeId) => !selectedSceneIds.includes(shapeId))) {
          throw badRequest(CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE);
        }
        const summary = "선택한 영역의 정적 HTML/CSS 초안을 만들었습니다.";
        return {
          artifact,
          summary,
          resourceRefs: artifact.sourceShapeIds,
          shouldContinue: false,
          progress: this.progress(summary, [], null)
        };
      }
      case "import_drive_file": {
        const query = this.readText(intentArguments.query).slice(0, 120);
        if (!query) throw badRequest("Canvas Agent import_drive_file intent query is required");
        return this.importDriveFile(run, query);
      }
      case "unsupported": {
        const summary = "현재 Canvas AI는 기존 도형 찾기, Drive 이미지 가져오기, 선택 영역의 정적 HTML/CSS 생성을 지원합니다.";
        return {
          artifact: null,
          summary,
          resourceRefs: [],
          shouldContinue: false,
          progress: this.progress(summary, [], null)
        };
      }
      default:
        throw badRequest("Canvas Agent intent is not supported");
    }
  }

  private async importDriveFile(
    run: CanvasAgentRunRow,
    query: string
  ): Promise<CanvasAgentActionResult> {
    const matches = await this.driveService.searchReadyImagesForCanvas(
      run.requested_by_user_id,
      run.workspace_id,
      query,
      5
    );
    if (!matches.length) {
      const summary = `공유 드라이브에서 “${query}” 관련 이미지를 찾지 못했습니다.`;
      return {
        clientAction: null,
        summary,
        resourceRefs: [],
        shouldContinue: false,
        progress: this.progress(summary, [], null)
      };
    }

    const [bestMatch, nextMatch] = matches;
    const confident = Boolean(
      bestMatch
      && (
        matches.length === 1
        || bestMatch.score >= 500
        || !nextMatch
        || bestMatch.score - nextMatch.score >= 100
      )
    );
    if (!bestMatch || !confident) {
      const candidates = matches.slice(0, 3).map((match) => match.fileName).join(", ");
      const summary = `공유 드라이브에서 비슷한 이미지가 여러 개 발견됐습니다: ${candidates}. 파일명을 더 구체적으로 알려주세요.`;
      return {
        clientAction: null,
        summary,
        resourceRefs: matches.map((match) => match.fileId),
        shouldContinue: false,
        progress: this.progress(summary, [], null)
      };
    }

    const summary = `공유 드라이브의 “${bestMatch.fileName}” 이미지를 Canvas에 추가합니다.`;
    return {
      clientAction: {
        type: "insert_drive_file",
        file: {
          fileId: bestMatch.fileId,
          fileName: bestMatch.fileName,
          mimeType: bestMatch.mimeType
        }
      },
      summary,
      resourceRefs: [bestMatch.fileId],
      shouldContinue: false,
      progress: this.progress(summary, [], null)
    };
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
    const shapes = await this.resolveShapes(run, explicitIds, input);
    const shapeIds = shapes.map((shape) => shape.id);
    const focus = await this.searchFocus(run, shapes, input);
    const routingPrefix = this.routingPrefix(input);
    const summary = shapes.length
      ? `${routingPrefix}“${query}” 관련 도형 ${shapes.length}개를 찾았습니다.`
      : `${routingPrefix}“${query}” 관련 도형을 찾지 못했습니다.`;

    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: input.continuePlanning === true && shapes.length === 0,
      progress: this.progress(
        shapes.length ? "검색 결과를 불러오고 있습니다." : summary,
        focus.highlightedShapeIds,
        focus.targetViewport,
        null,
        null,
        focus.loadRootShapeIds
      )
    };
  }

  private async selectShapes(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const shapes = await this.selectedShapes(run, input);
    const shapeIds = shapes.map((shape) => shape.id);
    const focus = await this.searchFocus(run, shapes, input);
    const summary = shapeIds.length
      ? `${shapeIds.length}개 도형을 선택했습니다.`
      : "선택할 도형을 찾지 못했습니다.";
    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: false,
      progress: this.progress(
        summary,
        focus.highlightedShapeIds,
        focus.targetViewport,
        null,
        null,
        focus.loadRootShapeIds
      )
    };
  }

  private async focusViewport(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentActionResult> {
    const shapes = await this.selectedShapes(run, input);
    const focus = await this.searchFocus(run, shapes, input);
    const shapeIds = shapes.map((shape) => shape.id);
    const summary = focus.targetViewport
      ? "요청한 도형 위치로 화면을 이동했습니다."
      : "이동할 도형을 찾지 못했습니다.";
    return {
      summary,
      resourceRefs: shapeIds,
      shouldContinue: false,
      progress: this.progress(
        summary,
        focus.highlightedShapeIds,
        focus.targetViewport,
        null,
        null,
        focus.loadRootShapeIds
      )
    };
  }

  private async selectedShapes(
    run: CanvasAgentRunRow,
    input: Record<string, unknown>
  ): Promise<CanvasAgentShapeRow[]> {
    const explicitIds = this.readStringArray(input.shapeIds);
    const contextIds = this.readStringArray(run.context_json.selectedShapeIds);
    const ids = explicitIds.length ? explicitIds : contextIds;
    return ids.length ? this.resolveShapes(run, ids, input) : [];
  }

  private async resolveShapes(
    run: CanvasAgentRunRow,
    ids: string[],
    input: Record<string, unknown>
  ): Promise<CanvasAgentShapeRow[]> {
    if (!ids.length) return [];
    if (input.routingSource !== "client_shape_context") {
      return this.repository.findShapesByIds(run.canvas_id, ids);
    }

    const summaries = this.readShapeSummaries(run.context_json.shapeSummaries);
    const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
    return ids.flatMap((id) => {
      const summary = summariesById.get(id);
      return summary ? [this.shapeRowFromSummary(summary)] : [];
    });
  }

  private readShapeSummaries(value: unknown): CanvasAgentShapeSummary[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const summary = item as Record<string, unknown>;
      const id = this.readText(summary.id);
      const shapeType = this.readText(summary.shapeType);
      const x = Number(summary.x);
      const y = Number(summary.y);
      const width = Number(summary.width);
      const height = Number(summary.height);
      if (!id || !shapeType || ![x, y, width, height].every(Number.isFinite)) return [];
      if (width <= 0 || height <= 0) return [];
      return [{
        id,
        shapeType,
        title: this.readNullableText(summary.title),
        text: this.readNullableText(summary.text),
        x,
        y,
        width,
        height
      }];
    });
  }

  private shapeRowFromSummary(summary: CanvasAgentShapeSummary): CanvasAgentShapeRow {
    return {
      id: summary.id,
      title: summary.title,
      text_content: summary.text,
      shape_type: summary.shapeType,
      x: summary.x,
      y: summary.y,
      width: summary.width,
      height: summary.height,
      parent_shape_id: null,
      rotation: 0,
      revision: 0,
      raw_shape: {}
    };
  }

  private progress(
    message: string,
    highlightedShapeIds: string[],
    targetViewport: CanvasAgentViewport | null,
    toolTarget: string | null = null,
    toolTargetLabel: string | null = null,
    loadRootShapeIds: string[] = []
  ): CanvasAgentProgressPayload {
    return {
      message,
      highlightedShapeIds,
      loadRootShapeIds,
      targetViewport,
      toolTarget,
      toolTargetLabel
    };
  }

  private async searchFocus(
    run: CanvasAgentRunRow,
    shapes: CanvasAgentShapeRow[],
    input: Record<string, unknown>
  ) {
    const shapeIds = shapes.map((shape) => shape.id);
    const ancestors = shapeIds.length && input.routingSource !== "client_shape_context"
      ? await this.repository.findShapeAncestors(run.canvas_id, shapeIds)
      : [];
    return buildCanvasAgentSearchFocus(shapes, ancestors);
  }

  private queryFromPrompt(prompt: string): string {
    const match = prompt.match(/^(.+?)(?:\s*관련)?\s*(?:메모|도형|내용)?\s*(?:을|를)?\s*(?:찾아|찾아줘|검색)/);
    return match?.[1]?.trim() ?? "";
  }

  private routingPrefix(input: Record<string, unknown>): string {
    if (input.routingSource === "client_shape_context") return "현재 캔버스에서 ";
    if (input.routingSource === "shape_embedding") return "임베딩 검색으로 ";
    if (input.routingSource === "database_text") return "DB 검색으로 ";
    if (input.routingSource === "llm_intent_classifier") return "Canvas AI가 검색어를 해석해서 ";
    return "";
  }

  private readText(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 12000) : "";
  }

  private readNullableText(value: unknown): string | null {
    const text = this.readText(value);
    return text || null;
  }

  private readStringArray(value: unknown, maxItems = 40): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))).slice(0, maxItems);
  }

  private readHtmlArtifact(value: unknown): CanvasAgentHtmlArtifact {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw badRequest(CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE);
    }
    const artifact = value as Record<string, unknown>;
    const title = this.readText(artifact.title).slice(0, 200);
    const html = typeof artifact.html === "string" ? artifact.html.trim() : "";
    const sourceShapeIds = this.readStringArray(artifact.sourceShapeIds, 160);
    if (artifact.kind !== "html" || !title || !html || !sourceShapeIds.length) {
      throw badRequest(CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE);
    }
    if (Buffer.byteLength(html, "utf8") > 250_000) {
      throw badRequest(CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE);
    }
    if (/<\s*(script|iframe|object|embed|base)\b/i.test(html)
      || /\son[a-z]+\s*=/i.test(html)
      || /javascript\s*:/i.test(html)
      || /<meta\b[^>]*http-equiv/i.test(html)
      || /<\s*link\b|@import\b|url\(\s*['"]?\s*(?:https?:|\/\/)/i.test(html)
      || /\s(?:src|href|action|formaction)\s*=\s*['"]?\s*(?:https?:|\/\/)/i.test(html)) {
      throw badRequest(CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE);
    }
    return { kind: "html", title, html, sourceShapeIds };
  }

  private readSelectedSceneIds(value: unknown): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const shapes = (value as Record<string, unknown>).shapes;
    if (!Array.isArray(shapes)) return [];
    return shapes.flatMap((shape) => {
      if (!shape || typeof shape !== "object" || Array.isArray(shape)) return [];
      const id = (shape as Record<string, unknown>).id;
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    }).slice(0, 160);
  }

}
