import type { Editor } from "tldraw";
import type {
  CanvasAgentSelectedScene,
  CanvasAgentSelectedSceneShape,
} from "../api/canvas-agent-types";

export const MAX_CANVAS_AGENT_SCENE_SHAPES = 160;
export const MAX_CANVAS_AGENT_SCENE_DEPTH = 12;
export const MAX_CANVAS_AGENT_SCENE_BYTES = 50_000;

const STYLE_KEYS = [
  "align",
  "arrowheadEnd",
  "arrowheadStart",
  "bend",
  "color",
  "dash",
  "fill",
  "font",
  "geo",
  "labelColor",
  "radius",
  "scale",
  "size",
  "spline",
  "verticalAlign",
] as const;

const FRAME_COLORS: Record<string, { background: string; border: string; text: string }> = {
  black: { background: "#edf0f4", border: "#5b6472", text: "#111827" },
  grey: { background: "#d9dde4", border: "#7b8492", text: "#111827" },
  "light-violet": { background: "#eadcff", border: "#a379e6", text: "#3b2470" },
  violet: { background: "#dec8ff", border: "#7c4bd6", text: "#35176f" },
  blue: { background: "#d4e2ff", border: "#4c6fe8", text: "#173a8a" },
  "light-blue": { background: "#d6ecff", border: "#4595d9", text: "#0e4d78" },
  yellow: { background: "#fff0a6", border: "#d79b1f", text: "#704900" },
  orange: { background: "#ffd8b8", border: "#df7a28", text: "#783500" },
  green: { background: "#cdf2db", border: "#2b9b55", text: "#10542c" },
  "light-green": { background: "#d8f6cf", border: "#5dad45", text: "#285f1b" },
  "light-red": { background: "#ffd2d2", border: "#e06b6b", text: "#831f1f" },
  red: { background: "#ffc3c3", border: "#d94949", text: "#7a1111" },
  white: { background: "#ffffff", border: "#cbd2df", text: "#111827" },
};

export class CanvasAgentSelectedSceneError extends Error {
  readonly missingFrameIds: string[];

  constructor(
    message: string,
    missingFrameIds: string[] = [],
  ) {
    super(message);
    this.name = "CanvasAgentSelectedSceneError";
    this.missingFrameIds = missingFrameIds;
  }
}

