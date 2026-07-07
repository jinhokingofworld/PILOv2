"use client";

import {
  Polyline2d,
  ShapeUtil,
  SVGContainer,
  T,
  Vec,
  type TLBaseShape,
  type TLShape
} from "tldraw";

import { isSqlErdTableShape } from "@/features/sql-erd/shapes/sql-erd-table-shape";

export const SQLTOERD_RELATION_SHAPE_TYPE = "sqltoerd_relation";

const RELATION_BOUNDS_PADDING = 16;

export type SqlErdRelationRoutePoint = {
  x: number;
  y: number;
};

export type SqlErdRelationShapeLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  points: SqlErdRelationRoutePoint[];
  arrowPoints: SqlErdRelationRoutePoint[];
};

type RelationAnchors = {
  endX: number;
  endY: number;
  startX: number;
  startY: number;
};

type TableBounds = {
  h: number;
  w: number;
  x: number;
  y: number;
};

export type SqlErdRelationShapeProps = {
  w: number;
  h: number;
  relationId: string;
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  constraintName: string | null;
  fromTableShapeId: string;
  toTableShapeId: string;
  points: SqlErdRelationRoutePoint[];
  arrowPoints: SqlErdRelationRoutePoint[];
};

export type SqlErdRelationShape = TLBaseShape<
  typeof SQLTOERD_RELATION_SHAPE_TYPE,
  SqlErdRelationShapeProps
>;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_RELATION_SHAPE_TYPE]: SqlErdRelationShapeProps;
  }
}

export function isSqlErdRelationShape(
  shape: TLShape | null | undefined
): shape is SqlErdRelationShape {
  return shape?.type === SQLTOERD_RELATION_SHAPE_TYPE;
}

export function getSqlErdRelationTableEdgeAnchors(
  fromTable: TableBounds,
  toTable: TableBounds
): RelationAnchors {
  const fromCenterX = fromTable.x + fromTable.w / 2;
  const fromCenterY = fromTable.y + fromTable.h / 2;
  const toCenterX = toTable.x + toTable.w / 2;
  const toCenterY = toTable.y + toTable.h / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      startX: dx >= 0 ? fromTable.x + fromTable.w : fromTable.x,
      startY: fromCenterY,
      endX: dx >= 0 ? toTable.x : toTable.x + toTable.w,
      endY: toCenterY
    };
  }

  return {
    startX: fromCenterX,
    startY: dy >= 0 ? fromTable.y + fromTable.h : fromTable.y,
    endX: toCenterX,
    endY: dy >= 0 ? toTable.y : toTable.y + toTable.h
  };
}

export function getSqlErdTableBoundsFromShape(
  shape: TLShape | null | undefined
): TableBounds | null {
  if (!isSqlErdTableShape(shape)) {
    return null;
  }

  return {
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h
  };
}

export function getSqlErdRelationRoutePoints(
  anchors: RelationAnchors
): SqlErdRelationRoutePoint[] {
  const { endX, endY, startX, startY } = anchors;

  if (Math.abs(endX - startX) >= Math.abs(endY - startY)) {
    const midX = startX + (endX - startX) / 2;

    return [
      { x: startX, y: startY },
      { x: midX, y: startY },
      { x: midX, y: endY },
      { x: endX, y: endY }
    ];
  }

  const midY = startY + (endY - startY) / 2;

  return [
    { x: startX, y: startY },
    { x: startX, y: midY },
    { x: endX, y: midY },
    { x: endX, y: endY }
  ];
}

function getRelationPathData(points: SqlErdRelationRoutePoint[]) {
  const [firstPoint, ...restPoints] = points;

  if (!firstPoint) {
    return "";
  }

  return [
    `M ${firstPoint.x} ${firstPoint.y}`,
    ...restPoints.map((point) => `L ${point.x} ${point.y}`)
  ].join(" ");
}

