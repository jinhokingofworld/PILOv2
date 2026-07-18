"use client";

import { Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  Polyline2d,
  ShapeUtil,
  SVGContainer,
  T,
  useEditor,
  Vec,
  type TLBaseShape,
  type TLShape
} from "tldraw";

import {
  getSqlErdRelationCurveGeometryPoints,
  getSqlErdRelationCurveMidpoint,
  getSqlErdRelationCurvePathData,
  type RelationPortSide,
  type SqlErdRelationRoutePoint
} from "@/features/sql-erd/shapes/sql-erd-relation-shape";

export const SQLTOERD_ANNOTATION_SHAPE_TYPE = "sqltoerd_annotation";
export const SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT =
  "sqltoerd:annotation-label-change";
export const SQLTOERD_ANNOTATION_DELETE_EVENT = "sqltoerd:annotation-delete";
export const SQLTOERD_ANNOTATION_SELECT_EVENT = "sqltoerd:annotation-select";
export const SQLTOERD_ANNOTATION_HIT_STROKE_WIDTH = 16;

export type SqlErdAnnotationShapeProps = {
  w: number;
  h: number;
  annotationId: string;
  kind: "table_link" | "column_link";
  fromTableId: string;
  fromColumnId: string | null;
  toTableId: string;
  toColumnId: string | null;
  fromTableShapeId: string;
  toTableShapeId: string;
  label: string;
  selected: boolean;
  endSide: RelationPortSide;
  points: SqlErdRelationRoutePoint[];
  startSide: RelationPortSide;
};

export type SqlErdAnnotationShape = TLBaseShape<
  typeof SQLTOERD_ANNOTATION_SHAPE_TYPE,
  SqlErdAnnotationShapeProps
>;

export type SqlErdAnnotationLabelChangeEventDetail = {
  annotationId: string;
  label: string;
};

export type SqlErdAnnotationDeleteEventDetail = {
  annotationId: string;
};

export type SqlErdAnnotationSelectEventDetail = {
  annotationId: string;
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_ANNOTATION_SHAPE_TYPE]: SqlErdAnnotationShapeProps;
  }
}

export function isSqlErdAnnotationShape(
  shape: TLShape | null | undefined
): shape is SqlErdAnnotationShape {
  return shape?.type === SQLTOERD_ANNOTATION_SHAPE_TYPE;
}

function emitAnnotationLabelChange(annotationId: string, label: string) {
  window.dispatchEvent(
    new CustomEvent<SqlErdAnnotationLabelChangeEventDetail>(
      SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT,
      { detail: { annotationId, label } }
    )
  );
}

function emitAnnotationDelete(annotationId: string) {
  window.dispatchEvent(
    new CustomEvent<SqlErdAnnotationDeleteEventDetail>(
      SQLTOERD_ANNOTATION_DELETE_EVENT,
      { detail: { annotationId } }
    )
  );
}

function emitAnnotationSelect(annotationId: string) {
  window.dispatchEvent(
    new CustomEvent<SqlErdAnnotationSelectEventDetail>(
      SQLTOERD_ANNOTATION_SELECT_EVENT,
      { detail: { annotationId } }
    )
  );
}

