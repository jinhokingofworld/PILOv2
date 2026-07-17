import { createBoardRoomName } from "../socket/board/board-room-names";
import { createSocketErrorPayload } from "../socket/socket-errors";
import type { BoardAccessContext } from "./board-access.service";
import { parseBoardRoomRef } from "./board-payload.parser";
import type { BoardRoomService } from "./board-room.service";
import { boardClientEvents, boardServerEvents } from "./board-socket-events";
import type { WorkspaceMembershipRevocationFence } from "../workspace-membership-revocation/workspace-membership-revocation";
import {
  evictBoardSocketFromRooms,
  type BoardMembershipSocket,
} from "./board-membership-revocation";

export type BoardSocket = BoardMembershipSocket & {
  emit: (event: string, payload: unknown) => unknown;
  join: (roomName: string) => unknown;
  on: (
    event: string,
    handler: (payload: unknown) => void | Promise<void>,
  ) => unknown;
};

export type BoardSocketHandlerOptions = {
  context: BoardAccessContext;
  membershipRevocationFence: WorkspaceMembershipRevocationFence;
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
  {
    context,
    membershipRevocationFence,
    roomService,
    socket,
  }: BoardSocketHandlerOptions,
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

    if (membershipRevocationFence.isRevoked(socket.id, result.payload.workspaceId)) {
      emitBoardError(socket, "forbidden", "board room access denied");
      return;
    }

    await socket.join(result.roomName);
    if (membershipRevocationFence.isRevoked(socket.id, result.payload.workspaceId)) {
      await evictBoardSocketFromRooms(socket, [result.roomName]);
      emitBoardError(socket, "forbidden", "board room access denied");
      return;
    }
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