export function buildCanvasAgentSelectedScene(editor: Editor): CanvasAgentSelectedScene | null {
  const selectedIds = editor.getSelectedShapeIds().map(String);
  if (!selectedIds.length) return null;

  const currentShapes = editor.getCurrentPageShapes();
  const shapeById = new Map(currentShapes.map((shape) => [String(shape.id), shape]));
  const validSelectedIds = selectedIds.filter((id) => shapeById.has(id));
  if (!validSelectedIds.length) return null;

  const selectedSet = new Set(validSelectedIds);
  const rootShapeIds = validSelectedIds.filter((id) => !hasAncestorInSet(id, selectedSet, shapeById));
  const includedIds = new Set(validSelectedIds);

  rootShapeIds.forEach((rootId) => {
    if (shapeById.get(rootId)?.type === "frame") {
      const descendantIds = new Set<string>([rootId]);
      collectDescendantIds(rootId, currentShapes, descendantIds);
      descendantIds.forEach((id) => includedIds.add(id));
    }
  });

  if (includedIds.size > MAX_CANVAS_AGENT_SCENE_SHAPES) {
    throw new CanvasAgentSelectedSceneError(
      `코드로 만들 선택 영역은 도형 ${MAX_CANVAS_AGENT_SCENE_SHAPES}개 이하로 줄여주세요.`,
    );
  }

  const missingFrameIds = [...includedIds].flatMap((id) => {
    const shape = shapeById.get(id);
    if (!shape || shape.type !== "frame") return [];
    const expected = readExpectedChildShapeCount(shape);
    if (expected <= 0) return [];
    const actual = countDescendants(id, currentShapes);
    return actual < expected ? [id] : [];
  });
  if (missingFrameIds.length) {
    throw new CanvasAgentSelectedSceneError(
      "선택 영역의 모든 프레임 내용을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      missingFrameIds,
    );
  }

  const includedShapes = currentShapes.filter((shape) => includedIds.has(String(shape.id)));
  const pageBounds = includedShapes.flatMap((shape) => {
    const bounds = editor.getShapePageBounds(shape.id);
    return bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)
      ? [{ id: String(shape.id), x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h }]
      : [];
  });
  if (!pageBounds.length) {
    throw new CanvasAgentSelectedSceneError("선택 영역의 위치 정보를 읽지 못했습니다.");
  }

  const singleFrameRoot = rootShapeIds.length === 1 && shapeById.get(rootShapeIds[0])?.type === "frame";
  const rootFrameBounds = singleFrameRoot
    ? pageBounds.find((bounds) => bounds.id === rootShapeIds[0]) ?? null
    : null;
  const left = rootFrameBounds?.x ?? Math.min(...pageBounds.map((bounds) => bounds.x));
  const top = rootFrameBounds?.y ?? Math.min(...pageBounds.map((bounds) => bounds.y));
  const right = rootFrameBounds
    ? rootFrameBounds.x + rootFrameBounds.width
    : Math.max(...pageBounds.map((bounds) => bounds.x + bounds.width));
  const bottom = rootFrameBounds
    ? rootFrameBounds.y + rootFrameBounds.height
    : Math.max(...pageBounds.map((bounds) => bounds.y + bounds.height));
  const boundsById = new Map(pageBounds.map((bounds) => [bounds.id, bounds]));

  const shapes: CanvasAgentSelectedSceneShape[] = includedShapes.map((shape, zIndex) => {
    const record = shape as unknown as Record<string, unknown>;
    const props = isRecord(record.props) ? record.props : {};
    const bounds = boundsById.get(String(shape.id));
    if (!bounds) {
      throw new CanvasAgentSelectedSceneError("선택 영역의 도형 위치를 읽지 못했습니다.");
    }
    const parentId = typeof record.parentId === "string" && includedIds.has(record.parentId)
      ? record.parentId
      : null;
    const depth = readDepth(String(shape.id), includedIds, shapeById);
    if (depth > MAX_CANVAS_AGENT_SCENE_DEPTH) {
      throw new CanvasAgentSelectedSceneError(
        `코드로 만들 선택 영역의 프레임 중첩은 ${MAX_CANVAS_AGENT_SCENE_DEPTH}단계 이하여야 합니다.`,
      );
    }

    return {
      id: String(shape.id),
      shapeType: typeof record.type === "string" ? record.type : "unknown",
      parentId,
      x: round(bounds.x - left),
      y: round(bounds.y - top),
      width: Math.max(1, round(bounds.width)),
      height: Math.max(1, round(bounds.height)),
      rotation: typeof record.rotation === "number" && Number.isFinite(record.rotation)
        ? round(record.rotation)
        : 0,
      zIndex,
      depth,
      title: readFirstText(props.name, props.fileName, props.title),
      text: readFirstText(
        props.text,
        props.label,
        props.placeholder,
        props.code,
        readRichText(props.richText),
      ),
      assetRef: typeof props.assetId === "string" ? props.assetId.slice(0, 200) : null,
      style: readStyle(record, props),
    };
  });

  const scene: CanvasAgentSelectedScene = {
    selectionMode: singleFrameRoot ? "frame" : "multi-selection",
    bounds: {
      width: Math.max(1, round(right - left)),
      height: Math.max(1, round(bottom - top)),
    },
    rootShapeIds,
    shapes,
    options: {
      styleMode: "faithful",
      responsive: false,
      includeJavaScript: false,
    },
  };
  if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > MAX_CANVAS_AGENT_SCENE_BYTES) {
    throw new CanvasAgentSelectedSceneError(
      "선택 영역의 코드 생성 정보가 너무 큽니다. 텍스트나 도형 수를 줄여주세요.",
    );
  }
  return scene;
}

