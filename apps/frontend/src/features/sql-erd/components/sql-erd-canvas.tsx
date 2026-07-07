"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShapeId,
  type Editor,
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
import { getTableLayout } from "@/features/sql-erd/utils/model";
import { cn } from "@/lib/utils";
import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";

type SqlErdCanvasProps = {
  className?: string;
  layoutJson?: SqltoerdLayoutJsonV1;
  modelJson?: SqltoerdModelJsonV1;
  onSelectionChange?: (selection: SqlErdSelection) => void;
  selectedSqlErdObject?: SqlErdSelection;
};

const sqlErdShapeUtils = [SqlErdRelationShapeUtil, SqlErdTableShapeUtil];

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
        toTableShape
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
        points: layout.points,
        arrowPoints: layout.arrowPoints
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
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ],
    arrowPoints: []
  };
}

function getSqlErdRelationShapeLayoutFromTablePartials(
  fromTableShape: TLShapePartial<SqlErdTableShape> | undefined,
  toTableShape: TLShapePartial<SqlErdTableShape> | undefined
) {
  if (!fromTableShape?.props || !toTableShape?.props) {
    return null;
  }

  const fromX = fromTableShape.x ?? 0;
  const fromY = fromTableShape.y ?? 0;
  const fromW = fromTableShape.props.w;
  const fromH = fromTableShape.props.h;
  const toX = toTableShape.x ?? 0;
  const toY = toTableShape.y ?? 0;
  const toW = toTableShape.props.w;
  const toH = toTableShape.props.h;

  if (
    typeof fromW !== "number" ||
    typeof fromH !== "number" ||
    typeof toW !== "number" ||
    typeof toH !== "number"
  ) {
    return null;
  }

  return getSqlErdRelationShapeLayout(
    {
      x: fromX,
      y: fromY,
      w: fromW,
      h: fromH
    },
    {
      x: toX,
      y: toY,
      w: toW,
      h: toH
    }
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

  return getSqlErdRelationShapeLayout(fromTable, toTable);
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
        points: layout.points,
        arrowPoints: layout.arrowPoints
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

function SqlErdCanvasShapeSync({ shapes }: { shapes: TLShapePartial[] }) {
  const editor = useEditor();

  useEffect(() => {
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

function SqlErdCanvasBackground() {
  return (
    <div className="absolute inset-0 bg-slate-50 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:24px_24px]" />
  );
}

export function SqlErdCanvas({
  className,
  layoutJson = commerceSqltoerdFixture.layoutJson,
  modelJson = commerceSqltoerdFixture.modelJson,
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
      {onSelectionChange ? (
        <SqlErdSelectionSync
          onSelectionChange={onSelectionChange}
          selectedSqlErdObject={selectedSqlErdObject}
        />
      ) : null}
    </TldrawSurface>
  );
}
