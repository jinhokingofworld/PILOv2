"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useValue } from "@tldraw/state-react";
import { type TLShape, type TLShapeId, useEditor } from "tldraw";

import type { SqlErdCanvasTool } from "@/features/sql-erd/components/sql-erd-canvas-toolbar";
import {
  isSqlErdAnnotationShape,
} from "@/features/sql-erd/shapes/sql-erd-annotation-shape";
import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import { isSqlErdNoteShape } from "@/features/sql-erd/shapes/sql-erd-note-shape";
import { isSqlErdRelationShape } from "@/features/sql-erd/shapes/sql-erd-relation-shape";
import { isSqlErdStrokeShape } from "@/features/sql-erd/shapes/sql-erd-stroke-shape";
import {
  isSqlErdTableShape,
  SQLTOERD_COLUMN_CONNECT_START_EVENT,
  SQLTOERD_TABLE_CONNECT_START_EVENT,
} from "@/features/sql-erd/shapes/sql-erd-table-shape";
import { isSqlErdTextShape } from "@/features/sql-erd/shapes/sql-erd-text-shape";
import type {
  SqlErdPresenceEditingMode,
  SqlErdPresencePoint,
  SqlErdPresenceSelectedObject,
} from "./sql-erd-realtime-types";
import type { SqlErdPresenceController } from "./use-sql-erd-presence";

type SqlErdRealtimeBridgeProps = Pick<
  SqlErdPresenceController,
  "currentUserId" | "remotePresence" | "updatePresence"
