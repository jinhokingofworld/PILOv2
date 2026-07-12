export const boardClientEvents = {
  join: "board:join",
  leave: "board:leave",
} as const;

export const boardServerEvents = {
  error: "board:error",
  joined: "board:joined",
  invalidated: "board:invalidated",
} as const;
