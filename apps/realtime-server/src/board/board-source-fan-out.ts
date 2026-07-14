import { boardServerEvents } from "./board-socket-events";
import { parseBoardSourceUpdatedPayload } from "./board-source-payload.parser";
import { createBoardSourceRoomName } from "./board-source-room.service";
import type { BoardSourceUpdatedPayload } from "./board-source-types";

export function createBoardSourceFanOut({ emitToRoom }: { emitToRoom: (roomName: string, event: string, payload: BoardSourceUpdatedPayload) => void }) {
  return {
    fanOut(payload: unknown) {
      const sourceEvent = parseBoardSourceUpdatedPayload(payload);
      if (!sourceEvent) return false;
      emitToRoom(createBoardSourceRoomName(sourceEvent), boardServerEvents.sourceUpdated, sourceEvent);
      return true;
    }
  };
}
