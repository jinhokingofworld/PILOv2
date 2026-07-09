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
const TABLE_HEADER_HEIGHT = 54;
const TABLE_ROW_HEIGHT = 42;
const TABLE_BORDER_WIDTH = 1;
const RELATION_CURVE_MIN_CONTROL_OFFSET = 80;

export type SqlErdRelationRoutePoint = {
  x: number;
  y: number;
};

export type SqlErdRelationShapeLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  endSide: RelationPortSide;
  points: SqlErdRelationRoutePoint[];
  arrowPoints: SqlErdRelationRoutePoint[];
  startSide: RelationPortSide;
};

type RelationPortSide = "left" | "right";

type RelationAnchors = {
  endX: number;
  endSide?: RelationPortSide;
  endY: number;
  startSide?: RelationPortSide;
  startX: number;
  startY: number;
};

type RelationPortAnchor = {
  side: RelationPortSide;
  x: number;
  y: number;
};

type RelationColumnIds = {
  fromColumnIds: string[];
  toColumnIds: string[];
};

type TableColumnBounds = {
  id: string;
};

type TableBounds = {
  columns: TableColumnBounds[];
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
  endSide: RelationPortSide;
  points: SqlErdRelationRoutePoint[];
  arrowPoints: SqlErdRelationRoutePoint[];
  startSide: RelationPortSide;
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
    columns: shape.props.columns.map((column) => ({ id: column.id })),
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h
  };
}

export function getSqlErdColumnAnchorY(
  table: TableBounds,
  columnIds: string[]
) {
  const columnIndexes = columnIds
    .map((columnId) =>
      table.columns.findIndex((column) => column.id === columnId)
    )
    .filter((columnIndex) => columnIndex >= 0);

  if (!columnIndexes.length) {
    return table.y + table.h / 2;
  }

  const averageColumnIndex =
    columnIndexes.reduce((sum, columnIndex) => sum + columnIndex, 0) /
    columnIndexes.length;

  return (
    table.y +
    TABLE_BORDER_WIDTH +
    TABLE_HEADER_HEIGHT +
    averageColumnIndex * TABLE_ROW_HEIGHT +
    TABLE_ROW_HEIGHT / 2
  );
}

export function getSqlErdRelationColumnAnchors(
  fromTable: TableBounds,
  toTable: TableBounds,
  columnIds: RelationColumnIds
): RelationAnchors {
  const { endPort, startPort } = getSqlErdNearestColumnPortAnchors(
    fromTable,
    toTable,
    columnIds
  );

  return {
    startX: startPort.x,
    startY: startPort.y,
    startSide: startPort.side,
    endX: endPort.x,
    endY: endPort.y,
    endSide: endPort.side
  };
}

export function getSqlErdColumnPortAnchors(
  table: TableBounds,
  columnIds: string[]
): {
  left: RelationPortAnchor;
  right: RelationPortAnchor;
} {
  const y = getSqlErdColumnAnchorY(table, columnIds);

  return {
    left: {
      side: "left",
      x: table.x,
      y
    },
    right: {
      side: "right",
      x: table.x + table.w,
      y
    }
  };
}

