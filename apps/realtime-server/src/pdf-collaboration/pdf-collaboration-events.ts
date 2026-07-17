export const pdfCollaborationClientEvents = {
  join: "pdf-collaboration:join",
  leave: "pdf-collaboration:leave",
  pageUpdate: "pdf-collaboration:page:update",
  pointerUpdate: "pdf-collaboration:pointer:update",
  strokeCommit: "pdf-collaboration:stroke:commit",
  strokeRemove: "pdf-collaboration:stroke:remove",
  strokesClear: "pdf-collaboration:strokes:clear",
} as const;

export const pdfCollaborationServerEvents = {
  error: "pdf-collaboration:error",
  joined: "pdf-collaboration:joined",
  leave: "pdf-collaboration:leave",
  pageUpdate: "pdf-collaboration:page:update",
  pointerUpdate: "pdf-collaboration:pointer:update",
  strokeCommit: "pdf-collaboration:stroke:commit",
  strokeRemove: "pdf-collaboration:stroke:remove",
  strokesClear: "pdf-collaboration:strokes:clear",
} as const;