> & {
  isSqlSourceOpen: boolean;
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

function getSelectedObject(shape: TLShape): SqlErdPresenceSelectedObject | null {
  if (isSqlErdTableShape(shape)) return { id: shape.props.tableId, type: "table" };
  if (isSqlErdRelationShape(shape)) return { id: shape.props.relationId, type: "relation" };
  if (isSqlErdAnnotationShape(shape)) return { id: shape.props.annotationId, type: "annotation" };
  if (isSqlErdNoteShape(shape)) return { id: shape.props.noteId, type: "note" };
  if (isSqlErdFrameShape(shape)) return { id: shape.props.frameId, type: "frame" };
  if (isSqlErdTextShape(shape)) return { id: shape.props.textId, type: "text" };
  if (isSqlErdStrokeShape(shape)) return { id: shape.props.strokeId, type: "stroke" };

  return null;
}

function getEditingMode({
  currentToolId,
  isCreatingRelation,
  isSqlSourceOpen,
  tool,
}: {
  currentToolId: string;
  isCreatingRelation: boolean;
  isSqlSourceOpen: boolean;
  tool: SqlErdCanvasTool;
}): SqlErdPresenceEditingMode {
  if (isSqlSourceOpen) return "sql";
  if (isCreatingRelation) return "relation";
  if (currentToolId.includes("resize")) return "resize";
  if (currentToolId.includes("translate")) return "move";
  if (tool === "draw") return "draw";

  return null;
}

function RemoteCursor({
  color,
  cursor,
  name,
  overlayRect,
}: {
  color: string;
  cursor: SqlErdPresencePoint | null;
  name: string;
  overlayRect: DOMRect | undefined;
}) {
  const editor = useEditor();
  const [displayCursor, setDisplayCursor] = useState(cursor);
  const displayCursorRef = useRef(cursor);

  useEffect(() => {
    if (!cursor) {
      displayCursorRef.current = null;
      setDisplayCursor(null);
      return;
    }

    let frameId: number | null = null;
    const animate = () => {
      const current = displayCursorRef.current ?? cursor;
      const next = {
        x: current.x + (cursor.x - current.x) * 0.35,
        y: current.y + (cursor.y - current.y) * 0.35,
      };
      const isSettled = Math.hypot(cursor.x - next.x, cursor.y - next.y) < 0.15;
      const resolvedCursor = isSettled ? cursor : next;

      displayCursorRef.current = resolvedCursor;
      setDisplayCursor(resolvedCursor);
      if (!isSettled) frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [cursor?.x, cursor?.y]);

  if (!displayCursor) return null;

  const screenPoint = editor.pageToScreen(displayCursor);
  const style = {
    "--sqltoerd-presence-color": color,
    transform: `translate3d(${screenPoint.x - (overlayRect?.left ?? 0)}px, ${screenPoint.y - (overlayRect?.top ?? 0)}px, 0)`,
  } as CSSProperties & { "--sqltoerd-presence-color": string };

  return (
    <div className="absolute left-0 top-0" style={style}>
      <span
        className="block size-3 rotate-45 rounded-sm"
        style={{ backgroundColor: "var(--sqltoerd-presence-color)" }}
      />
      <span
        className="ml-2 mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
        style={{ backgroundColor: "var(--sqltoerd-presence-color)" }}
      >
        {name}
      </span>
    </div>
  );
}

export function SqlErdRealtimeBridge({
  currentUserId,
  isSqlSourceOpen,
  remotePresence,
  tool,
  updatePresence,
}: SqlErdRealtimeBridgeProps) {
  const editor = useEditor();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isCreatingRelation, setIsCreatingRelation] = useState(false);
  const selectedShapeIdsKey = useValue(
    "sqltoerd-realtime-selection",
    () => Array.from(editor.getSelectedShapeIds()).sort().join("\u0000"),
    [editor],
  );
  const currentToolId = useValue(
    "sqltoerd-realtime-tool",
    () => editor.getCurrentToolId(),
    [editor],
  );
  const pageShapes = useValue(
    "sqltoerd-realtime-page-shapes",
    () => editor.getCurrentPageShapes(),
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
  const selectedObjects = useMemo(
    () =>
      selectedShapeIds.flatMap((shapeId) => {
        const shape = editor.getShape(shapeId as TLShapeId);
        const selectedObject = shape ? getSelectedObject(shape) : null;
        return selectedObject ? [selectedObject] : [];
      }),
    [editor, selectedShapeIds],
  );
  const editingMode = getEditingMode({
    currentToolId,
    isCreatingRelation,
    isSqlSourceOpen,
    tool,
  });
  const shapeBySelectedObject = useMemo(() => {
    const nextShapeBySelectedObject = new Map<string, TLShape>();
    pageShapes.forEach((shape) => {
      const selectedObject = getSelectedObject(shape);
      if (selectedObject) {
        nextShapeBySelectedObject.set(
          `${selectedObject.type}:${selectedObject.id}`,
          shape,
        );
      }
    });
    return nextShapeBySelectedObject;
  }, [pageShapes]);

  useEffect(() => {
    updatePresence({ selectedObjects });
  }, [selectedObjects, updatePresence]);

  useEffect(() => {
    updatePresence({ editingMode, tool: tool ?? "select" });
  }, [editingMode, tool, updatePresence]);

  useEffect(() => {
    const startRelation = () => setIsCreatingRelation(true);
    const stopRelation = () => setIsCreatingRelation(false);

    window.addEventListener(SQLTOERD_COLUMN_CONNECT_START_EVENT, startRelation);
    window.addEventListener(SQLTOERD_TABLE_CONNECT_START_EVENT, startRelation);
    window.addEventListener("pointerup", stopRelation);
    window.addEventListener("pointercancel", stopRelation);

    return () => {
      window.removeEventListener(SQLTOERD_COLUMN_CONNECT_START_EVENT, startRelation);
      window.removeEventListener(SQLTOERD_TABLE_CONNECT_START_EVENT, startRelation);
      window.removeEventListener("pointerup", stopRelation);
      window.removeEventListener("pointercancel", stopRelation);
    };
  }, []);

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
    presence.selectedObjects.flatMap((selectedObject) => {
      const shape = shapeBySelectedObject.get(
        `${selectedObject.type}:${selectedObject.id}`,
      );
      const bounds = shape ? editor.getShapePageBounds(shape) : null;
      if (!bounds || !bounds.isValid()) return [];

      const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
      const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
      return [{
        color: getColor(presence.userId),
        height: Math.max(1, Math.abs(bottomRight.y - topLeft.y)),
        id: `${presence.userId}:${selectedObject.type}:${selectedObject.id}`,
        left: Math.min(topLeft.x, bottomRight.x) - (overlayRect?.left ?? 0),
        name: presence.displayName,
        top: Math.min(topLeft.y, bottomRight.y) - (overlayRect?.top ?? 0),
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
      {visiblePresence.map((presence) => (
        <RemoteCursor
          color={getColor(presence.userId)}
          cursor={presence.cursor}
          key={presence.userId}
          name={presence.displayName}
          overlayRect={overlayRect}
        />
      ))}
    </div>
  );
}
