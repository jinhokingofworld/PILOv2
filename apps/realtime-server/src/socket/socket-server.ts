import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

import type { RealtimeServerConfig } from "../config/realtime-config";
import { createRealtimeSessionService } from "../auth/session.service";
import { createBoardAccessService } from "../board/board-access.service";
import { createBoardInvalidationFanOut } from "../board/board-invalidation-fan-out";
import { createBoardSourceFanOut } from "../board/board-source-fan-out";
import { createBoardRoomService } from "../board/board-room.service";
import { createBoardSourceRoomService } from "../board/board-source-room.service";
import { registerBoardSocketHandlers } from "../board/board-socket-handlers";
import { registerBoardSourceSocketHandlers } from "../board/board-source-socket-handlers";
import { canvasClientEvents, canvasServerEvents } from "../canvas/canvas-socket-events";
import {
  createCanvasAccessService,
  type CanvasAccessContext,
  type CanvasRoomAccess,
} from "../canvas/canvas-access.service";
import { createCanvasPresenceService } from "../canvas/canvas-presence.service";
import { createCanvasRoomCheckpointService } from "../canvas/canvas-room-checkpoint.service";
import { createCanvasRoomService } from "../canvas/canvas-room.service";
import { createCanvasRoomStateService } from "../canvas/canvas-room-state.service";
import { createCanvasShapeLockService } from "../canvas/canvas-shape-lock.service";
import { createCanvasShapePreviewService } from "../canvas/canvas-shape-preview.service";
import { createSqlErdAccessService } from "../sql-erd/sql-erd-access.service";
import {
  createSqlErdPresenceService,
  type SqlErdPresenceClearResult,
} from "../sql-erd/sql-erd-presence.service";
import { createSqlErdRoomService } from "../sql-erd/sql-erd-room.service";
import {
  sqlErdClientEvents,
  sqlErdServerEvents,
} from "../sql-erd/sql-erd-socket-events";
import { relaySqlErdOperation } from "../sql-erd/sql-erd-operation-relay";
import { createMeetingAccessService } from "../meeting/meeting-access.service";
import {
  isMeetingReportRedisEvent,
  isMeetingStateRedisEvent,
  meetingClientEvents,
  meetingServerEvents
} from "../meeting/meeting-socket-events";
import {
  pageCursorClientEvents,
  pageCursorServerEvents,
} from "../page-cursor/page-cursor-events";
import {
  readPageCursorRoomRef,
  readPageCursorUpdatePayload,
} from "../page-cursor/page-cursor-payload";
import {
  canJoinPageCursorRoom,
  createPageCursorRoomName,
} from "../page-cursor/page-cursor-room";
import type {
  PageCursorPresenceState,
  PageCursorRoomRef,
} from "../page-cursor/page-cursor-types";
import type {
  CanvasJoinPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceUpdatePayload,
  CanvasRoomShapePatchPayload,
  CanvasRoomRef,
  CanvasViewportLoadedPayload,
  CanvasShapeLockClaimPayload,
  CanvasShapeLockReleasePayload,
  CanvasShapeOperationPayload,
  CanvasShapePreviewClearRequestPayload,
  CanvasShapePreviewPayload,
} from "../canvas/canvas-types";
import type {
  SqlErdPresenceEditingMode,
  SqlErdPresencePoint,
  SqlErdPresenceSelectedObject,
  SqlErdPresenceTool,
  SqlErdPresenceState,
  SqlErdPresenceUpdatePayload,
  SqlErdRoomRef,
} from "../sql-erd/sql-erd-types";
import {
  createRealtimeDatabase,
  type RealtimeDatabase,
} from "../database/database";
import { createSocketIoRedisAdapter } from "../redis/redis-pubsub";
import {
  isPrReviewDecisionUpdatedEvent,
  isPrReviewConflictDraftLockPayload,
  isPrReviewConflictDraftRedisEvent,
  PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_ACCEPTED_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_CLAIM_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_REJECTED_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASED_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASE_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_LOCK_UPDATED_EVENT,
  PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL,
  PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT,
  PR_REVIEW_DECISION_REDIS_CHANNEL,
  PR_REVIEW_DECISION_UPDATED_EVENT,
} from "../pr-review/pr-review-socket-events";
import {
  createCanvasRoomName,
  createMeetingRoomName,
  createSqlErdRoomName,
} from "./room-names";
import { createSocketAuthContext } from "./socket-auth";
import { createSocketErrorPayload } from "./socket-errors";

