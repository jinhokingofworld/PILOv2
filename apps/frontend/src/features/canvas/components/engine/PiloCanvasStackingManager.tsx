"use client";

import { useEffect, useMemo, useRef } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { useValue } from "@tldraw/state-react";
import {
  bringPiloTextShapesToFront,
  getPiloTextShapeIds,
  isPiloSnapShape,
} from "./PiloCanvasShapeGuards";

export function SelectedShapeStackingManager() {
  const editor = useEditor();
  const lastStackedSelectionKeyRef = useRef("none");
  const textShapeKey =
    useValue(
      "pilo-text-shape-key",
      () => getPiloTextShapeIds(editor).join("|"),
      [editor],
    ) || "none";
  const selectedSnapShapeKey =
    useValue(
      "pilo-selected-snap-shape-key",
      () =>
        editor
          .getSelectedShapeIds()
          .filter((shapeId) => isPiloSnapShape(editor.getShape(shapeId)))
          .join("|"),
      [editor],
    ) || "none";
  const selectedShapeKey =
    useValue(
      "pilo-selected-shape-key",
      () => editor.getSelectedShapeIds().join("|"),
      [editor],
    ) || "none";
  const stackingKey = `${selectedShapeKey}:${selectedSnapShapeKey}:${textShapeKey}`;
  const selectedSnapShapeIds = useMemo(
    () =>
      selectedSnapShapeKey === "none"
        ? []
        : (selectedSnapShapeKey.split("|") as TLShapeId[]),
    [selectedSnapShapeKey],
  );
  const textShapeIds = useMemo(
    () =>
      textShapeKey === "none" ? [] : (textShapeKey.split("|") as TLShapeId[]),
    [textShapeKey],
  );

  useEffect(() => {
    if (textShapeKey === "none" && !selectedSnapShapeIds.length) {
      lastStackedSelectionKeyRef.current = "none";
      return;
    }
    if (lastStackedSelectionKeyRef.current === stackingKey) return;

    lastStackedSelectionKeyRef.current = stackingKey;
    editor.run(
      () => {
        if (selectedSnapShapeIds.length) {
          editor.bringToFront(selectedSnapShapeIds);
        }

        bringPiloTextShapesToFront(editor, textShapeIds);
      },
      { history: "ignore" },
    );
  }, [editor, selectedSnapShapeIds, stackingKey, textShapeIds, textShapeKey]);

  return null;
}
