import { createBoardRoomName } from "../socket/board/board-room-names";
import type {
  BoardAccessContext,
  BoardAccessService,
} from "./board-access.service";
import { parseBoardRoomRef } from "./board-payload.parser";
import type { BoardJoinedPayload, BoardJoinPayload } from "./board-types";

export type BoardRoomJoinResult =
  | {
      joined: false;
      reason: "forbidden";
    }
  | {
      joined: true;
      payload: BoardJoinedPayload;
      roomName: string;
    };

export type BoardRoomService = {
  joinBoardRoom: (
    context: BoardAccessContext,
    payload: BoardJoinPayload,
  ) => Promise<BoardRoomJoinResult>;
};

export function createBoardRoomService({
  accessService,
}: {
  accessService: BoardAccessService;
}): BoardRoomService {
  return {
    async joinBoardRoom(context, payload) {
      const room = parseBoardRoomRef(payload);

      if (!room) {
        return { joined: false, reason: "forbidden" };
      }

      const canJoin = await accessService.canJoinBoard(context, room);

      if (!canJoin) {
        return { joined: false, reason: "forbidden" };
      }

      return {
        joined: true,
        payload: {
          boardId: room.boardId,
          workspaceId: room.workspaceId,
        },
        roomName: createBoardRoomName(room),
      };
    },
  };
}
