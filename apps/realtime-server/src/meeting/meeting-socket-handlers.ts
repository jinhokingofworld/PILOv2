import { createMeetingRoomName } from "../socket/room-names";
import { createSocketErrorPayload } from "../socket/socket-errors";
import type { MeetingAccessContext } from "./meeting-access.service";
import {
  createWorkspaceMembershipRevocationFence,
  type WorkspaceMembershipRevocationFence
} from "../workspace-membership-revocation/workspace-membership-revocation";
import { meetingClientEvents, meetingServerEvents } from "./meeting-socket-events";

type MeetingAccessService = {
  canJoinWorkspace: (
    context: MeetingAccessContext,
    workspaceId: string
  ) => Promise<boolean>;
};

type MeetingSocket = {
  data: {
    auth: {
      userId: string;
    };
  };
  id: string;
  emit: (event: string, payload: unknown) => unknown;
  join: (roomName: string) => Promise<unknown> | unknown;
  leave: (roomName: string) => Promise<unknown> | unknown;
  on: (event: string, handler: (payload: unknown) => Promise<void> | void) => unknown;
};

function readWorkspaceId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const workspaceId = (payload as { workspaceId?: unknown }).workspaceId;
  return typeof workspaceId === "string" && workspaceId.trim()
    ? workspaceId.trim()
    : null;
}

function emitMeetingError(socket: MeetingSocket, message: string): void {
  socket.emit(
    meetingServerEvents.error,
    createSocketErrorPayload("invalid_payload", message)
  );
}

function emitForbidden(socket: MeetingSocket): void {
  socket.emit(
    meetingServerEvents.error,
    createSocketErrorPayload("forbidden", "meeting room access denied")
  );
}

export function registerMeetingSocketHandlers({
  accessService,
  membershipRevocationFence = createWorkspaceMembershipRevocationFence(),
  socket
}: {
  accessService: MeetingAccessService;
  membershipRevocationFence?: WorkspaceMembershipRevocationFence;
  socket: MeetingSocket;
}): void {
  socket.on(meetingClientEvents.subscribe, async payload => {
    const workspaceId = readWorkspaceId(payload);
    if (!workspaceId) {
      emitMeetingError(socket, "meeting:subscribe payload is invalid");
      return;
    }

    const allowed = await accessService.canJoinWorkspace(
      { userId: socket.data.auth.userId },
      workspaceId
    );
    if (!allowed || membershipRevocationFence.isRevoked(socket.id, workspaceId)) {
      emitForbidden(socket);
      return;
    }

    const roomName = createMeetingRoomName(workspaceId);
    await socket.join(roomName);
    if (membershipRevocationFence.isRevoked(socket.id, workspaceId)) {
      await socket.leave(roomName);
      emitForbidden(socket);
      return;
    }
    socket.emit(meetingServerEvents.subscribed, { workspaceId });
  });

  socket.on(meetingClientEvents.unsubscribe, async payload => {
    const workspaceId = readWorkspaceId(payload);
    if (!workspaceId) {
      emitMeetingError(socket, "meeting:unsubscribe payload is invalid");
      return;
    }
    await socket.leave(createMeetingRoomName(workspaceId));
  });
}
