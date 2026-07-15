"use client";

export type PageCursorPage = "board" | "calendar" | "home";

export type PageCursorRoom = {
  boardId?: string;
  page: PageCursorPage;
  workspaceId: string;
};

export type PageCursorPointRatio = {
  xRatio: number;
  yRatio: number;
};

export type PageCursorTarget = {
  id: string;
  label?: string | null;
  type: string;
};

export type PageCursorPayload = PageCursorRoom & {
  fallback: PageCursorPointRatio;
  sentAt?: string;
  target: PageCursorTarget | null;
  targetPoint: PageCursorPointRatio | null;
};

export type PageCursorPresence = PageCursorPayload & {
  displayName: string;
  updatedAt: string;
  userId: string;
};

export type PageCursorJoinedPayload = PageCursorRoom & {
  presence: PageCursorPresence[];
};

export type PageCursorLeavePayload = PageCursorRoom & {
  userId: string;
};
