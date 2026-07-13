import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

import type { RealtimeServerConfig } from "../config/realtime-config";
import { createRealtimeSessionService } from "../auth/session.service";
import { createBoardAccessService } from "../board/board-access.service";
import { createBoardInvalidationFanOut } from "../board/board-invalidation-fan-out";
import { createBoardRoomService } from "../board/board-room.service";
import { registerBoardSocketHandlers } from "../board/board-socket-handlers";
import { canvasClientEvents, canvasServerEvents } from "../canvas/canvas-socket-events";
import {
  createCanvasAccessService,
  type CanvasAccessContext,
  type CanvasRoomAccess,
} from "../canvas/canvas-access.service";
import { createCanvasPresenceService } from "../canvas/canvas-presence.service";
import { createCanvasRoomService } from "../canvas/canvas-room.service";
import { createCanvasShapeLockService } from "../canvas/canvas-shape-lock.service";
import { createMeetingAccessService } from "../meeting/meeting-access.service";
import {
  isMeetingReportRedisEvent,
  meetingClientEvents,
  meetingServerEvents
} from "../meeting/meeting-socket-events";
import type {
  CanvasJoinPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceUpdatePayload,
  CanvasRoomRef,
  CanvasShapeLockClaimPayload,
  CanvasShapeLockReleasePayload,
  CanvasShapeOperationPayload,
  CanvasShapePreviewClearRequestPayload,
  CanvasShapePreviewPayload,
} from "../canvas/canvas-types";
import { createRealtimeDatabase } from "../database/database";
import { createSocketIoRedisAdapter } from "../redis/redis-pubsub";
import { createCanvasRoomName, createMeetingRoomName } from "./room-names";
import { createSocketAuthContext } from "./socket-auth";
import { createSocketErrorPayload } from "./socket-errors";

export type RealtimeSocketServerHandle = {
  close: () => Promise<void>;
};

export type RealtimeSocketServerOptions = {
  config: RealtimeServerConfig;
  httpServer: HttpServer;
};

type AuthedSocket = Socket & {
  data: {
    auth: CanvasAccessContext & {
      displayName?: string;
    };
    canvasRoomAccess: Map<string, CanvasRoomAccess>;
  };
};

const CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations";
const MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events";
const BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value !== "string") return null;
  if (!value.trim()) return null;

  return value;
}

function readRoomRef(payload: unknown): CanvasRoomRef | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const canvasId = readRequiredString(payload, "canvasId");

  if (!workspaceId || !canvasId) return null;

  return { canvasId, workspaceId };
}

function isCanvasPresencePoint(value: unknown): value is CanvasPresencePoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

function isCanvasPresenceViewport(
  value: unknown,
): value is CanvasPresenceUpdatePayload["viewport"] {
  return (
    isRecord(value) &&
    typeof value.height === "number" &&
    typeof value.width === "number" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.height) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.zoom)
  );
}

function isCanvasPresenceEditingMode(
  value: unknown,
): value is CanvasPresenceEditingMode {
  return (
    value === "code" ||
    value === "draw" ||
    value === "hand" ||
    value === "move" ||
    value === "placement" ||
    value === "resize" ||
    value === "select" ||
    value === "text"
  );
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCanvasShapeOperationPayload(
  value: unknown,
): value is CanvasShapeOperationPayload {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.canvasId === "string" &&
    typeof value.shapeId === "string" &&
    typeof value.actorUserId === "string" &&
    typeof value.clientOperationId === "string" &&
    typeof value.contentHash === "string" &&
    isIsoDateString(value.createdAt) &&
    (value.operationType === "create" ||
      value.operationType === "update" ||
      value.operationType === "delete") &&
    typeof value.opSeq === "number" &&
    Number.isInteger(value.opSeq) &&
    value.opSeq > 0 &&
    (value.baseRevision === null ||
      (typeof value.baseRevision === "number" &&
        Number.isInteger(value.baseRevision) &&
        value.baseRevision > 0)) &&
    typeof value.resultRevision === "number" &&
    Number.isInteger(value.resultRevision) &&
    value.resultRevision > 0 &&
    isRecord(value.payload)
  );
}

function readJoinPayload(payload: unknown): CanvasJoinPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const lastSeenOpSeq = payload.lastSeenOpSeq;

  return {
    ...room,
    ...(typeof lastSeenOpSeq === "number" &&
    Number.isInteger(lastSeenOpSeq) &&
    lastSeenOpSeq >= 0
      ? { lastSeenOpSeq }
      : {}),
  };
}

