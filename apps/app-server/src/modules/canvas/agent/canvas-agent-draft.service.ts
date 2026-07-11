import { Injectable } from "@nestjs/common";
import type { SyncCanvasShapesBatchRequest } from "../canvas.types";
import type {
  CanvasAgentDraftColorOption,
  CanvasAgentDraftNode,
  CanvasAgentDraftNodeKind,
  CanvasAgentDraftRecommendedColor,
  CanvasAgentRequestContext,
  CanvasAgentShapeRow,
  CanvasDraftSpec
} from "./canvas-agent.types";
import { placeCanvasAgentDraftNodes } from "./canvas-agent-draft-placement";
import {
  canvasAgentDraftToShapeBatch,
  createCanvasAgentConnectionBatch
} from "./canvas-agent-draft-shape-batch";
import { createCanvasAgentDraftToolSteps } from "./canvas-agent-draft-tool-steps";

const MAX_GENERATED_DRAFT_NODES = 16;
const MAX_GENERATED_DRAFT_CONNECTIONS = 24;
const ALLOWED_DRAFT_NODE_KINDS = new Set<CanvasAgentDraftNodeKind>([
  "frame",
  "note",
  "text",
  "rectangle",
  "circle",
  "triangle",
  "code"
]);
const ALLOWED_DRAFT_COLORS = new Set(["default", "blue", "violet", "green", "yellow", "red", "black"]);
const DRAFT_COLOR_OPTIONS: CanvasAgentDraftColorOption[] = [
  { name: "default", label: "기본", hex: "#111827", bestFor: "기본 텍스트, 중립 요소, 일반 연결" },
  { name: "black", label: "검정", hex: "#111827", bestFor: "강한 제목, 핵심 연결선, 대비가 필요한 요소" },
  { name: "blue", label: "파랑", hex: "#3858f6", bestFor: "주요 흐름, 기본 액션, 신뢰감 있는 UI 구조" },
  { name: "violet", label: "보라", hex: "#7c3aed", bestFor: "AI, 인사이트, 보조 흐름, 창의적인 영역" },
  { name: "green", label: "초록", hex: "#16a34a", bestFor: "성공, 완료, 긍정 상태, 승인 흐름" },
  { name: "yellow", label: "노랑", hex: "#facc15", bestFor: "주의, 대기, 검토 필요, 하이라이트" },
  { name: "red", label: "빨강", hex: "#ef4444", bestFor: "오류, 위험, 실패, 삭제 또는 경고" }
];

