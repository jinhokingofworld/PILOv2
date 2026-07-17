import type {
  BoardAccessContext,
  BoardAccessService,
} from "../board/board-access.service";
import { createSocketErrorPayload } from "../socket/socket-errors";
import type { WorkspaceMembershipRevocationFence } from "../workspace-membership-revocation/workspace-membership-revocation";
import { pageCursorClientEvents, pageCursorServerEvents } from "./page-cursor-events";
import {
  evictPageCursorSocketFromRooms,
  type PageCursorMembershipSocket,
} from "./page-cursor-membership-revocation";
import {
  readPageCursorRoomRef,
  readPageCursorUpdatePayload,
} from "./page-cursor-payload";
import {
  canJoinPageCursorRoom,
  createPageCursorRoomName,
} from "./page-cursor-room";
import type {
  PageCursorPresenceState,
  PageCursorRoomRef,
} from "./page-cursor-types";

type PageCursorSocket = PageCursorMembershipSocket & {
  data: PageCursorMembershipSocket["data"] & {
    auth?: {
      displayName?: string;
      userId?: unknown;
    };
    pageCursorPresenceByRoom: Record<string, PageCursorPresenceState>;
  };
  emit: (event: string, payload: unknown) => unknown;
  join: (roomName: string) => Promise<unknown> | unknown;
  on: (
    event: string,
    handler: (payload: unknown) => Promise<void> | void,
  ) => unknown;
};

type PageCursorIo = {
  in: (roomName: string) => {
    fetchSockets: () => Promise<
      Array<{
        data: {
          pageCursorPresenceByRoom?: Record<string, unknown>;
        };
      }>
    >;
  };
};

function emitPageCursorError(
  socket: PageCursorSocket,
  code: "forbidden" | "invalid_payload" | "room_not_joined",
  message: string,
) {
  socket.emit(pageCursorServerEvents.error, createSocketErrorPayload(code, message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPageCursorPresenceState(
  value: unknown,
): value is PageCursorPresenceState {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    (value.page === "home" ||
      value.page === "calendar" ||
      value.page === "board") &&
    (value.boardId === undefined || typeof value.boardId === "string") &&
    typeof value.userId === "string" &&
    typeof value.displayName === "string" &&
    isRecord(value.fallback) &&
    typeof value.fallback.xRatio === "number" &&
    typeof value.fallback.yRatio === "number" &&
    (value.target === null || isRecord(value.target)) &&
    (value.targetPoint === null || isRecord(value.targetPoint)) &&
    typeof value.updatedAt === "string"
  );
}

async function getPageCursorRoomSocketPresence(
  io: PageCursorIo,
  room: PageCursorRoomRef,
  roomName: string,
): Promise<PageCursorPresenceState[]> {
  const sockets = await io.in(roomName).fetchSockets();
  const presenceByUserId = new Map<string, PageCursorPresenceState>();

  for (const socket of sockets) {
    const presence = socket.data.pageCursorPresenceByRoom?.[roomName];
    if (!isPageCursorPresenceState(presence)) continue;
    if (
      presence.workspaceId !== room.workspaceId ||
      presence.page !== room.page ||
      (presence.boardId ?? null) !== (room.boardId ?? null)
    ) {
      continue;
    }
    presenceByUserId.set(presence.userId, presence);
  }

  return [...presenceByUserId.values()];
}

export function registerPageCursorSocketHandlers({
  accessService,
  context,
  io,
  membershipRevocationFence,
  socket,
}: {
  accessService: BoardAccessService;
  context: BoardAccessContext & { displayName: string };
  io: PageCursorIo;
  membershipRevocationFence: WorkspaceMembershipRevocationFence;
  socket: PageCursorSocket;
}) {
  socket.on(pageCursorClientEvents.join, async (payload) => {
    const room = readPageCursorRoomRef(payload);
    if (!room) {
      emitPageCursorError(socket, "invalid_payload", "page-cursor:join payload is invalid");
      return;
    }

    const allowed = await canJoinPageCursorRoom({ accessService, context, room });
    if (!allowed || membershipRevocationFence.isRevoked(socket.id, room.workspaceId)) {
      emitPageCursorError(socket, "forbidden", "page cursor room access denied");
      return;
    }

    const roomName = createPageCursorRoomName(room);
    await socket.join(roomName);
    if (membershipRevocationFence.isRevoked(socket.id, room.workspaceId)) {
      await evictPageCursorSocketFromRooms(socket, [roomName]);
      emitPageCursorError(socket, "forbidden", "page cursor room access denied");
      return;
    }

    const presence = await getPageCursorRoomSocketPresence(io, room, roomName);
    if (membershipRevocationFence.isRevoked(socket.id, room.workspaceId)) {
      await evictPageCursorSocketFromRooms(socket, [roomName]);
      emitPageCursorError(socket, "forbidden", "page cursor room access denied");
      return;
    }

    socket.emit(pageCursorServerEvents.joined, { ...room, presence });
  });

  socket.on(pageCursorClientEvents.leave, async (payload) => {
    const room = readPageCursorRoomRef(payload);
    if (!room) {
      emitPageCursorError(socket, "invalid_payload", "page-cursor:leave payload is invalid");
      return;
    }

    const roomName = createPageCursorRoomName(room);
    await socket.leave(roomName);
    delete socket.data.pageCursorPresenceByRoom[roomName];
    socket.to(roomName).emit(pageCursorServerEvents.leave, {
      ...room,
      userId: context.userId ?? socket.id,
    });
  });

  socket.on(pageCursorClientEvents.update, (payload) => {
    const cursorPayload = readPageCursorUpdatePayload(payload);
    if (!cursorPayload) {
      emitPageCursorError(socket, "invalid_payload", "page-cursor:update payload is invalid");
      return;
    }
    if (
      membershipRevocationFence.isRevoked(
        socket.id,
        cursorPayload.workspaceId,
      )
    ) {
      emitPageCursorError(socket, "forbidden", "page cursor room access denied");
      return;
    }

    const roomName = createPageCursorRoomName(cursorPayload);
    if (!socket.rooms.has(roomName)) {
      emitPageCursorError(
        socket,
        "room_not_joined",
        "join page cursor room before sending cursor updates",
      );
      return;
    }

    const presence: PageCursorPresenceState = {
      ...cursorPayload,
      displayName: context.displayName,
      userId: context.userId ?? socket.id,
      updatedAt: new Date().toISOString(),
    };
    socket.data.pageCursorPresenceByRoom[roomName] = presence;
    socket.to(roomName).emit(pageCursorServerEvents.update, presence);
  });
}