function collectDescendantIds(rootId: string, shapes: ReturnType<Editor["getCurrentPageShapes"]>, ids: Set<string>) {
  let changed = true;
  while (changed) {
    changed = false;
    shapes.forEach((shape) => {
      const id = String(shape.id);
      const parentId = typeof shape.parentId === "string" ? shape.parentId : null;
      if (!ids.has(id) && parentId && ids.has(parentId)) {
        ids.add(id);
        changed = true;
      }
    });
  }
  ids.add(rootId);
}

function countDescendants(rootId: string, shapes: ReturnType<Editor["getCurrentPageShapes"]>) {
  const ids = new Set<string>([rootId]);
  collectDescendantIds(rootId, shapes, ids);
  return Math.max(0, ids.size - 1);
}

function hasAncestorInSet(
  id: string,
  ids: Set<string>,
  shapeById: Map<string, ReturnType<Editor["getCurrentPageShapes"]>[number]>,
) {
  const visited = new Set<string>();
  let parentId = readParentId(shapeById.get(id));
  while (parentId && !visited.has(parentId)) {
    if (ids.has(parentId)) return true;
    visited.add(parentId);
    parentId = readParentId(shapeById.get(parentId));
  }
  return false;
}

function readDepth(
  id: string,
  includedIds: Set<string>,
  shapeById: Map<string, ReturnType<Editor["getCurrentPageShapes"]>[number]>,
) {
  let depth = 0;
  const visited = new Set<string>();
  let parentId = readParentId(shapeById.get(id));
  while (parentId && includedIds.has(parentId) && !visited.has(parentId)) {
    depth += 1;
    visited.add(parentId);
    parentId = readParentId(shapeById.get(parentId));
  }
  if (parentId && visited.has(parentId)) {
    throw new CanvasAgentSelectedSceneError("선택 영역의 부모 관계가 순환되어 코드로 만들 수 없습니다.");
  }
  return depth;
}

function readParentId(shape: ReturnType<Editor["getCurrentPageShapes"]>[number] | undefined) {
  return shape && typeof shape.parentId === "string" && shape.parentId.startsWith("shape:")
    ? shape.parentId
    : null;
}

function readStyle(
  shape: Record<string, unknown>,
  props: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const style: Record<string, string | number | boolean | null> = {};
  STYLE_KEYS.forEach((key) => {
    const value = props[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      style[key] = typeof value === "string" ? value.slice(0, 100) : value;
    }
  });
  if (typeof shape.opacity === "number" && Number.isFinite(shape.opacity)) {
    style.opacity = round(shape.opacity);
  }
  for (const [prefix, point] of [["start", props.start], ["end", props.end]] as const) {
    if (!isRecord(point)) continue;
    if (typeof point.x === "number" && Number.isFinite(point.x)) style[`${prefix}X`] = round(point.x);
    if (typeof point.y === "number" && Number.isFinite(point.y)) style[`${prefix}Y`] = round(point.y);
  }
  if (shape.type === "frame" && typeof props.color === "string") {
    const colors = FRAME_COLORS[props.color];
    if (colors) {
      style.backgroundColor = colors.background;
      style.borderColor = colors.border;
      style.textColor = colors.text;
    }
  }
  return style;
}

function readExpectedChildShapeCount(shape: unknown) {
  if (!isRecord(shape) || !isRecord(shape.meta)) return 0;
  const value = shape.meta.piloChildShapeCount;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function readFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) return normalized.slice(0, 2000);
  }
  return null;
}

function readRichText(value: unknown): string | null {
  const fragments: string[] = [];
  collectRichText(value, fragments);
  return readFirstText(fragments.join(" "));
}

function collectRichText(value: unknown, fragments: string[]) {
  if (fragments.join(" ").length >= 2000) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRichText(item, fragments));
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === "string") fragments.push(value.text);
  if (Array.isArray(value.content)) collectRichText(value.content, fragments);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