export type RealtimeSocketServerHandle = {
  close: () => Promise<void>;
};

export type RealtimeSocketServerOptions = {
  config: RealtimeServerConfig;
  database?: RealtimeDatabase;
  httpServer: HttpServer;
};

type AuthedSocket = Socket & {
  data: {
    auth: CanvasAccessContext & {
      displayName: string;
    };
    canvasRoomAccess: Map<string, CanvasRoomAccess>;
    pageCursorPresenceByRoom: Record<string, PageCursorPresenceState>;
    sqlErdPresenceByRoom: Record<string, SqlErdPresenceState>;
  };
};

const CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations";
const SQL_ERD_OPERATION_REDIS_CHANNEL = "sql-erd:operations";
const MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events";
const MEETING_STATE_REDIS_CHANNEL = "meeting:state-events";
const BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations";
const BOARD_SOURCE_REDIS_CHANNEL = "board:source-events";

function createConflictDraftShapeLockId(
  reviewSessionId: string,
  reviewFileId: string
) {
  return `pr-review-conflict-draft:${reviewSessionId}:${reviewFileId}`;
}

function readConflictDraftLockId(shapeId: string): {
  reviewSessionId: string;
  reviewFileId: string;
} | null {
  const prefix = "pr-review-conflict-draft:";
  if (!shapeId.startsWith(prefix)) return null;
  const [reviewSessionId, reviewFileId] = shapeId.slice(prefix.length).split(":");
  return reviewSessionId && reviewFileId ? { reviewSessionId, reviewFileId } : null;
}

function emitConflictDraftLockReleases(
  io: Server,
  payload: { canvasId: string; workspaceId: string; ownerUserId: string; shapeIds: string[] }
) {
  for (const shapeId of payload.shapeIds) {
    const draft = readConflictDraftLockId(shapeId);
    if (!draft) continue;
    io.to(createCanvasRoomName(payload)).emit(PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASED_EVENT, {
      ...draft,
      canvasId: payload.canvasId,
      workspaceId: payload.workspaceId,
      ownerUserId: payload.ownerUserId
    });
  }
}

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

function readSqlErdRoomRef(payload: unknown): SqlErdRoomRef | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const sessionId = readRequiredString(payload, "sessionId");

  if (!workspaceId || !sessionId) return null;

  return { sessionId, workspaceId };
}

function isSqlErdPresencePoint(value: unknown): value is SqlErdPresencePoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

function isSqlErdPresenceTool(value: unknown): value is SqlErdPresenceTool {
  return (
    value === "draw" ||
    value === "eraser" ||
    value === "frame" ||
    value === "note" ||
    value === "select" ||
    value === "text"
  );
}

function isSqlErdPresenceEditingMode(
  value: unknown,
): value is SqlErdPresenceEditingMode {
  return (
    value === null ||
    value === "draw" ||
    value === "move" ||
    value === "relation" ||
    value === "resize" ||
    value === "sql"
  );
}

function isSqlErdPresenceSelectedObject(
  value: unknown,
): value is SqlErdPresenceSelectedObject {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    value.id.length <= 256 &&
    (value.type === "annotation" ||
      value.type === "frame" ||
      value.type === "note" ||
      value.type === "relation" ||
      value.type === "stroke" ||
      value.type === "table" ||
      value.type === "text")
  );
}

