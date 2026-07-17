import type { Editor, TLShape } from "tldraw";

import { isSqlErdAnnotationShape } from "@/features/sql-erd/shapes/sql-erd-annotation-shape";
import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import { isSqlErdNoteShape } from "@/features/sql-erd/shapes/sql-erd-note-shape";
import { isSqlErdTextShape } from "@/features/sql-erd/shapes/sql-erd-text-shape";
import { isSqlErdRelationShape } from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import { isSqlErdTableShape } from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type {
  SqlErdSelection,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

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
