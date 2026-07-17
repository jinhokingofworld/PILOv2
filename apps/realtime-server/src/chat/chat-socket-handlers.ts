import type { Socket } from "socket.io";

import { createSocketErrorPayload } from "../socket/socket-errors";
import type { ChatAccessContext } from "./chat-access.service";
import { chatClientEvents, chatServerEvents } from "./chat-events";
import { readChatRoomRef } from "./chat-payload";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "./chat-room.service";

type ChatAccessService = {
  canJoinWorkspace: (
    context: ChatAccessContext,
    workspaceId: string,
  ) => Promise<boolean>;
};

type ChatSocket = Socket & {
  data: {
    auth: ChatAccessContext;
  };
};

function emitInvalidPayload(socket: Socket, event: string) {
  socket.emit(
    chatServerEvents.error,
    createSocketErrorPayload("invalid_payload", `${event} payload is invalid`),
  );
}

function emitUnauthenticated(socket: Socket) {
  socket.emit(
    chatServerEvents.error,
    createSocketErrorPayload(
      "unauthenticated",
      "authenticated Chat user is required",
    ),
  );
}

function emitInternalError(socket: Socket) {
  socket.emit(
    chatServerEvents.error,
    createSocketErrorPayload(
      "internal_error",
      "workspace Chat operation failed",
    ),
  );
}

export function registerChatSocketHandlers({
  accessService,
  socket,
}: {
  accessService: ChatAccessService;
  socket: Socket;
}) {
  const authedSocket = socket as ChatSocket;
  const generationByWorkspace = new Map<string, number>();
  const membershipOperationByWorkspace = new Map<string, Promise<unknown>>();
  let disconnected = false;

  function nextGeneration(workspaceId: string) {
    const generation = (generationByWorkspace.get(workspaceId) ?? 0) + 1;
    generationByWorkspace.set(workspaceId, generation);
    return generation;
  }

  function isCurrentOperation(workspaceId: string, generation: number) {
    return (
      !disconnected &&
      socket.connected &&
      generationByWorkspace.get(workspaceId) === generation
    );
  }

  function runMembershipOperation<T>(
    workspaceId: string,
    operation: () => Promise<T>,
  ) {
    const previous = membershipOperationByWorkspace.get(workspaceId);
    const current = previous
      ? previous.catch(() => undefined).then(operation)
      : operation();
    membershipOperationByWorkspace.set(workspaceId, current);
    void current
      .finally(() => {
        if (membershipOperationByWorkspace.get(workspaceId) === current) {
          membershipOperationByWorkspace.delete(workspaceId);
        }
      })
      .catch(() => undefined);
    return current;
  }

  async function leaveChatRooms(workspaceId: string, userId: string) {
    const leaveRoom = async (roomName: string) => {
      await socket.leave(roomName);
    };
    const results = await Promise.allSettled([
      leaveRoom(createChatRoomName(workspaceId)),
      leaveRoom(createChatUserRoomName(workspaceId, userId)),
    ]);
    return results.every((result) => result.status === "fulfilled");
  }

  async function handleCurrentOperationFailure(
    workspaceId: string,
    userId: string,
    generation: number,
  ) {
    await runMembershipOperation(workspaceId, async () => {
      if (!isCurrentOperation(workspaceId, generation)) return;
      await leaveChatRooms(workspaceId, userId);
      if (!isCurrentOperation(workspaceId, generation)) return;
      emitInternalError(socket);
    });
  }

  socket.on(chatClientEvents.join, async (payload) => {
    const room = readChatRoomRef(payload);
    if (!room) {
      emitInvalidPayload(socket, chatClientEvents.join);
      return;
    }

    const userId = authedSocket.data.auth.userId;
    if (!userId) {
      emitUnauthenticated(socket);
      return;
    }

    const generation = nextGeneration(room.workspaceId);
    let allowed: boolean;
    try {
      allowed = await accessService.canJoinWorkspace(
        { userId },
        room.workspaceId,
      );
    } catch {
      await handleCurrentOperationFailure(
        room.workspaceId,
        userId,
        generation,
      );
      return;
    }
    if (!isCurrentOperation(room.workspaceId, generation)) return;
    if (!allowed) {
      await runMembershipOperation(room.workspaceId, async () => {
        if (!isCurrentOperation(room.workspaceId, generation)) return;
        const cleanupSucceeded = await leaveChatRooms(
          room.workspaceId,
          userId,
        );
        if (!isCurrentOperation(room.workspaceId, generation)) return;
        if (!cleanupSucceeded) {
          emitInternalError(socket);
          socket.disconnect(true);
          return;
        }
        socket.emit(
          chatServerEvents.error,
          createSocketErrorPayload(
            "forbidden",
            "workspace Chat access denied",
          ),
        );
      });
      return;
    }

    await runMembershipOperation(room.workspaceId, async () => {
      if (!isCurrentOperation(room.workspaceId, generation)) return;

      try {
        await socket.join(createChatRoomName(room.workspaceId));
        if (!isCurrentOperation(room.workspaceId, generation)) {
          await leaveChatRooms(room.workspaceId, userId);
          return;
        }

        await socket.join(createChatUserRoomName(room.workspaceId, userId));
      } catch {
        await leaveChatRooms(room.workspaceId, userId);
        if (isCurrentOperation(room.workspaceId, generation)) {
          emitInternalError(socket);
        }
        return;
      }

      if (!isCurrentOperation(room.workspaceId, generation)) {
        await leaveChatRooms(room.workspaceId, userId);
        return;
      }

      socket.emit(chatServerEvents.joined, room);
    });
  });

  socket.on(chatClientEvents.leave, async (payload) => {
    const room = readChatRoomRef(payload);
    if (!room) {
      emitInvalidPayload(socket, chatClientEvents.leave);
      return;
    }

    const userId = authedSocket.data.auth.userId;
    if (!userId) {
      emitUnauthenticated(socket);
      return;
    }

    const generation = nextGeneration(room.workspaceId);
    await runMembershipOperation(room.workspaceId, async () => {
      if (!isCurrentOperation(room.workspaceId, generation)) return;
      const cleanupSucceeded = await leaveChatRooms(
        room.workspaceId,
        userId,
      );
      if (
        !cleanupSucceeded &&
        isCurrentOperation(room.workspaceId, generation)
      ) {
        emitInternalError(socket);
      }
    });
  });

  socket.on("disconnect", async () => {
    disconnected = true;
    const userId = authedSocket.data.auth.userId;
    if (!userId) return;

    const workspaceIds = [...generationByWorkspace.keys()];
    for (const workspaceId of workspaceIds) {
      nextGeneration(workspaceId);
    }
    await Promise.all(
      workspaceIds.map((workspaceId) =>
        runMembershipOperation(workspaceId, () =>
          leaveChatRooms(workspaceId, userId),
        ),
      ),
    );
  });
}
