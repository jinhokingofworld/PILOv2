"use client";

import { useCallback, useEffect, useRef } from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor } from "tldraw";

import type { PrReviewCanvasPresenceController } from "@/features/pr-review/realtime/usePrReviewCanvasPresence";
import { RemoteCursorOverlay } from "@/shared/canvas-realtime/RemoteCursorOverlay";
import type {
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
} from "@/shared/canvas-realtime/canvas-realtime-types";

const PRESENCE_THROTTLE_MS = 80;

type PrReviewCanvasRealtimeBridgeProps = {
  presence: PrReviewCanvasPresenceController;
  readOnly: boolean;
};

function getPresenceEditingMode(
  currentToolId: string,
): CanvasPresenceEditingMode | null {
  if (currentToolId.includes("hand")) return "hand";
  if (currentToolId.includes("draw")) return "draw";
  if (currentToolId.includes("resize")) return "resize";
  if (currentToolId.includes("translate")) return "move";
  return currentToolId === "select.idle" || currentToolId === "select"
    ? "select"
    : "placement";
}

function PrReviewCanvasReadOnlyBridge({ readOnly }: { readOnly: boolean }) {
  const editor = useEditor();

  useEffect(() => {
    editor.updateInstanceState({ isReadonly: readOnly });
  }, [editor, readOnly]);

  return null;
}

function PrReviewCanvasPresenceReporter({
  presence,
}: {
  presence: PrReviewCanvasPresenceController;
}) {
  const editor = useEditor();
  const sendPresenceUpdate = presence.sendPresenceUpdate;
  const selectedShapeIds = useValue(
    "pr-review-presence-selected-shape-ids",
    () => editor.getSelectedShapeIds().map(String),
    [editor],
  );
  const currentToolId = useValue(
    "pr-review-presence-current-tool-id",
    () => editor.getCurrentToolId(),
    [editor],
  );
  const selectedShapeIdsRef = useRef(selectedShapeIds);
  const editingModeRef = useRef<CanvasPresenceEditingMode | null>(
    getPresenceEditingMode(currentToolId),
  );
  const lastSentAtRef = useRef(0);
  const lastSentPayloadRef = useRef<{
    cursor: CanvasPresencePoint | null;
    editingMode: CanvasPresenceEditingMode | null;
    selectedShapeIds: string[];
  }>({
    cursor: null,
    editingMode: null,
    selectedShapeIds: [],
  });
  const pendingCursorRef = useRef<CanvasPresencePoint | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    selectedShapeIdsRef.current = selectedShapeIds;
  }, [selectedShapeIds]);

  useEffect(() => {
    editingModeRef.current = getPresenceEditingMode(currentToolId);
  }, [currentToolId]);

  const flushPresence = useCallback(
    (cursor: CanvasPresencePoint | null) => {
      const nextSelectedShapeIds = selectedShapeIdsRef.current;
      const nextEditingMode = editingModeRef.current;
      const previous = lastSentPayloadRef.current;
      const cursorUnchanged =
        previous.cursor?.x === cursor?.x && previous.cursor?.y === cursor?.y;
      const selectionUnchanged =
        previous.selectedShapeIds.length === nextSelectedShapeIds.length &&
        previous.selectedShapeIds.every(
          (shapeId, index) => shapeId === nextSelectedShapeIds[index],
        );

      if (
        cursorUnchanged &&
        selectionUnchanged &&
        previous.editingMode === nextEditingMode
      ) {
        return;
      }

      const bounds = editor.getViewportPageBounds();
      const camera = editor.getCamera();
      sendPresenceUpdate(
        cursor,
        nextSelectedShapeIds,
        {
          height: bounds.h,
          width: bounds.w,
          x: bounds.x,
          y: bounds.y,
          zoom: camera.z,
        },
        null,
        nextEditingMode,
      );
      lastSentAtRef.current = Date.now();
      lastSentPayloadRef.current = {
        cursor,
        editingMode: nextEditingMode,
        selectedShapeIds: nextSelectedShapeIds,
      };
    },
    [editor, sendPresenceUpdate],
  );

  const schedulePresence = useCallback(
    (cursor: CanvasPresencePoint) => {
      pendingCursorRef.current = cursor;
      const elapsedMs = Date.now() - lastSentAtRef.current;

      if (elapsedMs >= PRESENCE_THROTTLE_MS) {
        if (pendingTimerRef.current) {
          window.clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        flushPresence(cursor);
        return;
      }

      if (pendingTimerRef.current) {
        return;
      }

      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        if (pendingCursorRef.current) {
          flushPresence(pendingCursorRef.current);
        }
      }, PRESENCE_THROTTLE_MS - elapsedMs);
    },
    [flushPresence],
  );

  useEffect(() => {
    if (presence.enabled && presence.joined) {
      flushPresence(lastSentPayloadRef.current.cursor);
    }
  }, [currentToolId, flushPresence, presence.enabled, presence.joined, selectedShapeIds]);

  useEffect(() => {
    if (!presence.enabled) {
      return undefined;
    }

    const container = editor.getContainer();

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.isPrimary === false) {
        return;
      }

      const pagePoint = editor.screenToPage({
        x: event.clientX,
        y: event.clientY,
      });
      schedulePresence({ x: pagePoint.x, y: pagePoint.y });
    }

    container.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      if (pendingTimerRef.current) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingCursorRef.current = null;
    };
  }, [editor, presence.enabled, schedulePresence]);

  return null;
}

export function PrReviewCanvasRealtimeBridge({
  presence,
  readOnly,
}: PrReviewCanvasRealtimeBridgeProps) {
  return (
    <>
      <PrReviewCanvasReadOnlyBridge readOnly={readOnly} />
      {presence.enabled ? (
        <PrReviewCanvasPresenceReporter presence={presence} />
      ) : null}
      <RemoteCursorOverlay
        currentUserId={presence.currentUserId}
        presence={presence.remotePresence}
      />
    </>
  );
}
