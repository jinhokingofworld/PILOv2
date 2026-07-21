"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent
} from "react";
import {
  createShapeId,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  useEditor
} from "tldraw";
import { Workflow } from "lucide-react";

import {
  SqlErdCanvasToolbar,
  type SqlErdCanvasTool
} from "@/features/sql-erd/components/sql-erd-canvas-toolbar";
import { SqlErdTableFocusProvider } from "@/features/sql-erd/components/sql-erd-table-focus-context";
import { SqlErdSelectionContextProvider } from "@/features/sql-erd/components/sql-erd-selection-context";
import { SqlErdRealtimeBridge } from "@/features/sql-erd/realtime/sql-erd-realtime-bridge";
import {
  createSqlErdTableMoveCompletionKey,
  resolveSqlErdRemoteTableMovePreview,
  shouldClearSqlErdTableMovePreviewAfterDrop,
  type SqlErdRemoteTableMovePreviewState,
  type SqlErdTableMoveCommit
} from "@/features/sql-erd/realtime/sql-erd-table-move-preview";
import type {
  SqlErdRealtimeConfig,
  SqlErdTableMovePreview
} from "@/features/sql-erd/realtime/sql-erd-realtime-types";
import { useSqlErdPresence } from "@/features/sql-erd/realtime/use-sql-erd-presence";
import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import {
  SQLTOERD_FRAME_SHAPE_TYPE,
  SQLTOERD_FRAME_CHANGE_EVENT,
  SQLTOERD_FRAME_DELETE_EVENT,
  isSqlErdFrameShape,
  SqlErdFrameShapeUtil,
  type SqlErdFrameChangeEventDetail,
  type SqlErdFrameDeleteEventDetail,
  type SqlErdFrameShape
} from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import {
  SQLTOERD_NOTE_SHAPE_TYPE,
  SQLTOERD_NOTE_CHANGE_EVENT,
  isSqlErdNoteShape,
  SqlErdNoteShapeUtil,
  type SqlErdNoteChangeEventDetail,
  type SqlErdNoteShape
} from "@/features/sql-erd/shapes/sql-erd-note-shape";
import {
  SQLTOERD_TEXT_CHANGE_EVENT,
  SQLTOERD_TEXT_SHAPE_TYPE,
  isSqlErdTextShape,
  SqlErdTextShapeUtil,
  type SqlErdTextChangeEventDetail,
  type SqlErdTextShape
} from "@/features/sql-erd/shapes/sql-erd-text-shape";
import {
  createSqlErdStrokeShape,
  getSqlErdStrokeShapeId,
  isSqlErdStrokeShape,
  SQLTOERD_STROKE_SHAPE_TYPE,
  SqlErdStrokeShapeUtil,
  type SqlErdStrokeShape
} from "@/features/sql-erd/shapes/sql-erd-stroke-shape";
import {
  isSqlErdAnnotationShape,
  SQLTOERD_ANNOTATION_DELETE_EVENT,
  SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT,
  SQLTOERD_ANNOTATION_SELECT_EVENT,
  SQLTOERD_ANNOTATION_SHAPE_TYPE,
  SqlErdAnnotationShapeUtil,
  type SqlErdAnnotationDeleteEventDetail,
  type SqlErdAnnotationLabelChangeEventDetail,
  type SqlErdAnnotationSelectEventDetail,
  type SqlErdAnnotationShape
} from "@/features/sql-erd/shapes/sql-erd-annotation-shape";
import {
  getSqlErdHighlightedColumnIdsForTable,
  getSqlErdRelationShapeLayout,
  getSqlErdTableBoundsFromShape,
  isSqlErdRelationShape,
  resolveSqlErdRelationHighlightFromIds,
  SQLTOERD_RELATION_HOVER_EVENT,
  SQLTOERD_RELATION_SHAPE_TYPE,
  SqlErdRelationShapeUtil,
  type SqlErdRelationHighlightDetail,
  type SqlErdRelationHoverEventDetail,
  type SqlErdRelationShape,
  type SqlErdRelationShapeLayout
} from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import {
  getSqlErdTableShapeSize,
  SQLTOERD_COLUMN_CONNECT_START_EVENT,
  SQLTOERD_COLUMN_SELECT_EVENT,
  SQLTOERD_TABLE_CONNECT_START_EVENT,
  SQLTOERD_TABLE_SELECT_EVENT,
  SQLTOERD_TABLE_SHAPE_TYPE,
  SqlErdTableShapeUtil,
  startSqlErdColumnConnection,
  startSqlErdTableConnection,
  toSqlErdTableShapeColumns,
  isSqlErdTableShape,
  type SqlErdColumnConnectStartEventDetail,
  type SqlErdTableConnectStartEventDetail,
  type SqlErdTableShape
} from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type {
  SqlErdSelection,
  SqltoerdCanvasFrame,
  SqltoerdCanvasFrameColor,
  SqltoerdCanvasNote,
  SqltoerdCanvasStroke,
  SqltoerdCanvasText,
  SqltoerdColumnAnnotationLink,
  SqltoerdLayoutJsonV1,
  SqltoerdLayoutPatch,
  SqltoerdModelJsonV1,
  SqltoerdTableAnnotationLink
} from "@/features/sql-erd/types";
import {
  areSqltoerdLayoutsEqual,
  addSqltoerdColumnAnnotation,
  addSqltoerdTableAnnotation,
  createSqltoerdModelIndex,
  getSqltoerdRenderableAnnotations,
  getTableLayout,
  inferSqlErdRelationCardinality,
  updateSqltoerdLayoutWithTablePositions,
} from "@/features/sql-erd/utils/model";
import {
  createSqltoerdAutoLayout,
  getSqltoerdMinimumZoomCamera,
  type SqltoerdAutoLayoutTableSize
} from "@/features/sql-erd/utils/auto-layout";
import {
  applySqlErdCanvasIncrementalShapeSync,
  createSqlErdTablePositionChangeBuffer,
  createSqlErdCanvasContentKey,
  createSqlErdCanvasContentSyncState,
  createSqlErdCanvasIncrementalShapeSyncPlan,
  invalidateSqlErdCanvasContentSyncFits,
  shouldFlushSqlErdTablePositionChangesOnKeyUp,
  syncSqlErdCanvasContent,
  type SqlErdTablePositionChangeBuffer
} from "@/features/sql-erd/utils/canvas-shape-sync";
import { getSqlErdPinnedTableCenter } from "@/features/sql-erd/utils/table-pin";
import {
  getSqlErdFocusedRelationRole,
  getSqlErdFocusedTableRole,
  isSqlErdShapeDimmedByTableFocus,
  type SqlErdAgentTableFocus
} from "@/features/sql-erd/utils/agent-table-focus";
import {
  areSqlErdSelectionsEqual,
  getSqlErdContextRelationIds,
  getSqlErdDeleteBatchFromSelectedShapes,
  getSqlErdSelectionFromSelectedShapes,
  isSqlErdCanvasBackgroundPoint,
  resolveSqlErdTableInteractionSelection,
  selectSqlErdCanvasShapeAtPoint,
  shouldHandleSqlErdSchemaDeleteShortcut,
  type SqlErdDeleteBatch
} from "@/features/sql-erd/utils/canvas-selection";
import { cn } from "@/lib/utils";
import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";
import { SqlErdWorkspaceLocationAdapter } from "@/features/sql-erd/sql-erd-workspace-location-adapter";

export type SqlErdLayoutPatchContext = {
  clientOperationId?: string;
};

type SqlErdCanvasProps = {
  className?: string;
  committedTableMoves?: SqlErdTableMoveCommit[];
  enableTableMovePreview?: boolean;
  isReadOnly?: boolean;
  isInspectorOpen?: boolean;
  layoutJson?: SqltoerdLayoutJsonV1;
  modelJson?: SqltoerdModelJsonV1;
  onLayoutPatch?: (
    patch: SqltoerdLayoutPatch,
    context?: SqlErdLayoutPatchContext
  ) => boolean | void;
  onDeleteForeignKey?: (relationId: string) => void;
  onSchemaDelete?: (
    selection: Extract<SqlErdSelection, { type: "table" | "column" }>
  ) => void;
  onSchemaDeleteBatch?: (batch: SqlErdDeleteBatch) => void;
  onSelectionChange?: (selection: SqlErdSelection) => void;
  onInspectorOpenChange?: (isOpen: boolean) => void;
  pinNavigationRequestId?: number;
  pinnedTableId?: string | null;
  realtimeConfig?: SqlErdRealtimeConfig | null;
  isSqlSourceOpen?: boolean;
  sessionId?: string | null;
  selectedSqlErdObject?: SqlErdSelection;
  tableFocus?: SqlErdAgentTableFocus | null;
};

const sqlErdShapeUtils = [
  SqlErdAnnotationShapeUtil,
  SqlErdFrameShapeUtil,
  SqlErdNoteShapeUtil,
  SqlErdStrokeShapeUtil,
  SqlErdTextShapeUtil,
  SqlErdRelationShapeUtil,
  SqlErdTableShapeUtil
];
const SQLTOERD_MINIMUM_READABLE_ZOOM = 0.45;
const SQLTOERD_STROKE_SIZE = 4;
const SQLTOERD_MINIMUM_STROKE_POINT_DISTANCE = 1;

type SqlErdOneShotPlacementTool = Exclude<
  SqlErdCanvasTool,
  "draw" | "eraser" | null
>;

const sqlErdTldrawComponents = {
  Background: null
};

function shapeIdSuffix(value: string) {
  const suffix = value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 92);

  return suffix || "item";
}

export function hashSqlErdShapeSourceId(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function getSqlErdTableShapeId(tableId: string) {
  return createShapeId(
    `sqltoerd-table-${shapeIdSuffix(tableId)}-${hashSqlErdShapeSourceId(tableId)}`
  );
}

export function getSqlErdRelationShapeId(relationId: string) {
  return createShapeId(
    `sqltoerd-relation-${shapeIdSuffix(relationId)}-${hashSqlErdShapeSourceId(relationId)}`
  );
}

export function getSqlErdAnnotationShapeId(annotationId: string) {
  return createShapeId(
    `sqltoerd-annotation-${shapeIdSuffix(annotationId)}-${hashSqlErdShapeSourceId(
      annotationId
    )}`
  );
}

export function getSqlErdNoteShapeId(noteId: string) {
  return createShapeId(`sqltoerd-note-${shapeIdSuffix(noteId)}-${hashSqlErdShapeSourceId(noteId)}`);
}

export function getSqlErdFrameShapeId(frameId: string) {
  return createShapeId(`sqltoerd-frame-${shapeIdSuffix(frameId)}-${hashSqlErdShapeSourceId(frameId)}`);
}

export function getSqlErdTextShapeId(textId: string) {
  return createShapeId(`sqltoerd-text-${shapeIdSuffix(textId)}-${hashSqlErdShapeSourceId(textId)}`);
}

export function createSqltoerdTableShapes(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1
): TLShapePartial<SqlErdTableShape>[] {
  return modelJson.schema.tables.map((table, index) => {
    const tableLayout = getTableLayout(layoutJson, table.id);
    const { w, h, badgeColumnWidth } = getSqlErdTableShapeSize(
      table,
      tableLayout?.width
    );
    const fallbackColumn = index % 3;
    const fallbackRow = Math.floor(index / 3);

    return {
      id: getSqlErdTableShapeId(table.id),
      type: SQLTOERD_TABLE_SHAPE_TYPE,
      x: tableLayout?.x ?? 80 + fallbackColumn * 360,
      y: tableLayout?.y ?? 80 + fallbackRow * 300,
      props: {
        w,
        h,
        tableId: table.id,
        tableName: table.name,
        schemaName: table.schemaName,
        badgeColumnWidth,
        selectedColumnId: null,
        selectedState: "none",
        highlightedColumnIds: [],
        columns: toSqlErdTableShapeColumns(table.columns)
      }
    };
  });
}

export function createSqltoerdRelationShapes(
  modelJson: SqltoerdModelJsonV1,
  tableShapes: TLShapePartial<SqlErdTableShape>[]
): TLShapePartial<SqlErdRelationShape>[] {
  const modelIndex = createSqltoerdModelIndex(modelJson);
  const tableShapeById = new Map(
    tableShapes.map((shape) => [shape.props?.tableId, shape])
  );

  return modelJson.schema.relations.map((relation) => {
    const cardinality = inferSqlErdRelationCardinality(relation, modelIndex);
    const fromTableShape = tableShapeById.get(relation.fromTableId);
    const toTableShape = tableShapeById.get(relation.toTableId);
    const layout =
      getSqlErdRelationShapeLayoutFromTablePartials(
        fromTableShape,
        toTableShape,
        {
          fromColumnIds: relation.fromColumnIds,
          toColumnIds: relation.toColumnIds
        }
      ) ?? getFallbackSqlErdRelationShapeLayout();

    return {
      id: getSqlErdRelationShapeId(relation.id),
      type: SQLTOERD_RELATION_SHAPE_TYPE,
      x: layout.x,
      y: layout.y,
      props: {
        w: layout.w,
        h: layout.h,
        relationId: relation.id,
        fromTableId: relation.fromTableId,
        fromColumnIds: relation.fromColumnIds,
        toTableId: relation.toTableId,
        toColumnIds: relation.toColumnIds,
        constraintName: relation.constraintName,
        fromTableShapeId: getSqlErdTableShapeId(relation.fromTableId),
        toTableShapeId: getSqlErdTableShapeId(relation.toTableId),
        endCardinality: cardinality?.to ?? null,
        endSide: layout.endSide,
        points: layout.points,
        arrowPoints: layout.arrowPoints,
        startCardinality: cardinality?.from ?? null,
        startSide: layout.startSide
      }
    };
  });
}

export function createSqltoerdAnnotationShapes(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1,
  tableShapes: TLShapePartial<SqlErdTableShape>[]
): TLShapePartial<SqlErdAnnotationShape>[] {
  const tableShapeById = new Map(
    tableShapes.map((shape) => [shape.props?.tableId, shape])
  );

  const annotations = getSqltoerdRenderableAnnotations(
    modelJson,
    layoutJson.annotations
  );

  return (annotations?.links ?? []).flatMap((annotation) => {
    const layout =
      getSqlErdRelationShapeLayoutFromTablePartials(
        tableShapeById.get(annotation.fromTableId),
        tableShapeById.get(annotation.toTableId),
        {
          fromColumnIds:
            annotation.kind === "column_link"
              ? [annotation.fromColumnId]
              : [],
          toColumnIds:
            annotation.kind === "column_link" ? [annotation.toColumnId] : []
        }
      ) ?? getFallbackSqlErdRelationShapeLayout();

    return [
      {
        id: getSqlErdAnnotationShapeId(annotation.id),
        type: SQLTOERD_ANNOTATION_SHAPE_TYPE,
        x: layout.x,
        y: layout.y,
        props: {
          w: layout.w,
          h: layout.h,
          annotationId: annotation.id,
          kind: annotation.kind,
          fromTableId: annotation.fromTableId,
          fromColumnId:
            annotation.kind === "column_link"
              ? annotation.fromColumnId
              : null,
          toTableId: annotation.toTableId,
          toColumnId:
            annotation.kind === "column_link" ? annotation.toColumnId : null,
          fromTableShapeId: getSqlErdTableShapeId(annotation.fromTableId),
          toTableShapeId: getSqlErdTableShapeId(annotation.toTableId),
          label: annotation.label,
          selected: false,
          endSide: layout.endSide,
          points: layout.points,
          startSide: layout.startSide
        }
      }
    ];
  });
}

export function createSqltoerdCanvasShapes(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1
) {
  const tableShapes = createSqltoerdTableShapes(modelJson, layoutJson);
  const relationShapes = createSqltoerdRelationShapes(modelJson, tableShapes);
  const annotationShapes = createSqltoerdAnnotationShapes(
    modelJson,
    layoutJson,
    tableShapes
  );
  const noteShapes: TLShapePartial<SqlErdNoteShape>[] = (layoutJson.annotations?.notes ?? []).map((note) => ({
    id: getSqlErdNoteShapeId(note.id), type: SQLTOERD_NOTE_SHAPE_TYPE, x: note.x, y: note.y,
    props: { w: note.width, h: note.height, noteId: note.id, text: note.text }
  }));
  const frameShapes: TLShapePartial<SqlErdFrameShape>[] = (layoutJson.annotations?.frames ?? []).map((frame) => ({
    id: getSqlErdFrameShapeId(frame.id), type: SQLTOERD_FRAME_SHAPE_TYPE, x: frame.x, y: frame.y,
    props: { w: frame.width, h: frame.height, frameId: frame.id, title: frame.title, color: frame.color, isLocked: frame.isLocked }
  }));
  const textShapes: TLShapePartial<SqlErdTextShape>[] = (layoutJson.annotations?.texts ?? []).map((text) => ({
    id: getSqlErdTextShapeId(text.id), type: SQLTOERD_TEXT_SHAPE_TYPE, x: text.x, y: text.y,
    props: { w: text.width, h: text.height, textId: text.id, text: text.text, color: text.color }
  }));
  const strokeShapes: TLShapePartial<SqlErdStrokeShape>[] = (layoutJson.annotations?.strokes ?? [])
    .map(createSqlErdStrokeShape);

  return [
    ...frameShapes,
    ...relationShapes,
    ...tableShapes,
    ...annotationShapes,
    ...noteShapes,
    ...textShapes,
    ...strokeShapes
  ];
}

function getFallbackSqlErdRelationShapeLayout(): SqlErdRelationShapeLayout {
  return {
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    endSide: "left",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ],
    arrowPoints: [],
    startSide: "right"
  };
}

