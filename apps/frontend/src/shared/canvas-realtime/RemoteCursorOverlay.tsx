"use client";

import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor, type Editor, type TLShapeId } from "tldraw";

import type {
  CanvasRemoteCursorEntry,
  CanvasRemoteCursorStore,
} from "./canvas-remote-cursor-store";
import { createCanvasRemoteCursorStore } from "./canvas-remote-cursor-store";
import type { CanvasRemotePresenceState } from "./canvas-realtime-types";

type RemoteCursorOverlayProps = {
  currentUserId: string | null;
  cursorStore?: CanvasRemoteCursorStore;
  presence: CanvasRemotePresenceState[];
};

type CanvasOverlayRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type CanvasScreenPoint = {
  x: number;
  y: number;
};

const REMOTE_CURSOR_INTERPOLATION_MS = 90;

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

function hasSameOverlayRect(
  previousRect: CanvasOverlayRect | null,
  nextRect: CanvasOverlayRect,
) {
  return (
    previousRect?.height === nextRect.height &&
    previousRect.left === nextRect.left &&
    previousRect.top === nextRect.top &&
    previousRect.width === nextRect.width
  );
}

function useCanvasOverlayRect(
  overlayRef: RefObject<HTMLDivElement | null>,
): CanvasOverlayRect | null {
  const [overlayRect, setOverlayRect] = useState<CanvasOverlayRect | null>(null);

  useLayoutEffect(() => {
    const overlayElement = overlayRef.current;

    if (!overlayElement) {
      return undefined;
    }

    const measuredOverlay = overlayElement;

    function updateOverlayRect() {
      const nextBounds = measuredOverlay.getBoundingClientRect();
      const nextRect = {
        height: nextBounds.height,
        left: nextBounds.left,
        top: nextBounds.top,
        width: nextBounds.width,
      };

      setOverlayRect((currentRect) =>
        hasSameOverlayRect(currentRect, nextRect) ? currentRect : nextRect,
      );
    }

    updateOverlayRect();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOverlayRect);

    resizeObserver?.observe(measuredOverlay);
    window.addEventListener("resize", updateOverlayRect);
    window.addEventListener("scroll", updateOverlayRect, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverlayRect);
      window.removeEventListener("scroll", updateOverlayRect, true);
    };
  }, [overlayRef]);

  return overlayRect;
}

