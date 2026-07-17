"use client";

import { useEffect } from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor, type TLShapeId } from "tldraw";
import type { PiloCanvasLocalInteractionState } from "../../canvas-engine-types";
import type {
  PiloCanvasHistoryState,
  PiloCanvasSnapState,
} from "../canvas-editor-contracts";

const idleInteractionState: PiloCanvasLocalInteractionState = {
  currentToolId: "select.idle",
  editingShapeId: null,
  focusedGroupId: null,
  isFocused: false,
  protectedShapeIds: [],
  selectedShapeIds: [],
};

function getProtectedShapeIds(
  selectedShapeIds: TLShapeId[],
  editingShapeId: TLShapeId | null,
) {
  const protectedShapeIds = new Set<string>();

  if (editingShapeId) {
    protectedShapeIds.add(String(editingShapeId));
  }

  selectedShapeIds.forEach((shapeId) => {
    protectedShapeIds.add(String(shapeId));
  });

  return Array.from(protectedShapeIds);
}

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

      return {
        currentToolId: editor.getCurrentToolId(),
        editingShapeId: editingShapeId ? String(editingShapeId) : null,
        focusedGroupId: pageState.focusedGroupId
          ? String(pageState.focusedGroupId)
          : null,
        isFocused: editor.getIsFocused(),
        protectedShapeIds: getProtectedShapeIds(
          selectedShapeIds,
          editingShapeId,
        ),
        selectedShapeIds: selectedShapeIds.map(String),
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
