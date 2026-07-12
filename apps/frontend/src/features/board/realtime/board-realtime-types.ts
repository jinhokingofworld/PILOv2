"use client";

export type BoardRealtimeRoom = {
  boardId: string;
  workspaceId: string;
};

export type BoardInvalidatedEvent = BoardRealtimeRoom & {
  updatedAt: string;
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
};

export type BoardClientToServerEvents = {
  "board:join": (payload: BoardRealtimeRoom) => void;
  "board:leave": (payload: BoardRealtimeRoom) => void;
};

export type BoardRealtimeConfig = {
  accessToken: string | null | undefined;
  boardId: string;
  reloadBoard: () => void | Promise<unknown>;
  workspaceId: string;
};
