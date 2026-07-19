import type {
  CanvasAgentShapeAncestorRow,
  CanvasAgentShapeRow,
  CanvasAgentViewport,
} from "./canvas-agent.types";

const DEFAULT_SHAPE_WIDTH = 180;
const DEFAULT_SHAPE_HEIGHT = 100;
const SEARCH_VIEWPORT_PADDING = 80;
const MAX_COMBINED_SEARCH_SPAN = 6_000;

type Matrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type ShapeBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

const IDENTITY_MATRIX: Matrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

function finiteNumber(value: number | string | null, fallback: number) {
  if (value === null) return fallback;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function shapeTransform(shape: CanvasAgentShapeRow): Matrix {
  const rotation = finiteNumber(shape.rotation, 0);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);

  return {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: finiteNumber(shape.x, 0),
    f: finiteNumber(shape.y, 0),
  };
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function pageBoundsForShape(
  shape: CanvasAgentShapeRow,
  ancestors: CanvasAgentShapeAncestorRow[],
): ShapeBounds {
  const transform = ([
    ...[...ancestors].sort(
      (left, right) => Number(right.depth) - Number(left.depth),
    ),
    shape,
  ] as CanvasAgentShapeRow[])
    .reduce(
      (matrix, item) => multiply(matrix, shapeTransform(item)),
      IDENTITY_MATRIX,
    );
  const width = Math.max(1, finiteNumber(shape.width, DEFAULT_SHAPE_WIDTH));
  const height = Math.max(1, finiteNumber(shape.height, DEFAULT_SHAPE_HEIGHT));
  const points = [
    transformPoint(transform, 0, 0),
    transformPoint(transform, width, 0),
    transformPoint(transform, width, height),
    transformPoint(transform, 0, height),
  ];

  return {
    bottom: Math.max(...points.map((point) => point.y)),
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
  };
}

function combineBounds(bounds: ShapeBounds[]): ShapeBounds {
  return {
    bottom: Math.max(...bounds.map((item) => item.bottom)),
    left: Math.min(...bounds.map((item) => item.left)),
    right: Math.max(...bounds.map((item) => item.right)),
    top: Math.min(...bounds.map((item) => item.top)),
  };
}

function viewportForBounds(bounds: ShapeBounds): CanvasAgentViewport {
  return {
    x: bounds.left - SEARCH_VIEWPORT_PADDING,
    y: bounds.top - SEARCH_VIEWPORT_PADDING,
    width: Math.max(
      320,
      bounds.right - bounds.left + SEARCH_VIEWPORT_PADDING * 2,
    ),
    height: Math.max(
      240,
      bounds.bottom - bounds.top + SEARCH_VIEWPORT_PADDING * 2,
    ),
  };
}

export function buildCanvasAgentSearchFocus(
  shapes: CanvasAgentShapeRow[],
  ancestors: CanvasAgentShapeAncestorRow[],
) {
  const ancestorsByShapeId = new Map<string, CanvasAgentShapeAncestorRow[]>();

  ancestors.forEach((ancestor) => {
    const entries = ancestorsByShapeId.get(ancestor.source_shape_id) ?? [];
    entries.push(ancestor);
    ancestorsByShapeId.set(ancestor.source_shape_id, entries);
  });

  const results = shapes.map((shape) => {
    const shapeAncestors = ancestorsByShapeId.get(shape.id) ?? [];
    const rootFrame = [...shapeAncestors]
      .sort((left, right) => Number(right.depth) - Number(left.depth))
      .find((ancestor) => ancestor.shape_type === "frame");

    return {
      bounds: pageBoundsForShape(shape, shapeAncestors),
      loadRootShapeId:
        rootFrame?.id ?? (shape.shape_type === "frame" ? shape.id : null),
      shapeId: shape.id,
    };
  });

  if (!results.length) {
    return {
      highlightedShapeIds: [] as string[],
      loadRootShapeIds: [] as string[],
      targetViewport: null as CanvasAgentViewport | null,
    };
  }

  const combinedBounds = combineBounds(results.map((result) => result.bounds));
  const combinedWidth = combinedBounds.right - combinedBounds.left;
  const combinedHeight = combinedBounds.bottom - combinedBounds.top;
  const focusedResults =
    combinedWidth > MAX_COMBINED_SEARCH_SPAN ||
    combinedHeight > MAX_COMBINED_SEARCH_SPAN
      ? results.slice(0, 1)
      : results;
  const focusBounds = combineBounds(
    focusedResults.map((result) => result.bounds),
  );

  return {
    highlightedShapeIds: focusedResults.map((result) => result.shapeId),
    loadRootShapeIds: Array.from(
      new Set(
        focusedResults.flatMap((result) =>
          result.loadRootShapeId ? [result.loadRootShapeId] : [],
        ),
      ),
    ),
    targetViewport: viewportForBounds(focusBounds),
  };
}
