import { randomUUID } from "node:crypto";
import type { SyncCanvasShapesBatchRequest } from "../contracts/canvas.types";
import type {
  CanvasAgentDraftNode,
  CanvasAgentDraftNodeKind,
  CanvasAgentShapeRow,
  CanvasDraftSpec
} from "./canvas-agent.types";

const ALLOWED_DRAFT_COLORS = new Set(["default", "blue", "violet", "green", "yellow", "red", "black"]);
const PILO_ARROW_BINDINGS_META_KEY = "piloArrowBindingsV1";

type PiloArrowBindingTerminal = "start" | "end";

export function canvasAgentDraftToShapeBatch(
  spec: CanvasDraftSpec,
  clientOperationId: string
): SyncCanvasShapesBatchRequest {
  const frameShapeIds = new Map<string, string>();
  const nodeShapeIds = new Map<string, string>();
  const operations: Array<Record<string, unknown>> = [];

  spec.nodes
    .filter((node) => node.kind === "frame")
    .forEach((node, index) => {
      const shapeId = shapeIdFor("frame");
      frameShapeIds.set(node.id, shapeId);
      nodeShapeIds.set(node.id, shapeId);
      operations.push(createFrameOperation(node, shapeId, clientOperationId, index));
    });

  spec.nodes
    .filter((node) => node.kind !== "frame")
    .forEach((node, index) => {
      const shapeId = shapeIdFor(node.kind);
      const parentFrame = findParentFrame(node, spec.nodes);
      const parentShapeId = parentFrame ? frameShapeIds.get(parentFrame.id) ?? null : null;
      nodeShapeIds.set(node.id, shapeId);

      if (node.kind === "code") {
        operations.push(createCodeOperation(node, shapeId, parentShapeId, clientOperationId, index));
        return;
      }
      if (node.kind === "text") {
        operations.push(createTextOperation(node, shapeId, parentShapeId, clientOperationId, index));
        return;
      }
      if (isGeoNode(node.kind)) {
        operations.push(createGeoOperation(node, shapeId, parentShapeId, clientOperationId, index));
        return;
      }

      operations.push(createNoteOperation(node, shapeId, parentShapeId, clientOperationId, index));
    });

  spec.connections.forEach((connection, index) => {
    const from = spec.nodes.find((node) => node.id === connection.from);
    const to = spec.nodes.find((node) => node.id === connection.to);
    const fromShapeId = nodeShapeIds.get(connection.from);
    const toShapeId = nodeShapeIds.get(connection.to);
    if (!from || !to || !fromShapeId || !toShapeId) return;

    const shapeId = shapeIdFor("arrow");
    const fromFrame = findParentFrame(from, spec.nodes);
    const toFrame = findParentFrame(to, spec.nodes);
    const parentShapeId = fromFrame && toFrame && fromFrame.id === toFrame.id
      ? frameShapeIds.get(fromFrame.id) ?? null
      : null;
    const fromPoint = connectionPoint(from, "end");
    const toPoint = connectionPoint(to, "start");
    const text = cleanText(connection.text);

    operations.push({
      type: "create",
      shapeId,
      clientOperationId: `${clientOperationId}:arrow:${index}`,
      payload: {
        id: shapeId,
        parentShapeId,
        shapeType: "arrow",
        title: null,
        textContent: text || null,
        x: 0,
        y: 0,
        width: null,
        height: null,
        rotation: 0,
        zIndex: 50 + index,
        rawShape: {
          id: shapeId,
          type: "arrow",
          parentId: parentShapeId ?? "page:page",
          x: 0,
          y: 0,
          rotation: 0,
          props: {
            dash: "draw",
            size: "m",
            fill: "none",
            color: toTldrawColor(connection.color),
            labelColor: "black",
            bend: 0,
            start: { type: "point", x: fromPoint.x, y: fromPoint.y },
            end: { type: "point", x: toPoint.x, y: toPoint.y },
            arrowheadStart: "none",
            arrowheadEnd: connection.kind === "line" ? "none" : "arrow",
            richText: richText(text)
          },
          meta: {
            piloCanvasAgent: true,
            [PILO_ARROW_BINDINGS_META_KEY]: createArrowBindingSnapshots(shapeId, fromShapeId, toShapeId)
          }
        }
      }
    });
  });

  return { operations };
}

