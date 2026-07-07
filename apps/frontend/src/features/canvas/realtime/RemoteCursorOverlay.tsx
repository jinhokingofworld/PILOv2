"use client";

import { useMemo, useRef, type CSSProperties } from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor, type TLShapeId } from "tldraw";

import type { CanvasRemotePresenceState } from "./canvas-realtime-types";

type RemoteCursorOverlayProps = {
  currentUserId: string | null;
  presence: CanvasRemotePresenceState[];
};

const cursorColors = [
  "#3158ff",
  "#ef5b68",
  "#2e9e5b",
  "#d9941f",
  "#7c5cff",
  "#0891b2",
  "#be4bdb",
  "#0f766e",
] as const;

function getStableCursorColor(userId: string) {
  let hash = 0;

  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }

  return cursorColors[hash % cursorColors.length];
}

function createRemoteSelectionOutlines({
  editor,
  overlayRect,
  presence,
}: {
  editor: ReturnType<typeof useEditor>;
  overlayRect: DOMRect | undefined;
  presence: CanvasRemotePresenceState[];
}) {
  return presence.flatMap((entry) =>
    entry.selectedShapeIds.flatMap((shapeId) => {
      const bounds = editor.getShapePageBounds(shapeId as TLShapeId);

      if (!bounds || !bounds.isValid()) {
        return [];
      }

      const topLeft = editor.pageToScreen({
        x: bounds.x,
        y: bounds.y,
      });
      const bottomRight = editor.pageToScreen({
        x: bounds.x + bounds.w,
        y: bounds.y + bounds.h,
      });
      const left = overlayRect ? topLeft.x - overlayRect.left : topLeft.x;
      const top = overlayRect ? topLeft.y - overlayRect.top : topLeft.y;
      const right = overlayRect
        ? bottomRight.x - overlayRect.left
        : bottomRight.x;
      const bottom = overlayRect
        ? bottomRight.y - overlayRect.top
        : bottomRight.y;

      return [
        {
          id: `${entry.userId}:${shapeId}`,
          color: getStableCursorColor(entry.userId),
          displayName: entry.displayName || "PILO",
          left: Math.min(left, right),
          top: Math.min(top, bottom),
          width: Math.max(1, Math.abs(right - left)),
          height: Math.max(1, Math.abs(bottom - top)),
        },
      ];
    }),
  );
}

export function RemoteCursorOverlay({
  currentUserId,
  presence,
}: RemoteCursorOverlayProps) {
  const editor = useEditor();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useValue("pilo-remote-cursor-camera", () => editor.getCamera(), [editor]);
  useValue(
    "pilo-remote-cursor-viewport",
    () => editor.getViewportScreenBounds(),
    [editor],
  );

  const visiblePresence = useMemo(
    () => presence.filter((entry) => entry.userId !== currentUserId),
    [currentUserId, presence],
  );

  const overlayRect = overlayRef.current?.getBoundingClientRect();
  const selectionOutlines = createRemoteSelectionOutlines({
    editor,
    overlayRect,
    presence: visiblePresence,
  });

  return (
    <div ref={overlayRef} className="canvas-remote-cursor-layer">
      {selectionOutlines.map((outline) => {
        const style = {
          "--canvas-remote-cursor-color": outline.color,
          height: outline.height,
          left: outline.left,
          top: outline.top,
          width: outline.width,
        } as CSSProperties & {
          "--canvas-remote-cursor-color": string;
        };

        return (
          <div
            key={outline.id}
            className="canvas-remote-selection-outline"
            style={style}
          >
            <span>{outline.displayName}</span>
          </div>
        );
      })}
      {visiblePresence.map((entry) => {
        const screenPoint = editor.pageToScreen(entry.cursor);
        const x = overlayRect ? screenPoint.x - overlayRect.left : screenPoint.x;
        const y = overlayRect ? screenPoint.y - overlayRect.top : screenPoint.y;
        const color = getStableCursorColor(entry.userId);
        const style = {
          "--canvas-remote-cursor-color": color,
          transform: `translate3d(${x}px, ${y}px, 0)`,
        } as CSSProperties & {
          "--canvas-remote-cursor-color": string;
        };

        return (
          <div
            key={entry.userId}
            className="canvas-remote-cursor"
            style={style}
          >
            <span className="canvas-remote-cursor-pointer" />
            <span className="canvas-remote-cursor-label">
              {entry.displayName || "PILO"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
