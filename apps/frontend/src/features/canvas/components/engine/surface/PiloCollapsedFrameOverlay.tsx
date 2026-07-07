"use client";

import { useValue } from "@tldraw/state-react";
import { useEditor, type Editor } from "tldraw";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import {
  getPiloChildShapeCount,
  isPiloFrameCollapsed,
} from "../../../utils/canvas-collapse";
import {
  isPiloFrameShape,
  type PiloFrameShape,
} from "../shapes/PiloCanvasShapeGuards";

type CollapsedFrameOverlayItem = {
  childShapeCount: number;
  frame: PiloFrameShape;
  height: number;
  id: string;
  isSelected: boolean;
  left: number;
  title: string;
  top: number;
  width: number;
  zoom: number;
};

function normalizeFrameTitle(value: string) {
  const title = value.replaceAll("\u200B", "").trim();

  return title || "Frame";
}

function readCollapsedFrameOverlayItems(
  editor: Editor,
  selectedShapeIds: Set<string>,
) {
  return editor
    .getCurrentPageShapes()
    .flatMap((shape): CollapsedFrameOverlayItem[] => {
      if (!isPiloFrameShape(shape) || !isPiloFrameCollapsed(shape)) {
        return [];
      }

      const bounds = editor.getShapePageBounds(shape.id);

      if (!bounds) return [];

      const viewportPoint = editor.pageToViewport({
        x: bounds.x,
        y: bounds.y,
      });
      const camera = editor.getCamera();

      return [
        {
          childShapeCount: getPiloChildShapeCount(shape),
          frame: shape,
          height: bounds.h,
          id: String(shape.id),
          isSelected: selectedShapeIds.has(String(shape.id)),
          left: viewportPoint.x,
          title: normalizeFrameTitle(shape.props.name),
          top: viewportPoint.y,
          width: bounds.w,
          zoom: camera.z,
        },
      ];
    });
}

export function PiloCollapsedFrameOverlay({
  onFrameCollapsedChange,
}: {
  onFrameCollapsedChange: (
    frame: PiloFrameShape,
    nextCollapsed: boolean,
  ) => void;
}) {
  const editor = useEditor();
  const camera = useValue(
    "pilo-collapsed-frame-overlay-camera",
    () => editor.getCamera(),
    [editor],
  );
  const selectedShapeIdToken = useValue(
    "pilo-collapsed-frame-overlay-selection",
    () => editor.getSelectedShapeIds().map(String).join("|"),
    [editor],
  );
  const [documentVersion, setDocumentVersion] = useState(0);
  const collapsedFrames = useMemo(
    () =>
      readCollapsedFrameOverlayItems(
        editor,
        new Set(selectedShapeIdToken ? selectedShapeIdToken.split("|") : []),
      ),
    [camera.x, camera.y, camera.z, documentVersion, editor, selectedShapeIdToken],
  );

  useEffect(() => {
    const removeListener = editor.store.listen(
      () => {
        setDocumentVersion((version) => version + 1);
      },
      {
        source: "all",
        scope: "document",
      },
    );

    return removeListener;
  }, [editor]);

  if (!collapsedFrames.length) return null;

  function handlePointerEvent(event: PointerEvent<HTMLElement>) {
    editor.markEventAsHandled(event);
    event.stopPropagation();
  }

  function handleExpandPointerDown(
    event: PointerEvent<HTMLButtonElement>,
    frame: PiloFrameShape,
  ) {
    handlePointerEvent(event);
    onFrameCollapsedChange(frame, false);
  }

  return (
    <div className="pilo-collapsed-frame-layer" aria-hidden="false">
      {collapsedFrames.map((item) => (
        <div
          key={item.id}
          className={`pilo-collapsed-frame-card${item.isSelected ? " is-selected" : ""}`}
          style={{
            height: item.height,
            left: item.left,
            top: item.top,
            transform: `scale(${item.zoom})`,
            width: item.width,
          }}
          title={`${item.title} - ${item.childShapeCount} shapes`}
        >
          <button
            type="button"
            className="pilo-collapsed-frame-expand"
            aria-label={`${item.title} expand`}
            onPointerDown={(event) => handleExpandPointerDown(event, item.frame)}
          >
            +
          </button>
          <strong>{item.title}</strong>
          <span>{item.childShapeCount} shapes</span>
          <small>Collapsed frame</small>
        </div>
      ))}
    </div>
  );
}
