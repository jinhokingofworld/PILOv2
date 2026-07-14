"use client";

export type BoardRealtimeRoom = {
  boardId: string;
  workspaceId: string;
};

export type BoardInvalidatedEvent = BoardRealtimeRoom & {
  updatedAt: string;
};

export type BoardSourceRealtimeRoom = {
  workspaceId: string;
};

export type BoardSourceUpdatedEvent = BoardSourceRealtimeRoom & {
  boardId: string;
  changedAt: string;
};

export type BoardRealtimeError = {
  code: string;
  message: string;
  requestId?: string;
};

export type BoardServerToClientEvents = {
  "board:error": (payload: BoardRealtimeError) => void;
  "board:invalidated": (payload: BoardInvalidatedEvent) => void;
  "board:joined": (payload: BoardRealtimeRoom) => void;
  "board:source:joined": (payload: BoardSourceRealtimeRoom) => void;
  "board:source:updated": (payload: BoardSourceUpdatedEvent) => void;
};

export type BoardClientToServerEvents = {
  "board:join": (payload: BoardRealtimeRoom) => void;
  "board:leave": (payload: BoardRealtimeRoom) => void;
  "board:source:join": (payload: BoardSourceRealtimeRoom) => void;
  "board:source:leave": (payload: BoardSourceRealtimeRoom) => void;
};

export type BoardRealtimeConfig = {
  accessToken: string | null | undefined;
  boardId: string;
  reloadBoard: () => void | Promise<unknown>;
  reloadActiveSource?: () => void | Promise<unknown>;
  workspaceId: string;
};
