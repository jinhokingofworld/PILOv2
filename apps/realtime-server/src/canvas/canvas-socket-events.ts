export const canvasClientEvents = {
  join: "canvas:join",
  leave: "canvas:leave",
  presenceUpdate: "canvas:presence:update",
  shapeLockClaim: "canvas:shape:lock:claim",
  shapeLockRelease: "canvas:shape:lock:release",
  shapeCommit: "canvas:shape:commit",
  shapePreview: "canvas:shape:preview",
  shapePreviewClear: "canvas:shape:preview:clear",
} as const;

export const canvasServerEvents = {
  error: "canvas:error",
  joined: "canvas:joined",
  operation: "canvas:operation",
  presenceLeave: "canvas:presence:leave",
  presenceUpdate: "canvas:presence:update",
  shapeLockAccepted: "canvas:shape:lock:accepted",
  shapeLockRejected: "canvas:shape:lock:rejected",
  shapeLockRelease: "canvas:shape:lock:release",
  shapeLockUpdate: "canvas:shape:lock:update",
  shapePreview: "canvas:shape:preview",
  shapePreviewClear: "canvas:shape:preview:clear",
  syncRequired: "canvas:sync:required",
} as const;
