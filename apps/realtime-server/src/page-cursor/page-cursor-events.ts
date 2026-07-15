export const pageCursorClientEvents = {
  join: "page-cursor:join",
  leave: "page-cursor:leave",
  update: "page-cursor:update",
} as const;

export const pageCursorServerEvents = {
  error: "page-cursor:error",
  joined: "page-cursor:joined",
  leave: "page-cursor:leave",
  update: "page-cursor:update",
} as const;
