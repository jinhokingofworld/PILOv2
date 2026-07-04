export function canvasStorageKey(boardId: string, scope: string) {
  return `pilo:canvas:${boardId}:${scope}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const persistableShapeTypes = new Set([
  "sticky-note",
  "text",
  "frame",
  "draw",
  "highlight",
  "geo",
  "arrow",
  "line",
  "image",
  "video",
  "bookmark",
  "embed",
  "group",
  "pilo-sticky-note",
  "pilo-code-block",
  // TODO(file_node): add PILO_FILE_NODE_SHAPE_TYPE after the ShapeUtil is
  // registered and the local/mock restore path can render it safely.
]);

export function readCanvasStorage(
  scope: string,
  boardId: string,
  storage: Storage | undefined = globalThis.localStorage,
) {
  try {
    const rawValue = storage?.getItem(canvasStorageKey(boardId, scope));

    return rawValue ? (JSON.parse(rawValue) as unknown) : null;
  } catch (error) {
    return null;
  }
}

export function writeCanvasStorage(
  scope: string,
  boardId: string,
  value: unknown,
  storage: Storage | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(canvasStorageKey(boardId, scope), JSON.stringify(value));
  } catch (error) {
    return false;
  }

  return true;
}

export function normalizeCanvasFreeformShapes(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (shape) =>
      isRecord(shape) &&
      typeof shape.id === "string" &&
      typeof shape.type === "string" &&
      persistableShapeTypes.has(shape.type) &&
      isFiniteNumber(shape.x) &&
      isFiniteNumber(shape.y) &&
      isRecord(shape.props),
  );
}