function getSqlErdRelationShapeLayoutFromTablePartials(
  fromTableShape: TLShapePartial<SqlErdTableShape> | undefined,
  toTableShape: TLShapePartial<SqlErdTableShape> | undefined,
  columnIds: {
    fromColumnIds: string[];
    toColumnIds: string[];
  }
) {
  if (!fromTableShape?.props || !toTableShape?.props) {
    return null;
  }

  const fromX = fromTableShape.x ?? 0;
  const fromY = fromTableShape.y ?? 0;
  const fromW = fromTableShape.props.w;
  const fromH = fromTableShape.props.h;
  const fromColumns = fromTableShape.props.columns ?? [];
  const toX = toTableShape.x ?? 0;
  const toY = toTableShape.y ?? 0;
  const toW = toTableShape.props.w;
  const toH = toTableShape.props.h;
  const toColumns = toTableShape.props.columns ?? [];

  if (
    typeof fromW !== "number" ||
    typeof fromH !== "number" ||
    typeof toW !== "number" ||
    typeof toH !== "number" ||
    !Array.isArray(fromColumns) ||
    !Array.isArray(toColumns)
  ) {
    return null;
  }

  return getSqlErdRelationShapeLayout(
    {
      columns: fromColumns.map((column) => ({ id: column.id })),
      x: fromX,
      y: fromY,
      w: fromW,
      h: fromH
    },
    {
      columns: toColumns.map((column) => ({ id: column.id })),
      x: toX,
      y: toY,
      w: toW,
      h: toH
    },
    columnIds
  );
}

function areSqlErdRelationPointsEqual(
  leftPoints: SqlErdRelationShapeLayout["points"],
  rightPoints: SqlErdRelationShapeLayout["points"]
) {
  if (leftPoints.length !== rightPoints.length) {
    return false;
  }

  return leftPoints.every((leftPoint, index) => {
    const rightPoint = rightPoints[index];

    return (
      Math.abs(leftPoint.x - rightPoint.x) < 0.01 &&
      Math.abs(leftPoint.y - rightPoint.y) < 0.01
    );
  });
}

function isSqlErdRelationLayoutEqual(
  shape: SqlErdRelationShape,
  layout: SqlErdRelationShapeLayout
) {
  return (
    Math.abs(shape.x - layout.x) < 0.01 &&
    Math.abs(shape.y - layout.y) < 0.01 &&
    Math.abs(shape.props.w - layout.w) < 0.01 &&
    Math.abs(shape.props.h - layout.h) < 0.01 &&
    shape.props.startSide === layout.startSide &&
    shape.props.endSide === layout.endSide &&
    areSqlErdRelationPointsEqual(shape.props.points, layout.points) &&
    areSqlErdRelationPointsEqual(shape.props.arrowPoints, layout.arrowPoints)
  );
}

function getSqlErdRelationShapeLayoutFromEditor(
  editor: Editor,
  shape: SqlErdRelationShape
) {
  const fromTableShape = editor.getShape(shape.props.fromTableShapeId as TLShapeId);
  const toTableShape = editor.getShape(shape.props.toTableShapeId as TLShapeId);
  const fromTable = getSqlErdTableBoundsFromShape(fromTableShape);
  const toTable = getSqlErdTableBoundsFromShape(toTableShape);

  if (!fromTable || !toTable) {
    return null;
  }

  return getSqlErdRelationShapeLayout(fromTable, toTable, {
    fromColumnIds: shape.props.fromColumnIds,
    toColumnIds: shape.props.toColumnIds
  });
}

function getSqlErdRelationShapeUpdates(
  editor: Editor
): TLShapePartial<SqlErdRelationShape>[] {
  const updates: TLShapePartial<SqlErdRelationShape>[] = [];

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdRelationShape(shape)) {
      continue;
    }

    const layout = getSqlErdRelationShapeLayoutFromEditor(editor, shape);

    if (!layout || isSqlErdRelationLayoutEqual(shape, layout)) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_RELATION_SHAPE_TYPE,
      x: layout.x,
      y: layout.y,
      props: {
        ...shape.props,
        w: layout.w,
        h: layout.h,
        endSide: layout.endSide,
        points: layout.points,
        arrowPoints: layout.arrowPoints,
        startSide: layout.startSide
      }
    });
  }

  return updates;
}

export function syncSqlErdRelationShapes(editor: Editor) {
  const updates = getSqlErdRelationShapeUpdates(editor);

  if (!updates.length) {
    return 0;
  }

  editor.run(
    () => {
      editor.updateShapes(updates);
    },
    { history: "ignore" }
  );

  return updates.length;
}

function getSqlErdAnnotationShapeLayoutFromEditor(
  editor: Editor,
  shape: SqlErdAnnotationShape
) {
  const fromTableShape = editor.getShape(
    shape.props.fromTableShapeId as TLShapeId
  );
  const toTableShape = editor.getShape(shape.props.toTableShapeId as TLShapeId);
  const fromTable = getSqlErdTableBoundsFromShape(fromTableShape);
  const toTable = getSqlErdTableBoundsFromShape(toTableShape);

  if (!fromTable || !toTable) {
    return null;
  }

  return getSqlErdRelationShapeLayout(fromTable, toTable, {
    fromColumnIds:
      shape.props.kind === "column_link" && shape.props.fromColumnId
        ? [shape.props.fromColumnId]
        : [],
    toColumnIds:
      shape.props.kind === "column_link" && shape.props.toColumnId
        ? [shape.props.toColumnId]
        : []
  });
}

function getSqlErdAnnotationShapeUpdates(
  editor: Editor
): TLShapePartial<SqlErdAnnotationShape>[] {
  const updates: TLShapePartial<SqlErdAnnotationShape>[] = [];

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdAnnotationShape(shape)) {
      continue;
    }

    const layout = getSqlErdAnnotationShapeLayoutFromEditor(editor, shape);

    if (!layout || isSqlErdAnnotationLayoutEqual(shape, layout)) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_ANNOTATION_SHAPE_TYPE,
      x: layout.x,
      y: layout.y,
      props: {
        ...shape.props,
        w: layout.w,
        h: layout.h,
        endSide: layout.endSide,
        points: layout.points,
        startSide: layout.startSide
      }
    });
  }

  return updates;
}

function isSqlErdAnnotationLayoutEqual(
  shape: SqlErdAnnotationShape,
  layout: SqlErdRelationShapeLayout
) {
  return (
    Math.abs(shape.x - layout.x) < 0.01 &&
    Math.abs(shape.y - layout.y) < 0.01 &&
    Math.abs(shape.props.w - layout.w) < 0.01 &&
    Math.abs(shape.props.h - layout.h) < 0.01 &&
    shape.props.startSide === layout.startSide &&
    shape.props.endSide === layout.endSide &&
    areSqlErdRelationPointsEqual(shape.props.points, layout.points)
  );
}

export function syncSqlErdAnnotationShapes(editor: Editor) {
  const updates = getSqlErdAnnotationShapeUpdates(editor);

  if (!updates.length) {
    return 0;
  }

  editor.run(
    () => {
      editor.updateShapes(updates);
    },
    { history: "ignore" }
  );

  return updates.length;
}

function getSqlErdSelectionFromEditor(editor: Editor): SqlErdSelection {
  return getSqlErdSelectionFromSelectedShapes(editor.getSelectedShapes());
}

function sendSqlErdCanvasBackgroundShapesToBack(
  editor: Editor,
  shapes: TLShapePartial[]
) {
  const frameShapeIds = shapes
    .filter((shape) => shape.type === SQLTOERD_FRAME_SHAPE_TYPE)
    .map((shape) => shape.id as TLShapeId);
  const noteShapeIds = shapes
    .filter((shape) => shape.type === SQLTOERD_NOTE_SHAPE_TYPE)
    .map((shape) => shape.id as TLShapeId);
  const relationShapeIds = shapes
    .filter((shape) => shape.type === SQLTOERD_RELATION_SHAPE_TYPE)
    .map((shape) => shape.id as TLShapeId);

  if (frameShapeIds.length) {
    editor.sendToBack(frameShapeIds);
  }

  if (noteShapeIds.length) {
    editor.sendToBack(noteShapeIds);
  }

  if (relationShapeIds.length) {
    editor.sendToBack(relationShapeIds);
  }
}

function isSqlErdCanvasShape(shape: TLShape) {
  return (
    isSqlErdTableShape(shape) ||
    isSqlErdRelationShape(shape) ||
    isSqlErdAnnotationShape(shape) ||
    shape.type === SQLTOERD_NOTE_SHAPE_TYPE ||
    shape.type === SQLTOERD_FRAME_SHAPE_TYPE ||
    shape.type === SQLTOERD_TEXT_SHAPE_TYPE ||
    shape.type === SQLTOERD_STROKE_SHAPE_TYPE
  );
}

function resetSqlErdCanvas(
  editor: Editor,
  shapes: TLShapePartial[],
  { zoomToFit = true }: { zoomToFit?: boolean } = {}
) {
  editor.run(
    () => {
      const existingShapeIds = editor
        .getCurrentPageShapes()
        .map((shape) => shape.id as TLShapeId);

      if (existingShapeIds.length) {
        editor.deleteShapes(existingShapeIds);
      }

      if (!shapes.length) {
        editor.selectNone();
        return;
      }

      editor.createShapes(shapes);
      sendSqlErdCanvasBackgroundShapesToBack(editor, shapes);
    },
    { history: "ignore" }
  );

  if (zoomToFit) {
    window.requestAnimationFrame(() => {
      fitSqlErdCanvas(editor, { enforceMinimumReadableZoom: false });
    });
  }
}

function fitSqlErdCanvas(
  editor: Editor,
  {
    enforceMinimumReadableZoom = true
  }: { enforceMinimumReadableZoom?: boolean } = {}
) {
  editor.zoomToFit();

  const pageBounds = editor.getCurrentPageBounds();

  if (
    !enforceMinimumReadableZoom ||
    !pageBounds ||
    editor.getZoomLevel() >= SQLTOERD_MINIMUM_READABLE_ZOOM
  ) {
    return;
  }

  editor.setCamera(
    getSqltoerdMinimumZoomCamera(
      pageBounds,
      editor.getViewportScreenBounds(),
      SQLTOERD_MINIMUM_READABLE_ZOOM
    )
  );
}

