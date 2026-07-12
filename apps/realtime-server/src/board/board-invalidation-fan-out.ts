import { createBoardRoomName } from "../socket/board/board-room-names";
import { boardServerEvents } from "./board-socket-events";
import { parseBoardInvalidationPayload } from "./board-payload.parser";
import type { BoardInvalidationPayload } from "./board-types";

export type BoardRoomEmitter = {
  emitToRoom: (
    roomName: string,
    event: string,
    payload: BoardInvalidationPayload,
  ) => void;
};

export type BoardInvalidationFanOut = {
  fanOut: (payload: unknown) => boolean;
};

export function createBoardInvalidationFanOut({
  emitToRoom,
}: BoardRoomEmitter): BoardInvalidationFanOut {
  return {
    fanOut(payload) {
      const invalidation = parseBoardInvalidationPayload(payload);

      if (!invalidation) {
        return false;
      }

      emitToRoom(
        createBoardRoomName(invalidation),
        boardServerEvents.invalidated,
        invalidation,
      );

      return true;
    },
  };
}
