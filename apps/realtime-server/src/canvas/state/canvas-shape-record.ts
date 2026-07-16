export function readShapeRevision(
  shape: Record<string, unknown> | undefined,
) {
  const revision = shape?.revision;

  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision > 0
    ? revision
    : null;
}

export function readShapeContentHash(
  shape: Record<string, unknown> | undefined,
) {
  return typeof shape?.contentHash === "string" && shape.contentHash
    ? shape.contentHash
    : null;
}

export function cloneShapeRecord(
  shape: Record<string, unknown> | null | undefined,
) {
  if (!shape) return null;

  try {
    return JSON.parse(JSON.stringify(shape)) as Record<string, unknown>;
  } catch {
    return { ...shape };
  }
}

export function areShapeRecordsEqual(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
) {
  if (!left && !right) return true;
  if (!left || !right) return false;

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

export function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toCanvasShapePayload(
  shape: Record<string, unknown>,
  zIndex: number,
) {
  const props = readRecord(shape.props);
  const rawShape = { ...shape };

  delete rawShape.contentHash;
  delete rawShape.revision;

  const title =
    typeof props.name === "string"
      ? props.name
      : typeof props.fileName === "string"
        ? props.fileName
        : null;
  const textContent =
    typeof props.text === "string"
      ? props.text
      : typeof props.code === "string"
        ? props.code
        : readRichTextPlainText(props.richText);

  return {
    height: readNullableSize(props.h),
    id: typeof shape.id === "string" ? shape.id : "",
    parentShapeId: resolveParentShapeId(shape.parentId),
    rawShape,
    rotation: readFiniteNumber(shape.rotation, 0),
    shapeType: typeof shape.type === "string" ? shape.type : "",
    textContent,
    title,
    width: readNullableSize(props.w),
    x: readFiniteNumber(shape.x, 0),
    y: readFiniteNumber(shape.y, 0),
    zIndex,
  };
}

function resolveParentShapeId(parentId: unknown) {
  if (typeof parentId !== "string") return null;
  if (!parentId.startsWith("shape:")) return null;

  const shapeId = parentId.slice("shape:".length).trim();

  return shapeId || null;
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readRichTextPlainText(value: unknown) {
  const richText = readRecord(value);
  const content = richText.content;

  if (!Array.isArray(content)) return null;

  const text = content
    .flatMap((node) => {
      if (!readRecord(node)) return [];
      const paragraph = node as Record<string, unknown>;
      const children = paragraph.content;

      return Array.isArray(children)
        ? children.flatMap((child) => {
            const textNode = readRecord(child);
            const childText = textNode.text;

            return typeof childText === "string" ? [childText] : [];
          })
        : [];
    })
    .join("\n")
    .trim();

  return text || null;
}