function getPointListData(points: SqlErdRelationRoutePoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getArrowPoints(
  routePoints: SqlErdRelationRoutePoint[]
): SqlErdRelationRoutePoint[] {
  const endPoint = routePoints.at(-1);
  const previousPoint = routePoints.at(-2);
  const arrowSize = 8;

  if (!endPoint || !previousPoint) {
    return [];
  }

  const dx = endPoint.x - previousPoint.x;
  const dy = endPoint.y - previousPoint.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = dx >= 0 ? 1 : -1;

    return [
      { x: endPoint.x, y: endPoint.y },
      { x: endPoint.x - arrowSize * direction, y: endPoint.y - arrowSize },
      { x: endPoint.x - arrowSize * direction, y: endPoint.y + arrowSize }
    ];
  }

  const direction = dy >= 0 ? 1 : -1;

  return [
    { x: endPoint.x, y: endPoint.y },
    { x: endPoint.x - arrowSize, y: endPoint.y - arrowSize * direction },
    { x: endPoint.x + arrowSize, y: endPoint.y - arrowSize * direction }
  ];
}

function getPaddedBounds(points: SqlErdRelationRoutePoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - RELATION_BOUNDS_PADDING;
  const minY = Math.min(...ys) - RELATION_BOUNDS_PADDING;
  const maxX = Math.max(...xs) + RELATION_BOUNDS_PADDING;
  const maxY = Math.max(...ys) + RELATION_BOUNDS_PADDING;

  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY)
  };
}

function toLocalPoints(
  points: SqlErdRelationRoutePoint[],
  bounds: Pick<SqlErdRelationShapeLayout, "x" | "y">
) {
  return points.map((point) => ({
    x: point.x - bounds.x,
    y: point.y - bounds.y
  }));
}

export function getSqlErdRelationShapeLayout(
  fromTable: TableBounds,
  toTable: TableBounds
): SqlErdRelationShapeLayout {
  const anchors = getSqlErdRelationTableEdgeAnchors(fromTable, toTable);
  const pagePoints = getSqlErdRelationRoutePoints(anchors);
  const pageArrowPoints = getArrowPoints(pagePoints);
  const bounds = getPaddedBounds([...pagePoints, ...pageArrowPoints]);

  return {
    ...bounds,
    points: toLocalPoints(pagePoints, bounds),
    arrowPoints: toLocalPoints(pageArrowPoints, bounds)
  };
}

function SqlErdRelationLine({ shape }: { shape: SqlErdRelationShape }) {
  return (
    <SVGContainer
      style={{
        height: shape.props.h,
        overflow: "visible",
        pointerEvents: "none",
        width: shape.props.w
      }}
    >
      <path
        d={getRelationPathData(shape.props.points)}
        fill="none"
        stroke="rgba(37, 99, 235, 0.58)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <polygon
        fill="rgba(37, 99, 235, 0.7)"
        points={getPointListData(shape.props.arrowPoints)}
      />
    </SVGContainer>
  );
}

export class SqlErdRelationShapeUtil extends ShapeUtil<SqlErdRelationShape> {
  static override type = SQLTOERD_RELATION_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    relationId: T.string,
    fromTableId: T.string,
    fromColumnIds: T.arrayOf(T.string),
    toTableId: T.string,
    toColumnIds: T.arrayOf(T.string),
    constraintName: T.nullable(T.string),
    fromTableShapeId: T.string,
    toTableShapeId: T.string,
    points: T.arrayOf(
      T.object({
        x: T.number,
        y: T.number
      })
    ),
    arrowPoints: T.arrayOf(
      T.object({
        x: T.number,
        y: T.number
      })
    )
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override getDefaultProps(): SqlErdRelationShape["props"] {
    return {
      w: 1,
      h: 1,
      relationId: "",
      fromTableId: "",
      fromColumnIds: [],
      toTableId: "",
      toColumnIds: [],
      constraintName: null,
      fromTableShapeId: "",
      toTableShapeId: "",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ],
      arrowPoints: []
    };
  }

  override getGeometry(shape: SqlErdRelationShape) {
    return new Polyline2d({
      points: shape.props.points.map((point) => new Vec(point.x, point.y))
    });
  }

  override component(shape: SqlErdRelationShape) {
    return <SqlErdRelationLine shape={shape} />;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override getIndicatorPath(shape: SqlErdRelationShape) {
    return new Path2D(getRelationPathData(shape.props.points));
  }
}