export function createCanvasAgentConnectionBatch(input: {
  clientOperationId: string;
  connectionKind: "arrow" | "line";
  from: CanvasAgentShapeRow;
  label: string | null;
  to: CanvasAgentShapeRow;
}): SyncCanvasShapesBatchRequest {
  const shapeId = shapeIdFor("arrow");
  const fromPoint = shapeConnectionPoint(input.from, "end");
  const toPoint = shapeConnectionPoint(input.to, "start");
  const geometry = connectionShapeGeometry(fromPoint, toPoint);
  const text = cleanText(input.label);

  return {
    operations: [
      {
        type: "create",
        shapeId,
        clientOperationId: input.clientOperationId,
        payload: {
          id: shapeId,
          parentShapeId: null,
          shapeType: "arrow",
          title: null,
          textContent: text || null,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          rotation: 0,
          zIndex: 90,
          rawShape: {
            id: shapeId,
            type: "arrow",
            parentId: "page:page",
            x: geometry.x,
            y: geometry.y,
            rotation: 0,
            props: {
              dash: "draw",
              size: "m",
              fill: "none",
              color: "black",
              labelColor: "black",
              bend: 0,
              start: { type: "point", x: geometry.start.x, y: geometry.start.y },
              end: { type: "point", x: geometry.end.x, y: geometry.end.y },
              arrowheadStart: "none",
              arrowheadEnd: input.connectionKind === "line" ? "none" : "arrow",
              richText: richText(text)
            },
            meta: {
              piloCanvasAgent: true,
              piloCanvasAgentConnection: {
                fromShapeId: input.from.id,
                toShapeId: input.to.id
              },
              [PILO_ARROW_BINDINGS_META_KEY]: createArrowBindingSnapshots(shapeId, input.from.id, input.to.id)
            }
          }
        }
      }
    ]
  };
}

function connectionShapeGeometry(
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number }
): {
  end: { x: number; y: number };
  height: number;
  start: { x: number; y: number };
  width: number;
  x: number;
  y: number;
} {
  const x = Math.min(fromPoint.x, toPoint.x);
  const y = Math.min(fromPoint.y, toPoint.y);
  const width = Math.max(1, Math.abs(toPoint.x - fromPoint.x));
  const height = Math.max(1, Math.abs(toPoint.y - fromPoint.y));

  return {
    end: {
      x: toPoint.x - x,
      y: toPoint.y - y
    },
    height,
    start: {
      x: fromPoint.x - x,
      y: fromPoint.y - y
    },
    width,
    x,
    y
  };
}

function createArrowBindingSnapshots(
  arrowId: string,
  startShapeId: string,
  endShapeId: string
): Array<Record<string, unknown>> {
  return [
    createArrowBindingSnapshot(arrowId, startShapeId, "start"),
    createArrowBindingSnapshot(arrowId, endShapeId, "end")
  ];
}

function createArrowBindingSnapshot(
  arrowId: string,
  targetShapeId: string,
  terminal: PiloArrowBindingTerminal
): Record<string, unknown> {
  return {
    type: "arrow",
    typeName: "binding",
    fromId: arrowId,
    toId: targetShapeId,
    props: {
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: "center"
    },
    meta: {}
  };
}

function createFrameOperation(
  node: CanvasAgentDraftNode,
  shapeId: string,
  clientOperationId: string,
  index = 0
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
      zIndex: 1 + index,
      rawShape: {
        id: shapeId,
        type: "frame",
        parentId: "page:page",
        x: node.x,
        y: node.y,
        rotation: 0,
        props: { w: node.width, h: node.height, name: node.title, color: toTldrawColor(node.color) },
        meta: { piloCanvasAgent: true }
      }
    }
  };
}