function preserveSqlErdTableInteractionState(
  editor: Editor,
  shape: TLShapePartial<SqlErdTableShape>
): TLShapePartial<SqlErdTableShape> {
  const currentShape = editor.getShape(shape.id as TLShapeId);

  if (!isSqlErdTableShape(currentShape) || !shape.props) {
    return shape;
  }

  return {
    ...shape,
    props: {
      ...shape.props,
      selectedColumnId: currentShape.props.selectedColumnId,
      selectedState: currentShape.props.selectedState,
      highlightedColumnIds: currentShape.props.highlightedColumnIds
    }
  };
}

function preserveSqlErdAnnotationInteractionState(
  editor: Editor,
  shape: TLShapePartial<SqlErdAnnotationShape>
): TLShapePartial<SqlErdAnnotationShape> {
  const currentShape = editor.getShape(shape.id as TLShapeId);

  if (!isSqlErdAnnotationShape(currentShape) || !shape.props) {
    return shape;
  }

  return {
    ...shape,
    props: {
      ...shape.props,
      selected: currentShape.props.selected
    }
  };
}

function applySqlErdCanvasShapes(editor: Editor, shapes: TLShapePartial[]) {
  const currentSqlErdShapes = editor
    .getCurrentPageShapes()
    .filter(isSqlErdCanvasShape);
  const syncPlan = createSqlErdCanvasIncrementalShapeSyncPlan(
    currentSqlErdShapes,
    shapes
  );
  const updates = syncPlan.shapesToUpdate
    .filter((shape) => !isSqlErdCanvasShapePartialApplied(editor, shape))
    .map((shape) =>
      shape.type === SQLTOERD_TABLE_SHAPE_TYPE
        ? preserveSqlErdTableInteractionState(
            editor,
            shape as TLShapePartial<SqlErdTableShape>
          )
        : shape.type === SQLTOERD_ANNOTATION_SHAPE_TYPE
          ? preserveSqlErdAnnotationInteractionState(
              editor,
              shape as TLShapePartial<SqlErdAnnotationShape>
            )
        : shape
    );

  editor.store.mergeRemoteChanges(() => {
    applySqlErdCanvasIncrementalShapeSync({
      currentShapes: currentSqlErdShapes,
      editor,
      nextShapes: shapes,
      onAfterSync: () => {
        sendSqlErdCanvasBackgroundShapesToBack(editor, shapes);
      },
      shapesToUpdate: updates
    });
  });
}

function areShapeNumbersEqual(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return Math.abs(left - right) < 0.01;
}

function areSqlErdTableShapeColumnsEqual(
  leftColumns: SqlErdTableShape["props"]["columns"],
  rightColumns: SqlErdTableShape["props"]["columns"]
) {
  if (leftColumns.length !== rightColumns.length) {
    return false;
  }

  return leftColumns.every((leftColumn, index) => {
    const rightColumn = rightColumns[index];

    return (
      leftColumn.id === rightColumn.id &&
      leftColumn.name === rightColumn.name &&
      leftColumn.dataType === rightColumn.dataType &&
      leftColumn.primaryKey === rightColumn.primaryKey &&
      leftColumn.foreignKey === rightColumn.foreignKey &&
      leftColumn.unique === rightColumn.unique &&
      leftColumn.nullable === rightColumn.nullable
    );
  });
}

function areStringArraysEqual(leftValues: string[], rightValues: string[]) {
  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every(
    (leftValue, index) => leftValue === rightValues[index]
  );
}

function isSqlErdTableShapePartialApplied(
  currentShape: TLShape | null | undefined,
  nextShape: TLShapePartial<SqlErdTableShape>
) {
  const nextProps = nextShape.props;

  if (!isSqlErdTableShape(currentShape) || !nextProps?.columns) {
    return false;
  }

  return (
    areShapeNumbersEqual(currentShape.x, nextShape.x) &&
    areShapeNumbersEqual(currentShape.y, nextShape.y) &&
    currentShape.props.tableId === nextProps.tableId &&
    currentShape.props.tableName === nextProps.tableName &&
    currentShape.props.schemaName === nextProps.schemaName &&
    areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
    areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
    areShapeNumbersEqual(
      currentShape.props.badgeColumnWidth,
      nextProps.badgeColumnWidth
    ) &&
    areSqlErdTableShapeColumnsEqual(
      currentShape.props.columns,
      nextProps.columns
    )
  );
}

function isSqlErdRelationShapePartialApplied(
  currentShape: TLShape | null | undefined,
  nextShape: TLShapePartial<SqlErdRelationShape>
) {
  const nextProps = nextShape.props;

  if (
    !isSqlErdRelationShape(currentShape) ||
    !nextProps?.fromColumnIds ||
    !nextProps.toColumnIds ||
    !nextProps.points ||
    !nextProps.arrowPoints
  ) {
    return false;
  }

  return (
    areShapeNumbersEqual(currentShape.x, nextShape.x) &&
    areShapeNumbersEqual(currentShape.y, nextShape.y) &&
    areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
    areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
    currentShape.props.relationId === nextProps.relationId &&
    currentShape.props.fromTableId === nextProps.fromTableId &&
    currentShape.props.toTableId === nextProps.toTableId &&
    currentShape.props.constraintName === nextProps.constraintName &&
    currentShape.props.startCardinality === nextProps.startCardinality &&
    currentShape.props.endCardinality === nextProps.endCardinality &&
    currentShape.props.startSide === nextProps.startSide &&
    currentShape.props.endSide === nextProps.endSide &&
    areStringArraysEqual(
      currentShape.props.fromColumnIds,
      nextProps.fromColumnIds
    ) &&
    areStringArraysEqual(
      currentShape.props.toColumnIds,
      nextProps.toColumnIds
    ) &&
    currentShape.props.fromTableShapeId === nextProps.fromTableShapeId &&
    currentShape.props.toTableShapeId === nextProps.toTableShapeId &&
    areSqlErdRelationPointsEqual(
      currentShape.props.points,
      nextProps.points
    ) &&
    areSqlErdRelationPointsEqual(
      currentShape.props.arrowPoints,
      nextProps.arrowPoints
    )
  );
}

function isSqlErdAnnotationShapePartialApplied(
  currentShape: TLShape | null | undefined,
  nextShape: TLShapePartial<SqlErdAnnotationShape>
) {
  const nextProps = nextShape.props;

  if (
    !isSqlErdAnnotationShape(currentShape) ||
    !nextProps?.points
  ) {
    return false;
  }

  return (
    areShapeNumbersEqual(currentShape.x, nextShape.x) &&
    areShapeNumbersEqual(currentShape.y, nextShape.y) &&
    areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
    areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
    currentShape.props.annotationId === nextProps.annotationId &&
    currentShape.props.fromTableId === nextProps.fromTableId &&
    currentShape.props.fromColumnId === nextProps.fromColumnId &&
    currentShape.props.toTableId === nextProps.toTableId &&
    currentShape.props.toColumnId === nextProps.toColumnId &&
    currentShape.props.fromTableShapeId === nextProps.fromTableShapeId &&
    currentShape.props.toTableShapeId === nextProps.toTableShapeId &&
    currentShape.props.label === nextProps.label &&
    currentShape.props.startSide === nextProps.startSide &&
    currentShape.props.endSide === nextProps.endSide &&
    areSqlErdRelationPointsEqual(currentShape.props.points, nextProps.points)
  );
}

function isSqlErdCanvasShapePartialApplied(
  editor: Editor,
  shape: TLShapePartial
) {
  const currentShape = editor.getShape(shape.id as TLShapeId);

  if (shape.type === SQLTOERD_TABLE_SHAPE_TYPE) {
    return isSqlErdTableShapePartialApplied(
      currentShape,
      shape as TLShapePartial<SqlErdTableShape>
    );
  }

  if (shape.type === SQLTOERD_RELATION_SHAPE_TYPE) {
    return isSqlErdRelationShapePartialApplied(
      currentShape,
      shape as TLShapePartial<SqlErdRelationShape>
    );
  }

  if (shape.type === SQLTOERD_ANNOTATION_SHAPE_TYPE) {
    return isSqlErdAnnotationShapePartialApplied(
      currentShape,
      shape as TLShapePartial<SqlErdAnnotationShape>
    );
  }

  if (shape.type === SQLTOERD_NOTE_SHAPE_TYPE) {
    const nextProps = (shape as TLShapePartial<SqlErdNoteShape>).props;
    return isSqlErdNoteShape(currentShape) && !!nextProps &&
      areShapeNumbersEqual(currentShape.x, shape.x) &&
      areShapeNumbersEqual(currentShape.y, shape.y) &&
      areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
      areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
      currentShape.props.noteId === nextProps.noteId && currentShape.props.text === nextProps.text;
  }

  if (shape.type === SQLTOERD_FRAME_SHAPE_TYPE) {
    const nextProps = (shape as TLShapePartial<SqlErdFrameShape>).props;
    return isSqlErdFrameShape(currentShape) && !!nextProps &&
      areShapeNumbersEqual(currentShape.x, shape.x) &&
      areShapeNumbersEqual(currentShape.y, shape.y) &&
      areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
      areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
      currentShape.props.frameId === nextProps.frameId &&
      currentShape.props.title === nextProps.title &&
      currentShape.props.color === nextProps.color &&
      currentShape.props.isLocked === nextProps.isLocked;
  }

  if (shape.type === SQLTOERD_TEXT_SHAPE_TYPE) {
    const nextProps = (shape as TLShapePartial<SqlErdTextShape>).props;
    return isSqlErdTextShape(currentShape) && !!nextProps &&
      areShapeNumbersEqual(currentShape.x, shape.x) &&
      areShapeNumbersEqual(currentShape.y, shape.y) &&
      areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
      areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
      currentShape.props.textId === nextProps.textId &&
      currentShape.props.text === nextProps.text &&
      currentShape.props.color === nextProps.color;
  }

  if (shape.type === SQLTOERD_STROKE_SHAPE_TYPE) {
    const nextProps = (shape as TLShapePartial<SqlErdStrokeShape>).props;
    return isSqlErdStrokeShape(currentShape) && !!nextProps && !!nextProps.points &&
      areShapeNumbersEqual(currentShape.x, shape.x) &&
      areShapeNumbersEqual(currentShape.y, shape.y) &&
      areShapeNumbersEqual(currentShape.props.w, nextProps.w) &&
      areShapeNumbersEqual(currentShape.props.h, nextProps.h) &&
      currentShape.props.strokeId === nextProps.strokeId &&
      currentShape.props.color === nextProps.color &&
      currentShape.props.size === nextProps.size &&
      areSqlErdRelationPointsEqual(currentShape.props.points, nextProps.points);
  }

  return false;
}

function areSqlErdCanvasShapesApplied(
  editor: Editor,
  shapes: TLShapePartial[]
) {
  const currentSqlErdShapeCount = editor
    .getCurrentPageShapes()
    .filter(isSqlErdCanvasShape).length;

  return (
    currentSqlErdShapeCount === shapes.length &&
    shapes.every((shape) => isSqlErdCanvasShapePartialApplied(editor, shape))
  );
}

function isPointNearSqlErdStroke(
  point: { x: number; y: number },
  shape: SqlErdStrokeShape,
  margin: number
) {
  const threshold = shape.props.size / 2 + margin;
  const thresholdSquared = threshold * threshold;

  return shape.props.points.some((start, index, points) => {
    if (index === 0) {
      return false;
    }

    const end = points[index - 1];
    const startX = shape.x + start.x;
    const startY = shape.y + start.y;
    const endX = shape.x + end.x;
    const endY = shape.y + end.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
    const t = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - startX) * deltaX + (point.y - startY) * deltaY) / segmentLengthSquared));
    const closestX = startX + deltaX * t;
    const closestY = startY + deltaY * t;
    const distanceX = point.x - closestX;
    const distanceY = point.y - closestY;

    return distanceX * distanceX + distanceY * distanceY <= thresholdSquared;
  });
}

function SqlErdCanvasShapeSync({
  canvasContentKey,
  shapes
}: {
  canvasContentKey: string;
  shapes: TLShapePartial[];
}) {
  const editor = useEditor();
  const contentSyncStateRef = useRef(
    createSqlErdCanvasContentSyncState(canvasContentKey)
  );

  useEffect(() => {
    return () => {
      invalidateSqlErdCanvasContentSyncFits(contentSyncStateRef.current);
    };
  }, []);

  useEffect(() => {
    syncSqlErdCanvasContent({
      contentKey: canvasContentKey,
      onFit: () => {
        fitSqlErdCanvas(editor);
      },
      scheduleFit: (callback) => window.requestAnimationFrame(callback),
      state: contentSyncStateRef.current,
      syncShapes: () => {
        if (!areSqlErdCanvasShapesApplied(editor, shapes)) {
          applySqlErdCanvasShapes(editor, shapes);
        }
      }
    });
  }, [canvasContentKey, editor, shapes]);

  return null;
}

function SqlErdRelationLayoutSync() {
  const editor = useEditor();
  const isSyncingRef = useRef(false);

  useEffect(() => {
    function syncRelationShapes() {
      if (isSyncingRef.current) {
        return;
      }

      isSyncingRef.current = true;

      try {
        syncSqlErdRelationShapes(editor);
        syncSqlErdAnnotationShapes(editor);
      } finally {
        isSyncingRef.current = false;
      }
    }

    syncRelationShapes();

    return editor.store.listen(syncRelationShapes, {
      scope: "document",
      source: "all"
    });
  }, [editor]);

  return null;
}

type SqlErdSelectionSyncProps = {
  onSelectionChange: (selection: SqlErdSelection) => void;
  selectedSqlErdObject: SqlErdSelection;
};