function readPresenceUpdatePayload(
  payload: unknown,
): CanvasPresenceUpdatePayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const cursor = payload.cursor;
  const selectedShapeIds = payload.selectedShapeIds;
  const editingShapeId = payload.editingShapeId;
  const editingMode = payload.editingMode;
  const sentAt = payload.sentAt;
  const viewport = payload.viewport;
  const validCursor = cursor === null || isCanvasPresencePoint(cursor);

  if (!validCursor) return null;
  if (
    editingShapeId !== undefined &&
    editingShapeId !== null &&
    typeof editingShapeId !== "string"
  ) {
    return null;
  }
  if (
    editingMode !== undefined &&
    editingMode !== null &&
    !isCanvasPresenceEditingMode(editingMode)
  ) {
    return null;
  }
  if (sentAt !== undefined && !isIsoDateString(sentAt)) return null;
  if (viewport !== undefined && !isCanvasPresenceViewport(viewport)) return null;
  if (
    !Array.isArray(selectedShapeIds) ||
    !selectedShapeIds.every((shapeId) => typeof shapeId === "string")
  ) {
    return null;
  }

  return {
    ...room,
    cursor,
    editingMode: editingMode ?? null,
    editingShapeId:
      typeof editingShapeId === "string" && editingShapeId
        ? editingShapeId
        : null,
    selectedShapeIds,
    ...(sentAt ? { sentAt } : {}),
    ...(viewport ? { viewport } : {}),
  };
}

function readShapeIds(payload: Record<string, unknown>): string[] | null {
  const shapeIds = payload.shapeIds;

  if (
    !Array.isArray(shapeIds) ||
    !shapeIds.every((shapeId) => typeof shapeId === "string")
  ) {
    return null;
  }

  return Array.from(
    new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
  );
}

function readShapeLockClaimPayload(
  payload: unknown,
): CanvasShapeLockClaimPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapeIds = readShapeIds(payload);

  if (!shapeIds?.length) return null;

  return {
    ...room,
    shapeIds,
  };
}

function readShapeLockReleasePayload(
  payload: unknown,
): CanvasShapeLockReleasePayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapeIds =
    payload.shapeIds === undefined ? undefined : readShapeIds(payload);

  if (payload.shapeIds !== undefined && !shapeIds) return null;

  return {
    ...room,
    ...(shapeIds ? { shapeIds } : {}),
  };
}

function isShapePreviewPhase(
  value: unknown,
): value is CanvasShapePreviewPayload["phase"] {
  return value === "move" || value === "resize" || value === "unknown";
}

function readShapePreviewPayload(
  payload: unknown,
): CanvasShapePreviewPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapes = payload.shapes;

  if (!Array.isArray(shapes) || !shapes.every(isRecord)) return null;

  return {
    ...room,
    phase: isShapePreviewPhase(payload.phase) ? payload.phase : "unknown",
    shapes,
  };
}

function readShapePreviewClearPayload(
  payload: unknown,
): CanvasShapePreviewClearRequestPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapeIds = readShapeIds(payload);

  if (!shapeIds?.length) return null;

  return {
    ...room,
    shapeIds,
  };
}

function emitCanvasError(socket: Socket, message: string) {
  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
}

function assertCanvasRoomWritable(
  socket: AuthedSocket,
  roomName: string,
): boolean {
  const access = socket.data.canvasRoomAccess.get(roomName);

  if (access && !access.readOnly) {
    return true;
  }

  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("forbidden", "canvas room is read-only"),
  );
  return false;
}

function readMeetingWorkspaceId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return readRequiredString(payload, "workspaceId");
}

function emitMeetingError(socket: Socket, message: string) {
  socket.emit(meetingServerEvents.error, createSocketErrorPayload("invalid_payload", message));
}

