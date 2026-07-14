import { createSocketErrorPayload } from "../socket/socket-errors";
import type { BoardAccessContext } from "./board-access.service";
import type { BoardSourceRoomService } from "./board-source-room.service";
import { parseBoardSourceRoomRef } from "./board-source-payload.parser";
import { createBoardSourceRoomName } from "./board-source-room.service";
import { boardClientEvents, boardServerEvents } from "./board-socket-events";
import type { BoardSocket } from "./board-socket-handlers";

export function registerBoardSourceSocketHandlers({ context, roomService, socket }: { context: BoardAccessContext; roomService: BoardSourceRoomService; socket: BoardSocket }) {
  socket.on(boardClientEvents.sourceJoin, async (payload) => {
    try {
      const result = await roomService.joinWorkspaceSourceRoom(context, payload);
      if (!result.joined || !result.roomName || !result.payload) {
        socket.emit(boardServerEvents.error, createSocketErrorPayload("forbidden", "board source room access denied"));
        return;
      }
      await socket.join(result.roomName);
      socket.emit(boardServerEvents.sourceJoined, result.payload);
    } catch {
      socket.emit(boardServerEvents.error, createSocketErrorPayload("internal_error", "board source room access failed"));
    }
  });
  socket.on(boardClientEvents.sourceLeave, async (payload) => {
    const room = parseBoardSourceRoomRef(payload);
    if (!room) {
      socket.emit(boardServerEvents.error, createSocketErrorPayload("invalid_payload", "board:source:leave payload is invalid"));
      return;
    }
    try {
      await socket.leave(createBoardSourceRoomName(room));
    } catch {
      socket.emit(boardServerEvents.error, createSocketErrorPayload("internal_error", "board source room leave failed"));
    }
  });
}