function readSqlErdPresenceUpdatePayload(
  payload: unknown,
): SqlErdPresenceUpdatePayload | null {
  const room = readSqlErdRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const cursor = payload.cursor;
  const selectedObjects = payload.selectedObjects;
  const sentAt = payload.sentAt;

  if (cursor !== null && !isSqlErdPresencePoint(cursor)) return null;
  if (
    !Array.isArray(selectedObjects) ||
    selectedObjects.length > 100 ||
    !selectedObjects.every(isSqlErdPresenceSelectedObject) ||
    !isSqlErdPresenceEditingMode(payload.editingMode) ||
    !isSqlErdPresenceTool(payload.tool) ||
    !isIsoDateString(sentAt)
  ) {
    return null;
  }

  return {
    ...room,
    cursor,
    editingMode: payload.editingMode,
    selectedObjects: Array.from(
      new Map(
        selectedObjects.map((selectedObject) => [
          `${selectedObject.type}:${selectedObject.id}`,
          { id: selectedObject.id.trim(), type: selectedObject.type },
        ]),
      ).values(),
    ),
    sentAt,
    tool: payload.tool,
  };
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

function readShapeIdList(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((shapeId) => typeof shapeId === "string")
  ) {
    return null;
  }

  return Array.from(
    new Set(value.map((shapeId) => shapeId.trim()).filter(Boolean)),
  );
}

function readShapeIds(payload: Record<string, unknown>): string[] | null {
  return readShapeIdList(payload.shapeIds);
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
  return (
    value === "delete" ||
    value === "move" ||
    value === "resize" ||
    value === "unknown"
  );
}

function readShapePreviewPayload(
  payload: unknown,
): CanvasShapePreviewPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapes = payload.shapes;
  const deletedShapeIds =
    payload.deletedShapeIds === undefined
      ? undefined
      : readShapeIdList(payload.deletedShapeIds);

  if (!Array.isArray(shapes) || !shapes.every(isRecord)) return null;
  if (payload.deletedShapeIds !== undefined && !deletedShapeIds) return null;
  if (!shapes.length && !deletedShapeIds?.length) return null;

  return {
    ...room,
    ...(deletedShapeIds?.length ? { deletedShapeIds } : {}),
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

function readViewportLoadedPayload(
  payload: unknown,
): CanvasViewportLoadedPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload) || !isRecord(payload.bounds)) return null;

  const { height, margin, width, x, y } = payload.bounds;
  const shapes = payload.shapes;

  if (
    typeof height !== "number" ||
    typeof margin !== "number" ||
    typeof width !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(height) ||
    !Number.isFinite(margin) ||
    !Number.isFinite(width) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    height <= 0 ||
    width <= 0 ||
    margin < 0
  ) {
    return null;
  }
  if (!Array.isArray(shapes) || !shapes.every(isRecord)) {
    return null;
  }

  return {
    ...room,
    bounds: { height, margin, width, x, y },
    shapes,
  };
}

function readRoomShapePatchPayload(
  payload: unknown,
): CanvasRoomShapePatchPayload | null {
  const room = readRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const upsertShapes = payload.upsertShapes;
  const deletedShapeIds = readShapeIdList(payload.deletedShapeIds);

  if (!Array.isArray(upsertShapes) || !upsertShapes.every(isRecord)) {
    return null;
  }
  if (!deletedShapeIds) return null;
  if (!upsertShapes.length && !deletedShapeIds.length) return null;

  return {
    ...room,
    deletedShapeIds,
    upsertShapes,
  };
}

function emitCanvasError(socket: Socket, message: string) {
  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
}