function SqlErdAnnotationLine({ shape }: { shape: SqlErdAnnotationShape }) {
  const editor = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftLabel, setDraftLabel] = useState(shape.props.label);
  const [isEditing, setIsEditing] = useState(false);
  const isSelected = shape.props.selected;
  const pathData = getSqlErdRelationCurvePathData(
    shape.props.points,
    shape.props.startSide,
    shape.props.endSide
  );
  const labelPoint = getSqlErdRelationCurveMidpoint(
    shape.props.points,
    shape.props.startSide,
    shape.props.endSide
  );

  function selectAnnotationShape() {
    emitAnnotationSelect(shape.props.annotationId);
  }

  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(shape.props.label);
    }
  }, [isEditing, shape.props.label]);

  useEffect(() => {
    if (isSelected && !shape.props.label) {
      setIsEditing(true);
    }
  }, [isSelected, shape.props.label]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function selectAnnotation(event: MouseEvent<SVGPathElement>) {
    event.stopPropagation();
    selectAnnotationShape();
  }

  function selectAnnotationOnPointerDown(
    event: PointerEvent<SVGPathElement>
  ) {
    event.stopPropagation();
    selectAnnotationShape();
  }

  function commitLabel() {
    const nextLabel = draftLabel.trim().slice(0, 200);

    setIsEditing(false);
    setDraftLabel(nextLabel);

    if (nextLabel !== shape.props.label) {
      emitAnnotationLabelChange(shape.props.annotationId, nextLabel);
    }
  }

  function handleLabelKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDraftLabel(shape.props.label);
      setIsEditing(false);
    }
  }

  function stopPointerPropagation(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

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
        data-sqltoerd-annotation-id={shape.props.annotationId}
        data-sqltoerd-annotation-hit-target
        d={pathData}
        fill="none"
        onClick={selectAnnotation}
        onPointerDown={selectAnnotationOnPointerDown}
        pointerEvents="stroke"
        stroke="transparent"
        strokeLinecap="round"
        strokeWidth={SQLTOERD_ANNOTATION_HIT_STROKE_WIDTH}
      />
      <path
        d={pathData}
        fill="none"
        pointerEvents="none"
        stroke={isSelected ? "#475569" : "#94a3b8"}
        strokeDasharray="8 6"
        strokeLinecap="round"
        strokeWidth={isSelected ? 2.5 : 2}
      />
      <foreignObject
        height={40}
        overflow="visible"
        width={220}
        x={labelPoint.x - 110}
        y={labelPoint.y - 20}
      >
        <div
          className="flex h-10 items-center justify-center gap-1"
          data-sqltoerd-annotation-id={shape.props.annotationId}
          data-sqltoerd-annotation-label={shape.props.annotationId}
          onPointerDown={stopPointerPropagation}
        >
          {isEditing ? (
            <input
              aria-label="설명 관계 이름"
              className="h-8 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-center text-sm text-slate-700 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              maxLength={200}
              onBlur={commitLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              onKeyDown={handleLabelKeyDown}
              ref={inputRef}
              value={draftLabel}
            />
          ) : (
            <button
              className="max-w-[180px] truncate rounded bg-white/95 px-2 py-1 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
              onClick={(event) => {
                event.stopPropagation();
                selectAnnotationShape();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                selectAnnotationShape();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsEditing(true);
              }}
              title="더블 클릭하여 설명 수정"
              type="button"
            >
              {shape.props.label || "설명 추가"}
            </button>
          )}
          {isSelected && !isEditing ? (
            <button
              aria-label="설명 관계 삭제"
              className="inline-flex size-7 items-center justify-center rounded bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                editor.selectNone();
                emitAnnotationDelete(shape.props.annotationId);
              }}
              data-sqltoerd-annotation-delete
              title="설명 관계 삭제"
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </foreignObject>
    </SVGContainer>
  );
}

export class SqlErdAnnotationShapeUtil extends ShapeUtil<SqlErdAnnotationShape> {
  static override type = SQLTOERD_ANNOTATION_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    annotationId: T.string,
    kind: T.string,
    fromTableId: T.string,
    fromColumnId: T.nullable(T.string),
    toTableId: T.string,
    toColumnId: T.nullable(T.string),
    fromTableShapeId: T.string,
    toTableShapeId: T.string,
    label: T.string,
    selected: T.boolean,
    endSide: T.string,
    points: T.arrayOf(
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

  override canRotate() { return false; }

  override canResize() {
    return false;
  }

  override getDefaultProps(): SqlErdAnnotationShape["props"] {
    return {
      w: 1,
      h: 1,
      annotationId: "",
      kind: "column_link",
      fromTableId: "",
      fromColumnId: null,
      toTableId: "",
      toColumnId: null,
      fromTableShapeId: "",
      toTableShapeId: "",
      label: "",
      selected: false,
      endSide: "left",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ],
      startSide: "right"
    };
  }

  override getGeometry(shape: SqlErdAnnotationShape) {
    return new Polyline2d({
      points: getSqlErdRelationCurveGeometryPoints(
        shape.props.points,
        shape.props.startSide,
        shape.props.endSide
      ).map((point) => new Vec(point.x, point.y))
    });
  }

  override component(shape: SqlErdAnnotationShape) {
    return <SqlErdAnnotationLine shape={shape} />;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override getIndicatorPath(shape: SqlErdAnnotationShape) {
    return new Path2D(
      getSqlErdRelationCurvePathData(
        shape.props.points,
        shape.props.startSide,
        shape.props.endSide
      )
    );
  }
}
