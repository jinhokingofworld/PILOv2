"use client";

import { type PointerEvent as ReactPointerEvent } from "react";
import { useValue } from "@tldraw/state-react";
import { LockOpen, type LucideProps } from "lucide-react";
import { useEditor, type TLShapeId } from "tldraw";

const GROUP_TOOLBAR_SIZE = 34;
const GROUP_TOOLBAR_OFFSET = 8;
const GROUP_TOOLBAR_VIEWPORT_PADDING = 12;

function clampToViewport(value: number, max: number) {
  return Math.min(Math.max(value, GROUP_TOOLBAR_VIEWPORT_PADDING), max);
}

export function SelectedGroupToolbar() {
  const editor = useEditor();
  const toolbarState = useValue(
    "pilo-selected-group-toolbar",
    () => {
      const selectedGroups = editor
        .getSelectedShapes()
        .filter((shape) => shape.type === "group");

      if (selectedGroups.length !== 1) return null;

      const selectedGroup = selectedGroups[0];
      const bounds = editor.getShapePageBounds(selectedGroup.id);

      if (!bounds) return null;

      const viewportBounds = editor.getViewportScreenBounds();
      const topLeft = editor.pageToViewport({
        x: bounds.x,
        y: bounds.y,
      });
      const maxLeft = Math.max(
        GROUP_TOOLBAR_VIEWPORT_PADDING,
        viewportBounds.w - GROUP_TOOLBAR_SIZE - GROUP_TOOLBAR_VIEWPORT_PADDING,
      );
      const maxTop = Math.max(
        GROUP_TOOLBAR_VIEWPORT_PADDING,
        viewportBounds.h - GROUP_TOOLBAR_SIZE - GROUP_TOOLBAR_VIEWPORT_PADDING,
      );

      return {
        groupId: selectedGroup.id as TLShapeId,
        left: clampToViewport(topLeft.x + GROUP_TOOLBAR_OFFSET, maxLeft),
        top: clampToViewport(topLeft.y + GROUP_TOOLBAR_OFFSET, maxTop),
      };
    },
    [editor],
  );

  if (!toolbarState) return null;

  const { groupId } = toolbarState;

  function handleToolbarPointerEvent(event: ReactPointerEvent<HTMLElement>) {
    editor.markEventAsHandled(event);
    event.stopPropagation();
  }

  function ungroupSelection() {
    editor.ungroupShapes([groupId]);
  }

  return (
    <div
      className="pilo-group-toolbar"
      style={{
        left: toolbarState.left,
        top: toolbarState.top,
      }}
      onPointerDownCapture={handleToolbarPointerEvent}
      onPointerUpCapture={handleToolbarPointerEvent}
    >
      <button
        type="button"
        aria-label="그룹 해제"
        data-tooltip="그룹 해제"
        onClick={ungroupSelection}
      >
        <GroupUnlockIcon aria-hidden="true" />
      </button>
    </div>
  );
}

function GroupUnlockIcon(props: LucideProps) {
  return <LockOpen {...props} strokeWidth={2.2} />;
}
