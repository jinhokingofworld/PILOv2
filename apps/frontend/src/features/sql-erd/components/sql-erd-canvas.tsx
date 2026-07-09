"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShapeId,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  useEditor
} from "tldraw";

import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import {
  getSqlErdRelationShapeLayout,
  getSqlErdTableBoundsFromShape,
  isSqlErdRelationShape,
  SQLTOERD_RELATION_SHAPE_TYPE,
  SqlErdRelationShapeUtil,
  type SqlErdRelationShape,
  type SqlErdRelationShapeLayout
} from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import {
  getSqlErdTableShapeSize,
  SQLTOERD_COLUMN_SELECT_EVENT,
  SQLTOERD_TABLE_SELECT_EVENT,
  SQLTOERD_TABLE_SHAPE_TYPE,
  SqlErdTableShapeUtil,
  toSqlErdTableShapeColumns,
  isSqlErdTableShape,
  type SqlErdTableShape
} from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type {
  SqlErdSelection,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";
import {
  areSqltoerdLayoutsEqual,
  getTableLayout,
  updateSqltoerdLayoutWithTablePositions,
  type SqltoerdTablePosition
} from "@/features/sql-erd/utils/model";
import { cn } from "@/lib/utils";
import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";

type SqlErdCanvasProps = {
  className?: string;
  layoutJson?: SqltoerdLayoutJsonV1;
  modelJson?: SqltoerdModelJsonV1;
  onLayoutChange?: (layoutJson: SqltoerdLayoutJsonV1) => void;
  onSelectionChange?: (selection: SqlErdSelection) => void;
  selectedSqlErdObject?: SqlErdSelection;
};

const sqlErdShapeUtils = [SqlErdRelationShapeUtil, SqlErdTableShapeUtil];
const SQLTOERD_LAYOUT_SYNC_DELAY_MS = 250;

const sqlErdTldrawComponents = {
  Background: SqlErdCanvasBackground
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
        columns: toSqlErdTableShapeColumns(table.columns)
      }
    };
  });
}

export function createSqltoerdRelationShapes(
  modelJson: SqltoerdModelJsonV1,
  tableShapes: TLShapePartial<SqlErdTableShape>[]
): TLShapePartial<SqlErdRelationShape>[] {
  const tableShapeById = new Map(
    tableShapes.map((shape) => [shape.props?.tableId, shape])
  );

  return modelJson.schema.relations.map((relation) => {
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
        endSide: layout.endSide,
        points: layout.points,
        arrowPoints: layout.arrowPoints,
        startSide: layout.startSide
      }
    };
  });
}

export function createSqltoerdCanvasShapes(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1
) {
  const tableShapes = createSqltoerdTableShapes(modelJson, layoutJson);
  const relationShapes = createSqltoerdRelationShapes(modelJson, tableShapes);

  return [
    ...relationShapes,
    ...tableShapes
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

function areSqlErdSelectionsEqual(
  left: SqlErdSelection,
  right: SqlErdSelection
) {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "table" && right.type === "table") {
    return left.tableId === right.tableId;
  }

  if (left.type === "column" && right.type === "column") {
    return left.tableId === right.tableId && left.columnId === right.columnId;
  }

  if (left.type === "relation" && right.type === "relation") {
    return left.relationId === right.relationId;
  }

  return true;
}

function getSqlErdSelectionFromEditor(
  editor: Editor,
  currentSelection: SqlErdSelection
): SqlErdSelection {
  const selectedShapes = editor.getSelectedShapes();

  if (selectedShapes.length !== 1) {
    return { type: "none" };
  }

  const [selectedShape] = selectedShapes;

  if (isSqlErdRelationShape(selectedShape)) {
    return {
      type: "relation",
      relationId: selectedShape.props.relationId
    };
  }

  if (isSqlErdTableShape(selectedShape)) {
    if (
      currentSelection.type === "column" &&
      currentSelection.tableId === selectedShape.props.tableId
    ) {
      return currentSelection;
    }

    return {
      type: "table",
      tableId: selectedShape.props.tableId
    };
  }

  return { type: "none" };
}

function resetSqlErdCanvas(
  editor: Editor,
  shapes: TLShapePartial[]
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
      editor.sendToBack(
        shapes
          .filter((shape) => shape.type === SQLTOERD_RELATION_SHAPE_TYPE)
          .map((shape) => shape.id as TLShapeId)
      );
    },
    { history: "ignore" }
  );
  window.requestAnimationFrame(() => {
    editor.zoomToFit({ animation: { duration: 160 } });
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

  return false;
}

function areSqlErdCanvasShapesApplied(
  editor: Editor,
  shapes: TLShapePartial[]
) {
  const currentSqlErdShapeCount = editor
    .getCurrentPageShapes()
    .filter(
      (shape) => isSqlErdTableShape(shape) || isSqlErdRelationShape(shape)
    ).length;

  return (
    currentSqlErdShapeCount === shapes.length &&
    shapes.every((shape) => isSqlErdCanvasShapePartialApplied(editor, shape))
  );
}

function SqlErdCanvasShapeSync({ shapes }: { shapes: TLShapePartial[] }) {
  const editor = useEditor();

  useEffect(() => {
    if (areSqlErdCanvasShapesApplied(editor, shapes)) {
      return;
    }

    resetSqlErdCanvas(editor, shapes);
  }, [editor, shapes]);

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
      setSelection(
        getSqlErdSelectionFromEditor(editor, selectedSqlErdObjectRef.current)
      );
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

function getSelectedColumnIdForTable(
  selection: SqlErdSelection,
  tableId: string
) {
  return selection.type === "column" && selection.tableId === tableId
    ? selection.columnId
    : null;
}

function syncSqlErdSelectedColumnShapes(
  editor: Editor,
  selectedSqlErdObject: SqlErdSelection
) {
  const updates: TLShapePartial<SqlErdTableShape>[] = [];

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdTableShape(shape)) {
      continue;
    }

    const selectedColumnId = getSelectedColumnIdForTable(
      selectedSqlErdObject,
      shape.props.tableId
    );

    if (shape.props.selectedColumnId === selectedColumnId) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_TABLE_SHAPE_TYPE,
      props: {
        ...shape.props,
        selectedColumnId
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
    syncSqlErdSelectedColumnShapes(editor, selectedSqlErdObject);
  }, [editor, selectedSqlErdObject]);

  return null;
}