function SqlErdSelectionSync({
  onSelectionChange,
  selectedSqlErdObject
}: SqlErdSelectionSyncProps) {
  const editor = useEditor();
  const selectedSqlErdObjectRef = useRef(selectedSqlErdObject);

  useEffect(() => {
    selectedSqlErdObjectRef.current = selectedSqlErdObject;
  }, [selectedSqlErdObject]);

  useEffect(() => {
    function setSelection(nextSelection: SqlErdSelection) {
      if (areSqlErdSelectionsEqual(selectedSqlErdObjectRef.current, nextSelection)) {
        return;
      }

      selectedSqlErdObjectRef.current = nextSelection;
      onSelectionChange(nextSelection);
    }

    function syncSelectionFromEditor() {
      setSelection(getSqlErdSelectionFromEditor(editor));
    }

    function handleColumnSelect(event: Event) {
      const customEvent = event as CustomEvent<{
        columnId?: unknown;
        tableId?: unknown;
      }>;
      const { columnId, tableId } = customEvent.detail ?? {};

      if (typeof columnId !== "string" || typeof tableId !== "string") {
        return;
      }

      setSelection({
        type: "column",
        columnId,
        tableId
      });
    }

    function handleTableSelect(event: Event) {
      const customEvent = event as CustomEvent<{ tableId?: unknown }>;
      const { tableId } = customEvent.detail ?? {};

      if (typeof tableId !== "string") {
        return;
      }

      setSelection({
        type: "table",
        tableId
      });
    }

    syncSelectionFromEditor();

    const removeStoreListener = editor.store.listen(syncSelectionFromEditor, {
      scope: "all",
      source: "all"
    });

    window.addEventListener(SQLTOERD_COLUMN_SELECT_EVENT, handleColumnSelect);
    window.addEventListener(SQLTOERD_TABLE_SELECT_EVENT, handleTableSelect);

    return () => {
      removeStoreListener();
      window.removeEventListener(SQLTOERD_COLUMN_SELECT_EVENT, handleColumnSelect);
      window.removeEventListener(SQLTOERD_TABLE_SELECT_EVENT, handleTableSelect);
    };
  }, [editor, onSelectionChange]);

  return null;
}

function SqlErdSchemaDeleteBridge({
  onDeleteForeignKey,
  onSchemaDelete,
  onSchemaDeleteBatch,
  selectedSqlErdObject
}: {
  onDeleteForeignKey?: (relationId: string) => void;
  onSchemaDelete: (
    selection: Extract<SqlErdSelection, { type: "table" | "column" }>
  ) => void;
  onSchemaDeleteBatch?: (batch: SqlErdDeleteBatch) => void;
  selectedSqlErdObject: SqlErdSelection;
}) {
  const editor = useEditor();
  const onDeleteForeignKeyRef = useRef(onDeleteForeignKey);
  const onSchemaDeleteRef = useRef(onSchemaDelete);
  const onSchemaDeleteBatchRef = useRef(onSchemaDeleteBatch);
  const selectedSqlErdObjectRef = useRef(selectedSqlErdObject);

  useEffect(() => {
    onDeleteForeignKeyRef.current = onDeleteForeignKey;
    onSchemaDeleteRef.current = onSchemaDelete;
    onSchemaDeleteBatchRef.current = onSchemaDeleteBatch;
    selectedSqlErdObjectRef.current = selectedSqlErdObject;
  }, [onDeleteForeignKey, onSchemaDelete, onSchemaDeleteBatch, selectedSqlErdObject]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      );
    }

    function hasMatchingSelectedSchemaShape() {
      const selection = selectedSqlErdObjectRef.current;
      const selectedShape = editor.getOnlySelectedShape();

      if (
        (selection.type === "table" || selection.type === "column") &&
        isSqlErdTableShape(selectedShape) &&
        selectedShape.props.tableId === selection.tableId
      ) {
        return true;
      }

      return (
        selection.type === "relation" &&
        isSqlErdRelationShape(selectedShape) &&
        selectedShape.props.relationId === selection.relationId
      );
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const selection = selectedSqlErdObjectRef.current;
      const selectedShapes = editor.getSelectedShapes();
      const deleteBatch = getSqlErdDeleteBatchFromSelectedShapes(selectedShapes);
      const hasBatchTargets =
        deleteBatch.tableIds.length > 0 ||
        deleteBatch.relationIds.length > 0 ||
        deleteBatch.deleteLinkIds.length > 0 ||
        deleteBatch.deleteNoteIds.length > 0 ||
        deleteBatch.deleteFrameIds.length > 0 ||
        deleteBatch.deleteTextIds.length > 0 ||
        deleteBatch.deleteStrokeIds.length > 0;

      if (
        selectedShapes.length > 1 &&
        hasBatchTargets &&
        onSchemaDeleteBatchRef.current &&
        (event.key === "Delete" || event.key === "Backspace") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onSchemaDeleteBatchRef.current(deleteBatch);
        return;
      }

      if (
        selection.type !== "table" &&
        selection.type !== "column" &&
        selection.type !== "relation"
      ) {
        return;
      }

      if (
        !shouldHandleSqlErdSchemaDeleteShortcut({
          isEditableTarget: isEditableTarget(event.target),
          key: event.key,
          selection
        }) ||
        !hasMatchingSelectedSchemaShape()
      ) {
        return;
      }

      if (selection.type === "relation" && !onDeleteForeignKeyRef.current) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (selection.type === "relation") {
        onDeleteForeignKeyRef.current?.(selection.relationId);
      } else {
        onSchemaDeleteRef.current(selection);
      }
    }

    const removeBeforeDeleteHandler =
      editor.sideEffects.registerBeforeDeleteHandler(
        "shape",
        (shape, source) => {
          if (
            source === "user" &&
            (isSqlErdTableShape(shape) ||
              (isSqlErdRelationShape(shape) &&
                Boolean(onDeleteForeignKeyRef.current))) &&
            hasMatchingSelectedSchemaShape()
          ) {
            return false;
          }
        }
      );

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      removeBeforeDeleteHandler();
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor]);

  return null;
}

function SqlErdTableFocusInteractionGuard({
  focus
}: {
  focus: SqlErdAgentTableFocus | null;
}) {
  const editor = useEditor();
  const focusRef = useRef(focus);
  const filteringSelectionRef = useRef(false);

  useEffect(() => {
    focusRef.current = focus;
    if (!focus || filteringSelectionRef.current) {
      return;
    }
    const selectedShapes = editor.getSelectedShapes();
    const allowedShapeIds = selectedShapes
      .filter(
        (shape) =>
          !isSqlErdShapeDimmedByTableFocus(
            focus,
            shape as unknown as {
              type: string;
              props?: Record<string, unknown>;
            }
          )
      )
      .map((shape) => shape.id);
    if (allowedShapeIds.length !== selectedShapes.length) {
      filteringSelectionRef.current = true;
      editor.setSelectedShapes(allowedShapeIds);
      filteringSelectionRef.current = false;
    }
  }, [editor, focus]);

  useEffect(() => {
    const removeSelectionListener = editor.store.listen(
      () => {
        const currentFocus = focusRef.current;
        if (!currentFocus || filteringSelectionRef.current) {
          return;
        }
        const selectedShapes = editor.getSelectedShapes();
        const allowedShapeIds = selectedShapes
          .filter(
            (shape) =>
              !isSqlErdShapeDimmedByTableFocus(
                currentFocus,
                shape as unknown as {
                  type: string;
                  props?: Record<string, unknown>;
                }
              )
          )
          .map((shape) => shape.id);
        if (allowedShapeIds.length === selectedShapes.length) {
          return;
        }
        filteringSelectionRef.current = true;
        editor.setSelectedShapes(allowedShapeIds);
        filteringSelectionRef.current = false;
      },
      { scope: "all", source: "user" }
    );
    const removeBeforeChangeHandler =
      editor.sideEffects.registerBeforeChangeHandler(
        "shape",
        (previousShape, nextShape, source) => {
          const currentFocus = focusRef.current;
          if (
            source === "user" &&
            currentFocus &&
            editor.getSelectedShapeIds().includes(previousShape.id) &&
            isSqlErdShapeDimmedByTableFocus(
              currentFocus,
              previousShape as unknown as {
                type: string;
                props?: Record<string, unknown>;
              }
            )
          ) {
            return previousShape;
          }
          return nextShape;
        }
      );
    const removeBeforeDeleteHandler =
      editor.sideEffects.registerBeforeDeleteHandler(
        "shape",
        (shape, source) => {
          const currentFocus = focusRef.current;
          if (
            source === "user" &&
            currentFocus &&
            isSqlErdShapeDimmedByTableFocus(
              currentFocus,
              shape as unknown as {
                type: string;
                props?: Record<string, unknown>;
              }
            )
          ) {
            return false;
          }
        }
      );

    return () => {
      removeSelectionListener();
      removeBeforeChangeHandler();
      removeBeforeDeleteHandler();
    };
  }, [editor]);

  return null;
}

function syncSqlErdSelectedColumnShapes(
  editor: Editor,
  selectedSqlErdObject: SqlErdSelection
) {
  const updates: TLShapePartial<SqlErdTableShape>[] = [];
  const selectedShapeIds = new Set(editor.getSelectedShapeIds());

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdTableShape(shape)) {
      continue;
    }

    const isShapeSelected = selectedShapeIds.has(shape.id);
    const { selectedColumnId, selectedState } =
      resolveSqlErdTableInteractionSelection({
        isShapeSelected,
        selection: selectedSqlErdObject,
        tableId: shape.props.tableId
      });

    if (
      shape.props.selectedColumnId === selectedColumnId &&
      shape.props.selectedState === selectedState
    ) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_TABLE_SHAPE_TYPE,
      props: {
        ...shape.props,
        selectedColumnId,
        selectedState
      }
    });
  }

  if (!updates.length) {
    return;
  }

  editor.run(
    () => {
      editor.updateShapes(updates);
    },
    { history: "ignore" }
  );
}

function SqlErdSelectedColumnSync({
  selectedSqlErdObject
}: {
  selectedSqlErdObject: SqlErdSelection;
}) {
  const editor = useEditor();

  useEffect(() => {
    const syncSelection = () => {
      syncSqlErdSelectedColumnShapes(editor, selectedSqlErdObject);
    };
    syncSelection();
    const removeListener = editor.store.listen(syncSelection, {
      scope: "all"
    });

    return removeListener;
  }, [editor, selectedSqlErdObject]);

  return null;
}

function SqlErdRemoteTableMovePreviewSync({
  commits,
  dismissPreviews,
  layoutJson,
  previews
}: {
  commits: SqlErdTableMoveCommit[];
  dismissPreviews: (
    previews: Pick<
      SqlErdTableMovePreview,
      "actorUserId" | "dragId" | "sentAt" | "tableId"
    >[]
  ) => void;
  layoutJson: SqltoerdLayoutJsonV1;
  previews: SqlErdTableMovePreview[];
}) {
  const editor = useEditor();
  const previewStateByTableIdRef = useRef(
    new Map<string, SqlErdRemoteTableMovePreviewState>()
  );

  useEffect(() => {
    const latestPreviewByTableId = new Map<string, SqlErdTableMovePreview>();
    previews.forEach((preview) => {
      const current = latestPreviewByTableId.get(preview.tableId);
      if (
        !current ||
        Date.parse(preview.sentAt) >= Date.parse(current.sentAt)
      ) {
        latestPreviewByTableId.set(preview.tableId, preview);
      }
    });

    const affectedTableIds = new Set([
      ...previewStateByTableIdRef.current.keys(),
      ...latestPreviewByTableId.keys()
    ]);
    const canonicalLayoutByTableId = new Map(
      layoutJson.tableLayouts.map((layout) => [layout.tableId, layout])
    );
    const completedDragKeys = new Set(
      commits.flatMap((commit) =>
        commit.tableIds.map((tableId) =>
          createSqlErdTableMoveCompletionKey(
            commit.actorUserId,
            tableId,
            commit.dragId
          )
        )
      )
    );
    const updates: TLShapePartial<SqlErdTableShape>[] = [];
    const nextPreviewStateByTableId = new Map<
      string,
      SqlErdRemoteTableMovePreviewState
    >();
    const previewsToDismiss: Pick<
      SqlErdTableMovePreview,
      "actorUserId" | "dragId" | "sentAt" | "tableId"
    >[] = [];

    editor.getCurrentPageShapes().forEach((shape) => {
      if (
        !isSqlErdTableShape(shape) ||
        !affectedTableIds.has(shape.props.tableId)
      ) {
        return;
      }

      const resolution = resolveSqlErdRemoteTableMovePreview({
        canonicalPosition:
          canonicalLayoutByTableId.get(shape.props.tableId) ?? null,
        completedDragKeys,
        currentPosition: { x: shape.x, y: shape.y },
        preview: latestPreviewByTableId.get(shape.props.tableId) ?? null,
        previousState:
          previewStateByTableIdRef.current.get(shape.props.tableId) ?? null
      });
      if (resolution.nextState) {
        nextPreviewStateByTableId.set(
          shape.props.tableId,
          resolution.nextState
        );
      }
      if (resolution.dismissPreview) {
        previewsToDismiss.push(resolution.dismissPreview);
      }
      if (
        shape.x === resolution.position.x &&
        shape.y === resolution.position.y
      ) {
        return;
      }

      updates.push({
        id: shape.id,
        type: SQLTOERD_TABLE_SHAPE_TYPE,
        x: resolution.position.x,
        y: resolution.position.y
      });
    });

    if (updates.length) {
      editor.store.mergeRemoteChanges(() => {
        editor.updateShapes(updates);
      });
    }
    previewStateByTableIdRef.current = nextPreviewStateByTableId;
    dismissPreviews(previewsToDismiss);
  }, [commits, dismissPreviews, editor, layoutJson, previews]);

  return null;
}

