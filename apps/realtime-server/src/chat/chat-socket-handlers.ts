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

  function isCurrentJoin(workspaceId: string, generation: number) {
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
    await socket.leave(createChatRoomName(workspaceId));
    await socket.leave(createChatUserRoomName(workspaceId, userId));
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
    const allowed = await accessService.canJoinWorkspace(
      { userId },
      room.workspaceId,
    );
    if (!isCurrentJoin(room.workspaceId, generation)) return;
    if (!allowed) {
      socket.emit(
        chatServerEvents.error,
        createSocketErrorPayload(
          "forbidden",
          "workspace Chat access denied",
        ),
      );
      return;
    }

    await runMembershipOperation(room.workspaceId, async () => {
      if (!isCurrentJoin(room.workspaceId, generation)) return;

      await socket.join(createChatRoomName(room.workspaceId));
      if (!isCurrentJoin(room.workspaceId, generation)) {
        await leaveChatRooms(room.workspaceId, userId);
        return;
      }

      await socket.join(createChatUserRoomName(room.workspaceId, userId));
      if (!isCurrentJoin(room.workspaceId, generation)) {
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
      if (generationByWorkspace.get(room.workspaceId) !== generation) return;
      await leaveChatRooms(room.workspaceId, userId);
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
