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
import {
  createWorkspaceMembershipRevocationFence,
  type WorkspaceMembershipRevocationFence
} from "../workspace-membership-revocation/workspace-membership-revocation";

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

export function emitWorkspacePresenceClearResult(
  io: Server,
  result: WorkspacePresenceClearResult,
) {
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
  membershipRevocationFence = createWorkspaceMembershipRevocationFence(),
  service,
  socket,
}: {
  accessService: WorkspacePresenceAccessService;
  io: Server;
  membershipRevocationFence?: WorkspaceMembershipRevocationFence;
  service: WorkspacePresenceService;
  socket: Socket;
}) {
  const authedSocket = socket as WorkspacePresenceSocket;
  const generationByWorkspace = new Map<string, number>();
  const joinedGenerationByWorkspace = new Map<string, number>();
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
      !membershipRevocationFence.isRevoked(socket.id, workspaceId) &&
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

    await runMembershipOperation(room.workspaceId, async () => {
      if (!isCurrentJoin(room.workspaceId, generation)) return;
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
  });

  socket.on(workspacePresenceClientEvents.leave, async (payload) => {
    const room = readWorkspacePresenceRoomRef(payload);
    if (!room) {
      emitInvalidPayload(socket, workspacePresenceClientEvents.leave);
      return;
    }
    const generation = nextGeneration(room.workspaceId);
    joinedGenerationByWorkspace.delete(room.workspaceId);

    await runMembershipOperation(room.workspaceId, async () => {
      if (generationByWorkspace.get(room.workspaceId) !== generation) return;
      const result = service.leaveSocket(socket.id, room.workspaceId);
      await socket.leave(createWorkspacePresenceRoomName(room.workspaceId));
      if (result) emitWorkspacePresenceClearResult(io, result);
    });
  });

  socket.on(workspacePresenceClientEvents.update, async (payload) => {
    const update = readWorkspacePresenceUpdatePayload(payload);
    if (!update) {
      emitInvalidPayload(socket, workspacePresenceClientEvents.update);
      return;
    }

    if (membershipRevocationFence.isRevoked(socket.id, update.workspaceId)) {
      const result = service.leaveSocket(socket.id, update.workspaceId);
      await socket.leave(createWorkspacePresenceRoomName(update.workspaceId));
      if (result) emitWorkspacePresenceClearResult(io, result);
      socket.emit(
        workspacePresenceServerEvents.error,
        createSocketErrorPayload("forbidden", "workspace presence access denied"),
      );
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
      emitWorkspacePresenceClearResult(io, result);
    }
  });
}
