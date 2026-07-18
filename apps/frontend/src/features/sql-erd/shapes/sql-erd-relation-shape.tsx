"use client";

import { useState, type MouseEvent } from "react";
import {
  type Editor,
  Polyline2d,
  ShapeUtil,
  SVGContainer,
  T,
  useEditor,
  useValue,
  Vec,
  type TLBaseShape,
  type TLShape
} from "tldraw";

import { isSqlErdTableShape } from "@/features/sql-erd/shapes/sql-erd-table-shape";
import { useSqlErdTableFocus } from "@/features/sql-erd/components/sql-erd-table-focus-context";
import { useSqlErdContextRelationIds } from "@/features/sql-erd/components/sql-erd-selection-context";
import type { ErdRelation } from "@/features/sql-erd/types";
import { getSqlErdFocusedRelationRole } from "@/features/sql-erd/utils/agent-table-focus";
import type { SqlErdRelationCardinality } from "@/features/sql-erd/utils/model";

export const SQLTOERD_RELATION_SHAPE_TYPE = "sqltoerd_relation";
export const SQLTOERD_RELATION_HOVER_EVENT = "sqltoerd:relation-hover";
export const SQLTOERD_RELATION_HIT_STROKE_WIDTH = 16;

const RELATION_BOUNDS_PADDING = 16;
const TABLE_HEADER_HEIGHT = 54;
const TABLE_ROW_HEIGHT = 42;
const TABLE_BORDER_WIDTH = 1;
const RELATION_CURVE_MIN_CONTROL_OFFSET = 80;
const RELATION_CURVE_GEOMETRY_SEGMENT_COUNT = 16;
const CARDINALITY_MARKER_HALF_HEIGHT = 6;
const CARDINALITY_MARKER_NEAR_OFFSET = 5;
const CARDINALITY_MARKER_FAR_OFFSET = 12;
const CARDINALITY_MARKER_CIRCLE_OFFSET = 14;
const CARDINALITY_MARKER_MANY_JUNCTION_OFFSET = 14;
const CARDINALITY_MARKER_MANY_CIRCLE_OFFSET = 21;
const CARDINALITY_MARKER_CIRCLE_RADIUS = 3.5;

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

export type RelationPortSide = "left" | "right";

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

type CardinalityMarkerSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type CardinalityMarkerCircle = {
  cx: number;
  cy: number;
  r: number;
};

export type SqlErdCardinalityMarkerGeometry = {
  circles: CardinalityMarkerCircle[];
  segments: CardinalityMarkerSegment[];
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
  endCardinality: SqlErdRelationCardinality | null;
  endSide: RelationPortSide;
  points: SqlErdRelationRoutePoint[];
  arrowPoints: SqlErdRelationRoutePoint[];
  startCardinality: SqlErdRelationCardinality | null;
  startSide: RelationPortSide;
};

export type SqlErdRelationHighlightDetail = {
  relationId: string;
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
};

