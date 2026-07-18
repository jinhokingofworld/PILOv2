"use client";

import {
  Rectangle2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type TLShape,
  type TLShapePartial
} from "tldraw";

import type {
  SqltoerdCanvasFrameColor,
  SqltoerdCanvasStroke
} from "@/features/sql-erd/types";

export const SQLTOERD_STROKE_SHAPE_TYPE = "sqltoerd_stroke";

export type SqlErdStrokeShapeProps = {
  w: number;
  h: number;
  strokeId: string;
  points: { x: number; y: number }[];
  color: SqltoerdCanvasFrameColor;
  size: number;
};

export type SqlErdStrokeShape = TLBaseShape<
  typeof SQLTOERD_STROKE_SHAPE_TYPE,
  SqlErdStrokeShapeProps
>;

export function getSqlErdStrokeShapeId(strokeId: string) {
  return `shape:sqltoerd-stroke:${strokeId}` as SqlErdStrokeShape["id"];
}

export function isSqlErdStrokeShape(
  shape: TLShape | null | undefined
): shape is SqlErdStrokeShape {
  return shape?.type === SQLTOERD_STROKE_SHAPE_TYPE;
}

export function createSqlErdStrokeShape(
  stroke: SqltoerdCanvasStroke
): TLShapePartial<SqlErdStrokeShape> {
  const padding = stroke.size / 2;
  const minX = Math.min(...stroke.points.map((point) => point.x)) - padding;
  const minY = Math.min(...stroke.points.map((point) => point.y)) - padding;
  const maxX = Math.max(...stroke.points.map((point) => point.x)) + padding;
  const maxY = Math.max(...stroke.points.map((point) => point.y)) + padding;

  return {
    id: getSqlErdStrokeShapeId(stroke.id),
    type: SQLTOERD_STROKE_SHAPE_TYPE,
    x: minX,
    y: minY,
    props: {
      w: Math.max(maxX - minX, stroke.size),
      h: Math.max(maxY - minY, stroke.size),
      strokeId: stroke.id,
      points: stroke.points.map((point) => ({
        x: point.x - minX,
        y: point.y - minY
      })),
      color: stroke.color,
      size: stroke.size
    }
  };
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_STROKE_SHAPE_TYPE]: SqlErdStrokeShapeProps;
  }
}

const strokeColors: Record<SqltoerdCanvasFrameColor, string> = {
  slate: "#475569",
  blue: "#2563eb",
  green: "#059669",
  amber: "#d97706",
  rose: "#e11d48"
};

export class SqlErdStrokeShapeUtil extends ShapeUtil<SqlErdStrokeShape> {
  static override type = SQLTOERD_STROKE_SHAPE_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    strokeId: T.string,
    points: T.arrayOf(T.object({ x: T.number, y: T.number })),
    color: T.string,
    size: T.number
  };

  override canBind() {
    return false;
  }

  override canEdit() {
    return false;
  }

  override canRotate() { return false; }

  override canResize() {
    return false;
  }

  override canBeLaidOut() {
    return false;
  }

  override getDefaultProps(): SqlErdStrokeShape["props"] {
    return {
      w: 4,
      h: 4,
      strokeId: "",
      points: [],
      color: "blue",
      size: 4
    };
  }

  override getGeometry(shape: SqlErdStrokeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false
    });
  }

  override component(shape: SqlErdStrokeShape) {
    return (
      <SVGContainer>
        <polyline
          fill="none"
          points={shape.props.points.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={strokeColors[shape.props.color]}
          stroke-linecap="round"
          stroke-linejoin="round"
          strokeWidth={shape.props.size}
        />
      </SVGContainer>
    );
  }

  override getIndicatorPath(shape: SqlErdStrokeShape) {
    const path = new Path2D();
    const [firstPoint, ...remainingPoints] = shape.props.points;

    if (!firstPoint) {
      return path;
    }

    path.moveTo(firstPoint.x, firstPoint.y);
    remainingPoints.forEach((point) => path.lineTo(point.x, point.y));
    return path;
  }
}