function SqlErdPinnedTableNavigationSync({
  pinNavigationRequestId,
  pinnedTableId
}: {
  pinNavigationRequestId: number;
  pinnedTableId: string | null;
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!pinnedTableId || pinNavigationRequestId === 0) {
      return;
    }

    const tableCenter = getSqlErdPinnedTableCenter(
      editor.getCurrentPageShapes().filter(isSqlErdTableShape),
      pinnedTableId
    );

    if (!tableCenter) {
      return;
    }

    editor.centerOnPoint(tableCenter, { animation: { duration: 180 } });
  }, [editor, pinNavigationRequestId, pinnedTableId]);

  return null;
}

function syncSqlErdHighlightedColumnShapes(
  editor: Editor,
  detail: SqlErdRelationHighlightDetail | null
) {
  const updates: TLShapePartial<SqlErdTableShape>[] = [];

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdTableShape(shape)) {
      continue;
    }

    const highlightedColumnIds = getSqlErdHighlightedColumnIdsForTable(
      detail,
      shape.props.tableId
    );

    if (
      areStringArraysEqual(
        shape.props.highlightedColumnIds,
        highlightedColumnIds
      )
    ) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_TABLE_SHAPE_TYPE,
      props: {
        ...shape.props,
        highlightedColumnIds
      }
    });
  }

  if (!updates.length) {
    return;
  }

  editor.run(
    () => {
      editor.updateShapes(updates);
    },
    { history: "ignore" }
  );
}

function parseSqlErdRelationHoverEventDetail(
  detail: unknown
): SqlErdRelationHoverEventDetail | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }

  const eventDetail = detail as Partial<SqlErdRelationHoverEventDetail>;

  if (
    typeof eventDetail.isHovered !== "boolean" ||
    typeof eventDetail.relationId !== "string" ||
    typeof eventDetail.fromTableId !== "string" ||
    typeof eventDetail.toTableId !== "string" ||
    !Array.isArray(eventDetail.fromColumnIds) ||
    !Array.isArray(eventDetail.toColumnIds) ||
    !eventDetail.fromColumnIds.every((columnId) => typeof columnId === "string") ||
    !eventDetail.toColumnIds.every((columnId) => typeof columnId === "string")
  ) {
    return null;
  }

  return {
    isHovered: eventDetail.isHovered,
    relationId: eventDetail.relationId,
    fromTableId: eventDetail.fromTableId,
    fromColumnIds: eventDetail.fromColumnIds,
    toTableId: eventDetail.toTableId,
    toColumnIds: eventDetail.toColumnIds
  };
}

function SqlErdRelationHighlightSync({
  modelJson,
  selectedSqlErdObject
}: {
  modelJson: SqltoerdModelJsonV1;
  selectedSqlErdObject: SqlErdSelection;
}) {
  const editor = useEditor();
  const hoveredRelationIdRef = useRef<string | null>(null);
  const modelJsonRef = useRef(modelJson);
  const selectedRelationId =
    selectedSqlErdObject.type === "relation"
      ? selectedSqlErdObject.relationId
      : null;
  const selectedRelationIdRef = useRef<string | null>(selectedRelationId);

  useEffect(() => {
    modelJsonRef.current = modelJson;
    selectedRelationIdRef.current = selectedRelationId;
    syncSqlErdHighlightedColumnShapes(
      editor,
      resolveSqlErdRelationHighlightFromIds(
        modelJson.schema.relations,
        selectedRelationId,
        hoveredRelationIdRef.current
      )
    );
  }, [editor, modelJson, selectedRelationId]);

  useEffect(() => {
    function handleRelationHover(event: Event) {
      const detail = parseSqlErdRelationHoverEventDetail(
        (event as CustomEvent).detail
      );

      if (!detail) {
        return;
      }

      if (detail.isHovered) {
        hoveredRelationIdRef.current = detail.relationId;
        syncSqlErdHighlightedColumnShapes(
          editor,
          resolveSqlErdRelationHighlightFromIds(
            modelJsonRef.current.schema.relations,
            selectedRelationIdRef.current,
            detail.relationId
          )
        );
        return;
      }

      if (hoveredRelationIdRef.current !== detail.relationId) {
        return;
      }

      hoveredRelationIdRef.current = null;
      syncSqlErdHighlightedColumnShapes(
        editor,
        resolveSqlErdRelationHighlightFromIds(
          modelJsonRef.current.schema.relations,
          selectedRelationIdRef.current,
          null
        )
      );
    }

    window.addEventListener(
      SQLTOERD_RELATION_HOVER_EVENT,
      handleRelationHover
    );

    return () => {
      window.removeEventListener(
        SQLTOERD_RELATION_HOVER_EVENT,
        handleRelationHover
      );
      hoveredRelationIdRef.current = null;
      syncSqlErdHighlightedColumnShapes(editor, null);
    };
  }, [editor]);

  return null;
}

type SqlErdColumnConnectorDrag = SqlErdColumnConnectStartEventDetail & {
  kind: "column";
  currentClientX: number;
  currentClientY: number;
};

type SqlErdTableConnectorDrag = SqlErdTableConnectStartEventDetail & {
  kind: "table";
  currentClientX: number;
  currentClientY: number;
};

type SqlErdAnnotationConnectorDrag =
  | SqlErdColumnConnectorDrag
  | SqlErdTableConnectorDrag;

type SqlErdColumnAnnotationInteractionSyncProps = {
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  onLayoutPatch: (patch: SqltoerdLayoutPatch) => void;
};

function getSqlErdAnnotationSelectionUpdates(
  editor: Editor,
  selectedAnnotationId: string | null
) {
  return editor
    .getCurrentPageShapes()
    .filter(isSqlErdAnnotationShape)
    .flatMap((shape): TLShapePartial<SqlErdAnnotationShape>[] => {
      const selected = shape.props.annotationId === selectedAnnotationId;

      if (shape.props.selected === selected) {
        return [];
      }

      return [
        {
          id: shape.id,
          type: SQLTOERD_ANNOTATION_SHAPE_TYPE,
          props: {
            ...shape.props,
            selected
          }
        }
      ];
    });
}

function selectSqlErdAnnotationShape(
  editor: Editor,
  annotationId: string,
  selectionSyncGuard: { current: boolean }
) {
  const shapeId = getSqlErdAnnotationShapeId(annotationId);
  const updates = getSqlErdAnnotationSelectionUpdates(editor, annotationId);

  selectionSyncGuard.current = true;

  try {
    editor.run(
      () => {
        if (editor.getShape(shapeId)) {
          editor.select(shapeId);
        }

        if (updates.length) {
          editor.updateShapes(updates);
        }
      },
      { history: "ignore" }
    );
  } finally {
    selectionSyncGuard.current = false;
  }
}

function syncSqlErdAnnotationSelectionFromEditor(editor: Editor) {
  const selectedShape = editor.getOnlySelectedShape();
  const selectedAnnotationId = isSqlErdAnnotationShape(selectedShape)
    ? selectedShape.props.annotationId
    : null;
  const updates = getSqlErdAnnotationSelectionUpdates(
    editor,
    selectedAnnotationId
  );

  if (!updates.length) {
    return;
  }

  editor.run(() => editor.updateShapes(updates), { history: "ignore" });
}

function parseColumnConnectStartDetail(
  detail: unknown
): SqlErdColumnConnectStartEventDetail | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }

  const value = detail as Partial<SqlErdColumnConnectStartEventDetail>;

  if (
    typeof value.clientX !== "number" ||
    typeof value.clientY !== "number" ||
    typeof value.columnId !== "string" ||
    typeof value.pointerId !== "number" ||
    (value.side !== "left" && value.side !== "right") ||
    typeof value.tableId !== "string"
  ) {
    return null;
  }

  return {
    clientX: value.clientX,
    clientY: value.clientY,
    columnId: value.columnId,
    pointerId: value.pointerId,
    side: value.side,
    tableId: value.tableId
  };
}

function parseTableConnectStartDetail(
  detail: unknown
): SqlErdTableConnectStartEventDetail | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }

  const value = detail as Partial<SqlErdTableConnectStartEventDetail>;

  if (
    typeof value.clientX !== "number" ||
    typeof value.clientY !== "number" ||
    typeof value.pointerId !== "number" ||
    (value.side !== "left" && value.side !== "right") ||
    typeof value.tableId !== "string"
  ) {
    return null;
  }

  return {
    clientX: value.clientX,
    clientY: value.clientY,
    pointerId: value.pointerId,
    side: value.side,
    tableId: value.tableId
  };
}

function getColumnConnectorTargetAtPoint(clientX: number, clientY: number) {
  const target = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(
      "[data-sqltoerd-column-port-hit], [role='button'][data-sqltoerd-column-id][data-sqltoerd-table-id]"
    );
  const tableId = target?.dataset.sqltoerdTableId;
  const columnId = target?.dataset.sqltoerdColumnId;

  return tableId && columnId ? { tableId, columnId } : null;
}

function getTableConnectorTargetAtPoint(clientX: number, clientY: number) {
  const target = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(
      "[data-sqltoerd-table-port-hit], [data-sqltoerd-table-header][data-sqltoerd-table-id]"
    );
  const tableId = target?.dataset.sqltoerdTableId;

  return tableId ? { tableId } : null;
}

function createSqlErdColumnAnnotationId() {
  const uniqueValue =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `annotation.${uniqueValue}`;
}

function getColumnAnnotationBlockMessage(
  reason:
    | "annotation_exists"
    | "annotation_limit"
    | "foreign_key_exists"
    | "invalid_endpoint"
    | "same_endpoint"
) {
  switch (reason) {
    case "annotation_exists":
      return "두 컬럼 사이에 이미 설명 관계가 있습니다.";
    case "annotation_limit":
      return "설명 관계는 최대 300개까지 추가할 수 있습니다.";
    case "foreign_key_exists":
      return "두 컬럼은 이미 SQL FK 관계로 연결되어 있습니다.";
    case "same_endpoint":
      return "같은 컬럼끼리는 설명 관계를 만들 수 없습니다.";
    default:
      return "연결할 컬럼을 찾을 수 없습니다.";
  }
}

