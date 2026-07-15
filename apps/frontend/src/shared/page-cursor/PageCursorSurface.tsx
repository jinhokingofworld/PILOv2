"use client";

import {
  useMemo,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from "react";

import {
  PAGE_CURSOR_TARGET_ID_ATTR,
  PAGE_CURSOR_TARGET_TYPE_ATTR
} from "./page-cursor-target";
import type { PageCursorPresence, PageCursorRoom } from "./page-cursor-types";
import { usePageCursorRoom } from "./use-page-cursor-room";

type PageCursorSurfaceProps = PageCursorRoom &
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  enabled?: boolean;
};

const cursorColors = [
  "#3158ff",
  "#ef5b68",
  "#2e9e5b",
  "#d9941f",
  "#7c5cff",
  "#0891b2",
  "#be4bdb",
  "#0f766e"
] as const;

function getStableCursorColor(userId: string) {
  let hash = 0;

  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }

  return cursorColors[hash % cursorColors.length];
}

function escapeAttributeValue(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

function getCursorPosition({
  container,
  cursor
}: {
  container: HTMLElement;
  cursor: PageCursorPresence;
}) {
  const containerRect = container.getBoundingClientRect();
  const targetSelector = cursor.target
    ? `[${PAGE_CURSOR_TARGET_TYPE_ATTR}="${escapeAttributeValue(
        cursor.target.type
      )}"][${PAGE_CURSOR_TARGET_ID_ATTR}="${escapeAttributeValue(
        cursor.target.id
      )}"]`
    : null;
  const targetElement = targetSelector
    ? container.querySelector<HTMLElement>(targetSelector)
    : null;

  if (targetElement && cursor.targetPoint) {
    const targetRect = targetElement.getBoundingClientRect();

    return {
      label: cursor.displayName,
      x:
        targetRect.left -
        containerRect.left +
        targetRect.width * cursor.targetPoint.xRatio,
      y:
        targetRect.top -
        containerRect.top +
        targetRect.height * cursor.targetPoint.yRatio
    };
  }

  return {
    label: cursor.displayName,
    x: containerRect.width * cursor.fallback.xRatio,
    y: containerRect.height * cursor.fallback.yRatio
  };
}

function RemotePageCursor({
  container,
  cursor
}: {
  container: HTMLElement;
  cursor: PageCursorPresence;
}) {
  const position = getCursorPosition({ container, cursor });
  const color = getStableCursorColor(cursor.userId);
  const style = {
    "--page-cursor-color": color,
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`
  } as CSSProperties & {
    "--page-cursor-color": string;
  };

  return (
    <div
      className="absolute left-0 top-0 z-40 flex translate-x-0 translate-y-0 items-start gap-1.5 text-xs font-semibold text-white drop-shadow-sm"
      style={style}
    >
      <span
        className="mt-0.5 block size-3 rotate-45 rounded-br-[2px] rounded-tl-[10px] rounded-tr-[10px] border border-white/70"
        style={{ backgroundColor: color }}
      />
      <span
        className="max-w-32 truncate rounded-full px-2 py-1 shadow-sm"
        style={{ backgroundColor: color }}
      >
        {position.label || cursor.displayName || "PILO"}
      </span>
    </div>
  );
}

export function PageCursorSurface({
  boardId,
  children,
  className,
  enabled = true,
  page,
  workspaceId,
  ...surfaceProps
}: PageCursorSurfaceProps) {
  const { containerRef, cursors, layoutVersion } = usePageCursorRoom({
    ...(boardId ? { boardId } : {}),
    enabled,
    page,
    workspaceId
  });
  const container = containerRef.current;

  const visibleCursors = useMemo(
    () => cursors.filter((cursor) => cursor.userId),
    [cursors, layoutVersion]
  );

  return (
    <div {...surfaceProps} ref={containerRef} className={className}>
      {children}
      {container ? (
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
          {visibleCursors.map((cursor) => (
            <RemotePageCursor
              key={cursor.userId}
              container={container}
              cursor={cursor}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