@Injectable()
export class CanvasAgentDraftService {
  createDraftSpec(input: {
    code?: string;
    connections?: unknown;
    kind: "diagram" | "code";
    nodes?: unknown;
    prompt: string;
    recommendedColors?: unknown;
    sourceShapes: CanvasAgentShapeRow[];
    style?: string;
    summary?: string;
    title?: string;
    viewport: CanvasAgentRequestContext["viewport"];
  }): CanvasDraftSpec {
    const origin = {
      x: input.viewport ? input.viewport.x + 80 : 80,
      y: input.viewport ? input.viewport.y + 80 : 80
    };
    const sourceShapeIds = input.sourceShapes.map((shape) => shape.id);
    const sourceRevisions = Object.fromEntries(
      input.sourceShapes.map((shape) => [shape.id, Number(shape.revision)])
    );
    const title = this.cleanText(input.title) || this.inferTitle(input.prompt, input.kind);

    const generated = this.createGeneratedDraftSpec({
      connections: input.connections,
      kind: input.kind,
      nodes: input.nodes,
      origin,
      recommendedColors: input.recommendedColors,
      sourceRevisions,
      sourceShapeIds,
      summary: input.summary,
      title
    });
    if (generated) return this.placeDraftSpec(generated, input.viewport);

    if (input.kind === "code") {
      const code = this.cleanText(input.code) || this.defaultCode(input.prompt);
      const codeNode: CanvasAgentDraftNode = {
        id: "code",
        kind: "code",
        title: "canvas-agent-example.ts",
        text: null,
        x: 36,
        y: 72,
        width: 460,
        height: 300,
        color: "blue",
        code,
        language: "ts",
        parentId: "frame"
      };
      const frame: CanvasAgentDraftNode = {
        id: "frame",
        kind: "frame",
        title,
        text: null,
        x: origin.x,
        y: origin.y,
        width: 532,
        height: 408,
        color: "blue"
      };

      return this.placeDraftSpec({
        kind: "code",
        title,
        summary: `${title} 코드 블록 초안`,
        sourceShapeIds,
        sourceRevisions,
        availableColors: DRAFT_COLOR_OPTIONS,
        recommendedColors: this.defaultRecommendedColors([frame, codeNode]),
        nodes: [frame, codeNode],
        connections: [],
        toolSteps: this.createToolSteps([frame, codeNode], [])
      }, input.viewport);
    }

    const labels = input.sourceShapes.length
      ? input.sourceShapes.map((shape, index) => this.shapeLabel(shape, index))
      : this.defaultDiagramLabels(input.prompt);
    const cardWidth = 220;
    const cardHeight = 112;
    const gap = 76;
    const cards = labels.slice(0, 5).map((label, index) => ({
      id: `card-${index + 1}`,
      kind: "note" as const,
      title: label.title,
      text: label.text,
      x: 40 + index * (cardWidth + gap),
      y: 96,
      width: cardWidth,
      height: cardHeight,
      color: index % 2 === 0 ? "blue" : "violet",
      parentId: "frame"
    }));
    const contentWidth = Math.max(cardWidth + 80, cards.length * cardWidth + Math.max(0, cards.length - 1) * gap + 80);
    const frame: CanvasAgentDraftNode = {
      id: "frame",
      kind: "frame",
      title,
      text: null,
      x: origin.x,
      y: origin.y,
      width: contentWidth,
      height: 260,
      color: input.style === "presentation" ? "violet" : "blue"
    };

    const connections = cards.slice(1).map((card, index) => ({
      id: `arrow-${index + 1}`,
      from: `card-${index + 1}`,
      to: card.id,
      kind: "arrow" as const
    }));

    return this.placeDraftSpec({
      kind: input.kind,
      title,
      summary: `${cards.length}개 항목으로 구성한 흐름도 초안`,
      sourceShapeIds,
      sourceRevisions,
      availableColors: DRAFT_COLOR_OPTIONS,
      recommendedColors: this.defaultRecommendedColors([frame, ...cards]),
      nodes: [frame, ...cards],
      connections,
      toolSteps: this.createToolSteps([frame, ...cards], connections)
    }, input.viewport);
  }

  private createGeneratedDraftSpec(input: {
    connections: unknown;
    kind: "diagram" | "code";
    nodes: unknown;
    origin: { x: number; y: number };
    recommendedColors: unknown;
    sourceRevisions: Record<string, number>;
    sourceShapeIds: string[];
    summary?: string;
    title: string;
  }): CanvasDraftSpec | null {
    if (!Array.isArray(input.nodes) || input.nodes.length === 0) return null;

    const nodes = input.nodes
      .slice(0, MAX_GENERATED_DRAFT_NODES)
      .map((node, index) => this.readGeneratedNode(node, index, input.origin))
      .filter((node): node is CanvasAgentDraftNode => node !== null);
    if (!nodes.length) return null;

    const frameIds = new Set(nodes.filter((node) => node.kind === "frame").map((node) => node.id));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const normalizedNodes = nodes.map((node) => ({
      ...node,
      parentId: node.parentId && frameIds.has(node.parentId) ? node.parentId : null
    }));
    const connections = Array.isArray(input.connections)
      ? input.connections
        .slice(0, MAX_GENERATED_DRAFT_CONNECTIONS)
        .map((connection, index) => this.readGeneratedConnection(connection, index, nodeIds))
        .filter((connection): connection is NonNullable<ReturnType<typeof this.readGeneratedConnection>> => connection !== null)
      : [];

    const summary = this.cleanText(input.summary) || `${normalizedNodes.length}개 Canvas 도구 배치 계획`;
    return {
      kind: input.kind,
      title: input.title,
      summary,
      sourceShapeIds: input.sourceShapeIds,
      sourceRevisions: input.sourceRevisions,
      availableColors: DRAFT_COLOR_OPTIONS,
      recommendedColors: this.readRecommendedColors(input.recommendedColors, normalizedNodes),
      nodes: normalizedNodes,
      connections,
      toolSteps: this.createToolSteps(normalizedNodes, connections)
    };
  }