function SqlErdAnnotationInteractionSync({
  layoutJson,
  modelJson,
  onLayoutPatch
}: SqlErdColumnAnnotationInteractionSyncProps) {
  const editor = useEditor();
  const [drag, setDrag] = useState<SqlErdAnnotationConnectorDrag | null>(
    null
  );
  const [message, setMessage] = useState<string | null>(null);
  const dragRef = useRef<SqlErdAnnotationConnectorDrag | null>(null);
  const layoutJsonRef = useRef(layoutJson);
  const messageTimeoutRef = useRef<number | null>(null);
  const modelJsonRef = useRef(modelJson);
  const onLayoutPatchRef = useRef(onLayoutPatch);
  const selectionSyncGuardRef = useRef(false);

  useEffect(() => {
    layoutJsonRef.current = layoutJson;
  }, [layoutJson]);

  useEffect(() => {
    modelJsonRef.current = modelJson;
  }, [modelJson]);

  useEffect(() => {
    onLayoutPatchRef.current = onLayoutPatch;
  }, [onLayoutPatch]);

  useEffect(() => {
    function showMessage(nextMessage: string) {
      setMessage(nextMessage);

      if (messageTimeoutRef.current !== null) {
        window.clearTimeout(messageTimeoutRef.current);
      }

      messageTimeoutRef.current = window.setTimeout(() => {
        messageTimeoutRef.current = null;
        setMessage(null);
      }, 2600);
    }

    function publishPatch(patch: SqltoerdLayoutPatch) {
      onLayoutPatchRef.current(patch);
    }

    function startAnnotationDrag(
      detail: SqlErdColumnConnectStartEventDetail | SqlErdTableConnectStartEventDetail,
      kind: SqlErdAnnotationConnectorDrag["kind"]
    ) {
      const nextDrag = {
        ...detail,
        kind,
        currentClientX: detail.clientX,
        currentClientY: detail.clientY
      } as SqlErdAnnotationConnectorDrag;

      dragRef.current = nextDrag;
      setDrag(nextDrag);
      setMessage(null);
    }

    function handleColumnConnectStart(event: Event) {
      const detail = parseColumnConnectStartDetail(
        (event as CustomEvent).detail
      );

      if (!detail) {
        return;
      }

      startAnnotationDrag(detail, "column");
    }

    function handleTableConnectStart(event: Event) {
      const detail = parseTableConnectStartDetail(
        (event as CustomEvent).detail
      );

      if (!detail) {
        return;
      }

      startAnnotationDrag(detail, "table");
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const currentDrag = dragRef.current;

      if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
        return;
      }

      const nextDrag = {
        ...currentDrag,
        currentClientX: event.clientX,
        currentClientY: event.clientY
      };

      dragRef.current = nextDrag;
      setDrag(nextDrag);
    }

    function clearDrag() {
      dragRef.current = null;
      setDrag(null);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const currentDrag = dragRef.current;

      if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
        return;
      }

      clearDrag();

      const annotationId = createSqlErdColumnAnnotationId();
      let annotation: SqltoerdColumnAnnotationLink | SqltoerdTableAnnotationLink;
      let result:
        | ReturnType<typeof addSqltoerdColumnAnnotation>
        | ReturnType<typeof addSqltoerdTableAnnotation>;

      if (currentDrag.kind === "column") {
        const target = getColumnConnectorTargetAtPoint(
          event.clientX,
          event.clientY
        );

        if (!target) {
          return;
        }

        annotation = {
          id: annotationId,
          kind: "column_link",
          fromTableId: currentDrag.tableId,
          fromColumnId: currentDrag.columnId,
          toTableId: target.tableId,
          toColumnId: target.columnId,
          label: ""
        };
        result = addSqltoerdColumnAnnotation(
          modelJsonRef.current,
          layoutJsonRef.current,
          annotation
        );
      } else {
        const target = getTableConnectorTargetAtPoint(
          event.clientX,
          event.clientY
        );

        if (!target) {
          return;
        }

        annotation = {
          id: annotationId,
          kind: "table_link",
          fromTableId: currentDrag.tableId,
          toTableId: target.tableId,
          label: ""
        };
        result = addSqltoerdTableAnnotation(
          modelJsonRef.current,
          layoutJsonRef.current,
          annotation
        );
      }

      if (!result.ok) {
        showMessage(getColumnAnnotationBlockMessage(result.reason));
        return;
      }

      const tableShapes = editor
        .getCurrentPageShapes()
        .filter(isSqlErdTableShape);
      const annotationShape = createSqltoerdAnnotationShapes(
        modelJsonRef.current,
        result.layoutJson,
        tableShapes
      ).find((shape) => shape.props?.annotationId === annotation.id);

      if (annotationShape) {
        editor.run(
          () => {
            editor.createShape(annotationShape);
          },
          { history: "ignore" }
        );
      }

      publishPatch({ linksToAdd: [annotation] });

      window.requestAnimationFrame(() => {
        selectSqlErdAnnotationShape(
          editor,
          annotation.id,
          selectionSyncGuardRef
        );
      });
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      if (dragRef.current?.pointerId === event.pointerId) {
        clearDrag();
      }
    }

    function deleteAnnotation(annotationId: string) {
      const shapeId = getSqlErdAnnotationShapeId(annotationId);

      if (editor.getShape(shapeId)) {
        editor.run(() => editor.deleteShapes([shapeId]), { history: "ignore" });
      }

      publishPatch({ deleteLinkIds: [annotationId] });
    }

    function isEditableKeyboardTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      );
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && dragRef.current) {
        clearDrag();
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !isEditableKeyboardTarget(event.target)
      ) {
        const selectedShape = editor.getOnlySelectedShape();

        if (isSqlErdAnnotationShape(selectedShape)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          deleteAnnotation(selectedShape.props.annotationId);
        }
      }
    }

    function handleLabelChange(event: Event) {
      const detail = (event as CustomEvent<SqlErdAnnotationLabelChangeEventDetail>)
        .detail;

      if (
        !detail ||
        typeof detail.annotationId !== "string" ||
        typeof detail.label !== "string"
      ) {
        return;
      }

      publishPatch({ linksById: { [detail.annotationId]: { label: detail.label } } });
    }

    function handleDelete(event: Event) {
      const detail = (event as CustomEvent<SqlErdAnnotationDeleteEventDetail>)
        .detail;

      if (!detail || typeof detail.annotationId !== "string") {
        return;
      }

      deleteAnnotation(detail.annotationId);
    }

    function handleAnnotationSelect(event: Event) {
      const detail = (event as CustomEvent<SqlErdAnnotationSelectEventDetail>)
        .detail;

      if (!detail || typeof detail.annotationId !== "string") {
        return;
      }

      window.requestAnimationFrame(() => {
        selectSqlErdAnnotationShape(
          editor,
          detail.annotationId,
          selectionSyncGuardRef
        );
      });
    }

    const removeAnnotationSelectionListener = editor.store.listen(
      () => {
        if (!selectionSyncGuardRef.current) {
          syncSqlErdAnnotationSelectionFromEditor(editor);
        }
      },
      {
        scope: "all",
        source: "all"
      }
    );

    window.addEventListener(
      SQLTOERD_COLUMN_CONNECT_START_EVENT,
      handleColumnConnectStart
    );
    window.addEventListener(
      SQLTOERD_TABLE_CONNECT_START_EVENT,
      handleTableConnectStart
    );
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(
      SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT,
      handleLabelChange
    );
    window.addEventListener(SQLTOERD_ANNOTATION_DELETE_EVENT, handleDelete);
    window.addEventListener(SQLTOERD_ANNOTATION_SELECT_EVENT, handleAnnotationSelect);

    return () => {
      removeAnnotationSelectionListener();
      window.removeEventListener(
        SQLTOERD_COLUMN_CONNECT_START_EVENT,
        handleColumnConnectStart
      );
      window.removeEventListener(
        SQLTOERD_TABLE_CONNECT_START_EVENT,
        handleTableConnectStart
      );
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(
        SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT,
        handleLabelChange
      );
      window.removeEventListener(
        SQLTOERD_ANNOTATION_DELETE_EVENT,
        handleDelete
      );
      window.removeEventListener(
        SQLTOERD_ANNOTATION_SELECT_EVENT,
        handleAnnotationSelect
      );

      if (messageTimeoutRef.current !== null) {
        window.clearTimeout(messageTimeoutRef.current);
      }
    };
  }, [editor]);

  const previewPath = drag
    ? `M ${drag.clientX} ${drag.clientY} C ${
        (drag.clientX + drag.currentClientX) / 2
      } ${drag.clientY}, ${(drag.clientX + drag.currentClientX) / 2} ${
        drag.currentClientY
      }, ${drag.currentClientX} ${drag.currentClientY}`
    : null;

  return (
    <>
      {previewPath ? (
        <svg
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[100] h-screen w-screen"
          data-sqltoerd-annotation-preview
        >
          <path
            d={previewPath}
            fill="none"
            stroke="#64748b"
            strokeDasharray="8 6"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      ) : null}
      {message ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-20 z-[101] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-md"
          data-sqltoerd-annotation-message
          role="status"
        >
          {message}
        </div>
      ) : null}
    </>
  );
}

function getSqlErdTableSizesFromEditor(
  editor: Editor
): SqltoerdAutoLayoutTableSize[] {
  return editor
    .getCurrentPageShapes()
    .filter(isSqlErdTableShape)
    .map((shape) => ({
      height: shape.props.h,
      tableId: shape.props.tableId,
      width: shape.props.w
    }));
}

function getSqlErdTablePositionFromEditor(
  editor: Editor,
  tableId: string
) {
  const shape = editor
    .getCurrentPageShapes()
    .find(
      (candidate): candidate is SqlErdTableShape =>
        isSqlErdTableShape(candidate) && candidate.props.tableId === tableId
    );

  return shape
    ? { tableId: shape.props.tableId, x: shape.x, y: shape.y }
    : null;
}

function applySqlErdAutoLayout({
  editor,
  layoutJson,
  modelJson,
  tablePositionChanges
}: {
  editor: Editor;
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  tablePositionChanges: SqlErdTablePositionChangeBuffer;
}) {
  const nextLayoutJson = createSqltoerdAutoLayout({
    layoutJson,
    modelJson,
    tableSizes: getSqlErdTableSizesFromEditor(editor)
  });

  if (areSqltoerdLayoutsEqual(layoutJson, nextLayoutJson)) {
    return null;
  }

  const nextTableLayoutsById = new Map(
    nextLayoutJson.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ])
  );
  const plannedUpdates = editor
    .getCurrentPageShapes()
    .filter(isSqlErdTableShape)
    .flatMap((shape) => {
      const tableLayout = nextTableLayoutsById.get(shape.props.tableId);

      if (
        !tableLayout ||
        (shape.x === tableLayout.x && shape.y === tableLayout.y)
      ) {
        return [];
      }

      return [
        {
          tablePosition: {
            tableId: shape.props.tableId,
            x: tableLayout.x,
            y: tableLayout.y
          },
          update: {
            id: shape.id,
            type: SQLTOERD_TABLE_SHAPE_TYPE,
            x: tableLayout.x,
            y: tableLayout.y
          } satisfies TLShapePartial<SqlErdTableShape>
        }
      ];
    });

  if (!plannedUpdates.length) {
    return null;
  }

  const updates = plannedUpdates.map(({ update }) => update);
  tablePositionChanges.suppressNext(
    plannedUpdates.map(({ tablePosition }) => tablePosition)
  );
  editor.markHistoryStoppingPoint("sqltoerd auto layout");
  editor.run(() => {
    editor.updateShapes(updates);
  });
  editor.markHistoryStoppingPoint("sqltoerd auto layout");

  window.requestAnimationFrame(() => {
    tablePositionChanges.clearSuppressed();
  });

  return nextLayoutJson;
}

type SqlErdCanvasAnnotationSyncProps = {
  layoutJson: SqltoerdLayoutJsonV1;
  onLayoutPatch: (patch: SqltoerdLayoutPatch) => void;
};

function SqlErdCanvasAnnotationSync({
  layoutJson,
  onLayoutPatch
}: SqlErdCanvasAnnotationSyncProps) {
  const editor = useEditor();
  const layoutJsonRef = useRef(layoutJson);
  const onLayoutPatchRef = useRef(onLayoutPatch);

  useEffect(() => { layoutJsonRef.current = layoutJson; }, [layoutJson]);
  useEffect(() => { onLayoutPatchRef.current = onLayoutPatch; }, [onLayoutPatch]);

  useEffect(() => {
    function handleNoteChange(event: Event) {
      const { noteId, text } = (event as CustomEvent<SqlErdNoteChangeEventDetail>).detail;
      onLayoutPatchRef.current({ notesById: { [noteId]: { text } } });
    }
    function handleTextChange(event: Event) {
      const { textId, patch } = (event as CustomEvent<SqlErdTextChangeEventDetail>).detail;
      const textShape = editor.getShape(getSqlErdTextShapeId(textId));

      if (isSqlErdTextShape(textShape)) {
        editor.run(() => {
          editor.updateShapes([
            {
              id: textShape.id,
              type: SQLTOERD_TEXT_SHAPE_TYPE,
              props: { ...textShape.props, ...patch }
            }
          ]);
        }, { history: "ignore" });
      }

      onLayoutPatchRef.current({ textsById: { [textId]: patch } });
    }
    function deleteNote(noteId: string) {
      const shapeId = getSqlErdNoteShapeId(noteId);

      if (editor.getShape(shapeId)) {
        editor.run(() => editor.deleteShapes([shapeId]), { history: "ignore" });
      }

      onLayoutPatchRef.current({ deleteNoteIds: [noteId] });
    }
    function handleFrameChange(event: Event) {
      const { frameId, patch } = (event as CustomEvent<SqlErdFrameChangeEventDetail>).detail;

      const frameShape = editor.getShape(getSqlErdFrameShapeId(frameId));

      if (isSqlErdFrameShape(frameShape)) {
        editor.run(() => {
          editor.updateShapes([
            {
              id: frameShape.id,
              type: SQLTOERD_FRAME_SHAPE_TYPE,
              props: { ...frameShape.props, ...patch }
            }
          ]);
        }, { history: "ignore" });
      }

      onLayoutPatchRef.current({ framesById: { [frameId]: patch } });
    }
    function deleteFrame(frameId: string) {
      const frame = layoutJsonRef.current.annotations?.frames?.find(
        (item) => item.id === frameId
      );

      if (!frame || frame.isLocked) {
        return;
      }

      const shapeId = getSqlErdFrameShapeId(frameId);

      if (editor.getShape(shapeId)) {
        editor.run(() => editor.deleteShapes([shapeId]), { history: "ignore" });
      }

      onLayoutPatchRef.current({ deleteFrameIds: [frameId] });
    }
    function deleteText(textId: string) {
      const shapeId = getSqlErdTextShapeId(textId);

      if (editor.getShape(shapeId)) {
        editor.run(() => editor.deleteShapes([shapeId]), { history: "ignore" });
      }

      onLayoutPatchRef.current({ deleteTextIds: [textId] });
    }
    function handleFrameDelete(event: Event) {
      const { frameId } = (event as CustomEvent<SqlErdFrameDeleteEventDetail>).detail;
      deleteFrame(frameId);
    }
    function isEditableKeyboardTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      );
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const selectedShape = editor.getOnlySelectedShape();

      if (isSqlErdNoteShape(selectedShape)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteNote(selectedShape.props.noteId);
        return;
      }

      if (isSqlErdTextShape(selectedShape)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteText(selectedShape.props.textId);
        return;
      }

      if (!isSqlErdFrameShape(selectedShape)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!selectedShape.props.isLocked) {
        deleteFrame(selectedShape.props.frameId);
      }
    }
    window.addEventListener(SQLTOERD_NOTE_CHANGE_EVENT, handleNoteChange);
    window.addEventListener(SQLTOERD_TEXT_CHANGE_EVENT, handleTextChange);
    window.addEventListener(SQLTOERD_FRAME_CHANGE_EVENT, handleFrameChange);
    window.addEventListener(SQLTOERD_FRAME_DELETE_EVENT, handleFrameDelete);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener(SQLTOERD_NOTE_CHANGE_EVENT, handleNoteChange);
      window.removeEventListener(SQLTOERD_TEXT_CHANGE_EVENT, handleTextChange);
      window.removeEventListener(SQLTOERD_FRAME_CHANGE_EVENT, handleFrameChange);
      window.removeEventListener(SQLTOERD_FRAME_DELETE_EVENT, handleFrameDelete);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    let hasPendingLayoutSync = false;
    function syncTransforms() {
      const notesById: NonNullable<SqltoerdLayoutPatch["notesById"]> = {};
      const framesById: NonNullable<SqltoerdLayoutPatch["framesById"]> = {};
      const textsById: NonNullable<SqltoerdLayoutPatch["textsById"]> = {};
      const notes = new Map((layoutJsonRef.current.annotations?.notes ?? []).map((note) => [note.id, note]));
      const frames = new Map((layoutJsonRef.current.annotations?.frames ?? []).map((frame) => [frame.id, frame]));
      const texts = new Map((layoutJsonRef.current.annotations?.texts ?? []).map((text) => [text.id, text]));
      editor.getCurrentPageShapes().forEach((shape) => {
        if (isSqlErdNoteShape(shape)) {
          const note = notes.get(shape.props.noteId);
          if (note && (note.x !== shape.x || note.y !== shape.y || note.width !== shape.props.w || note.height !== shape.props.h)) {
            notesById[note.id] = { x: shape.x, y: shape.y, width: shape.props.w, height: shape.props.h };
          }
        }
        if (isSqlErdFrameShape(shape)) {
          const frame = frames.get(shape.props.frameId);
          if (frame && (frame.x !== shape.x || frame.y !== shape.y || frame.width !== shape.props.w || frame.height !== shape.props.h)) {
            framesById[frame.id] = { x: shape.x, y: shape.y, width: shape.props.w, height: shape.props.h };
          }
        }
        if (isSqlErdTextShape(shape)) {
          const text = texts.get(shape.props.textId);
          if (text && (text.x !== shape.x || text.y !== shape.y || text.width !== shape.props.w || text.height !== shape.props.h)) {
            textsById[text.id] = { x: shape.x, y: shape.y, width: shape.props.w, height: shape.props.h };
          }
        }
      });
      if (Object.keys(notesById).length || Object.keys(framesById).length || Object.keys(textsById).length) {
        onLayoutPatchRef.current({ notesById, framesById, textsById });
      }
    }
    function flushPendingLayoutSync() {
      if (!hasPendingLayoutSync) return;

      hasPendingLayoutSync = false;
      window.requestAnimationFrame(syncTransforms);
    }
    const removeListener = editor.store.listen(() => {
      hasPendingLayoutSync = true;
    }, { scope: "document", source: "user" });
    window.addEventListener("pointerup", flushPendingLayoutSync);
    return () => {
      window.removeEventListener("pointerup", flushPendingLayoutSync);
      removeListener();
    };
  }, [editor]);

  return null;
}

