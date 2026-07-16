export type CanvasRoomNameInput = {
  canvasId: string;
  workspaceId: string;
};

export type SqlErdRoomNameInput = {
  sessionId: string;
  workspaceId: string;
};

export type DocumentRoomNameInput = {
  documentId: string;
  workspaceId: string;
};

export function createCanvasRoomName({
  canvasId,
  workspaceId,
}: CanvasRoomNameInput) {
  return `workspace:${workspaceId}:canvas:${canvasId}`;
}

export function createCanvasTldrawSyncRoomName({
  canvasId,
  workspaceId,
}: CanvasRoomNameInput) {
  return `${createCanvasRoomName({ canvasId, workspaceId })}:tldraw-sync`;
}

export function createSqlErdRoomName({
  sessionId,
  workspaceId,
}: SqlErdRoomNameInput) {
  return `workspace:${workspaceId}:sql-erd:${sessionId}`;
}

export function createDocumentYjsRoomName({
  documentId,
  workspaceId,
}: DocumentRoomNameInput) {
  return `workspace:${workspaceId}:document:${documentId}:yjs`;
}

export function createMeetingRoomName(workspaceId: string) {
  return `workspace:${workspaceId}:meeting`;
}