export async function createRealtimeSocketServer({
  config,
  httpServer,
}: RealtimeSocketServerOptions): Promise<RealtimeSocketServerHandle> {
  const io = new Server(httpServer, {
    cors: {
      credentials: true,
      origin: config.corsOrigin,
    },
    path: "/socket.io",
  });
  const redisAdapter = config.redisUrl
    ? await createSocketIoRedisAdapter(config.redisUrl)
    : null;
  const database = createRealtimeDatabase({
    databaseSsl: config.databaseSsl,
    databaseUrl: config.databaseUrl,
  });

  if (redisAdapter) {
    io.adapter(redisAdapter.adapter);
  }

  const sessionService = createRealtimeSessionService(database);
  const accessService = createCanvasAccessService(database);
  const boardAccessService = createBoardAccessService(database);
  const presenceService = createCanvasPresenceService();
  const shapeLockService = createCanvasShapeLockService();
  const roomService = createCanvasRoomService({
    accessService,
    presenceService,
  });
  const meetingAccessService = createMeetingAccessService(database);
  const boardRoomService = createBoardRoomService({
    accessService: boardAccessService,
  });
  const boardInvalidationFanOut = createBoardInvalidationFanOut({
    emitToRoom(roomName, event, payload) {
      io.to(roomName).emit(event, payload);
    },
  });
  const unsubscribeCanvasOperations = redisAdapter
    ? await redisAdapter.subscribe(CANVAS_OPERATION_REDIS_CHANNEL, (payload) => {
        if (!isCanvasShapeOperationPayload(payload)) {
          console.error("Canvas operation Redis payload is invalid", payload);
          return;
        }

        io.to(createCanvasRoomName(payload)).emit(
          canvasServerEvents.operation,
          payload,
        );
      })
    : null;
  const unsubscribeMeetingReports = redisAdapter
    ? await redisAdapter.subscribe(MEETING_REPORT_REDIS_CHANNEL, payload => {
        if (!isMeetingReportRedisEvent(payload)) {
          console.error("MeetingReport Redis payload is invalid", payload);
          return;
        }

        const { workspaceId, ...event } = payload;
        io.to(createMeetingRoomName(workspaceId)).emit(meetingServerEvents.reportUpdated, event);
      })
    : null;
  const unsubscribeBoardInvalidations = redisAdapter
    ? await redisAdapter.subscribe(BOARD_INVALIDATION_REDIS_CHANNEL, (payload) => {
        if (!boardInvalidationFanOut.fanOut(payload)) {
          console.error("Board invalidation Redis payload is invalid");
        }
      })
    : null;

  io.use((socket, next) => {
    const authContext = createSocketAuthContext(
      socket.handshake.headers,
      socket.handshake.auth,
    );

    if (!authContext) {
      next(new Error("unauthenticated"));
      return;
    }

    void sessionService
      .validateSessionToken(authContext.token)
      .then((session) => {
        if (!session) {
          next(new Error("unauthenticated"));
          return;
        }

        (socket as AuthedSocket).data.auth = {
          ...authContext,
          userId: session.userId,
        };
        (socket as AuthedSocket).data.canvasRoomAccess = new Map();
        next();
      })
      .catch(next);
  });

  io.on("connection", (socket) => {
    const authedSocket = socket as AuthedSocket;

    socket.on(canvasClientEvents.join, async (payload) => {
      const joinPayload = readJoinPayload(payload);

      if (!joinPayload) {
        emitCanvasError(socket, "canvas:join payload is invalid");
        return;
      }

      const result = await roomService.joinCanvasRoom(
        authedSocket.data.auth,
        joinPayload,
      );

      if (!result.joined) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload("forbidden", "canvas room access denied"),
        );
        return;
      }

      await socket.join(result.roomName);
      authedSocket.data.canvasRoomAccess.set(result.roomName, result.access);
      socket.emit(canvasServerEvents.joined, result.payload);
    });

    socket.on(meetingClientEvents.subscribe, async payload => {
      const workspaceId = readMeetingWorkspaceId(payload);
      if (!workspaceId) {
        emitMeetingError(socket, "meeting:subscribe payload is invalid");
        return;
      }

      const allowed = await meetingAccessService.canJoinWorkspace(
        { userId: authedSocket.data.auth.userId },
        workspaceId
      );
      if (!allowed) {
        socket.emit(
          meetingServerEvents.error,
          createSocketErrorPayload("forbidden", "meeting room access denied")
        );
        return;
      }

      await socket.join(createMeetingRoomName(workspaceId));
      socket.emit(meetingServerEvents.subscribed, { workspaceId });
    });

    socket.on(meetingClientEvents.unsubscribe, async payload => {
      const workspaceId = readMeetingWorkspaceId(payload);
      if (!workspaceId) {
        emitMeetingError(socket, "meeting:unsubscribe payload is invalid");
        return;
      }
      await socket.leave(createMeetingRoomName(workspaceId));
    });

    socket.on(canvasClientEvents.leave, async (payload) => {
      const room = readRoomRef(payload);

      if (!room) {
        emitCanvasError(socket, "canvas:leave payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(room);
      const leavePayload = presenceService.clearRoomPresence(socket.id, room);
      const lockReleasePayload = shapeLockService.clearRoomLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        room,
      );

      await socket.leave(roomName);
      authedSocket.data.canvasRoomAccess.delete(roomName);

      if (leavePayload) {
        socket.to(roomName).emit(canvasServerEvents.presenceLeave, leavePayload);
      }

      if (lockReleasePayload) {
        socket
          .to(roomName)
          .emit(canvasServerEvents.shapeLockRelease, lockReleasePayload);
        socket.to(roomName).emit(canvasServerEvents.shapePreviewClear, {
          canvasId: room.canvasId,
          actorUserId: lockReleasePayload.ownerUserId,
          shapeIds: lockReleasePayload.shapeIds,
          workspaceId: room.workspaceId,
        });
      }
    });

    registerBoardSocketHandlers({
      context: authedSocket.data.auth,
      roomService: boardRoomService,
      socket,
    });

    socket.on(canvasClientEvents.presenceUpdate, (payload) => {
      const presencePayload = readPresenceUpdatePayload(payload);

      if (!presencePayload) {
        emitCanvasError(socket, "canvas:presence:update payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(presencePayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before sending presence",
          ),
        );
        return;
      }

      const presence = presenceService.updatePresence(
        socket.id,
        {
          displayName: authedSocket.data.auth.displayName,
          userId: authedSocket.data.auth.userId ?? socket.id,
        },
        presencePayload,
      );

      socket.to(roomName).emit(canvasServerEvents.presenceUpdate, presence);
    });

    socket.on(canvasClientEvents.shapeLockClaim, (payload) => {
      const claimPayload = readShapeLockClaimPayload(payload);

      if (!claimPayload) {
        emitCanvasError(socket, "canvas:shape:lock:claim payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(claimPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before claiming shape locks",
          ),
        );
        return;
      }

      if (!assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }

      const result = shapeLockService.claimLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        claimPayload,
        claimPayload.shapeIds,
      );

      if (result.accepted.locks.length) {
        socket.emit(canvasServerEvents.shapeLockAccepted, result.accepted);
        socket
          .to(roomName)
          .emit(canvasServerEvents.shapeLockUpdate, result.accepted);
      }

      if (result.rejected.shapeIds.length) {
        socket.emit(canvasServerEvents.shapeLockRejected, result.rejected);
      }
    });

    socket.on(canvasClientEvents.shapeLockRelease, (payload) => {
      const releasePayload = readShapeLockReleasePayload(payload);

      if (!releasePayload) {
        emitCanvasError(socket, "canvas:shape:lock:release payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(releasePayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before releasing shape locks",
          ),
        );
        return;
      }

      if (!assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }

      const lockReleasePayload = shapeLockService.clearRoomLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        releasePayload,
        releasePayload.shapeIds,
      );

      if (!lockReleasePayload) return;

      io.to(roomName).emit(canvasServerEvents.shapeLockRelease, lockReleasePayload);
      io.to(roomName).emit(canvasServerEvents.shapePreviewClear, {
        canvasId: releasePayload.canvasId,
        actorUserId: lockReleasePayload.ownerUserId,
        shapeIds: lockReleasePayload.shapeIds,
        workspaceId: releasePayload.workspaceId,
      });
    });

    socket.on(canvasClientEvents.shapePreview, (payload) => {
      const previewPayload = readShapePreviewPayload(payload);

      if (!previewPayload) {
        emitCanvasError(socket, "canvas:shape:preview payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(previewPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before sending shape previews",
          ),
        );
        return;
      }

      if (!assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }

      socket.to(roomName).emit(canvasServerEvents.shapePreview, {
        ...previewPayload,
        actorUserId: authedSocket.data.auth.userId ?? socket.id,
        sentAt: new Date().toISOString(),
      });
    });

    socket.on(canvasClientEvents.shapePreviewClear, (payload) => {
      const clearPayload = readShapePreviewClearPayload(payload);

      if (!clearPayload) {
        emitCanvasError(socket, "canvas:shape:preview:clear payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(clearPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before clearing shape previews",
          ),
        );
        return;
      }

      if (!assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }

      socket.to(roomName).emit(canvasServerEvents.shapePreviewClear, {
        ...clearPayload,
        actorUserId: authedSocket.data.auth.userId ?? socket.id,
      });
    });

    socket.on("disconnect", () => {
      const leaveEvents = presenceService.clearSocket(socket.id);
      const lockReleaseEvents = shapeLockService.clearSocket(socket.id);

      for (const leavePayload of leaveEvents) {
        socket
          .to(createCanvasRoomName(leavePayload))
          .emit(canvasServerEvents.presenceLeave, leavePayload);
      }

      for (const lockReleasePayload of lockReleaseEvents) {
        const roomName = createCanvasRoomName(lockReleasePayload);

        socket
          .to(roomName)
          .emit(canvasServerEvents.shapeLockRelease, lockReleasePayload);
        socket.to(roomName).emit(canvasServerEvents.shapePreviewClear, {
          canvasId: lockReleasePayload.canvasId,
          actorUserId: lockReleasePayload.ownerUserId,
          shapeIds: lockReleasePayload.shapeIds,
          workspaceId: lockReleasePayload.workspaceId,
        });
      }
    });
  });

  return {
    async close() {
      await unsubscribeCanvasOperations?.();
      await unsubscribeMeetingReports?.();
      await unsubscribeBoardInvalidations?.();
      await io.close();
      await redisAdapter?.close();
      await database.close();
    },
  };
}
