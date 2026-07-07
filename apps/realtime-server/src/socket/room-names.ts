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
