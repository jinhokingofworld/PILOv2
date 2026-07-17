export type CanvasPreviewPoint = {
  x: number;
  y: number;
};

type CanvasRemoteConnectionShapeBase = {
  id: string;
  opacity: number;
  parentId: string;
  rotation: number;
  x: number;
  y: number;
};

export type CanvasRemoteLinePreviewShape =
  CanvasRemoteConnectionShapeBase & {
    type: "line";
    props: {
      color: string;
      dash: string;
      points: Array<CanvasPreviewPoint & { index: string }>;
      scale: number;
      size: string;
      spline: string;
    };
  };

export type CanvasRemoteArrowPreviewShape =
  CanvasRemoteConnectionShapeBase & {
    type: "arrow";
    props: {
      arrowheadEnd: string;
      arrowheadStart: string;
      bend: number;
      color: string;
      dash: string;
      elbowMidPoint: number;
      end: CanvasPreviewPoint;
      kind: string;
      scale: number;
      size: string;
      start: CanvasPreviewPoint;
    };
  };

export type CanvasRemoteConnectionPreviewShape =
  | CanvasRemoteArrowPreviewShape
  | CanvasRemoteLinePreviewShape;

export type CanvasRemoteConnectionPath =
  | {
      kind: "polyline";
      points: CanvasPreviewPoint[];
    }
  | {
      control: CanvasPreviewPoint;
      end: CanvasPreviewPoint;
      kind: "quadratic";
      start: CanvasPreviewPoint;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function readPoint(value: unknown, fallback: CanvasPreviewPoint) {
  if (!isRecord(value)) return fallback;

  return {
    x: readFiniteNumber(value.x, fallback.x),
    y: readFiniteNumber(value.y, fallback.y),
  };
}

function readConnectionShapeBase(value: Record<string, unknown>) {
  if (typeof value.id !== "string") return null;

  return {
    id: value.id,
    opacity: Math.min(1, Math.max(0, readFiniteNumber(value.opacity, 1))),
    parentId: typeof value.parentId === "string" ? value.parentId : "",
    rotation: readFiniteNumber(value.rotation, 0),
    x: readFiniteNumber(value.x, 0),
    y: readFiniteNumber(value.y, 0),
  };
}

export function readRemoteConnectionPreviewShape(
  value: unknown,
): CanvasRemoteConnectionPreviewShape | null {
  if (!isRecord(value) || (value.type !== "line" && value.type !== "arrow")) {
    return null;
  }

  const base = readConnectionShapeBase(value);
  const props = isRecord(value.props) ? value.props : null;

  if (!base || !props) return null;

  const commonProps = {
    color: typeof props.color === "string" ? props.color : "black",
    dash: typeof props.dash === "string" ? props.dash : "draw",
    scale: Math.max(0.01, readFiniteNumber(props.scale, 1)),
    size: typeof props.size === "string" ? props.size : "m",
  };

  if (value.type === "line") {
    const points = isRecord(props.points)
      ? Object.values(props.points)
          .flatMap((point) => {
            if (!isRecord(point)) return [];

            return [
              {
                index: typeof point.index === "string" ? point.index : "",
                x: readFiniteNumber(point.x, 0),
                y: readFiniteNumber(point.y, 0),
              },
            ];
          })
          .sort((left, right) => left.index.localeCompare(right.index))
      : [];

    if (!points.length) return null;

    return {
      ...base,
      props: {
        ...commonProps,
        points,
        spline: typeof props.spline === "string" ? props.spline : "line",
      },
      type: "line",
    };
  }

  return {
    ...base,
    props: {
      ...commonProps,
      arrowheadEnd:
        typeof props.arrowheadEnd === "string" ? props.arrowheadEnd : "arrow",
      arrowheadStart:
        typeof props.arrowheadStart === "string"
          ? props.arrowheadStart
          : "none",
      bend: readFiniteNumber(props.bend, 0),
      elbowMidPoint: Math.min(
        1,
        Math.max(0, readFiniteNumber(props.elbowMidPoint, 0.5)),
      ),
      end: readPoint(props.end, { x: 1, y: 1 }),
      kind: typeof props.kind === "string" ? props.kind : "arc",
      start: readPoint(props.start, { x: 0, y: 0 }),
    },
    type: "arrow",
  };
}

export function getRemoteConnectionPreviewPath(
  shape: CanvasRemoteConnectionPreviewShape,
): CanvasRemoteConnectionPath {
  if (shape.type === "line") {
    return {
      kind: "polyline",
      points: shape.props.points.map(({ x, y }) => ({ x, y })),
    };
  }

  const { bend, elbowMidPoint, end, kind, start } = shape.props;

  if (kind === "elbow") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const middleX = start.x + dx * elbowMidPoint;

      return {
        kind: "polyline",
        points: [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
      };
    }

    const middleY = start.y + dy * elbowMidPoint;

    return {
      kind: "polyline",
      points: [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end],
    };
  }

  if (Math.abs(bend) < 0.01) {
    return { kind: "polyline", points: [start, end] };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;

  return {
    control: {
      x: (start.x + end.x) / 2 - (dy / length) * bend,
      y: (start.y + end.y) / 2 + (dx / length) * bend,
    },
    end,
    kind: "quadratic",
    start,
  };
}
