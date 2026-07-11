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
  "note",
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
  "pilo-code-block",
  // TODO(file_node): add PILO_FILE_NODE_SHAPE_TYPE after the ShapeUtil is
  // registered and the local/mock restore path can render it safely.
]);

function createEmptyRichText() {
  return {
    content: [
      {
        type: "paragraph",
      },
    ],
    type: "doc",
  };
}

function isRichText(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    Array.isArray(value.content)
  );
}

function normalizePoint(value: unknown, fallback: { x: number; y: number }) {
  return isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
    ? { x: value.x, y: value.y }
    : fallback;
}

function normalizeShapeProps(shape: Record<string, unknown>) {
  const props = isRecord(shape.props) ? { ...shape.props } : {};

  if ("assetId" in props && typeof props.assetId !== "string") {
    delete props.assetId;
  }

  if (
    shape.type === "text" ||
    shape.type === "geo" ||
    shape.type === "arrow"
  ) {
    props.richText = isRichText(props.richText)
      ? props.richText
      : createEmptyRichText();
  }

  if (shape.type === "arrow") {
    props.start = normalizePoint(props.start, { x: 0, y: 0 });
    props.end = normalizePoint(props.end, { x: 2, y: 0 });
  }

  if (
    (shape.type === "draw" || shape.type === "highlight") &&
    !Array.isArray(props.segments)
  ) {
    delete props.segments;
  }

  if (shape.type === "line" && !isRecord(props.points)) {
    delete props.points;
  }

  return props;
}

function normalizeParentId(parentId: unknown) {
  return typeof parentId === "string" &&
    (parentId.startsWith("page:") || parentId.startsWith("shape:"))
    ? parentId
    : null;
}

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

  return value.flatMap((shape) => {
    if (
      !isRecord(shape) ||
      typeof shape.id !== "string" ||
      typeof shape.type !== "string" ||
      !persistableShapeTypes.has(shape.type) ||
      !isFiniteNumber(shape.x) ||
      !isFiniteNumber(shape.y) ||
      !isRecord(shape.props)
    ) {
      return [];
    }

    const normalizedShape: Record<string, unknown> = {
      ...shape,
      props: normalizeShapeProps(shape),
    };
    const parentId = normalizeParentId(shape.parentId);

    if (parentId) {
      normalizedShape.parentId = parentId;
    } else {
      delete normalizedShape.parentId;
    }

    if (typeof normalizedShape.index !== "string") {
      delete normalizedShape.index;
    }

    normalizedShape.meta = isRecord(normalizedShape.meta)
      ? normalizedShape.meta
      : {};

    return [normalizedShape];
  });
}