function createRemoteSelectionOutlines({
  editor,
  overlayRect,
  presence,
}: {
  editor: Editor;
  overlayRect: CanvasOverlayRect | null;
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

function RemoteSelectionOutlines({
  overlayRect,
  presence,
}: {
  overlayRect: CanvasOverlayRect | null;
  presence: CanvasRemotePresenceState[];
}) {
  const editor = useEditor();
  const selectionOutlines = useValue(
    "pilo-remote-selection-outlines",
    () =>
      createRemoteSelectionOutlines({
        editor,
        overlayRect,
        presence,
      }),
    [editor, overlayRect, presence],
  );

  return selectionOutlines.map((outline) => {
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
  });
}

function setCursorElementPosition(
  element: HTMLDivElement,
  position: CanvasScreenPoint,
) {
  element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
}

function RemoteCursor({
  camera,
  entry,
  overlayRect,
}: {
  camera: ReturnType<Editor["getCamera"]>;
  entry: CanvasRemoteCursorEntry;
  overlayRect: CanvasOverlayRect | null;
}) {
  const editor = useEditor();
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentPositionRef = useRef<CanvasScreenPoint | null>(null);
  const previousPagePointRef = useRef<CanvasScreenPoint | null>(null);

  useLayoutEffect(() => {
    const cursorElement = cursorRef.current;

    if (!cursorElement) {
      return undefined;
    }

    const screenPoint = editor.pageToScreen(entry.cursor);
    const nextPosition = {
      x: overlayRect ? screenPoint.x - overlayRect.left : screenPoint.x,
      y: overlayRect ? screenPoint.y - overlayRect.top : screenPoint.y,
    };
    const previousPagePoint = previousPagePointRef.current;
    const hasCursorPacketMoved =
      previousPagePoint !== null &&
      (previousPagePoint.x !== entry.cursor.x ||
        previousPagePoint.y !== entry.cursor.y);
    const currentPosition = currentPositionRef.current;

    previousPagePointRef.current = entry.cursor;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!currentPosition || !hasCursorPacketMoved) {
      currentPositionRef.current = nextPosition;
      setCursorElementPosition(cursorElement, nextPosition);
      return undefined;
    }

    const animationStartPosition = currentPosition;
    const animatedCursorElement = cursorElement;
    const animationStartedAt = performance.now();

    function animateCursor(now: number) {
      const progress = Math.min(
        1,
        (now - animationStartedAt) / REMOTE_CURSOR_INTERPOLATION_MS,
      );
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const interpolatedPosition = {
        x:
          animationStartPosition.x +
          (nextPosition.x - animationStartPosition.x) * easedProgress,
        y:
          animationStartPosition.y +
          (nextPosition.y - animationStartPosition.y) * easedProgress,
      };

      currentPositionRef.current = interpolatedPosition;
      setCursorElementPosition(animatedCursorElement, interpolatedPosition);

      if (progress < 1) {
        animationFrameRef.current =
          window.requestAnimationFrame(animateCursor);
      } else {
        animationFrameRef.current = null;
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(animateCursor);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    camera.x,
    camera.y,
    camera.z,
    editor,
    entry.cursor,
    overlayRect,
  ]);

  const style = {
    "--canvas-remote-cursor-color": getStableCursorColor(entry.userId),
  } as CSSProperties & {
    "--canvas-remote-cursor-color": string;
  };

  return (
    <div ref={cursorRef} className="canvas-remote-cursor" style={style}>
      <span className="canvas-remote-cursor-pointer" />
      <span className="canvas-remote-cursor-label">
        {entry.displayName || "PILO"}
      </span>
    </div>
  );
}

const MemoizedRemoteCursor = memo(RemoteCursor);

function RemoteCursors({
  currentUserId,
  cursorStore,
  overlayRect,
}: {
  currentUserId: string | null;
  cursorStore: CanvasRemoteCursorStore;
  overlayRect: CanvasOverlayRect | null;
}) {
  const editor = useEditor();
  const camera = useValue(
    "pilo-remote-cursor-camera",
    () => editor.getCamera(),
    [editor],
  );
  const cursorEntries = useSyncExternalStore(
    cursorStore.subscribe,
    cursorStore.getSnapshot,
    cursorStore.getSnapshot,
  );

  return cursorEntries
    .filter((entry) => entry.userId !== currentUserId)
    .map((entry) => (
      <MemoizedRemoteCursor
        key={entry.userId}
        camera={camera}
        entry={entry}
        overlayRect={overlayRect}
      />
    ));
}

export function RemoteCursorOverlay({
  currentUserId,
  cursorStore,
  presence,
}: RemoteCursorOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [fallbackCursorStore] = useState(createCanvasRemoteCursorStore);
  const resolvedCursorStore = cursorStore ?? fallbackCursorStore;
  const overlayRect = useCanvasOverlayRect(overlayRef);
  const visiblePresence = useMemo(
    () =>
      presence.filter(
        (entry) => entry.userId && entry.userId !== currentUserId,
      ),
    [currentUserId, presence],
  );

  useLayoutEffect(() => {
    if (cursorStore) {
      return;
    }

    fallbackCursorStore.replace(presence);
  }, [cursorStore, fallbackCursorStore, presence]);

  return (
    <div ref={overlayRef} className="canvas-remote-cursor-layer">
      <RemoteSelectionOutlines
        overlayRect={overlayRect}
        presence={visiblePresence}
      />
      <RemoteCursors
        currentUserId={currentUserId}
        cursorStore={resolvedCursorStore}
        overlayRect={overlayRect}
      />
    </div>
  );
}
