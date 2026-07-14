export const boardClientEvents = {
  join: "board:join",
  leave: "board:leave",
  sourceJoin: "board:source:join",
  sourceLeave: "board:source:leave",
} as const;

export const boardServerEvents = {
  error: "board:error",
  joined: "board:joined",
  invalidated: "board:invalidated",
  sourceJoined: "board:source:joined",
  sourceUpdated: "board:source:updated",
} as const;