  toShapeBatch(spec: CanvasDraftSpec, clientOperationId: string): SyncCanvasShapesBatchRequest {
    return canvasAgentDraftToShapeBatch(spec, clientOperationId);
  }

  createConnectionBatch(input: {
    clientOperationId: string;
    connectionKind: "arrow" | "line";
    from: CanvasAgentShapeRow;
    label: string | null;
    to: CanvasAgentShapeRow;
  }): SyncCanvasShapesBatchRequest {
    return createCanvasAgentConnectionBatch(input);
  }

  private shapeLabel(shape: CanvasAgentShapeRow, index: number): { text: string | null; title: string } {
    const title = this.cleanText(shape.title) || `항목 ${index + 1}`;
    const text = this.cleanText(shape.text_content)?.slice(0, 180) ?? null;
    return { title, text };
  }

  private defaultDiagramLabels(prompt: string): Array<{ text: string | null; title: string }> {
    return [
      { title: "문제", text: this.cleanText(prompt).slice(0, 120) },
      { title: "해결", text: "핵심 해결 방법" },
      { title: "기대 효과", text: "사용자에게 전달할 결과" }
    ];
  }

  private inferTitle(prompt: string, kind: CanvasDraftSpec["kind"]): string {
    const suffix = kind === "code" ? "코드 예시" : "흐름도 초안";
    return `${this.cleanText(prompt).slice(0, 48) || "Canvas AI"} ${suffix}`;
  }

  private defaultCode(prompt: string): string {
    return `// ${this.cleanText(prompt).slice(0, 100)}\nexport function canvasAgentExample() {\n  return \"PILO Canvas AI\";\n}`;
  }

  private readGeneratedNode(
    value: unknown,
    index: number,
    origin: { x: number; y: number }
  ): CanvasAgentDraftNode | null {
    if (!this.isRecord(value)) return null;
    const kind = this.normalizeNodeKind(value.kind ?? value.tool);
    if (!kind || !ALLOWED_DRAFT_NODE_KINDS.has(kind)) return null;

    const id = this.cleanText(value.id) || `node-${index + 1}`;
    const title = this.cleanText(value.title) || this.cleanText(value.text) || this.defaultNodeTitle(kind, index);
    const text = this.cleanText(value.text);
    const code = this.cleanText(value.code);
    const parentId = this.cleanText(value.parentId) || null;
    return {
      id: id.slice(0, 64),
      kind,
      title: title.slice(0, 120),
      text: text ? text.slice(0, 1200) : null,
      x: this.readBoundedNumber(value.x, origin.x, -100000, 100000),
      y: this.readBoundedNumber(value.y, origin.y, -100000, 100000),
      width: this.readBoundedNumber(value.width, this.defaultNodeWidth(kind), 32, 2000),
      height: this.readBoundedNumber(value.height, this.defaultNodeHeight(kind), 24, 1600),
      color: this.normalizeColor(value.color),
      ...(code ? { code: code.slice(0, 12000) } : {}),
      ...(kind === "code" ? { language: this.cleanText(value.language) || "ts" } : {}),
      parentId
    };
  }

