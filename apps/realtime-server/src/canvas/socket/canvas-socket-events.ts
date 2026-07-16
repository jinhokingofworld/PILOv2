// Canvas client and server event names.
export const canvasClientEvents = {
  join: "canvas:join",
  leave: "canvas:leave",
  historyRedo: "canvas:room:history:redo",
  historyUndo: "canvas:room:history:undo",
  presenceUpdate: "canvas:presence:update",
  shapePatch: "canvas:room:shape:patch",
  shapePreview: "canvas:shape:preview",
  shapePreviewClear: "canvas:shape:preview:clear",
  viewportLoaded: "canvas:viewport:loaded",
} as const;

export const canvasServerEvents = {
  checkpoint: "canvas:room:checkpoint",
  error: "canvas:error",
  joined: "canvas:joined",
  operation: "canvas:operation",
  presenceLeave: "canvas:presence:leave",
  presenceUpdate: "canvas:presence:update",
  shapePatch: "canvas:room:shape:patch",
  shapePreview: "canvas:shape:preview",
  shapePreviewClear: "canvas:shape:preview:clear",
  shapesHydrate: "canvas:room:shapes:hydrate",
  loadedRegionsUpdate: "canvas:room:loaded-regions:update",
  syncRequired: "canvas:sync:required",
} as const;
