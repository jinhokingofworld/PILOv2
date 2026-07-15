import type { Server, Socket } from "socket.io";

import { createSocketErrorPayload } from "../socket/socket-errors";
import type { WorkspacePresenceAccessContext } from "./workspace-presence-access.service";
import {
  workspacePresenceClientEvents,
  workspacePresenceServerEvents,
} from "./workspace-presence-events";
import {
  readWorkspacePresenceRoomRef,
  readWorkspacePresenceUpdatePayload,
} from "./workspace-presence-payload";
import type { WorkspacePresenceService } from "./workspace-presence.service";
import type { WorkspacePresenceClearResult } from "./workspace-presence-types";

type WorkspacePresenceAccessService = {
  canJoinWorkspace: (
    context: WorkspacePresenceAccessContext,
    workspaceId: string,
  ) => Promise<boolean>;
};

type WorkspacePresenceSocket = Socket & {
  data: {
    auth: WorkspacePresenceAccessContext & { displayName: string };
  };
};

export function createWorkspacePresenceRoomName(workspaceId: string) {
  return `workspace:${workspaceId}:presence`;
}

function emitClearResult(io: Server, result: WorkspacePresenceClearResult) {
  if (result.kind === "update") {
    io.to(createWorkspacePresenceRoomName(result.presence.workspaceId)).emit(
      workspacePresenceServerEvents.update,
      result.presence,
    );
    return;
  }

  io.to(createWorkspacePresenceRoomName(result.payload.workspaceId)).emit(
    workspacePresenceServerEvents.leave,
    result.payload,
  );
}

function emitInvalidPayload(socket: Socket, event: string) {
  socket.emit(
    workspacePresenceServerEvents.error,
    createSocketErrorPayload("invalid_payload", `${event} payload is invalid`),
  );
}

export function registerWorkspacePresenceSocketHandlers({
  accessService,
  io,
  service,
  socket,
}: {
  accessService: WorkspacePresenceAccessService;
  io: Server;
  service: WorkspacePresenceService;
  socket: Socket;
}) {
  const authedSocket = socket as WorkspacePresenceSocket;
  const generationByWorkspace = new Map<string, number>();
  const joinedGenerationByWorkspace = new Map<string, number>();
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

  socket.on(workspacePresenceClientEvents.join, async (payload) => {
    const room = readWorkspacePresenceRoomRef(payload);
    if (!room) {
      emitInvalidPayload(socket, workspacePresenceClientEvents.join);
      return;
    }
    const generation = nextGeneration(room.workspaceId);

    const allowed = await accessService.canJoinWorkspace(
      authedSocket.data.auth,
      room.workspaceId,
    );
    if (!isCurrentJoin(room.workspaceId, generation)) return;
    if (!allowed || !authedSocket.data.auth.userId) {
      socket.emit(
        workspacePresenceServerEvents.error,
        createSocketErrorPayload(
          "forbidden",
          "workspace presence access denied",
        ),
      );
      return;
    }

    const roomName = createWorkspacePresenceRoomName(room.workspaceId);
    await socket.join(roomName);
    if (!isCurrentJoin(room.workspaceId, generation)) {
      if (
        joinedGenerationByWorkspace.get(room.workspaceId) !==
        generationByWorkspace.get(room.workspaceId)
      ) {
        await socket.leave(roomName);
      }
      return;
    }
    const presence = service.joinSocket(
      socket.id,
      {
        displayName: authedSocket.data.auth.displayName,
        userId: authedSocket.data.auth.userId,
      },
      room.workspaceId,
    );
    joinedGenerationByWorkspace.set(room.workspaceId, generation);
    socket.emit(workspacePresenceServerEvents.joined, {
      ...room,
      presence: service.getWorkspacePresence(room.workspaceId),
    });
    socket.to(roomName).emit(workspacePresenceServerEvents.update, presence);
  });

  socket.on(workspacePresenceClientEvents.leave, async (payload) => {
    const room = readWorkspacePresenceRoomRef(payload);
    if (!room) {
      emitInvalidPayload(socket, workspacePresenceClientEvents.leave);
      return;
    }
    const generation = nextGeneration(room.workspaceId);
    joinedGenerationByWorkspace.delete(room.workspaceId);

    const result = service.leaveSocket(socket.id, room.workspaceId);
    await socket.leave(createWorkspacePresenceRoomName(room.workspaceId));
    if (result && generationByWorkspace.get(room.workspaceId) === generation) {
      emitClearResult(io, result);
    }
  });

  socket.on(workspacePresenceClientEvents.update, (payload) => {
    const update = readWorkspacePresenceUpdatePayload(payload);
    if (!update) {
      emitInvalidPayload(socket, workspacePresenceClientEvents.update);
      return;
    }

    const presence = service.updateSocket(socket.id, update);
    if (!presence) {
      socket.emit(
        workspacePresenceServerEvents.error,
        createSocketErrorPayload(
          "room_not_joined",
          "join workspace presence before updating location",
        ),
      );
      return;
    }

    io.to(createWorkspacePresenceRoomName(update.workspaceId)).emit(
      workspacePresenceServerEvents.update,
      presence,
    );
  });

  socket.on("disconnect", () => {
    disconnected = true;
    joinedGenerationByWorkspace.clear();
    for (const result of service.clearSocket(socket.id)) {
      emitClearResult(io, result);
    }
  });
}
