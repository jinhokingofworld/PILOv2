import type { SqlErdRoomRef } from "./sql-erd-types";

export function canEmitSqlErdJoined({
  isRoomJoined,
  room,
  roomName,
  roomsByName,
  revokedWorkspaceIds,
}: {
  isRoomJoined: boolean;
  room: SqlErdRoomRef;
  roomName: string;
  roomsByName: Map<string, SqlErdRoomRef>;
  revokedWorkspaceIds: Set<string>;
}): boolean {
  return (
    isRoomJoined &&
    roomsByName.get(roomName) === room &&
    !revokedWorkspaceIds.has(room.workspaceId)
  );
}
