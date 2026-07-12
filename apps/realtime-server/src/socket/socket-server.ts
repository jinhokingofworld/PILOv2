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
} from "../canvas/canvas-access.service";
import { createCanvasPresenceService } from "../canvas/canvas-presence.service";
import { createCanvasRoomService } from "../canvas/canvas-room.service";
import type {
  CanvasJoinPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceUpdatePayload,
  CanvasRoomRef,
  CanvasShapeOperationPayload,
} from "../canvas/canvas-types";
import { createRealtimeDatabase } from "../database/database";
import { createSocketIoRedisAdapter } from "../redis/redis-pubsub";
import { createCanvasRoomName } from "./room-names";
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
  };
};

const CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations";
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

function emitCanvasError(socket: Socket, message: string) {
  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
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
  const roomService = createCanvasRoomService({
    accessService,
    presenceService,
  });
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
      socket.emit(canvasServerEvents.joined, result.payload);
    });

    socket.on(canvasClientEvents.leave, async (payload) => {
      const room = readRoomRef(payload);

      if (!room) {
        emitCanvasError(socket, "canvas:leave payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(room);
      const leavePayload = presenceService.clearRoomPresence(socket.id, room);

      await socket.leave(roomName);

      if (leavePayload) {
        socket.to(roomName).emit(canvasServerEvents.presenceLeave, leavePayload);
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

    socket.on("disconnect", () => {
      const leaveEvents = presenceService.clearSocket(socket.id);

      for (const leavePayload of leaveEvents) {
        socket
          .to(createCanvasRoomName(leavePayload))
          .emit(canvasServerEvents.presenceLeave, leavePayload);
      }
    });
  });

  return {
    async close() {
      await unsubscribeCanvasOperations?.();
      await unsubscribeBoardInvalidations?.();
      await io.close();
      await redisAdapter?.close();
      await database.close();
    },
  };
}
