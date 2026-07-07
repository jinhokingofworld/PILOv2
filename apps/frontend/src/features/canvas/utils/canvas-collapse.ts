export const PILO_FRAME_COLLAPSED_META_KEY = "piloFrameCollapsed";
export const PILO_CODE_BLOCK_COLLAPSED_META_KEY = "piloCodeBlockCollapsed";
export const PILO_CHILD_SHAPE_COUNT_META_KEY = "piloChildShapeCount";
export const PILO_FRAME_EXPANDED_SIZE_META_KEY = "piloFrameExpandedSize";
export const PILO_CODE_BLOCK_EXPANDED_SIZE_META_KEY =
  "piloCodeBlockExpandedSize";

type ShapeLike = {
  meta?: unknown;
  parentId?: unknown;
  props?: unknown;
  type?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPiloFrameCollapsed(shape: ShapeLike) {
  return (
    shape.type === "frame" &&
    isRecord(shape.meta) &&
    shape.meta[PILO_FRAME_COLLAPSED_META_KEY] === true
  );
}

export function isPiloCodeBlockCollapsed(shape: ShapeLike) {
  return (
    shape.type === "pilo-code-block" &&
    ((isRecord(shape.meta) &&
      shape.meta[PILO_CODE_BLOCK_COLLAPSED_META_KEY] === true) ||
      (isRecord(shape.props) && shape.props.isCollapsed === true))
  );
}

export function getPiloChildShapeCount(shape: ShapeLike) {
  if (!isRecord(shape.meta)) return 0;

  const value = shape.meta[PILO_CHILD_SHAPE_COUNT_META_KEY];

  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function getPiloFrameExpandedSize(shape: ShapeLike) {
  return getPiloShapeExpandedSize(shape, PILO_FRAME_EXPANDED_SIZE_META_KEY);
}

export function getPiloCodeBlockExpandedSize(shape: ShapeLike) {
  return getPiloShapeExpandedSize(
    shape,
    PILO_CODE_BLOCK_EXPANDED_SIZE_META_KEY,
  );
}

function getPiloShapeExpandedSize(shape: ShapeLike, metaKey: string) {
  if (!isRecord(shape.meta)) return null;

  const value = shape.meta[metaKey];

  if (!isRecord(value)) return null;

  const { h, w } = value;

  if (
    typeof h !== "number" ||
    typeof w !== "number" ||
    !Number.isFinite(h) ||
    !Number.isFinite(w) ||
    h <= 0 ||
    w <= 0
  ) {
    return null;
  }

  return { h, w };
}

export function getCodeLineCount(code: string) {
  if (!code) return 0;

  return code.split(/\r\n|\r|\n/).length;
}

export function getCodePreview(code: string, lineCount = 4) {
  return code
    .split(/\r\n|\r|\n/)
    .slice(0, lineCount)
    .join("\n")
    .trim();
}
