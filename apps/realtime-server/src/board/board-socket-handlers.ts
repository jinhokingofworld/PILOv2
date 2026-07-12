import { createBoardRoomName } from "../socket/board/board-room-names";
import { createSocketErrorPayload } from "../socket/socket-errors";
import type { BoardAccessContext } from "./board-access.service";
import { parseBoardRoomRef } from "./board-payload.parser";
import type { BoardRoomService } from "./board-room.service";
import { boardClientEvents, boardServerEvents } from "./board-socket-events";

export type BoardSocket = {
  emit: (event: string, payload: unknown) => unknown;
  join: (roomName: string) => unknown;
  leave: (roomName: string) => unknown;
  on: (
    event: string,
    handler: (payload: unknown) => void | Promise<void>,
  ) => unknown;
};

export type BoardSocketHandlerOptions = {
  context: BoardAccessContext;
  roomService: BoardRoomService;
  socket: BoardSocket;
};

function emitBoardError(
  socket: BoardSocket,
  code: "forbidden" | "internal_error" | "invalid_payload",
  message: string,
) {
  socket.emit(boardServerEvents.error, createSocketErrorPayload(code, message));
}

export async function handleBoardJoin(
  { context, roomService, socket }: BoardSocketHandlerOptions,
  payload: unknown,
): Promise<void> {
  const joinPayload = parseBoardRoomRef(payload);

  if (!joinPayload) {
    emitBoardError(socket, "invalid_payload", "board:join payload is invalid");
    return;
  }

  try {
    const result = await roomService.joinBoardRoom(context, joinPayload);

    if (!result.joined) {
      emitBoardError(socket, "forbidden", "board room access denied");
      return;
    }

    await socket.join(result.roomName);
    socket.emit(boardServerEvents.joined, result.payload);
  } catch {
    emitBoardError(socket, "internal_error", "board room access failed");
  }
}

async function handleBoardLeave(
  { socket }: BoardSocketHandlerOptions,
  payload: unknown,
): Promise<void> {
  const room = parseBoardRoomRef(payload);

  if (!room) {
    emitBoardError(socket, "invalid_payload", "board:leave payload is invalid");
    return;
  }

  try {
    await socket.leave(createBoardRoomName(room));
  } catch {
    emitBoardError(socket, "internal_error", "board room leave failed");
  }
}

export function registerBoardSocketHandlers(
  options: BoardSocketHandlerOptions,
) {
  options.socket.on(boardClientEvents.join, (payload) =>
    handleBoardJoin(options, payload),
  );
  options.socket.on(boardClientEvents.leave, (payload) =>
    handleBoardLeave(options, payload),
  );
}
