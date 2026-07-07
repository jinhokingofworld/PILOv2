"use client";

import { useCallback, useMemo } from "react";
import {
  createShapeId,
  type Editor,
  type TLShapeId,
  type TLShapePartial
} from "tldraw";

import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import {
  getSqlErdTableShapeSize,
  SQLTOERD_TABLE_SHAPE_TYPE,
  SqlErdTableShapeUtil,
  toSqlErdTableShapeColumns,
  type SqlErdTableShape
} from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type {
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";
import { getTableLayout } from "@/features/sql-erd/utils/model";
import { cn } from "@/lib/utils";
import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";

type SqlErdCanvasProps = {
  className?: string;
};

const sqlErdShapeUtils = [SqlErdTableShapeUtil];

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
        columns: toSqlErdTableShapeColumns(table.columns)
      }
    };
  });
}

function resetSqlErdCanvas(
  editor: Editor,
  shapes: TLShapePartial<SqlErdTableShape>[]
) {
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
  window.requestAnimationFrame(() => {
    editor.zoomToFit({ animation: { duration: 160 } });
  });
}

function SqlErdCanvasBackground() {
  return (
    <div className="absolute inset-0 bg-slate-50 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:24px_24px]" />
  );
}

export function SqlErdCanvas({ className }: SqlErdCanvasProps) {
  const shapes = useMemo(
    () =>
      createSqltoerdTableShapes(
        commerceSqltoerdFixture.modelJson,
        commerceSqltoerdFixture.layoutJson
      ),
    []
  );
  const handleMount = useCallback(
    (editor: Editor) => {
      editor.setCurrentTool("select.idle");
      resetSqlErdCanvas(editor, shapes);
    },
    [shapes]
  );

  return (
    <TldrawSurface
      className={cn("h-full w-full", className)}
      components={sqlErdTldrawComponents}
      hideUi
      onMount={handleMount}
      shapeUtils={sqlErdShapeUtils}
    />
  );
}
