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
  id: string;
  left: number;
  title: string;
  top: number;
};

function normalizeFrameTitle(value: string) {
  const title = value.replaceAll("\u200B", "").trim();

  return title || "Frame";
}

function readCollapsedFrameOverlayItems(editor: Editor) {
  return editor
    .getCurrentPageShapes()
    .flatMap((shape): CollapsedFrameOverlayItem[] => {
      if (!isPiloFrameShape(shape) || !isPiloFrameCollapsed(shape)) {
        return [];
      }

      const bounds = editor.getShapePageBounds(shape.id);

      if (!bounds) return [];

      const viewportPoint = editor.pageToViewport({
        x: bounds.x + 8,
        y: bounds.y + 8,
      });

      return [
        {
          childShapeCount: getPiloChildShapeCount(shape),
          frame: shape,
          id: String(shape.id),
          left: viewportPoint.x,
          title: normalizeFrameTitle(shape.props.name),
          top: viewportPoint.y,
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
  const [documentVersion, setDocumentVersion] = useState(0);
  const collapsedFrames = useMemo(
    () => readCollapsedFrameOverlayItems(editor),
    [camera.x, camera.y, camera.z, documentVersion, editor],
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
        <button
          key={item.id}
          type="button"
          className="pilo-collapsed-frame-card"
          style={{
            left: item.left,
            top: item.top,
          }}
          aria-label={`${item.title} expand`}
          title={`${item.title} - ${item.childShapeCount} shapes`}
          onPointerDown={(event) => handleExpandPointerDown(event, item.frame)}
          onPointerUp={handlePointerEvent}
        >
          <span className="pilo-collapsed-frame-plus" aria-hidden="true">
            +
          </span>
          <small aria-hidden="true">{item.childShapeCount}</small>
        </button>
      ))}
    </div>
  );
}
