"use client";

import type { HTMLAttributes } from "react";

export const PAGE_CURSOR_TARGET_TYPE_ATTR = "data-page-cursor-target-type";
export const PAGE_CURSOR_TARGET_ID_ATTR = "data-page-cursor-target-id";
export const PAGE_CURSOR_TARGET_LABEL_ATTR = "data-page-cursor-target-label";

export function pageCursorTargetAttributes({
  id,
  label,
  type
}: {
  id: string | number;
  label?: string | null;
  type: string;
}): HTMLAttributes<HTMLElement> {
  return {
    [PAGE_CURSOR_TARGET_ID_ATTR]: String(id),
    ...(label ? { [PAGE_CURSOR_TARGET_LABEL_ATTR]: label } : {}),
    [PAGE_CURSOR_TARGET_TYPE_ATTR]: type
  } as HTMLAttributes<HTMLElement>;
}
