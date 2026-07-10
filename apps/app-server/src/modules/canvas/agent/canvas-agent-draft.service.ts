import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { SyncCanvasShapesBatchRequest } from "../canvas.types";
import type {
  CanvasAgentDraftNode,
  CanvasAgentRequestContext,
  CanvasAgentShapeRow,
  CanvasDraftSpec
} from "./canvas-agent.types";

@Injectable()
export class CanvasAgentDraftService {
  createDraftSpec(input: {
    code?: string;
    kind: "diagram" | "organize" | "code";
    prompt: string;
    sourceShapes: CanvasAgentShapeRow[];
    style?: string;
    title?: string;
    viewport: CanvasAgentRequestContext["viewport"];
  }): CanvasDraftSpec {
    const origin = {
      x: input.viewport?.x ?? 80,
      y: input.viewport?.y ?? 80
    };
    const sourceShapeIds = input.sourceShapes.map((shape) => shape.id);
    const sourceRevisions = Object.fromEntries(
      input.sourceShapes.map((shape) => [shape.id, Number(shape.revision)])
    );
    const title = this.cleanText(input.title) || this.inferTitle(input.prompt, input.kind);

    if (input.kind === "code") {
      const code = this.cleanText(input.code) || this.defaultCode(input.prompt);
      const codeNode: CanvasAgentDraftNode = {
        id: "code",
        kind: "code",
        title: "canvas-agent-example.ts",
        text: null,
        x: origin.x + 36,
        y: origin.y + 72,
        width: 460,
        height: 300,
        color: "blue",
        code,
        language: "ts"
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

      return {
        kind: "code",
        title,
        summary: `${title} 코드 블록 초안`,
        sourceShapeIds,
        sourceRevisions,
        nodes: [frame, codeNode],
        connections: []
      };
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
      color: index % 2 === 0 ? "blue" : "violet"
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

    return {
      kind: input.kind,
      title,
      summary: `${cards.length}개 항목으로 구성한 ${input.kind === "organize" ? "정리" : "흐름도"} 초안`,
      sourceShapeIds,
      sourceRevisions,
      nodes: [frame, ...cards],
      connections: cards.slice(1).map((card, index) => ({ from: `card-${index + 1}`, to: card.id }))
    };
  }

  toShapeBatch(spec: CanvasDraftSpec, clientOperationId: string): SyncCanvasShapesBatchRequest {
    const frame = spec.nodes.find((node) => node.kind === "frame") ?? null;
    const frameShapeId = frame ? this.shapeId("frame") : null;
    const nodeShapeIds = new Map<string, string>();
    const operations: Array<Record<string, unknown>> = [];

    if (frame && frameShapeId) {
      operations.push(this.createFrameOperation(frame, frameShapeId, clientOperationId));
    }

    spec.nodes
      .filter((node) => node.kind !== "frame")
      .forEach((node, index) => {
        const shapeId = this.shapeId(node.kind);
        nodeShapeIds.set(node.id, shapeId);
        operations.push(
          node.kind === "code"
            ? this.createCodeOperation(node, shapeId, frame, frameShapeId, clientOperationId, index)
            : this.createNoteOperation(node, shapeId, frame, frameShapeId, clientOperationId, index)
        );
      });

    spec.connections.forEach((connection, index) => {
      const from = spec.nodes.find((node) => node.id === connection.from);
      const to = spec.nodes.find((node) => node.id === connection.to);
      const fromShapeId = nodeShapeIds.get(connection.from);
      const toShapeId = nodeShapeIds.get(connection.to);
      if (!from || !to || !fromShapeId || !toShapeId) return;

      const shapeId = this.shapeId("arrow");
      operations.push({
        type: "create",
        shapeId,
        clientOperationId: `${clientOperationId}:arrow:${index}`,
        payload: {
          id: shapeId,
          parentShapeId: frameShapeId,
          shapeType: "arrow",
          title: null,
          textContent: null,
          x: frame ? 0 : from.x,
          y: frame ? 0 : from.y,
          width: null,
          height: null,
          rotation: 0,
          zIndex: 50 + index,
          rawShape: {
            id: shapeId,
            type: "arrow",
            parentId: frameShapeId ?? "page:page",
            x: frame ? 0 : from.x,
            y: frame ? 0 : from.y,
            rotation: 0,
            props: {
              dash: "draw",
              size: "m",
              fill: "none",
              color: "black",
              labelColor: "black",
              bend: 0,
              start: { type: "point", x: from.x + from.width, y: from.y + from.height / 2 },
              end: { type: "point", x: to.x, y: to.y + to.height / 2 },
              arrowheadStart: "none",
              arrowheadEnd: "arrow"
            },
            meta: { piloCanvasAgent: true }
          }
        }
      });
    });

    return { operations };
  }

  private createFrameOperation(
    node: CanvasAgentDraftNode,
    shapeId: string,
    clientOperationId: string
  ): Record<string, unknown> {
    return {
      type: "create",
      shapeId,
      clientOperationId: `${clientOperationId}:frame`,
      payload: {
        id: shapeId,
        parentShapeId: null,
        shapeType: "frame",
        title: node.title,
        textContent: null,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: 0,
        zIndex: 1,
        rawShape: {
          id: shapeId,
          type: "frame",
          parentId: "page:page",
          x: node.x,
          y: node.y,
          rotation: 0,
          props: { w: node.width, h: node.height, name: node.title, color: node.color },
          meta: { piloCanvasAgent: true }
        }
      }
    };
  }

  private createNoteOperation(
    node: CanvasAgentDraftNode,
    shapeId: string,
    frame: CanvasAgentDraftNode | null,
    frameShapeId: string | null,
    clientOperationId: string,
    index: number
  ): Record<string, unknown> {
    const text = [node.title, node.text].filter(Boolean).join("\n");
    return {
      type: "create",
      shapeId,
      clientOperationId: `${clientOperationId}:note:${index}`,
      payload: {
        id: shapeId,
        parentShapeId: frameShapeId,
        shapeType: "note",
        title: node.title,
        textContent: text,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: 0,
        zIndex: 10 + index,
        rawShape: {
          id: shapeId,
          type: "note",
          parentId: frameShapeId ?? "page:page",
          x: frame ? node.x : node.x,
          y: frame ? node.y : node.y,
          rotation: 0,
          props: {
            color: node.color,
            richText: this.richText(text),
            size: "m",
            font: "draw",
            align: "middle",
            verticalAlign: "middle",
            labelColor: "black",
            growY: 0,
            fontSizeAdjustment: 1,
            url: "",
            scale: 1,
            textFirstEditedBy: null
          },
          meta: { piloCanvasAgent: true }
        }
      }
    };
  }

  private createCodeOperation(
    node: CanvasAgentDraftNode,
    shapeId: string,
    frame: CanvasAgentDraftNode | null,
    frameShapeId: string | null,
    clientOperationId: string,
    index: number
  ): Record<string, unknown> {
    return {
      type: "create",
      shapeId,
      clientOperationId: `${clientOperationId}:code:${index}`,
      payload: {
        id: shapeId,
        parentShapeId: frameShapeId,
        shapeType: "pilo-code-block",
        title: node.title,
        textContent: null,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: 0,
        zIndex: 10 + index,
        rawShape: {
          id: shapeId,
          type: "pilo-code-block",
          parentId: frameShapeId ?? "page:page",
          x: frame ? node.x : node.x,
          y: frame ? node.y : node.y,
          rotation: 0,
          props: {
            w: node.width,
            h: node.height,
            fileName: node.title,
            language: node.language ?? "ts",
            code: node.code ?? "",
            isCollapsed: false,
            scrollY: 0
          },
          meta: { piloCanvasAgent: true }
        }
      }
    };
  }

  private richText(text: string): Record<string, unknown> {
    return {
      type: "doc",
      content: text.split("\n").map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {})
      }))
    };
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
    const suffix = kind === "code" ? "코드 예시" : kind === "organize" ? "정리 초안" : "흐름도 초안";
    return `${this.cleanText(prompt).slice(0, 48) || "Canvas AI"} ${suffix}`;
  }

  private defaultCode(prompt: string): string {
    return `// ${this.cleanText(prompt).slice(0, 100)}\nexport function canvasAgentExample() {\n  return \"PILO Canvas AI\";\n}`;
  }

  private cleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private shapeId(kind: string): string {
    return `shape:canvas-agent-${kind}-${randomUUID()}`;
  }
}
