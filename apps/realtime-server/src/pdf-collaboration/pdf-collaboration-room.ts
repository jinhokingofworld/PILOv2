import type { PdfCollaborationRoomRef } from "./pdf-collaboration-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPdfCollaborationRoomName(room: PdfCollaborationRoomRef) {
  return `workspace:${room.workspaceId}:pdf:${room.fileId}`;
}

export function normalizePdfCollaborationRoomRef(
  room: PdfCollaborationRoomRef,
): PdfCollaborationRoomRef | null {
  if (!UUID_PATTERN.test(room.workspaceId) || !UUID_PATTERN.test(room.fileId)) {
    return null;
  }

  return {
    fileId: room.fileId.toLowerCase(),
    workspaceId: room.workspaceId.toLowerCase(),
  };
}