export function getSqlErdNearestColumnPortAnchors(
  fromTable: TableBounds,
  toTable: TableBounds,
  columnIds: RelationColumnIds
): {
  endPort: RelationPortAnchor;
  startPort: RelationPortAnchor;
} {
  const fromPorts = getSqlErdColumnPortAnchors(
    fromTable,
    columnIds.fromColumnIds
  );
  const toPorts = getSqlErdColumnPortAnchors(toTable, columnIds.toColumnIds);
  const fromCenterX = fromTable.x + fromTable.w / 2;
  const toCenterX = toTable.x + toTable.w / 2;
  const isToRight = toCenterX >= fromCenterX;
  const candidates = [
    {
      endPort: toPorts.left,
      preference: isToRight ? 0 : 2,
      startPort: fromPorts.right
    },
    {
      endPort: toPorts.right,
      preference: isToRight ? 2 : 0,
      startPort: fromPorts.left
    },
    {
      endPort: toPorts.right,
      preference: 1,
      startPort: fromPorts.right
    },
    {
      endPort: toPorts.left,
      preference: 1,
      startPort: fromPorts.left
    }
  ];

  return candidates
    .map((candidate) => ({
      ...candidate,
      distance:
        (candidate.endPort.x - candidate.startPort.x) ** 2 +
        (candidate.endPort.y - candidate.startPort.y) ** 2
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.preference - right.preference
    )[0];
}

export function getSqlErdRelationRoutePoints(
  anchors: RelationAnchors
): SqlErdRelationRoutePoint[] {
  const { endX, endY, startX, startY } = anchors;
  const midX = startX + (endX - startX) / 2;

  return [
    { x: startX, y: startY },
    { x: midX, y: startY },
    { x: midX, y: endY },
    { x: endX, y: endY }
  ];
}

function getRelationCurvePathData(
  points: SqlErdRelationRoutePoint[],
  startSide: RelationPortSide,
  endSide: RelationPortSide
) {
  const startPoint = points[0];
  const endPoint = points.at(-1);

  if (!startPoint || !endPoint) {
    return "";
  }

  const [controlPointOne, controlPointTwo] =
    getRelationCurveControlPoints(points, startSide, endSide);

  if (!controlPointOne || !controlPointTwo) {
    return "";
  }

  return `M ${startPoint.x} ${startPoint.y} C ${controlPointOne.x} ${controlPointOne.y}, ${controlPointTwo.x} ${controlPointTwo.y}, ${endPoint.x} ${endPoint.y}`;
}

function getRelationCurveControlPoints(
  points: SqlErdRelationRoutePoint[],
  startSide: RelationPortSide,
  endSide: RelationPortSide
): SqlErdRelationRoutePoint[] {
  const startPoint = points[0];
  const endPoint = points.at(-1);

  if (!startPoint || !endPoint) {
    return [];
  }

  const dx = endPoint.x - startPoint.x;
  const controlOffset = Math.max(
    RELATION_CURVE_MIN_CONTROL_OFFSET,
    Math.abs(dx) * 0.5
  );
  const startDirection = startSide === "right" ? 1 : -1;
  const endDirection = endSide === "right" ? 1 : -1;
  const controlPointOne = {
    x: startPoint.x + controlOffset * startDirection,
    y: startPoint.y
  };
  const controlPointTwo = {
    x: endPoint.x + controlOffset * endDirection,
    y: endPoint.y
  };

  return [controlPointOne, controlPointTwo];
}

function getRelationCurveBoundsPoints(
  points: SqlErdRelationRoutePoint[],
  startSide: RelationPortSide,
  endSide: RelationPortSide
): SqlErdRelationRoutePoint[] {
  return [
    ...points,
    ...getRelationCurveControlPoints(points, startSide, endSide)
  ];
}

function getRelationCurveGeometryPoints(
  points: SqlErdRelationRoutePoint[],
  startSide: RelationPortSide,
  endSide: RelationPortSide
): SqlErdRelationRoutePoint[] {
  const startPoint = points[0];
  const endPoint = points.at(-1);
  const [controlPointOne, controlPointTwo] =
    getRelationCurveControlPoints(points, startSide, endSide);

  if (!startPoint || !endPoint || !controlPointOne || !controlPointTwo) {
    return points;
  }

  return [
    startPoint,
    controlPointOne,
    controlPointTwo,
    endPoint
  ];
}

function getPointListData(points: SqlErdRelationRoutePoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getArrowPoints(
  routePoints: SqlErdRelationRoutePoint[],
  endSide?: RelationPortSide
): SqlErdRelationRoutePoint[] {
  const endPoint = routePoints.at(-1);
  const previousPoint = routePoints.at(-2);
  const arrowSize = 8;

  if (!endPoint || !previousPoint) {
    return [];
  }

  if (endSide) {
    const direction = endSide === "left" ? 1 : -1;

    return [
      { x: endPoint.x, y: endPoint.y },
      { x: endPoint.x - arrowSize * direction, y: endPoint.y - arrowSize },
      { x: endPoint.x - arrowSize * direction, y: endPoint.y + arrowSize }
    ];
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
  toTable: TableBounds,
  columnIds: RelationColumnIds = {
    fromColumnIds: [],
    toColumnIds: []
  }
): SqlErdRelationShapeLayout {
  const anchors = getSqlErdRelationColumnAnchors(fromTable, toTable, columnIds);
  const startSide = anchors.startSide ?? (anchors.endX >= anchors.startX ? "right" : "left");
  const endSide = anchors.endSide ?? (anchors.endX >= anchors.startX ? "left" : "right");
  const pagePoints = getSqlErdRelationRoutePoints(anchors);
  const pageArrowPoints = getArrowPoints(pagePoints, endSide);
  const bounds = getPaddedBounds([
    ...getRelationCurveBoundsPoints(pagePoints, startSide, endSide),
    ...pageArrowPoints
  ]);

  return {
    ...bounds,
    endSide,
    points: toLocalPoints(pagePoints, bounds),
    arrowPoints: toLocalPoints(pageArrowPoints, bounds),
    startSide
  };
}

function SqlErdRelationLine({ shape }: { shape: SqlErdRelationShape }) {
  return (
    <SVGContainer
      style={{
        height: shape.props.h,
        overflow: "visible",
        pointerEvents: "auto",
        width: shape.props.w
      }}
    >
      <path
        d={getRelationCurvePathData(
          shape.props.points,
          shape.props.startSide,
          shape.props.endSide
        )}
        fill="none"
        pointerEvents="stroke"
        stroke="rgba(37, 99, 235, 0.58)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <polygon
        fill="rgba(37, 99, 235, 0.7)"
        pointerEvents="auto"
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
    endSide: T.string,
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
    ),
    startSide: T.string
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
      endSide: "left",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ],
      arrowPoints: [],
      startSide: "right"
    };
  }

  override getGeometry(shape: SqlErdRelationShape) {
    return new Polyline2d({
      points: getRelationCurveGeometryPoints(
        shape.props.points,
        shape.props.startSide,
        shape.props.endSide
      ).map((point) => new Vec(point.x, point.y))
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
    return new Path2D(
      getRelationCurvePathData(
        shape.props.points,
        shape.props.startSide,
        shape.props.endSide
      )
    );
  }
}