  private readGeneratedConnection(
    value: unknown,
    index: number,
    nodeIds: Set<string>
  ): CanvasDraftSpec["connections"][number] | null {
    if (!this.isRecord(value)) return null;
    const from = this.cleanText(value.from);
    const to = this.cleanText(value.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return null;

    return {
      id: this.cleanText(value.id) || `connection-${index + 1}`,
      from,
      to,
      kind: value.kind === "line" || value.tool === "line" ? "line" : "arrow",
      text: this.cleanText(value.text) || null,
      color: this.normalizeColor(value.color)
    };
  }

  private readRecommendedColors(
    value: unknown,
    nodes: CanvasAgentDraftNode[]
  ): CanvasAgentDraftRecommendedColor[] {
    const recommendations = Array.isArray(value)
      ? value
        .map((item) => this.readRecommendedColor(item))
        .filter((item): item is CanvasAgentDraftRecommendedColor => item !== null)
      : [];

    if (recommendations.length) {
      return this.dedupeRecommendedColors(recommendations).slice(0, 5);
    }

    return this.defaultRecommendedColors(nodes);
  }

  private readRecommendedColor(value: unknown): CanvasAgentDraftRecommendedColor | null {
    if (!this.isRecord(value)) return null;
    const color = this.colorOption(value.name ?? value.color);
    if (!color) return null;

    const label = this.cleanText(value.label) || color.label;
    const usage = this.cleanText(value.usage) || color.bestFor;
    return {
      name: color.name,
      label: label.slice(0, 40),
      usage: usage.slice(0, 160)
    };
  }

  private defaultRecommendedColors(nodes: CanvasAgentDraftNode[]): CanvasAgentDraftRecommendedColor[] {
    const colorNames = Array.from(new Set(nodes.map((node) => this.normalizeColor(node.color)))).slice(0, 4);
    const names = colorNames.length ? colorNames : ["blue"];
    return names
      .map((name) => this.colorOption(name))
      .filter((color): color is CanvasAgentDraftColorOption => color !== null)
      .map((color) => ({
        name: color.name,
        label: color.label,
        usage: color.bestFor
      }));
  }

  private dedupeRecommendedColors(
    recommendations: CanvasAgentDraftRecommendedColor[]
  ): CanvasAgentDraftRecommendedColor[] {
    const seen = new Set<string>();
    return recommendations.filter((recommendation) => {
      if (seen.has(recommendation.name)) return false;
      seen.add(recommendation.name);
      return true;
    });
  }

  private placeDraftSpec(
    spec: CanvasDraftSpec,
    viewport: CanvasAgentRequestContext["viewport"]
  ): CanvasDraftSpec {
    const nodes = placeCanvasAgentDraftNodes({
      nodes: spec.nodes,
      viewport
    });

    return {
      ...spec,
      nodes,
      toolSteps: this.createToolSteps(nodes, spec.connections)
    };
  }

  private createToolSteps(
    nodes: CanvasAgentDraftNode[],
    connections: CanvasDraftSpec["connections"]
  ): CanvasDraftSpec["toolSteps"] {
    return createCanvasAgentDraftToolSteps(nodes, connections);
  }

  private normalizeNodeKind(value: unknown): CanvasAgentDraftNodeKind | null {
    const normalized = this.cleanText(value).toLowerCase();
    if (normalized === "frame") return "frame";
    if (normalized === "note" || normalized === "memo" || normalized === "sticky-note") return "note";
    if (normalized === "text") return "text";
    if (normalized === "rectangle" || normalized === "rect" || normalized === "box") return "rectangle";
    if (normalized === "circle" || normalized === "ellipse") return "circle";
    if (normalized === "triangle") return "triangle";
    if (normalized === "code" || normalized === "code_block" || normalized === "code-block") return "code";
    return null;
  }

  private normalizeColor(value: unknown): string {
    const color = this.cleanText(value).toLowerCase();
    return ALLOWED_DRAFT_COLORS.has(color) ? color : "blue";
  }

  private colorOption(value: unknown): CanvasAgentDraftColorOption | null {
    const name = this.cleanText(value).toLowerCase();
    if (!ALLOWED_DRAFT_COLORS.has(name)) return null;
    return DRAFT_COLOR_OPTIONS.find((color) => color.name === name) ?? null;
  }

  private defaultNodeTitle(kind: CanvasAgentDraftNodeKind, index: number): string {
    if (kind === "frame") return `프레임 ${index + 1}`;
    if (kind === "code") return "canvas-agent-example.ts";
    if (kind === "text") return `텍스트 ${index + 1}`;
    return `항목 ${index + 1}`;
  }

  private defaultNodeWidth(kind: CanvasAgentDraftNodeKind): number {
    if (kind === "frame") return 720;
    if (kind === "code") return 460;
    if (kind === "text") return 260;
    return 220;
  }

  private defaultNodeHeight(kind: CanvasAgentDraftNodeKind): number {
    if (kind === "frame") return 360;
    if (kind === "code") return 300;
    if (kind === "text") return 72;
    return 112;
  }

  private readBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  private cleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

}
