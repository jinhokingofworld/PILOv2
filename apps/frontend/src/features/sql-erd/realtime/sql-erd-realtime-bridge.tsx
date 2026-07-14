"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useValue } from "@tldraw/state-react";
import { type TLShapeId, useEditor } from "tldraw";

import type { SqlErdCanvasTool } from "@/features/sql-erd/components/sql-erd-canvas-toolbar";
import type { SqlErdPresenceController } from "./use-sql-erd-presence";

type SqlErdRealtimeBridgeProps = Pick<
  SqlErdPresenceController,
  "currentUserId" | "remotePresence" | "updatePresence"
> & {
  tool: SqlErdCanvasTool;
};

const colors = ["#3158ff", "#ef5b68", "#2e9e5b", "#d9941f", "#7c5cff"] as const;

function getColor(userId: string) {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return colors[hash % colors.length];
}

export function SqlErdRealtimeBridge({
  currentUserId,
  remotePresence,
  tool,
  updatePresence,
}: SqlErdRealtimeBridgeProps) {
  const editor = useEditor();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const selectedShapeIdsKey = useValue(
    "sqltoerd-realtime-selection",
    () => Array.from(editor.getSelectedShapeIds()).sort().join("\u0000"),
    [editor],
  );
  useValue("sqltoerd-realtime-camera", () => editor.getCamera(), [editor]);
  useValue(
    "sqltoerd-realtime-viewport",
    () => editor.getViewportScreenBounds(),
    [editor],
  );

  const selectedShapeIds = useMemo(
    () => (selectedShapeIdsKey ? selectedShapeIdsKey.split("\u0000") : []),
    [selectedShapeIdsKey],
  );

  useEffect(() => {
    updatePresence({ selectedShapeIds });
  }, [selectedShapeIds, updatePresence]);

  useEffect(() => {
    updatePresence({ tool: tool ?? "select" });
  }, [tool, updatePresence]);

  const overlayRect = overlayRef.current?.getBoundingClientRect();
  const visiblePresence = useMemo(
    () =>
      remotePresence.filter(
        (presence) =>
          presence.userId !== currentUserId &&
          (presence.cursor === null ||
            (Number.isFinite(presence.cursor.x) && Number.isFinite(presence.cursor.y))),
      ),
    [currentUserId, remotePresence],
  );
  const outlines = visiblePresence.flatMap((presence) =>
    presence.selectedShapeIds.flatMap((shapeId) => {
      const bounds = editor.getShapePageBounds(shapeId as TLShapeId);
      if (!bounds || !bounds.isValid()) return [];

      const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
      const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
      const left = topLeft.x - (overlayRect?.left ?? 0);
      const top = topLeft.y - (overlayRect?.top ?? 0);
      return [{
        color: getColor(presence.userId),
        height: Math.max(1, Math.abs(bottomRight.y - topLeft.y)),
        id: `${presence.userId}:${shapeId}`,
        left: Math.min(left, bottomRight.x - (overlayRect?.left ?? 0)),
        name: presence.displayName ?? "PILO",
        top: Math.min(top, bottomRight.y - (overlayRect?.top ?? 0)),
        width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
      }];
    }),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-20" ref={overlayRef}>
      {outlines.map((outline) => (
        <div
          className="absolute rounded border-2"
          key={outline.id}
          style={{
            borderColor: outline.color,
            height: outline.height,
            left: outline.left,
            top: outline.top,
            width: outline.width,
          }}
        >
          <span
            className="absolute -top-5 left-0 rounded px-1 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: outline.color }}
          >
            {outline.name}
          </span>
        </div>
      ))}
      {visiblePresence.map((presence) => {
        if (!presence.cursor) return null;
        const screenPoint = editor.pageToScreen(presence.cursor);
        const x = screenPoint.x - (overlayRect?.left ?? 0);
        const y = screenPoint.y - (overlayRect?.top ?? 0);
        const color = getColor(presence.userId);
        const style = {
          "--sqltoerd-presence-color": color,
          transform: `translate3d(${x}px, ${y}px, 0)`,
        } as CSSProperties & { "--sqltoerd-presence-color": string };

        return (
          <div className="absolute left-0 top-0" key={presence.userId} style={style}>
            <span
              className="block size-3 rotate-45 rounded-sm"
              style={{ backgroundColor: "var(--sqltoerd-presence-color)" }}
            />
            <span
              className="ml-2 mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: "var(--sqltoerd-presence-color)" }}
            >
              {presence.displayName ?? "PILO"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