function createNoteOperation(
  node: CanvasAgentDraftNode,
  shapeId: string,
  parentShapeId: string | null,
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
      parentShapeId,
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
        parentId: parentShapeId ?? "page:page",
        x: node.x,
        y: node.y,
        rotation: 0,
        props: {
          color: toTldrawColor(node.color),
          richText: richText(text),
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

function createTextOperation(
  node: CanvasAgentDraftNode,
  shapeId: string,
  parentShapeId: string | null,
  clientOperationId: string,
  index: number
): Record<string, unknown> {
  const text = [node.title, node.text].filter(Boolean).join("\n");
  return {
    type: "create",
    shapeId,
    clientOperationId: `${clientOperationId}:text:${index}`,
    payload: {
      id: shapeId,
      parentShapeId,
      shapeType: "text",
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
        type: "text",
        parentId: parentShapeId ?? "page:page",
        x: node.x,
        y: node.y,
        rotation: 0,
        props: {
          color: toTldrawColor(node.color),
          richText: richText(text),
          size: "m",
          font: "draw",
          w: node.width,
          autoSize: false,
          scale: 1,
          textAlign: "middle"
        },
        meta: { piloCanvasAgent: true }
      }
    }
  };
}

function createGeoOperation(
  node: CanvasAgentDraftNode,
  shapeId: string,
  parentShapeId: string | null,
  clientOperationId: string,
  index: number
): Record<string, unknown> {
  const text = [node.title, node.text].filter(Boolean).join("\n");
  return {
    type: "create",
    shapeId,
    clientOperationId: `${clientOperationId}:geo:${index}`,
    payload: {
      id: shapeId,
      parentShapeId,
      shapeType: "geo",
      title: node.title,
      textContent: text || null,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: 0,
      zIndex: 10 + index,
      rawShape: {
        id: shapeId,
        type: "geo",
        parentId: parentShapeId ?? "page:page",
        x: node.x,
        y: node.y,
        rotation: 0,
        props: {
          w: node.width,
          h: node.height,
          geo: geoForNodeKind(node.kind),
          color: toTldrawColor(node.color),
          labelColor: "black",
          fill: "semi",
          dash: "draw",
          size: "m",
          font: "draw",
          align: "middle",
          verticalAlign: "middle",
          growY: 0,
          richText: richText(text),
          scale: 1
        },
        meta: { piloCanvasAgent: true }
      }
    }
  };
}

function createCodeOperation(
  node: CanvasAgentDraftNode,
  shapeId: string,
  parentShapeId: string | null,
  clientOperationId: string,
  index: number
): Record<string, unknown> {
  return {
    type: "create",
    shapeId,
    clientOperationId: `${clientOperationId}:code:${index}`,
    payload: {
      id: shapeId,
      parentShapeId,
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
        parentId: parentShapeId ?? "page:page",
        x: node.x,
        y: node.y,
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

function richText(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {})
    }))
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shapeIdFor(kind: string): string {
  return `shape:canvas-agent-${kind}-${randomUUID()}`;
}

function toTldrawColor(value: unknown): string {
  const color = normalizeColor(value);
  return color === "default" ? "black" : color;
}

function normalizeColor(value: unknown): string {
  const color = cleanText(value).toLowerCase();
  return ALLOWED_DRAFT_COLORS.has(color) ? color : "blue";
}

function findParentFrame(
  node: CanvasAgentDraftNode,
  nodes: CanvasAgentDraftNode[]
): CanvasAgentDraftNode | null {
  if (!node.parentId) return null;
  return nodes.find((candidate) => candidate.id === node.parentId && candidate.kind === "frame") ?? null;
}

function connectionPoint(node: CanvasAgentDraftNode, side: "start" | "end"): { x: number; y: number } {
  return {
    x: side === "start" ? node.x : node.x + node.width,
    y: node.y + node.height / 2
  };
}

function shapeConnectionPoint(shape: CanvasAgentShapeRow, side: "start" | "end"): { x: number; y: number } {
  const x = Number(shape.x);
  const y = Number(shape.y);
  const width = Number(shape.width ?? 180);
  const height = Number(shape.height ?? 100);
  return {
    x: side === "start" ? x : x + width,
    y: y + height / 2
  };
}

function isGeoNode(kind: CanvasAgentDraftNodeKind): boolean {
  return kind === "rectangle" || kind === "circle" || kind === "triangle";
}

function geoForNodeKind(kind: CanvasAgentDraftNodeKind): string {
  if (kind === "circle") return "ellipse";
  if (kind === "triangle") return "triangle";
  return "rectangle";
}