type SqlErdLayoutSyncProps = {
  cancelPendingTableMovePreviews: (tableIds: string[]) => void;
  clearTableMovePreviews: (tableIds: string[]) => void;
  onLayoutPatch: (
    patch: SqltoerdLayoutPatch,
    context?: SqlErdLayoutPatchContext
  ) => boolean | void;
  sendTableMovePreview?: (preview: {
    dragId: string;
    tableId: string;
    x: number;
    y: number;
  }) => void;
  tablePositionChanges: SqlErdTablePositionChangeBuffer;
};

function SqlErdLayoutSync({
  cancelPendingTableMovePreviews,
  clearTableMovePreviews,
  onLayoutPatch,
  sendTableMovePreview,
  tablePositionChanges
}: SqlErdLayoutSyncProps) {
  const editor = useEditor();
  const onLayoutPatchRef = useRef(onLayoutPatch);
  const activeTableMoveDragIdRef = useRef<string | null>(null);
  const previewedTableIdsRef = useRef(new Set<string>());

  useEffect(() => {
    onLayoutPatchRef.current = onLayoutPatch;
  }, [onLayoutPatch]);

  useEffect(() => {
    function flushPendingLayoutSync() {
      window.requestAnimationFrame(() => {
        const tablePositions = tablePositionChanges.flush((tableId) =>
          getSqlErdTablePositionFromEditor(editor, tableId)
        );

        if (!tablePositions.length) {
          return;
        }

        const tableIds = tablePositions.map(({ tableId }) => tableId);
        const dragId = activeTableMoveDragIdRef.current;
        activeTableMoveDragIdRef.current = null;
        cancelPendingTableMovePreviews(tableIds);
        tableIds.forEach((tableId) => {
          previewedTableIdsRef.current.delete(tableId);
        });
        const scheduled = onLayoutPatchRef.current(
          { tablePositions },
          dragId ? { clientOperationId: dragId } : undefined
        );
        if (shouldClearSqlErdTableMovePreviewAfterDrop(scheduled)) {
          clearTableMovePreviews(tableIds);
        }
      });
    }

    function cancelPendingLayoutSync() {
      window.requestAnimationFrame(() => {
        tablePositionChanges.cancel();
        activeTableMoveDragIdRef.current = null;
        const tableIds = [...previewedTableIdsRef.current];
        previewedTableIdsRef.current.clear();
        clearTableMovePreviews(tableIds);
      });
    }

    function handleTablePositionKeyUp(event: KeyboardEvent) {
      if (shouldFlushSqlErdTablePositionChangesOnKeyUp(event)) {
        flushPendingLayoutSync();
      }
    }

    const removeStoreListener = editor.store.listen((entry) => {
      tablePositionChanges.record(entry).forEach((tableId) => {
        const tablePosition = getSqlErdTablePositionFromEditor(editor, tableId);
        if (!tablePosition) return;

        if (!sendTableMovePreview) return;

        const dragId =
          activeTableMoveDragIdRef.current ?? crypto.randomUUID();
        activeTableMoveDragIdRef.current = dragId;
        previewedTableIdsRef.current.add(tableId);
        sendTableMovePreview({
          dragId,
          tableId,
          x: tablePosition.x,
          y: tablePosition.y
        });
      });
    }, {
      scope: "document",
      source: "user"
    });
    window.addEventListener("pointerup", flushPendingLayoutSync);
    window.addEventListener("pointercancel", cancelPendingLayoutSync);
    window.addEventListener("keyup", handleTablePositionKeyUp);

    return () => {
      window.removeEventListener("pointerup", flushPendingLayoutSync);
      window.removeEventListener("pointercancel", cancelPendingLayoutSync);
      window.removeEventListener("keyup", handleTablePositionKeyUp);
      removeStoreListener();
      clearTableMovePreviews([...previewedTableIdsRef.current]);
      previewedTableIdsRef.current.clear();
      activeTableMoveDragIdRef.current = null;
      tablePositionChanges.cancel();
      tablePositionChanges.clearSuppressed();
    };
  }, [
    cancelPendingTableMovePreviews,
    clearTableMovePreviews,
    editor,
    sendTableMovePreview,
    tablePositionChanges
  ]);

  return null;
}

function SqlErdCanvasReadOnlyBridge({ isReadOnly }: { isReadOnly: boolean }) {
  const editor = useEditor();

  useEffect(() => {
    editor.updateInstanceState({ isReadonly: isReadOnly });
  }, [editor, isReadOnly]);

  return null;
}