function getSqlErdTablePositionsFromEditor(
  editor: Editor
): SqltoerdTablePosition[] {
  return editor
    .getCurrentPageShapes()
    .filter(isSqlErdTableShape)
    .map((shape) => ({
      tableId: shape.props.tableId,
      x: shape.x,
      y: shape.y
    }));
}

type SqlErdLayoutSyncProps = {
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  onLayoutChange: (layoutJson: SqltoerdLayoutJsonV1) => void;
};

function SqlErdLayoutSync({
  layoutJson,
  modelJson,
  onLayoutChange
}: SqlErdLayoutSyncProps) {
  const editor = useEditor();
  const layoutJsonRef = useRef(layoutJson);
  const modelJsonRef = useRef(modelJson);
  const onLayoutChangeRef = useRef(onLayoutChange);

  useEffect(() => {
    layoutJsonRef.current = layoutJson;
  }, [layoutJson]);

  useEffect(() => {
    modelJsonRef.current = modelJson;
  }, [modelJson]);

  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  useEffect(() => {
    let timeoutId: number | null = null;

    function clearPendingLayoutSync() {
      if (timeoutId === null) {
        return;
      }

      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    function syncLayoutFromEditor() {
      timeoutId = null;

      const nextLayoutJson = updateSqltoerdLayoutWithTablePositions(
        modelJsonRef.current,
        layoutJsonRef.current,
        getSqlErdTablePositionsFromEditor(editor)
      );

      if (areSqltoerdLayoutsEqual(layoutJsonRef.current, nextLayoutJson)) {
        return;
      }

      layoutJsonRef.current = nextLayoutJson;
      onLayoutChangeRef.current(nextLayoutJson);
    }

    function scheduleLayoutSync() {
      clearPendingLayoutSync();
      timeoutId = window.setTimeout(
        syncLayoutFromEditor,
        SQLTOERD_LAYOUT_SYNC_DELAY_MS
      );
    }

    const removeStoreListener = editor.store.listen(scheduleLayoutSync, {
      scope: "document",
      source: "user"
    });

    return () => {
      clearPendingLayoutSync();
      removeStoreListener();
    };
  }, [editor]);

  return null;
}

function SqlErdCanvasBackground() {
  return (
    <div className="absolute inset-0 bg-slate-50 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:24px_24px]" />
  );
}

export function SqlErdCanvas({
  className,
  layoutJson = commerceSqltoerdFixture.layoutJson,
  modelJson = commerceSqltoerdFixture.modelJson,
  onLayoutChange,
  onSelectionChange,
  selectedSqlErdObject = { type: "none" }
}: SqlErdCanvasProps) {
  const shapes = useMemo(
    () => createSqltoerdCanvasShapes(modelJson, layoutJson),
    [layoutJson, modelJson]
  );
  const handleMount = useCallback(
    (editor: Editor) => {
      editor.setCurrentTool("select.idle");
    },
    []
  );

  return (
    <TldrawSurface
      className={cn("h-full w-full", className)}
      components={sqlErdTldrawComponents}
      hideUi
      onMount={handleMount}
      shapeUtils={sqlErdShapeUtils}
    >
      <SqlErdCanvasShapeSync shapes={shapes} />
      <SqlErdRelationLayoutSync />
      <SqlErdSelectedColumnSync selectedSqlErdObject={selectedSqlErdObject} />
      {onLayoutChange ? (
        <SqlErdLayoutSync
          layoutJson={layoutJson}
          modelJson={modelJson}
          onLayoutChange={onLayoutChange}
        />
      ) : null}
      {onSelectionChange ? (
        <SqlErdSelectionSync
          onSelectionChange={onSelectionChange}
          selectedSqlErdObject={selectedSqlErdObject}
        />
      ) : null}
    </TldrawSurface>
  );
}
