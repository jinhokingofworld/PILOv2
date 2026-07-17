import type { Editor } from "tldraw";
import type { CanvasAgentShapeSummary } from "../api/canvas-agent-types";

export const MAX_CANVAS_AGENT_SHAPE_SUMMARIES = 120;

type ShapeCandidate = {
  index: number;
  isSelected: boolean;
  isVisible: boolean;
  summary: CanvasAgentShapeSummary;
};

export function buildCanvasAgentShapeSummaries(
  editor: Editor,
): CanvasAgentShapeSummary[] {
  const selectedIds = new Set(editor.getSelectedShapeIds().map(String));
  const viewport = editor.getViewportPageBounds();

  return editor
    .getCurrentPageShapes()
    .flatMap((shape, index): ShapeCandidate[] => {
      const bounds = editor.getShapePageBounds(shape.id);
      if (!bounds) return [];
      if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) return [];
      const record = shape as unknown as Record<string, unknown>;
      const props = isRecord(record.props) ? record.props : {};
      const title = readFirstText(props.name, props.fileName, props.title);
      const text = readFirstText(
        props.text,
        props.code,
        props.label,
        props.placeholder,
        readRichText(props.richText),
      );

      return [{
        index,
        isSelected: selectedIds.has(String(shape.id)),
        isVisible: intersects(
          {
            x: bounds.x,
            y: bounds.y,
            width: Math.max(1, bounds.w),
            height: Math.max(1, bounds.h),
          },
          { x: viewport.x, y: viewport.y, width: viewport.w, height: viewport.h },
        ),
        summary: {
          id: String(shape.id),
          shapeType: typeof record.type === "string" ? record.type : "unknown",
          title,
          text,
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.w),
          height: Math.max(1, bounds.h),
        },
      }];
    })
    .sort((left, right) =>
      Number(right.isSelected) - Number(left.isSelected)
      || Number(right.isVisible) - Number(left.isVisible)
      || left.index - right.index)
    .slice(0, MAX_CANVAS_AGENT_SHAPE_SUMMARIES)
    .map(({ summary }) => summary);
}

function readFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) return normalized.slice(0, 500);
  }
  return null;
}

function readRichText(value: unknown): string | null {
  const fragments: string[] = [];
  collectRichText(value, fragments);
  return readFirstText(fragments.join(" "));
}

function collectRichText(value: unknown, fragments: string[]) {
  if (fragments.join(" ").length >= 500) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRichText(item, fragments));
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === "string") fragments.push(value.text);
  if (Array.isArray(value.content)) collectRichText(value.content, fragments);
}

function intersects(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