export function SqlErdCanvas({
  className,
  committedTableMoves = [],
  enableTableMovePreview = false,
  isReadOnly = false,
  isInspectorOpen = false,
  layoutJson = commerceSqltoerdFixture.layoutJson,
  modelJson = commerceSqltoerdFixture.modelJson,
  onLayoutPatch: onLayoutPatchProp,
  onDeleteForeignKey,
  onSchemaDelete,
  onSchemaDeleteBatch,
  onInspectorOpenChange,
  onSelectionChange,
  pinNavigationRequestId = 0,
  pinnedTableId = null,
  realtimeConfig = null,
  isSqlSourceOpen = false,
  sessionId = null,
  selectedSqlErdObject = { type: "none" },
  tableFocus = null
}: SqlErdCanvasProps) {
  const onLayoutPatch = isReadOnly ? undefined : onLayoutPatchProp;
  const editorRef = useRef<Editor | null>(null);
  const tablePositionChanges = useMemo(
    () =>
      createSqlErdTablePositionChangeBuffer(
        (shape): shape is SqlErdTableShape =>
          isSqlErdTableShape(shape as TLShape | null | undefined)
      ),
    []
  );
  const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null);
  const [tool, setTool] = useState<SqlErdCanvasTool>(null);
  const [nextFrameColor, setNextFrameColor] = useState<SqltoerdCanvasFrameColor>("blue");
  const [nextStrokeColor, setNextStrokeColor] = useState<SqltoerdCanvasFrameColor>("blue");
  const [nextTextColor, setNextTextColor] = useState<SqltoerdCanvasFrameColor>("slate");
  const toolRef = useRef<SqlErdCanvasTool>(null);
  const pendingPlacementToolRef = useRef<SqlErdOneShotPlacementTool | null>(null);
  const pendingNoteFocusIdRef = useRef<string | null>(null);
  const pendingTextFocusIdRef = useRef<string | null>(null);
  const strokePointerIdRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<SqltoerdCanvasStroke | null>(null);
  const eraserPointerIdRef = useRef<number | null>(null);
  const sqlErdPresence = useSqlErdPresence(realtimeConfig);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    if (!tableFocus) {
      return;
    }
    editorRef.current?.selectNone();
    onSelectionChange?.({ type: "none" });
  }, [onSelectionChange, tableFocus]);
  const shapes = useMemo(
    () => createSqltoerdCanvasShapes(modelJson, layoutJson),
    [layoutJson, modelJson]
  );
  const canvasContentKey = useMemo(
    () => createSqlErdCanvasContentKey({ modelJson, sessionId }),
    [modelJson, sessionId]
  );
  const contextRelationIds = useMemo(
    () => getSqlErdContextRelationIds(modelJson, selectedSqlErdObject),
    [modelJson, selectedSqlErdObject]
  );
  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setCanvasEditor(editor);
      editor.setCurrentTool("select.idle");
      resetSqlErdCanvas(editor, shapes);
    },
    [shapes]
  );
  const placeAnnotationAt = useCallback(
    (tool: SqlErdOneShotPlacementTool, point: { x: number; y: number }) => {
      const editor = editorRef.current;

      if (!editor || !onLayoutPatch) {
        return false;
      }

      if (tool === "note") {
        if ((layoutJson.annotations?.notes?.length ?? 0) >= 100) return false;
        const noteId = crypto.randomUUID();
        pendingNoteFocusIdRef.current = noteId;
        onLayoutPatch({
          notesToAdd: [{
            id: noteId,
            x: point.x,
            y: point.y,
            width: 240,
            height: 160,
            text: ""
          }]
        });
      } else if (tool === "frame") {
        if ((layoutJson.annotations?.frames?.length ?? 0) >= 100) return false;
        onLayoutPatch({
          framesToAdd: [{
            id: crypto.randomUUID(),
            x: point.x,
            y: point.y,
            width: 640,
            height: 420,
            title: "프레임",
            color: nextFrameColor,
            isLocked: false
          }]
        });
      } else {
        if ((layoutJson.annotations?.texts?.length ?? 0) >= 100) return false;
        const textId = crypto.randomUUID();
        pendingTextFocusIdRef.current = textId;
        onLayoutPatch({
          textsToAdd: [{
            id: textId,
            x: point.x,
            y: point.y,
            width: 240,
            height: 72,
            text: "",
            color: nextTextColor
          }]
        });
      }

      pendingPlacementToolRef.current = null;
      setTool(null);
      editor.cancel();
      editor.updateInstanceState({ isToolLocked: false });
      editor.setCurrentTool("select.idle");
      return true;
    },
    [
      layoutJson.annotations?.frames?.length,
      layoutJson.annotations?.notes?.length,
      layoutJson.annotations?.texts?.length,
      nextFrameColor,
      nextTextColor,
      onLayoutPatch
    ]
  );
  useEffect(() => {
    const noteId = pendingNoteFocusIdRef.current;

    if (!noteId) return;

    let nextFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>(
          `[data-sqltoerd-note-id="${noteId}"]`
        );

        if (!input) return;

        pendingNoteFocusIdRef.current = null;
        input.focus();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (nextFrameId !== null) window.cancelAnimationFrame(nextFrameId);
    };
  }, [layoutJson.annotations?.notes]);
  useEffect(() => {
    const textId = pendingTextFocusIdRef.current;

    if (!textId) return;

    let nextFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>(
          `[data-sqltoerd-text-id="${textId}"]`
        );

        if (!input) return;

        pendingTextFocusIdRef.current = null;
        input.focus();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (nextFrameId !== null) window.cancelAnimationFrame(nextFrameId);
    };
  }, [layoutJson.annotations?.texts]);
  const handleStartTool = useCallback(
    (nextTool: Exclude<SqlErdCanvasTool, null>) => {
      const editor = editorRef.current;

      if (!editor) return;

      pendingPlacementToolRef.current =
        nextTool === "note" || nextTool === "frame" || nextTool === "text"
          ? nextTool
          : null;
      setTool(nextTool);
      editor.cancel();
      editor.updateInstanceState({ isToolLocked: false });
      editor.setCurrentTool("select.idle");
      editor.selectNone();
    },
    []
  );
  const handleSelectTool = useCallback(() => {
    const editor = editorRef.current;

    pendingPlacementToolRef.current = null;
    strokePointerIdRef.current = null;
    activeStrokeRef.current = null;
    eraserPointerIdRef.current = null;
    setTool(null);

    if (!editor) return;

    editor.cancel();
    editor.updateInstanceState({ isToolLocked: false });
    editor.setCurrentTool("select.idle");
  }, []);
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      return target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
    }

    function cancelActiveToolWithEscape(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.key !== "Escape" ||
        isEditableTarget(event.target) ||
        (!pendingPlacementToolRef.current && toolRef.current === null)
      ) {
        return;
      }

      pendingPlacementToolRef.current = null;
      const activeStroke = activeStrokeRef.current;
      strokePointerIdRef.current = null;
      activeStrokeRef.current = null;
      eraserPointerIdRef.current = null;
      toolRef.current = null;
      setTool(null);
      editorRef.current?.cancel();
      if (activeStroke) {
        editorRef.current?.run(() => {
          editorRef.current?.deleteShapes([getSqlErdStrokeShapeId(activeStroke.id)]);
        }, { history: "ignore" });
      }
      editorRef.current?.updateInstanceState({ isToolLocked: false });
      editorRef.current?.setCurrentTool("select.idle");
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", cancelActiveToolWithEscape, true);
    return () => {
      window.removeEventListener("keydown", cancelActiveToolWithEscape, true);
    };
  }, []);
  const updateStrokeShape = useCallback((editor: Editor, stroke: SqltoerdCanvasStroke) => {
    const shape = createSqlErdStrokeShape(stroke);

    editor.run(() => {
      if (editor.getShape(shape.id as TLShapeId)) {
        editor.updateShapes([shape]);
      } else {
        editor.createShape(shape);
      }
    }, { history: "ignore" });
  }, []);
  const deleteStrokeAt = useCallback(
    (editor: Editor, point: { x: number; y: number }) => {
      const margin = editor.options.hitTestMargin / editor.getZoomLevel();
      const strokeShapes = editor
        .getCurrentPageShapes()
        .filter(isSqlErdStrokeShape)
        .filter((shape) => isPointNearSqlErdStroke(point, shape, margin));

      if (!strokeShapes.length || !onLayoutPatch) {
        return;
      }

      const strokeIds = Array.from(new Set(strokeShapes.map((shape) => shape.props.strokeId)));
      editor.run(() => {
        editor.deleteShapes(strokeShapes.map((shape) => shape.id));
      }, { history: "ignore" });
      onLayoutPatch({ deleteStrokeIds: strokeIds });
    },
    [onLayoutPatch]
  );
  const handlePointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const editor = editorRef.current;

      if (!editor || !event.isPrimary) {
        return;
      }

      sqlErdPresence.updatePresence({
        cursor: editor.screenToPage({ x: event.clientX, y: event.clientY })
      });

      if (strokePointerIdRef.current === event.pointerId && activeStrokeRef.current) {
        const stroke = activeStrokeRef.current;
        const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
        const previousPoint = stroke.points[stroke.points.length - 1];
        const distance = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);

        if (distance >= SQLTOERD_MINIMUM_STROKE_POINT_DISTANCE && stroke.points.length < 500) {
          const nextStroke = { ...stroke, points: [...stroke.points, point] };
          activeStrokeRef.current = nextStroke;
          updateStrokeShape(editor, nextStroke);
        }

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        return;
      }

      if (eraserPointerIdRef.current === event.pointerId) {
        deleteStrokeAt(editor, editor.screenToPage({ x: event.clientX, y: event.clientY }));
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      }
    },
    [deleteStrokeAt, sqlErdPresence, updateStrokeShape]
  );
  const handlePointerLeaveCapture = useCallback(() => {
    sqlErdPresence.updatePresence({ cursor: null });
  }, [sqlErdPresence]);
  const handlePointerUpCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const editor = editorRef.current;

      if (!editor || !event.isPrimary) {
        return;
      }

      if (strokePointerIdRef.current === event.pointerId) {
        const stroke = activeStrokeRef.current;
        strokePointerIdRef.current = null;
        activeStrokeRef.current = null;

        if (stroke && stroke.points.length >= 2 && onLayoutPatch) {
          onLayoutPatch({ strokesToAdd: [stroke] });
        } else if (stroke) {
          editor.run(() => editor.deleteShapes([getSqlErdStrokeShapeId(stroke.id)]), {
            history: "ignore"
          });
        }

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        return;
      }

      if (eraserPointerIdRef.current === event.pointerId) {
        eraserPointerIdRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      }
    },
    [onLayoutPatch]
  );
  const handlePointerCancelCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (strokePointerIdRef.current === event.pointerId) {
        const stroke = activeStrokeRef.current;
        strokePointerIdRef.current = null;
        activeStrokeRef.current = null;

        if (stroke) {
          editorRef.current?.run(() => {
            editorRef.current?.deleteShapes([getSqlErdStrokeShapeId(stroke.id)]);
          }, { history: "ignore" });
        }
      }

      if (eraserPointerIdRef.current === event.pointerId) {
        eraserPointerIdRef.current = null;
      }
    },
    []
  );
  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const eventTarget = event.target as Element;
      const editor = editorRef.current;

      if (isReadOnly || !editor || event.button !== 0 || !event.isPrimary) {
        return;
      }

      const pagePoint = editor.screenToPage({
        x: event.clientX,
        y: event.clientY
      });

      if (tableFocus) {
        const hitShape = editor.getShapeAtPoint(pagePoint, {
          hitInside: true,
          hitLabels: true,
          hitLocked: true
        });
        const isDimmedTable =
          isSqlErdTableShape(hitShape) &&
          getSqlErdFocusedTableRole(tableFocus, hitShape.props.tableId) ===
            "dimmed";
        const isDimmedRelation =
          isSqlErdRelationShape(hitShape) &&
          getSqlErdFocusedRelationRole(
            tableFocus,
            hitShape.props.relationId
          ) === "dimmed";
        if (isDimmedTable || isDimmedRelation) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          return;
        }
      }

      if (eventTarget.closest("[data-sqltoerd-canvas-toolbar]")) {
        return;
      }

      if (eventTarget.closest("input, textarea, select, button")) {
        selectSqlErdCanvasShapeAtPoint(editor, pagePoint, {
          toggle: event.shiftKey
        });
        return;
      }

      const pendingPlacementTool = pendingPlacementToolRef.current;

      if (toolRef.current === "draw") {
        if ((layoutJson.annotations?.strokes?.length ?? 0) >= 100) {
          return;
        }

        const stroke: SqltoerdCanvasStroke = {
          id: crypto.randomUUID(),
          points: [pagePoint],
          color: nextStrokeColor,
          size: SQLTOERD_STROKE_SIZE
        };
        strokePointerIdRef.current = event.pointerId;
        activeStrokeRef.current = stroke;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateStrokeShape(editor, stroke);
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        return;
      }

      if (toolRef.current === "eraser") {
        eraserPointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        deleteStrokeAt(editor, pagePoint);
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        return;
      }

      if (pendingPlacementTool && placeAnnotationAt(pendingPlacementTool, pagePoint)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.detail === 2 && !editor.getShapeAtPoint(pagePoint, {
        hitInside: true,
        hitLabels: true,
        hitLocked: true
      }) && placeAnnotationAt("text", pagePoint)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        toolRef.current === null &&
        isSqlErdCanvasBackgroundPoint(editor, pagePoint)
      ) {
        editor.selectNone();
        onSelectionChange?.({ type: "none" });
      }

      const annotationTarget = eventTarget.closest<HTMLElement>(
        "[data-sqltoerd-annotation-id]"
      );
      const annotationId = annotationTarget?.dataset.sqltoerdAnnotationId;

      if (annotationId) {
        window.dispatchEvent(
          new CustomEvent<SqlErdAnnotationSelectEventDetail>(
            SQLTOERD_ANNOTATION_SELECT_EVENT,
            { detail: { annotationId } }
          )
        );

        if (eventTarget.closest("[data-sqltoerd-annotation-delete]")) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent<SqlErdAnnotationDeleteEventDetail>(
              SQLTOERD_ANNOTATION_DELETE_EVENT,
              { detail: { annotationId } }
            )
          );
          return;
        }
      }

      const port = eventTarget.closest<HTMLElement>(
        "[data-sqltoerd-column-port-hit]"
      );
      const columnId = port?.dataset.sqltoerdColumnId;
      const side = port?.dataset.sqltoerdColumnPort;
      const tableId = port?.dataset.sqltoerdTableId;

      if (
        !port ||
        !columnId ||
        (side !== "left" && side !== "right") ||
        !tableId ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      startSqlErdColumnConnection({
        clientX: event.clientX,
        clientY: event.clientY,
        columnId,
        pointerId: event.pointerId,
        side,
        tableId
      });
    },
    [deleteStrokeAt, isReadOnly, layoutJson.annotations?.strokes?.length, nextStrokeColor, placeAnnotationAt, tableFocus, updateStrokeShape]
  );
  const handleDoubleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const eventTarget = event.target as Element;

      if (eventTarget.closest("[data-sqltoerd-canvas-toolbar], input, textarea, select, button")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    []
  );
  const handleTouchStartCapture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      editorRef.current?.markEventAsHandled(event);
    },
    []
  );
  const handleAutoLayout = useCallback(() => {
    const editor = editorRef.current;

    if (!editor || !onLayoutPatch) {
      return;
    }

    const nextLayoutJson = applySqlErdAutoLayout({
      editor,
      layoutJson,
      modelJson,
      tablePositionChanges
    });

    if (nextLayoutJson) {
      onLayoutPatch({ tablePositions: nextLayoutJson.tableLayouts });
    }
  }, [layoutJson, modelJson, onLayoutPatch, tablePositionChanges]);

  const handleFrameColorChange = useCallback(
    (frameId: string, color: SqltoerdCanvasFrameColor) => {
      window.dispatchEvent(
        new CustomEvent<SqlErdFrameChangeEventDetail>(
          SQLTOERD_FRAME_CHANGE_EVENT,
          { detail: { frameId, patch: { color } } }
        )
      );
    },
    []
  );
  const handleTextColorChange = useCallback(
    (textId: string, color: SqltoerdCanvasFrameColor) => {
      window.dispatchEvent(
        new CustomEvent<SqlErdTextChangeEventDetail>(
          SQLTOERD_TEXT_CHANGE_EVENT,
          { detail: { textId, patch: { color } } }
        )
      );
    },
    []
  );

  const handleFitCanvas = useCallback(() => {
    const editor = editorRef.current;

    if (editor) {
      fitSqlErdCanvas(editor);
    }
  }, []);

  return (
    <div
      className="relative h-full w-full"
      onDoubleClickCapture={handleDoubleClickCapture}
      onPointerCancelCapture={handlePointerCancelCapture}
      onPointerLeave={handlePointerLeaveCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onTouchStartCapture={handleTouchStartCapture}
    >
      <SqlErdSelectionContextProvider relationIds={contextRelationIds}>
        <SqlErdTableFocusProvider focus={tableFocus}>
          <TldrawSurface
          className={cn(
            "h-full w-full bg-slate-50 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:24px_24px]",
            className
          )}
          components={sqlErdTldrawComponents}
          hideUi
          onMount={handleMount}
          onPointerDownCapture={handlePointerDownCapture}
          shapeUtils={sqlErdShapeUtils}
        >
        {sessionId && onInspectorOpenChange && onSelectionChange ? (
          <SqlErdWorkspaceLocationAdapter
            isInspectorOpen={isInspectorOpen}
            onInspectorOpenChange={onInspectorOpenChange}
            onSelectionChange={onSelectionChange}
            selectedSqlErdObject={selectedSqlErdObject}
            sessionId={sessionId}
          />
        ) : null}
        <SqlErdCanvasReadOnlyBridge isReadOnly={isReadOnly} />
        <SqlErdCanvasShapeSync
          canvasContentKey={canvasContentKey}
          shapes={shapes}
        />
        <SqlErdRemoteTableMovePreviewSync
          commits={committedTableMoves}
          dismissPreviews={sqlErdPresence.dismissRemoteTableMovePreviews}
          layoutJson={layoutJson}
          previews={sqlErdPresence.remoteTableMovePreviews}
        />
        <SqlErdTableFocusInteractionGuard focus={tableFocus} />
        <SqlErdRelationLayoutSync />
        <SqlErdRelationHighlightSync
          modelJson={modelJson}
          selectedSqlErdObject={selectedSqlErdObject}
        />
        <SqlErdPinnedTableNavigationSync
          pinNavigationRequestId={pinNavigationRequestId}
          pinnedTableId={pinnedTableId}
        />
        <SqlErdSelectedColumnSync selectedSqlErdObject={selectedSqlErdObject} />
        {onSchemaDelete ? (
          <SqlErdSchemaDeleteBridge
            onDeleteForeignKey={onDeleteForeignKey}
            onSchemaDelete={onSchemaDelete}
            onSchemaDeleteBatch={onSchemaDeleteBatch}
            selectedSqlErdObject={selectedSqlErdObject}
          />
        ) : null}
        {sqlErdPresence.enabled ? (
          <SqlErdRealtimeBridge
            currentUserId={sqlErdPresence.currentUserId}
            isSqlSourceOpen={isSqlSourceOpen}
            remotePresence={sqlErdPresence.remotePresence}
            tool={tool}
            updatePresence={sqlErdPresence.updatePresence}
          />
        ) : null}
        {onLayoutPatch ? (
          <>
            <SqlErdAnnotationInteractionSync
              layoutJson={layoutJson}
              modelJson={modelJson}
              onLayoutPatch={onLayoutPatch}
            />
            <SqlErdLayoutSync
              cancelPendingTableMovePreviews={
                sqlErdPresence.cancelPendingTableMovePreviews
              }
              clearTableMovePreviews={sqlErdPresence.clearTableMovePreviews}
              onLayoutPatch={onLayoutPatch}
              sendTableMovePreview={
                enableTableMovePreview
                  ? sqlErdPresence.sendTableMovePreview
                  : undefined
              }
              tablePositionChanges={tablePositionChanges}
            />
            <SqlErdCanvasAnnotationSync
              layoutJson={layoutJson}
              onLayoutPatch={onLayoutPatch}
            />
          </>
        ) : null}
        {onSelectionChange ? (
          <SqlErdSelectionSync
            onSelectionChange={onSelectionChange}
            selectedSqlErdObject={selectedSqlErdObject}
          />
        ) : null}
          </TldrawSurface>
        </SqlErdTableFocusProvider>
      </SqlErdSelectionContextProvider>
      {onLayoutPatch && canvasEditor ? (
        <SqlErdCanvasToolbar
          editor={canvasEditor}
          isFrameLimitReached={(layoutJson.annotations?.frames?.length ?? 0) >= 100}
          isNoteLimitReached={(layoutJson.annotations?.notes?.length ?? 0) >= 100}
          isStrokeLimitReached={(layoutJson.annotations?.strokes?.length ?? 0) >= 100}
          isTextLimitReached={(layoutJson.annotations?.texts?.length ?? 0) >= 100}
          nextFrameColor={nextFrameColor}
          nextStrokeColor={nextStrokeColor}
          nextTextColor={nextTextColor}
          onFit={handleFitCanvas}
          onFrameColorChange={handleFrameColorChange}
          onNextFrameColorChange={setNextFrameColor}
          onNextStrokeColorChange={setNextStrokeColor}
          onNextTextColorChange={setNextTextColor}
          onSelectTool={handleSelectTool}
          onStartTool={handleStartTool}
          onTextColorChange={handleTextColorChange}
          tool={tool}
        />
      ) : null}
      {onLayoutPatch && !tableFocus ? (
        <button
          aria-label="자동 정렬"
          className="absolute left-4 top-4 z-20 inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          data-sqltoerd-auto-layout
          onClick={handleAutoLayout}
          title="FK 관계를 기준으로 테이블 자동 정렬"
          type="button"
        >
          <Workflow aria-hidden="true" className="size-4" />
          자동 정렬
        </button>
      ) : null}
    </div>
  );
}