export type SqlErdRelationHoverEventDetail =
  SqlErdRelationHighlightDetail & {
    isHovered: boolean;
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

export function getSqlErdRelationVisualStyle({
  isContextual = false,
  isHovered,
  isSelected
}: {
  isContextual?: boolean;
  isHovered: boolean;
  isSelected: boolean;
}) {
  if (isSelected) {
    return {
      stroke: "rgba(37, 99, 235, 0.98)",
      strokeWidth: 4
    };
  }

  if (isHovered) {
    return {
      stroke: "rgba(37, 99, 235, 0.82)",
      strokeWidth: 3.25
    };
  }

  if (isContextual) {
    return {
      stroke: "rgba(37, 99, 235, 0.74)",
      strokeWidth: 3
    };
  }

  return {
    stroke: "rgba(37, 99, 235, 0.58)",
    strokeWidth: 2.5
  };
}

export function getSqlErdCardinalityMarkerGeometry(
  endpoint: SqlErdRelationRoutePoint,
  side: RelationPortSide,
  cardinality: SqlErdRelationCardinality
): SqlErdCardinalityMarkerGeometry {
  const direction = side === "right" ? 1 : -1;
  const createVerticalSegment = (offset: number) => ({
    x1: endpoint.x + offset * direction,
    y1: endpoint.y - CARDINALITY_MARKER_HALF_HEIGHT,
    x2: endpoint.x + offset * direction,
    y2: endpoint.y + CARDINALITY_MARKER_HALF_HEIGHT
  });

  if (cardinality === "one") {
    return {
      circles: [],
      segments: [
        createVerticalSegment(CARDINALITY_MARKER_NEAR_OFFSET),
        createVerticalSegment(CARDINALITY_MARKER_FAR_OFFSET)
      ]
    };
  }

  if (cardinality === "zero_or_one") {
    return {
      circles: [
        {
          cx: endpoint.x + CARDINALITY_MARKER_CIRCLE_OFFSET * direction,
          cy: endpoint.y,
          r: CARDINALITY_MARKER_CIRCLE_RADIUS
        }
      ],
      segments: [createVerticalSegment(CARDINALITY_MARKER_NEAR_OFFSET)]
    };
  }

  const junctionX =
    endpoint.x + CARDINALITY_MARKER_MANY_JUNCTION_OFFSET * direction;
  const prongX = endpoint.x + CARDINALITY_MARKER_NEAR_OFFSET * direction;

  return {
    circles: [
      {
        cx: endpoint.x + CARDINALITY_MARKER_MANY_CIRCLE_OFFSET * direction,
        cy: endpoint.y,
        r: CARDINALITY_MARKER_CIRCLE_RADIUS
      }
    ],
    segments: [-1, 0, 1].map((verticalDirection) => ({
      x1: junctionX,
      y1: endpoint.y,
      x2: prongX,
      y2: endpoint.y + CARDINALITY_MARKER_HALF_HEIGHT * verticalDirection
    }))
  };
}

export function getSqlErdRelationHighlightDetail(
  relations: ErdRelation[],
  relationId: string | null
): SqlErdRelationHighlightDetail | null {
  if (!relationId) {
    return null;
  }

  const relation = relations.find((candidate) => candidate.id === relationId);

  if (!relation) {
    return null;
  }

  return {
    relationId: relation.id,
    fromTableId: relation.fromTableId,
    fromColumnIds: relation.fromColumnIds,
    toTableId: relation.toTableId,
    toColumnIds: relation.toColumnIds
  };
}

export function resolveSqlErdRelationHighlightFromIds(
  relations: ErdRelation[],
  selectedRelationId: string | null,
  hoveredRelationId: string | null
) {
  if (selectedRelationId) {
    return getSqlErdRelationHighlightDetail(relations, selectedRelationId);
  }

  return getSqlErdRelationHighlightDetail(relations, hoveredRelationId);
}

export function selectSqlErdRelationShape(
  editor: Pick<Editor, "select">,
  shape: Pick<SqlErdRelationShape, "id">
) {
  editor.select(shape.id);
}

export function getSqlErdHighlightedColumnIdsForTable(
  detail: SqlErdRelationHighlightDetail | null,
  tableId: string
) {
  if (!detail) {
    return [];
  }

  const columnIds = new Set<string>();

  if (detail.fromTableId === tableId) {
    detail.fromColumnIds.forEach((columnId) => columnIds.add(columnId));
  }

  if (detail.toTableId === tableId) {
    detail.toColumnIds.forEach((columnId) => columnIds.add(columnId));
  }

  return [...columnIds];
}

function emitSqlErdRelationHover(
  shape: SqlErdRelationShape,
  isHovered: boolean
) {
  window.dispatchEvent(
    new CustomEvent(SQLTOERD_RELATION_HOVER_EVENT, {
      detail: {
        isHovered,
        relationId: shape.props.relationId,
        fromTableId: shape.props.fromTableId,
        fromColumnIds: shape.props.fromColumnIds,
        toTableId: shape.props.toTableId,
        toColumnIds: shape.props.toColumnIds
      }
    })
  );
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

export function getSqlErdRelationCurvePathData(
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

export function getSqlErdRelationCurveMidpoint(
  points: SqlErdRelationRoutePoint[],
  startSide: RelationPortSide,
  endSide: RelationPortSide
): SqlErdRelationRoutePoint {
  const startPoint = points[0] ?? { x: 0, y: 0 };
  const endPoint = points.at(-1) ?? startPoint;
  const [controlPointOne, controlPointTwo] =
    getRelationCurveControlPoints(points, startSide, endSide);

  if (!controlPointOne || !controlPointTwo) {
    return {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2
    };
  }

  return {
    x:
      (startPoint.x +
        3 * controlPointOne.x +
        3 * controlPointTwo.x +
        endPoint.x) /
      8,
    y:
      (startPoint.y +
        3 * controlPointOne.y +
        3 * controlPointTwo.y +
        endPoint.y) /
      8
  };
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

export function getSqlErdRelationCurveGeometryPoints(
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

  return Array.from(
    { length: RELATION_CURVE_GEOMETRY_SEGMENT_COUNT + 1 },
    (_, index) => {
      const t = index / RELATION_CURVE_GEOMETRY_SEGMENT_COUNT;
      const inverseT = 1 - t;

      return {
        x:
          inverseT ** 3 * startPoint.x +
          3 * inverseT ** 2 * t * controlPointOne.x +
          3 * inverseT * t ** 2 * controlPointTwo.x +
          t ** 3 * endPoint.x,
        y:
          inverseT ** 3 * startPoint.y +
          3 * inverseT ** 2 * t * controlPointOne.y +
          3 * inverseT * t ** 2 * controlPointTwo.y +
          t ** 3 * endPoint.y
      };
    }
  );
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

function SqlErdCardinalityMarker({
  cardinality,
  endpoint,
  side,
  stroke,
  strokeWidth
}: {
  cardinality: SqlErdRelationCardinality;
  endpoint: SqlErdRelationRoutePoint;
  side: RelationPortSide;
  stroke: string;
  strokeWidth: number;
}) {
  const geometry = getSqlErdCardinalityMarkerGeometry(
    endpoint,
    side,
    cardinality
  );

  return (
    <g
      data-sqltoerd-cardinality-marker={cardinality}
      pointerEvents="none"
    >
      {geometry.segments.map((segment, index) => (
        <line
          key={`segment-${index}`}
          stroke={stroke}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          {...segment}
        />
      ))}
      {geometry.circles.map((circle, index) => (
        <circle
          fill="var(--background)"
          key={`circle-${index}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          {...circle}
        />
      ))}
    </g>
  );
}

function SqlErdRelationLine({ shape }: { shape: SqlErdRelationShape }) {
  const editor = useEditor();
  const tableFocus = useSqlErdTableFocus();
  const contextRelationIds = useSqlErdContextRelationIds();
  const [isHovered, setIsHovered] = useState(false);
  const focusRole = tableFocus
    ? getSqlErdFocusedRelationRole(tableFocus, shape.props.relationId)
    : null;
  const isFocusDimmed = focusRole === "dimmed";
  const isSelected = useValue(
    `sqltoerd-relation-selected-${shape.id}`,
    () => editor.getOnlySelectedShape()?.id === shape.id,
    [editor, shape.id]
  );
  const pathData = getSqlErdRelationCurvePathData(
    shape.props.points,
    shape.props.startSide,
    shape.props.endSide
  );
  const visualStyle = getSqlErdRelationVisualStyle({
    isContextual: contextRelationIds.has(shape.props.relationId),
    isHovered,
    isSelected
  });
  const startPoint = shape.props.points[0];
  const endPoint = shape.props.points.at(-1);
  const hasCardinalityMarkers = Boolean(
    startPoint &&
      endPoint &&
      shape.props.startCardinality &&
      shape.props.endCardinality
  );

  function handlePointerEnter() {
    if (isFocusDimmed) {
      return;
    }
    setIsHovered(true);
    emitSqlErdRelationHover(shape, true);
  }

  function handlePointerLeave() {
    setIsHovered(false);
    emitSqlErdRelationHover(shape, false);
  }

  function handleClick(event: MouseEvent<SVGPathElement>) {
    event.stopPropagation();
    selectSqlErdRelationShape(editor, shape);
  }

  return (
    <SVGContainer
      style={{
        filter: isFocusDimmed ? "blur(1px) saturate(0.4)" : undefined,
        height: shape.props.h,
        opacity: isFocusDimmed ? 0.12 : 1,
        overflow: "visible",
        pointerEvents: isFocusDimmed ? "none" : "auto",
        transition: "filter 160ms ease, opacity 160ms ease",
        width: shape.props.w
      }}
    >
      <path
        data-sqltoerd-relation-focus-role={focusRole ?? undefined}
        data-sqltoerd-relation-hit-target
        d={pathData}
        fill="none"
        onClick={handleClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        pointerEvents={isFocusDimmed ? "none" : "stroke"}
        stroke="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={SQLTOERD_RELATION_HIT_STROKE_WIDTH}
      />
      <path
        data-sqltoerd-relation-state={
          isSelected
            ? "selected"
            : isHovered
              ? "hovered"
              : contextRelationIds.has(shape.props.relationId)
                ? "contextual"
                : "default"
        }
        d={pathData}
        fill="none"
        pointerEvents="none"
        stroke={visualStyle.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={visualStyle.strokeWidth}
      />
      {hasCardinalityMarkers &&
      startPoint &&
      endPoint &&
      shape.props.startCardinality &&
      shape.props.endCardinality ? (
        <>
          <SqlErdCardinalityMarker
            cardinality={shape.props.startCardinality}
            endpoint={startPoint}
            side={shape.props.startSide}
            stroke={visualStyle.stroke}
            strokeWidth={visualStyle.strokeWidth}
          />
          <SqlErdCardinalityMarker
            cardinality={shape.props.endCardinality}
            endpoint={endPoint}
            side={shape.props.endSide}
            stroke={visualStyle.stroke}
            strokeWidth={visualStyle.strokeWidth}
          />
        </>
      ) : (
        <polygon
          fill={visualStyle.stroke}
          pointerEvents="none"
          points={getPointListData(shape.props.arrowPoints)}
        />
      )}
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
    endCardinality: T.nullable(T.string),
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
    startCardinality: T.nullable(T.string),
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
      endCardinality: null,
      endSide: "left",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ],
      arrowPoints: [],
      startCardinality: null,
      startSide: "right"
    };
  }

  override getGeometry(shape: SqlErdRelationShape) {
    return new Polyline2d({
      points: getSqlErdRelationCurveGeometryPoints(
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
      getSqlErdRelationCurvePathData(
        shape.props.points,
        shape.props.startSide,
        shape.props.endSide
      )
    );
  }
}
