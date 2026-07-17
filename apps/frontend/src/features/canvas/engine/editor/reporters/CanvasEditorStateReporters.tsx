"use client";

import { useEffect } from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor } from "tldraw";
import type { PiloCanvasLocalInteractionState } from "../../canvas-engine-types";
import {
  getCanvasActiveMutationShapeIds,
  getCanvasInteractionToolPath,
  isCanvasFreehandInteractionActive,
} from "../../interactions/canvas-local-interaction-policy";
import type {
  PiloCanvasHistoryState,
  PiloCanvasSnapState,
} from "../canvas-editor-contracts";

const idleInteractionState: PiloCanvasLocalInteractionState = {
  activeMutationShapeIds: [],
  currentToolId: "select.idle",
  editingShapeId: null,
  focusedGroupId: null,
  isFreehandDrawing: false,
  isFocused: false,
  selectedShapeIds: [],
};

export function CanvasLocalInteractionReporter({
  onChange,
}: {
  onChange: (state: PiloCanvasLocalInteractionState) => void;
}) {
  const editor = useEditor();
  const localInteractionState = useValue(
    "pilo-local-interaction-state",
    () => {
      const selectedShapeIds = editor.getSelectedShapeIds();
      const editingShapeId = editor.getEditingShapeId();
      const pageState = editor.getCurrentPageState();
      const currentToolId = getCanvasInteractionToolPath(editor);
      const isDragging = editor.inputs.getIsDragging();
      const isPointing = editor.inputs.getIsPointing();
      const normalizedEditingShapeId = editingShapeId
        ? String(editingShapeId)
        : null;
      const normalizedSelectedShapeIds = selectedShapeIds.map(String);

      return {
        activeMutationShapeIds: getCanvasActiveMutationShapeIds({
          currentToolId,
          editingShapeId: normalizedEditingShapeId,
          isDragging,
          isPointing,
          selectedShapeIds: normalizedSelectedShapeIds,
        }),
        currentToolId,
        editingShapeId: normalizedEditingShapeId,
        focusedGroupId: pageState.focusedGroupId
          ? String(pageState.focusedGroupId)
          : null,
        isFreehandDrawing: isCanvasFreehandInteractionActive({
          currentToolId,
          isDragging,
          isPointing,
        }),
        isFocused: editor.getIsFocused(),
        selectedShapeIds: normalizedSelectedShapeIds,
      };
    },
    [editor],
  );

  useEffect(() => {
    onChange(localInteractionState);
  }, [localInteractionState, onChange]);

  useEffect(
    () => () => {
      onChange(idleInteractionState);
    },
    [onChange],
  );

  return null;
}

export function CanvasHistoryStateReporter({
  onHistoryStateChange,
}: {
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
}) {
  const editor = useEditor();
  const canUndo = useValue("pilo-can-undo", () => editor.getCanUndo(), [
    editor,
  ]);
  const canRedo = useValue("pilo-can-redo", () => editor.getCanRedo(), [
    editor,
  ]);

  useEffect(() => {
    onHistoryStateChange({ canUndo, canRedo });
  }, [canRedo, canUndo, onHistoryStateChange]);

  useEffect(() => {
    return () => onHistoryStateChange({ canUndo: false, canRedo: false });
  }, [onHistoryStateChange]);

  return null;
}

export function CanvasSnapStateReporter({
  onSnapStateChange,
}: {
  onSnapStateChange: (state: PiloCanvasSnapState) => void;
}) {
  const editor = useEditor();
  const isSmartGuideEnabled = useValue(
    "pilo-smart-guide-enabled",
    () => editor.user.getIsSnapMode(),
    [editor],
  );

  useEffect(() => {
    onSnapStateChange({ isSmartGuideEnabled });
  }, [isSmartGuideEnabled, onSnapStateChange]);

  useEffect(() => {
    return () => onSnapStateChange({ isSmartGuideEnabled: false });
  }, [onSnapStateChange]);

  return null;
}
