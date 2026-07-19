import type { Editor, TLShape } from "tldraw";

import { isSqlErdAnnotationShape } from "@/features/sql-erd/shapes/sql-erd-annotation-shape";
import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import { isSqlErdNoteShape } from "@/features/sql-erd/shapes/sql-erd-note-shape";
import { isSqlErdTextShape } from "@/features/sql-erd/shapes/sql-erd-text-shape";
import { isSqlErdStrokeShape } from "@/features/sql-erd/shapes/sql-erd-stroke-shape";
import { isSqlErdRelationShape } from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import { isSqlErdTableShape } from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type {
  SqlErdSelection,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

export function shouldHandleSqlErdSchemaDeleteShortcut({
  isEditableTarget,
  key,
  selection
}: {
  isEditableTarget: boolean;
  key: string;
  selection: SqlErdSelection;
}) {
  return (
    !isEditableTarget &&
    (key === "Delete" || key === "Backspace") &&
    (selection.type === "table" ||
      selection.type === "column" ||
      selection.type === "relation")
  );
}

export function getSqlErdContextRelationIds(
  modelJson: SqltoerdModelJsonV1,
  selection: SqlErdSelection
) {
  if (selection.type !== "table") {
    return new Set<string>();
  }

  return new Set(
    modelJson.schema.relations
      .filter(
        (relation) =>
          relation.fromTableId === selection.tableId ||
          relation.toTableId === selection.tableId
      )
      .map((relation) => relation.id)
  );
}

export function areSqlErdSelectionsEqual(
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

  if (left.type === "annotation" && right.type === "annotation") {
    return left.annotationId === right.annotationId;
  }

  if (left.type === "note" && right.type === "note") return left.noteId === right.noteId;
  if (left.type === "frame" && right.type === "frame") return left.frameId === right.frameId;
  if (left.type === "text" && right.type === "text") return left.textId === right.textId;

  return true;
}

export function resolveSqlErdTableInteractionSelection({
  isShapeSelected,
  selection,
  tableId
}: {
  isShapeSelected: boolean;
  selection: SqlErdSelection;
  tableId: string;
}) {
  if (!isShapeSelected) {
    return {
      selectedColumnId: null,
      selectedState: "none" as const
    };
  }

  if (selection.type === "column" && selection.tableId === tableId) {
    return {
      selectedColumnId: selection.columnId,
      selectedState: "column" as const
    };
  }

  return {
    selectedColumnId: null,
    selectedState: "table" as const
  };
}

export function getSqlErdSelectionFromSelectedShapes(
  selectedShapes: TLShape[]
): SqlErdSelection {
  if (selectedShapes.length !== 1) {
    return { type: "none" };
  }

  const [selectedShape] = selectedShapes;

  if (isSqlErdAnnotationShape(selectedShape)) {
    return {
      type: "annotation",
      annotationId: selectedShape.props.annotationId
    };
  }

  if (isSqlErdNoteShape(selectedShape)) return { type: "note", noteId: selectedShape.props.noteId };
  if (isSqlErdFrameShape(selectedShape)) return { type: "frame", frameId: selectedShape.props.frameId };
  if (isSqlErdTextShape(selectedShape)) return { type: "text", textId: selectedShape.props.textId };

  if (isSqlErdRelationShape(selectedShape)) {
    return {
      type: "relation",
      relationId: selectedShape.props.relationId
    };
  }

  if (isSqlErdTableShape(selectedShape)) {
    if (
      selectedShape.props.selectedState === "column" &&
      selectedShape.props.selectedColumnId
    ) {
      return {
        type: "column",
        tableId: selectedShape.props.tableId,
        columnId: selectedShape.props.selectedColumnId
      };
    }

    return {
      type: "table",
      tableId: selectedShape.props.tableId
    };
  }

  return { type: "none" };
}

export type SqlErdDeleteBatch = {
  tableIds: string[];
  relationIds: string[];
  deleteLinkIds: string[];
  deleteNoteIds: string[];
  deleteFrameIds: string[];
  deleteTextIds: string[];
  deleteStrokeIds: string[];
};

export function getSqlErdDeleteBatchFromSelectedShapes(
  selectedShapes: TLShape[]
): SqlErdDeleteBatch {
  const tableIds = new Set<string>();
  const relationIds = new Set<string>();
  const deleteLinkIds = new Set<string>();
  const deleteNoteIds = new Set<string>();
  const deleteFrameIds = new Set<string>();
  const deleteTextIds = new Set<string>();
  const deleteStrokeIds = new Set<string>();

  for (const shape of selectedShapes) {
    if (isSqlErdTableShape(shape)) tableIds.add(shape.props.tableId);
    else if (isSqlErdRelationShape(shape)) relationIds.add(shape.props.relationId);
    else if (isSqlErdAnnotationShape(shape)) deleteLinkIds.add(shape.props.annotationId);
    else if (isSqlErdNoteShape(shape)) deleteNoteIds.add(shape.props.noteId);
    else if (isSqlErdFrameShape(shape)) deleteFrameIds.add(shape.props.frameId);
    else if (isSqlErdTextShape(shape)) deleteTextIds.add(shape.props.textId);
    else if (isSqlErdStrokeShape(shape)) deleteStrokeIds.add(shape.props.strokeId);
  }

  return {
    deleteFrameIds: [...deleteFrameIds],
    deleteLinkIds: [...deleteLinkIds],
    deleteNoteIds: [...deleteNoteIds],
    deleteStrokeIds: [...deleteStrokeIds],
    deleteTextIds: [...deleteTextIds],
    relationIds: [...relationIds],
    tableIds: [...tableIds]
  };
}

export function selectSqlErdCanvasShapeAtPoint(
  editor: Pick<
    Editor,
    "getSelectedShapeIds" | "getShapeAtPoint" | "selectNone" | "setSelectedShapes"
  >,
  point: { x: number; y: number },
  options: {
    clearOnMiss?: boolean;
    toggle?: boolean;
  } = {}
) {
  const shape = editor.getShapeAtPoint(point, {
    hitInside: true,
    hitLabels: true,
    hitLocked: true
  });

  if (
    !shape ||
    !(
      isSqlErdAnnotationShape(shape) ||
      isSqlErdFrameShape(shape) ||
      isSqlErdNoteShape(shape) ||
      isSqlErdTextShape(shape) ||
      isSqlErdRelationShape(shape) ||
      isSqlErdTableShape(shape)
    )
  ) {
    if (options.clearOnMiss) {
      editor.selectNone();
    }
    return false;
  }

  if (!options.toggle) {
    editor.setSelectedShapes([shape.id]);
    return true;
  }

  const selectedShapeIds = Array.from(editor.getSelectedShapeIds());
  editor.setSelectedShapes(
    selectedShapeIds.includes(shape.id)
      ? selectedShapeIds.filter((shapeId) => shapeId !== shape.id)
      : [...selectedShapeIds, shape.id]
  );
  return true;
}

export function isSqlErdCanvasBackgroundPoint(
  editor: Pick<Editor, "getShapeAtPoint"> & {
    overlays: Pick<Editor["overlays"], "getOverlayAtPoint">;
  },
  point: { x: number; y: number }
) {
  return (
    !editor.getShapeAtPoint(point, {
      hitInside: true,
      hitLabels: true,
      hitLocked: true
    }) && !editor.overlays.getOverlayAtPoint(point)
  );
}
