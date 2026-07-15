export type PageCursorPage = "board" | "calendar" | "home";

export type PageCursorRoomRef = {
  boardId?: string;
  page: PageCursorPage;
  workspaceId: string;
};

export type PageCursorPointRatio = {
  xRatio: number;
  yRatio: number;
};

export type PageCursorTargetRef = {
  id: string;
  label?: string | null;
  type: string;
};

export type PageCursorUpdatePayload = PageCursorRoomRef & {
  fallback: PageCursorPointRatio;
  sentAt?: string;
  target: PageCursorTargetRef | null;
  targetPoint: PageCursorPointRatio | null;
};

export type PageCursorPresenceState = PageCursorUpdatePayload & {
  displayName: string;
  updatedAt: string;
  userId: string;
};

export type PageCursorJoinedPayload = PageCursorRoomRef & {
  presence: PageCursorPresenceState[];
};