function emitSqlErdError(socket: Socket, message: string) {
  socket.emit(
    sqlErdServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
}

function emitSqlErdPresenceClearResult(
  socket: Socket,
  clearResult: SqlErdPresenceClearResult,
) {
  if (clearResult.kind === "update") {
    socket
      .to(createSqlErdRoomName(clearResult.presence))
      .emit(sqlErdServerEvents.presenceUpdate, clearResult.presence);
    return;
  }

  socket
    .to(createSqlErdRoomName(clearResult.payload))
    .emit(sqlErdServerEvents.presenceLeave, clearResult.payload);
}

function isSqlErdPresenceState(
  value: unknown,
): value is SqlErdPresenceState {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.userId === "string" &&
    typeof value.displayName === "string" &&
    (value.cursor === null || isSqlErdPresencePoint(value.cursor)) &&
    Array.isArray(value.selectedObjects) &&
    value.selectedObjects.every(isSqlErdPresenceSelectedObject) &&
    isSqlErdPresenceEditingMode(value.editingMode) &&
    isSqlErdPresenceTool(value.tool) &&
    isIsoDateString(value.sentAt) &&
    typeof value.updatedAt === "string"
  );
}

async function getSqlErdRoomSocketPresence(
  io: Server,
  room: SqlErdRoomRef,
  roomName: string,
): Promise<SqlErdPresenceState[]> {
  const sockets = await io.in(roomName).fetchSockets();
  const presenceByUserId = new Map<string, SqlErdPresenceState>();

  for (const socket of sockets) {
    const socketData = socket.data as {
      sqlErdPresenceByRoom?: Record<string, unknown>;
    };
    const presence = socketData.sqlErdPresenceByRoom?.[roomName];

    if (!isSqlErdPresenceState(presence)) continue;
    if (presence.workspaceId !== room.workspaceId || presence.sessionId !== room.sessionId) {
      continue;
    }

    presenceByUserId.set(presence.userId, presence);
  }

  return [...presenceByUserId.values()];
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

function emitPageCursorError(socket: Socket, message: string) {
  socket.emit(
    pageCursorServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
}

function isPageCursorPresenceState(
  value: unknown,
): value is PageCursorPresenceState {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    (value.page === "home" || value.page === "calendar" || value.page === "board") &&
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
  io: Server,
  room: PageCursorRoomRef,
  roomName: string,
): Promise<PageCursorPresenceState[]> {
  const sockets = await io.in(roomName).fetchSockets();
  const presenceByUserId = new Map<string, PageCursorPresenceState>();

  for (const socket of sockets) {
    const socketData = socket.data as {
      pageCursorPresenceByRoom?: Record<string, unknown>;
    };
    const presence = socketData.pageCursorPresenceByRoom?.[roomName];

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

export async function createRealtimeSocketServer({
  config,
  database: providedDatabase,
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
  const database =
    providedDatabase ??
    createRealtimeDatabase({
      databaseApplicationName: config.databaseApplicationName,
      databasePoolConnectionTimeoutMs: config.databasePoolConnectionTimeoutMs,
      databasePoolIdleTimeoutMs: config.databasePoolIdleTimeoutMs,
      databasePoolMax: config.databasePoolMax,
      databaseSsl: config.databaseSsl,
      databaseUrl: config.databaseUrl,
    });

  if (redisAdapter) {
    io.adapter(redisAdapter.adapter);
  }

  const sessionService = createRealtimeSessionService(database);
  const accessService = createCanvasAccessService(database);
  const sqlErdAccessService = createSqlErdAccessService(database);
  const boardAccessService = createBoardAccessService(database);
  const presenceService = createCanvasPresenceService();
  const roomStateService = createCanvasRoomStateService();
  const sqlErdPresenceService = createSqlErdPresenceService();
  const shapeLockService = createCanvasShapeLockService({
    redisClient: redisAdapter?.stateClient ?? null,
  });
  const shapePreviewService = createCanvasShapePreviewService({
    redisClient: redisAdapter?.stateClient ?? null,
  });
  const roomService = createCanvasRoomService({
    accessService,
    presenceService,
    roomStateService,
    shapeLockService,
    shapePreviewService,
  });
  const roomCheckpointService = createCanvasRoomCheckpointService({
    appServerUrl: config.appServerUrl,
    roomStateService,
  });
  const sqlErdRoomService = createSqlErdRoomService({
    accessService: sqlErdAccessService,
    presenceService: sqlErdPresenceService,
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
  const boardSourceRoomService = createBoardSourceRoomService({
    accessService: boardAccessService,
  });
  const boardSourceFanOut = createBoardSourceFanOut({
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
  const unsubscribeSqlErdOperations = redisAdapter
    ? await redisAdapter.subscribe(SQL_ERD_OPERATION_REDIS_CHANNEL, (payload) => {
        if (!relaySqlErdOperation(payload, (roomName, event, operation) => {
          io.to(roomName).emit(event, operation);
        })) {
          console.error("SQLtoERD operation Redis payload is invalid", payload);
        }
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
  const unsubscribeMeetingStates = redisAdapter
    ? await redisAdapter.subscribe(MEETING_STATE_REDIS_CHANNEL, payload => {
        if (!isMeetingStateRedisEvent(payload)) {
          console.error("Meeting state Redis payload is invalid", payload);
          return;
        }

        const { workspaceId, ...event } = payload;
        io.to(createMeetingRoomName(workspaceId)).emit(
          meetingServerEvents.stateUpdated,
          event
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
  const unsubscribeBoardSourceEvents = redisAdapter
    ? await redisAdapter.subscribe(BOARD_SOURCE_REDIS_CHANNEL, (payload) => {
        if (!boardSourceFanOut.fanOut(payload)) {
          console.error("Board source Redis payload is invalid");
        }
      })
    : null;
  const unsubscribePrReviewDecisions = redisAdapter
    ? await redisAdapter.subscribe(PR_REVIEW_DECISION_REDIS_CHANNEL, (payload) => {
        if (!isPrReviewDecisionUpdatedEvent(payload)) {
          console.error("PR Review decision Redis payload is invalid", payload);
          return;
        }

        io.to(createCanvasRoomName(payload)).emit(
          PR_REVIEW_DECISION_UPDATED_EVENT,
          payload,
        );
      })
    : null;
  const unsubscribePrReviewConflictDrafts = redisAdapter
    ? await redisAdapter.subscribe(PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL, (payload) => {
        if (!isPrReviewConflictDraftRedisEvent(payload)) {
          console.error("PR Review Conflict draft Redis payload is invalid", payload);
          return;
        }

        io.to(createCanvasRoomName(payload)).emit(payload.event, payload);
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
          displayName: session.displayName,
          userId: session.userId,
        };
        (socket as AuthedSocket).data.canvasRoomAccess = new Map();
        (socket as AuthedSocket).data.pageCursorPresenceByRoom = {};
        (socket as AuthedSocket).data.sqlErdPresenceByRoom = {};
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

    socket.on(sqlErdClientEvents.join, async (payload) => {
      const joinPayload = readSqlErdRoomRef(payload);

      if (!joinPayload) {
        emitSqlErdError(socket, "sql-erd:join payload is invalid");
        return;
      }

      const result = await sqlErdRoomService.joinSqlErdRoom(
        authedSocket.data.auth,
        joinPayload,
      );

      if (!result.joined) {
        socket.emit(
          sqlErdServerEvents.error,
          createSocketErrorPayload("forbidden", "SQLtoERD room access denied"),
        );
        return;
      }

      await socket.join(result.roomName);
      socket.emit(sqlErdServerEvents.joined, {
        ...result.payload,
        presence: await getSqlErdRoomSocketPresence(
          io,
          joinPayload,
          result.roomName,
        ),
      });
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

    socket.on(pageCursorClientEvents.join, async (payload) => {
      const room = readPageCursorRoomRef(payload);

      if (!room) {
        emitPageCursorError(socket, "page-cursor:join payload is invalid");
        return;
      }

      const allowed = await canJoinPageCursorRoom({
        accessService: boardAccessService,
        context: authedSocket.data.auth,
        room,
      });

      if (!allowed) {
        socket.emit(
          pageCursorServerEvents.error,
          createSocketErrorPayload("forbidden", "page cursor room access denied"),
        );
        return;
      }

      const roomName = createPageCursorRoomName(room);
      await socket.join(roomName);
      socket.emit(pageCursorServerEvents.joined, {
        ...room,
        presence: await getPageCursorRoomSocketPresence(io, room, roomName),
      });
    });

    socket.on(pageCursorClientEvents.leave, async (payload) => {
      const room = readPageCursorRoomRef(payload);

      if (!room) {
        emitPageCursorError(socket, "page-cursor:leave payload is invalid");
        return;
      }

      const roomName = createPageCursorRoomName(room);
      await socket.leave(roomName);
      delete authedSocket.data.pageCursorPresenceByRoom[roomName];
      socket.to(roomName).emit(pageCursorServerEvents.leave, {
        ...room,
        userId: authedSocket.data.auth.userId ?? socket.id,
      });
    });

    socket.on(canvasClientEvents.leave, async (payload) => {
      const room = readRoomRef(payload);

      if (!room) {
        emitCanvasError(socket, "canvas:leave payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(room);
      const leavePayload = presenceService.clearRoomPresence(socket.id, room);
      const lockReleasePayload = await shapeLockService.clearRoomLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        room,
      );
      const previewClearPayload = await shapePreviewService.clearRoomPreview(
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
        emitConflictDraftLockReleases(io, lockReleasePayload);
      }

      if (previewClearPayload) {
        socket
          .to(roomName)
          .emit(canvasServerEvents.shapePreviewClear, previewClearPayload);
      }
    });

    socket.on(sqlErdClientEvents.leave, async (payload) => {
      const room = readSqlErdRoomRef(payload);

      if (!room) {
        emitSqlErdError(socket, "sql-erd:leave payload is invalid");
        return;
      }

      const roomName = createSqlErdRoomName(room);
      const clearResult = sqlErdPresenceService.clearRoomPresence(socket.id, room);

      await socket.leave(roomName);
      delete authedSocket.data.sqlErdPresenceByRoom[roomName];

      if (clearResult) emitSqlErdPresenceClearResult(socket, clearResult);
    });

    registerBoardSocketHandlers({
      context: authedSocket.data.auth,
      roomService: boardRoomService,
      socket,
    });
    registerBoardSourceSocketHandlers({
      context: authedSocket.data.auth,
      roomService: boardSourceRoomService,
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

    socket.on(sqlErdClientEvents.presenceUpdate, (payload) => {
      const presencePayload = readSqlErdPresenceUpdatePayload(payload);

      if (!presencePayload) {
        emitSqlErdError(socket, "sql-erd:presence:update payload is invalid");
        return;
      }

      const roomName = createSqlErdRoomName(presencePayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          sqlErdServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join SQLtoERD room before sending presence",
          ),
        );
        return;
      }

      const presence = sqlErdPresenceService.updatePresence(
        socket.id,
        {
          displayName: authedSocket.data.auth.displayName,
          userId: authedSocket.data.auth.userId ?? socket.id,
        },
        presencePayload,
      );
      authedSocket.data.sqlErdPresenceByRoom[roomName] = presence;

      socket.to(roomName).emit(sqlErdServerEvents.presenceUpdate, presence);
    });

    socket.on(pageCursorClientEvents.update, (payload) => {
      const cursorPayload = readPageCursorUpdatePayload(payload);

      if (!cursorPayload) {
        emitPageCursorError(socket, "page-cursor:update payload is invalid");
        return;
      }

      const roomName = createPageCursorRoomName(cursorPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pageCursorServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join page cursor room before sending cursor updates",
          ),
        );
        return;
      }

      const presence: PageCursorPresenceState = {
        ...cursorPayload,
        displayName: authedSocket.data.auth.displayName,
        userId: authedSocket.data.auth.userId ?? socket.id,
        updatedAt: new Date().toISOString(),
      };
      authedSocket.data.pageCursorPresenceByRoom[roomName] = presence;

      socket.to(roomName).emit(pageCursorServerEvents.update, presence);
    });

    socket.on(canvasClientEvents.shapeLockClaim, async (payload) => {
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

      const result = await shapeLockService.claimLocks(
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

    socket.on(canvasClientEvents.shapeLockRelease, async (payload) => {
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

      const lockReleasePayload = await shapeLockService.clearRoomLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        releasePayload,
        releasePayload.shapeIds,
      );

      if (!lockReleasePayload) return;

      io.to(roomName).emit(canvasServerEvents.shapeLockRelease, lockReleasePayload);
    });

    socket.on(canvasClientEvents.viewportLoaded, (payload) => {
      const loadedPayload = readViewportLoadedPayload(payload);

      if (!loadedPayload) {
        emitCanvasError(socket, "canvas:viewport:loaded payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(loadedPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before reporting loaded viewport",
          ),
        );
        return;
      }

      const loadedRegions = roomStateService.recordLoadedViewport(
        loadedPayload,
        loadedPayload.bounds,
        loadedPayload.shapes,
      );

      io.to(roomName).emit(canvasServerEvents.shapesHydrate, {
        canvasId: loadedPayload.canvasId,
        loadedRegions,
        shapes: loadedPayload.shapes,
        workspaceId: loadedPayload.workspaceId,
      });
    });

    socket.on(canvasClientEvents.shapePatch, (payload) => {
      const patchPayload = readRoomShapePatchPayload(payload);

      if (!patchPayload) {
        emitCanvasError(socket, "canvas:room:shape:patch payload is invalid");
        return;
      }

      const roomName = createCanvasRoomName(patchPayload);

      if (!socket.rooms.has(roomName)) {
        socket.emit(
          canvasServerEvents.error,
          createSocketErrorPayload(
            "room_not_joined",
            "join canvas room before sending room shape patch",
          ),
        );
        return;
      }

      if (!assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }

      roomStateService.applyShapePatch(patchPayload, patchPayload);
      roomCheckpointService.scheduleCheckpoint(
        patchPayload,
        authedSocket.data.auth.token,
      );
      socket.to(roomName).emit(canvasServerEvents.shapePatch, {
        ...patchPayload,
        actorUserId: authedSocket.data.auth.userId ?? socket.id,
        sentAt: new Date().toISOString(),
      });
    });

    socket.on(canvasClientEvents.shapePreview, async (payload) => {
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

      const previewEvent = {
        ...previewPayload,
        actorUserId: authedSocket.data.auth.userId ?? socket.id,
        sentAt: new Date().toISOString(),
      };

      await shapePreviewService.updatePreview(
        socket.id,
        previewEvent.actorUserId,
        previewEvent,
      );

      socket.to(roomName).emit(canvasServerEvents.shapePreview, previewEvent);
    });

    socket.on(canvasClientEvents.shapePreviewClear, async (payload) => {
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

      const clearEvent = await shapePreviewService.clearRoomPreview(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        clearPayload,
        clearPayload.shapeIds,
      );

      if (!clearEvent) return;

      socket.to(roomName).emit(canvasServerEvents.shapePreviewClear, clearEvent);
    });

    socket.on(PR_REVIEW_CONFLICT_DRAFT_LOCK_CLAIM_EVENT, async payload => {
      if (!isPrReviewConflictDraftLockPayload(payload)) {
        emitCanvasError(socket, "pr-review:conflict-draft:lock:claim payload is invalid");
        return;
      }
      const roomName = createCanvasRoomName(payload);
      if (!socket.rooms.has(roomName) || !assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }
      const shapeId = createConflictDraftShapeLockId(
        payload.reviewSessionId,
        payload.reviewFileId
      );
      const result = await shapeLockService.claimLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        payload,
        [shapeId]
      );
      if (result.accepted.locks.length) {
        const lock = result.accepted.locks[0];
        const event = {
          ...payload,
          ownerUserId: lock.ownerUserId,
          lockedAt: lock.lockedAt,
          expiresAt: lock.expiresAt
        };
        socket.emit(PR_REVIEW_CONFLICT_DRAFT_LOCK_ACCEPTED_EVENT, event);
        socket.to(roomName).emit(PR_REVIEW_CONFLICT_DRAFT_LOCK_UPDATED_EVENT, event);
      }
      if (result.rejected.shapeIds.length) {
        const lock = result.rejected.locks[0];
        socket.emit(PR_REVIEW_CONFLICT_DRAFT_LOCK_REJECTED_EVENT, {
          ...payload,
          ownerUserId: lock?.ownerUserId ?? null,
          lockedAt: lock?.lockedAt ?? null,
          expiresAt: lock?.expiresAt ?? null
        });
      }
    });

    socket.on(PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASE_EVENT, async payload => {
      if (!isPrReviewConflictDraftLockPayload(payload)) {
        emitCanvasError(socket, "pr-review:conflict-draft:lock:release payload is invalid");
        return;
      }
      const roomName = createCanvasRoomName(payload);
      if (!socket.rooms.has(roomName) || !assertCanvasRoomWritable(authedSocket, roomName)) {
        return;
      }
      const release = await shapeLockService.clearRoomLocks(
        socket.id,
        authedSocket.data.auth.userId ?? socket.id,
        payload,
        [createConflictDraftShapeLockId(payload.reviewSessionId, payload.reviewFileId)]
      );
      if (!release) return;
      io.to(roomName).emit(PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASED_EVENT, {
        ...payload,
        ownerUserId: release.ownerUserId
      });
    });

    socket.on("disconnect", () => {
      void (async () => {
        const leaveEvents = presenceService.clearSocket(socket.id);
        const sqlErdClearResults = sqlErdPresenceService.clearSocket(socket.id);
        const pageCursorLeaveEvents: PageCursorPresenceState[] = Object.values(
          authedSocket.data.pageCursorPresenceByRoom,
        );
        authedSocket.data.pageCursorPresenceByRoom = {};
        const [lockReleaseEvents, previewClearEvents] = await Promise.all([
          shapeLockService.clearSocket(socket.id),
          shapePreviewService.clearSocket(socket.id),
        ]);

        for (const leavePayload of leaveEvents) {
          socket
            .to(createCanvasRoomName(leavePayload))
            .emit(canvasServerEvents.presenceLeave, leavePayload);
        }

        for (const clearResult of sqlErdClearResults) {
          emitSqlErdPresenceClearResult(socket, clearResult);
        }

        for (const pageCursorPresence of pageCursorLeaveEvents) {
          socket
            .to(createPageCursorRoomName(pageCursorPresence))
            .emit(pageCursorServerEvents.leave, {
              boardId: pageCursorPresence.boardId,
              page: pageCursorPresence.page,
              userId: pageCursorPresence.userId,
              workspaceId: pageCursorPresence.workspaceId,
            });
        }

        for (const lockReleasePayload of lockReleaseEvents) {
          socket
            .to(createCanvasRoomName(lockReleasePayload))
            .emit(canvasServerEvents.shapeLockRelease, lockReleasePayload);
          emitConflictDraftLockReleases(io, lockReleasePayload);
        }

        for (const previewClearPayload of previewClearEvents) {
          socket
            .to(createCanvasRoomName(previewClearPayload))
            .emit(canvasServerEvents.shapePreviewClear, previewClearPayload);
        }
      })().catch((error) => {
        console.error("Realtime socket disconnect cleanup failed", error);
      });
    });
  });

  return {
    async close() {
      await unsubscribeCanvasOperations?.();
      await unsubscribeSqlErdOperations?.();
      await unsubscribeMeetingReports?.();
      await unsubscribeMeetingStates?.();
      await unsubscribeBoardInvalidations?.();
      await unsubscribeBoardSourceEvents?.();
      await unsubscribePrReviewDecisions?.();
      await unsubscribePrReviewConflictDrafts?.();
      roomCheckpointService.close();
      await io.close();
      await redisAdapter?.close();
      await database.close();
    },
  };
}
