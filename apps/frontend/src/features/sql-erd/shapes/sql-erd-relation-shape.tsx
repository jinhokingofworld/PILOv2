"use client";

import { useValue } from "@tldraw/state-react";
import {
  Polyline2d,
  ShapeUtil,
  SVGContainer,
  T,
  Vec,
  useEditor,
  type TLBaseShape,
  type TLShape,
  type TLShapeId
} from "tldraw";

import {
  isSqlErdTableShape,
  type SqlErdTableShape
} from "@/features/sql-erd/shapes/sql-erd-table-shape";

export const SQLTOERD_RELATION_SHAPE_TYPE = "sqltoerd_relation";

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

function getTableBounds(shape: TLShape | null | undefined): TableBounds | null {
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

function getRelationPathData(anchors: RelationAnchors) {
  const { endX, endY, startX, startY } = anchors;

  if (Math.abs(endX - startX) >= Math.abs(endY - startY)) {
    const midX = startX + (endX - startX) / 2;

    return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
  }

  const midY = startY + (endY - startY) / 2;

  return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
}

function getArrowPoints(anchors: RelationAnchors) {
  const { endX, endY, startX, startY } = anchors;
  const arrowSize = 8;

  if (Math.abs(endX - startX) >= Math.abs(endY - startY)) {
    const direction = endX >= startX ? 1 : -1;

    return `${endX},${endY} ${endX - arrowSize * direction},${endY - arrowSize} ${endX - arrowSize * direction},${endY + arrowSize}`;
  }

  const direction = endY >= startY ? 1 : -1;

  return `${endX},${endY} ${endX - arrowSize},${endY - arrowSize * direction} ${endX + arrowSize},${endY - arrowSize * direction}`;
}

function getRelationAnchors(
  editorShapeLookup: (id: TLShapeId) => TLShape | undefined,
  shape: SqlErdRelationShape
) {
  const fromShape = editorShapeLookup(
    shape.props.fromTableShapeId as TLShapeId
  ) as SqlErdTableShape | undefined;
  const toShape = editorShapeLookup(
    shape.props.toTableShapeId as TLShapeId
  ) as SqlErdTableShape | undefined;
  const fromTable = getTableBounds(fromShape);
  const toTable = getTableBounds(toShape);

  if (!fromTable || !toTable) {
    return null;
  }

  return getSqlErdRelationTableEdgeAnchors(fromTable, toTable);
}

function SqlErdRelationLine({ shape }: { shape: SqlErdRelationShape }) {
  const editor = useEditor();
  const anchors = useValue(
    `sqltoerd-relation-${shape.id}`,
    () => getRelationAnchors((id) => editor.getShape(id), shape),
    [
      editor,
      shape,
      shape.props.fromTableShapeId,
      shape.props.toTableShapeId
    ]
  );

  if (!anchors) {
    return null;
  }

  return (
    <SVGContainer style={{ overflow: "visible", pointerEvents: "none" }}>
      <path
        d={getRelationPathData(anchors)}
        fill="none"
        stroke="rgba(37, 99, 235, 0.58)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <polygon fill="rgba(37, 99, 235, 0.7)" points={getArrowPoints(anchors)} />
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
    toTableShapeId: T.string
  };

  override canBind() {
    return false;
  }

  override canCull() {
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
      toTableShapeId: ""
    };
  }

  override getGeometry() {
    return new Polyline2d({
      points: [new Vec(0, 0), new Vec(1, 1)]
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

  override getIndicatorPath() {
    return new Path2D("M 0 0 L 1 1");
  }
}
