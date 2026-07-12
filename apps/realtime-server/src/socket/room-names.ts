export type CanvasRoomNameInput = {
  canvasId: string;
  workspaceId: string;
};

export function createCanvasRoomName({
  canvasId,
  workspaceId,
}: CanvasRoomNameInput) {
  return `workspace:${workspaceId}:canvas:${canvasId}`;
}

export function createMeetingRoomName(workspaceId: string) {
  return `workspace:${workspaceId}:meeting`;
}
