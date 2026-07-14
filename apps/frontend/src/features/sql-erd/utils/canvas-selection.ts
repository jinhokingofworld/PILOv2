import type { TLShape } from "tldraw";

import { isSqlErdAnnotationShape } from "@/features/sql-erd/shapes/sql-erd-annotation-shape";
import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import { isSqlErdNoteShape } from "@/features/sql-erd/shapes/sql-erd-note-shape";
import { isSqlErdTextShape } from "@/features/sql-erd/shapes/sql-erd-text-shape";
import { isSqlErdRelationShape } from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import { isSqlErdTableShape } from "@/features/sql-erd/shapes/sql-erd-table-shape";
import type { SqlErdSelection } from "@/features/sql-erd/types";

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
