export const canvasClientEvents = {
  join: "canvas:join",
  leave: "canvas:leave",
  presenceUpdate: "canvas:presence:update",
} as const;

export const canvasServerEvents = {
  error: "canvas:error",
  joined: "canvas:joined",
  operation: "canvas:operation",
  presenceLeave: "canvas:presence:leave",
  presenceUpdate: "canvas:presence:update",
  syncRequired: "canvas:sync:required",
} as const;
