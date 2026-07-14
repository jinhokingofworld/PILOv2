import type { BoardAccessContext, BoardAccessService } from "./board-access.service";
import { parseBoardSourceRoomRef } from "./board-source-payload.parser";
import type { BoardSourceRoomRef } from "./board-source-types";

export function createBoardSourceRoomName({ workspaceId }: BoardSourceRoomRef) {
  return `workspace:${workspaceId}:boards`;
}

export type BoardSourceRoomService = {
  joinWorkspaceSourceRoom: (context: BoardAccessContext, payload: unknown) => Promise<{ joined: boolean; roomName?: string; payload?: BoardSourceRoomRef }>;
};

export function createBoardSourceRoomService({ accessService }: { accessService: BoardAccessService }): BoardSourceRoomService {
  return {
    async joinWorkspaceSourceRoom(context, payload) {
      const room = parseBoardSourceRoomRef(payload);
      if (!room || !(await accessService.canJoinWorkspace(context, room.workspaceId))) return { joined: false };
      return { joined: true, roomName: createBoardSourceRoomName(room), payload: room };
    }
  };
}
