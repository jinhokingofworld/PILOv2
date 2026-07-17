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
import { createChatAccessService } from "../chat/chat-access.service";
import { createChatFanOut } from "../chat/chat-fan-out";
import {
  createChatMembershipRevocationHandler,
} from "../chat/chat-membership-revocation";
import { registerChatSocketHandlers } from "../chat/chat-socket-handlers";
import { createChatSubscriptionWorkQueue } from "../chat/chat-subscription-work";
import { createGithubSourceAccessService } from "../github-source/github-source-access.service";
import { createGithubSourceFanOut } from "../github-source/github-source-fan-out";
import { createGithubSourceRoomService } from "../github-source/github-source-room.service";
import { registerGithubSourceSocketHandlers } from "../github-source/github-source-socket-handlers";
import { canvasServerEvents } from "../canvas/socket/canvas-socket-events";
import {
  createCanvasAccessService,
  type CanvasAccessContext,
  type CanvasRoomAccess,
} from "../canvas/room/canvas-access.service";
import { createCanvasPresenceService } from "../canvas/presence/canvas-presence.service";
import { createCanvasRoomCheckpointService } from "../canvas/checkpoint/canvas-room-checkpoint.service";
import { createCanvasRoomService } from "../canvas/room/canvas-room.service";
import {
  createCanvasRoomStateService,
  type CanvasRoomStateStats,
} from "../canvas/state/canvas-room-state.service";
import { createCanvasShapeLockService } from "../canvas/review-lock/canvas-shape-lock.service";
import { createCanvasShapePreviewService } from "../canvas/preview/canvas-shape-preview.service";
import { createClassicCanvasMembershipRevocationHandler } from "../canvas/socket/canvas-membership-revocation";
import {
  assertCanvasRoomWritable,
  emitCanvasError,
  registerCanvasSocketHandlers,
} from "../canvas/socket/canvas-socket-handlers";
import {
  isCanvasShapeOperationPayload,
} from "../canvas/socket/canvas-socket-payloads";
import { createSqlErdAccessService } from "../sql-erd/sql-erd-access.service";
import { canEmitSqlErdJoined } from "../sql-erd/sql-erd-join-state";
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
import {
  createSqlErdMembershipRevocationHandler,
  evictSqlErdSocketFromRooms,
} from "../sql-erd/sql-erd-membership-revocation";
import { createMeetingAccessService } from "../meeting/meeting-access.service";
import { createWorkspacePresenceAccessService } from "../workspace-presence/workspace-presence-access.service";
import { createWorkspacePresenceService } from "../workspace-presence/workspace-presence.service";
import { registerWorkspacePresenceSocketHandlers } from "../workspace-presence/workspace-presence-socket-handlers";
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
import { createPdfCollaborationAccessService } from "../pdf-collaboration/pdf-collaboration-access.service";
import { createPdfCollaborationMembershipRevocationHandler } from "../pdf-collaboration/pdf-collaboration-membership-revocation";
import {
  pdfCollaborationClientEvents,
  pdfCollaborationServerEvents,
} from "../pdf-collaboration/pdf-collaboration-events";
import {
  readPdfCollaborationPageUpdate,
  readPdfCollaborationPointerUpdate,
  readPdfCollaborationRoomRef,
  readPdfCollaborationStrokeCommit,
  readPdfCollaborationStrokeRemove,
} from "../pdf-collaboration/pdf-collaboration-payload";
import { createPdfCollaborationRoomName } from "../pdf-collaboration/pdf-collaboration-room";
import { createPdfCollaborationRoomState } from "../pdf-collaboration/pdf-collaboration-room-state";
import { WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL } from "../workspace-membership-revocation/workspace-membership-revocation";
import type {
  CanvasRoomRef,
} from "../canvas/contracts/canvas-types";
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
  isPrReviewRoomDeletedEvent,
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
  PR_REVIEW_ROOM_DELETED_EVENT,
  PR_REVIEW_ROOM_REDIS_CHANNEL,
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
  getCanvasRoomStateStats: () => CanvasRoomStateStats;
};

export type RealtimeSocketServerOptions = {
  config: RealtimeServerConfig;
  database?: RealtimeDatabase;
  httpServer: HttpServer;
  membershipRevocationHandlers?: Array<{
    handle: (payload: unknown) => Promise<boolean>;
  }>;
};

type AuthedSocket = Socket & {
  data: {
    auth: CanvasAccessContext & {
      displayName: string;
    };
    canvasRoomAccess: Map<string, CanvasRoomAccess>;
    canvasRoomsByName: Map<string, CanvasRoomRef>;
    pageCursorPresenceByRoom: Record<string, PageCursorPresenceState>;
    revokedClassicCanvasWorkspaceIds: Set<string>;
    sqlErdPresenceByRoom: Record<string, SqlErdPresenceState>;
    sqlErdRevokedWorkspaceIds: Set<string>;
    sqlErdRoomsByName: Map<string, SqlErdRoomRef>;
  };
};

const CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations";
const SQL_ERD_OPERATION_REDIS_CHANNEL = "sql-erd:operations";
const MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events";
const MEETING_STATE_REDIS_CHANNEL = "meeting:state-events";
const BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations";
const BOARD_SOURCE_REDIS_CHANNEL = "board:source-events";
const GITHUB_SOURCE_INVALIDATION_REDIS_CHANNEL = "github:source-invalidations";
const CHAT_REDIS_CHANNEL = "chat:events";

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

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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

function emitPdfCollaborationError(socket: Socket, message: string) {
  socket.emit(
    pdfCollaborationServerEvents.error,
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
  membershipRevocationHandlers = [],
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
  const pdfCollaborationAccessService = createPdfCollaborationAccessService({
    database,
  });
  const sqlErdAccessService = createSqlErdAccessService(database);
  const boardAccessService = createBoardAccessService(database);
  const presenceService = createCanvasPresenceService();
  const roomStateService = createCanvasRoomStateService();
  const pdfCollaborationRoomState = createPdfCollaborationRoomState();
  const sqlErdPresenceService = createSqlErdPresenceService();
  const shapeLockService = createCanvasShapeLockService({
    redisClient: redisAdapter?.stateClient ?? null,
  });
  const shapePreviewService = createCanvasShapePreviewService({
    redisClient: redisAdapter?.stateClient ?? null,
  });
  const roomService = createCanvasRoomService({
    accessService,
    appServerUrl: config.appServerUrl,
    presenceService,
    roomStateService,
    shapeLockService,
    shapePreviewService,
  });
  const roomCheckpointService = createCanvasRoomCheckpointService({
    appServerUrl: config.appServerUrl,
    onCheckpointStatus(payload) {
      io.to(createCanvasRoomName(payload)).emit(
        canvasServerEvents.checkpoint,
        payload,
      );
    },
    roomStateService,
  });
  const sqlErdRoomService = createSqlErdRoomService({
    accessService: sqlErdAccessService,
    presenceService: sqlErdPresenceService,
  });
  const meetingAccessService = createMeetingAccessService(database);
  const workspacePresenceAccessService =
    createWorkspacePresenceAccessService(database);
  const workspacePresenceService = createWorkspacePresenceService();
  const chatAccessService = createChatAccessService(database);
  const chatFanOut = createChatFanOut({ database, io });
  const chatMembershipRevocationHandler =
    createChatMembershipRevocationHandler({ io });
  const classicCanvasMembershipRevocationHandler =
    createClassicCanvasMembershipRevocationHandler({
      emitLockReleases(payload) {
        emitConflictDraftLockReleases(io, payload);
      },
      io,
      presenceService,
      roomCheckpointService,
      shapeLockService,
      shapePreviewService,
    });
  const pdfCollaborationMembershipRevocationHandler =
    createPdfCollaborationMembershipRevocationHandler({
      io,
      roomState: pdfCollaborationRoomState,
    });
  const sqlErdMembershipRevocationHandler =
    createSqlErdMembershipRevocationHandler({
      database,
      io,
      presenceService: sqlErdPresenceService,
    });
  const chatSubscriptionWork = createChatSubscriptionWorkQueue({
    onRejected() {
      console.error("Chat Redis subscription work failed");
    },
  });
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
  const githubSourceAccessService = createGithubSourceAccessService(database);
  const githubSourceRoomService = createGithubSourceRoomService({
    accessService: githubSourceAccessService,
  });
  const githubSourceFanOut = createGithubSourceFanOut({
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
  const unsubscribeGithubSourceInvalidations = redisAdapter
    ? await redisAdapter.subscribe(
        GITHUB_SOURCE_INVALIDATION_REDIS_CHANNEL,
        (payload) => {
          if (!githubSourceFanOut.fanOut(payload)) {
            console.error("GitHub source invalidation Redis payload is invalid");
          }
        },
      )
    : null;
  const unsubscribeChatEvents = redisAdapter
    ? await redisAdapter.subscribe(CHAT_REDIS_CHANNEL, (payload) => {
        chatSubscriptionWork.enqueueChatEvent(async () => {
          if (!(await chatFanOut.fanOut(payload))) {
            console.error("Chat Redis payload or access recheck failed");
          }
        });
      })
    : null;
  const unsubscribeWorkspaceMembershipRevocations = redisAdapter
    ? await redisAdapter.subscribe(
        WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
        (payload) => {
          chatSubscriptionWork.trackRevocation(async () => {
            const handled = await Promise.all(
              [
                chatMembershipRevocationHandler.handle(payload),
                classicCanvasMembershipRevocationHandler.handle(payload),
                pdfCollaborationMembershipRevocationHandler.handle(payload),
                sqlErdMembershipRevocationHandler.handle(payload),
                ...membershipRevocationHandlers.map((handler) =>
                  handler.handle(payload),
                ),
              ],
            );
            if (handled.some((result) => !result)) {
              console.error("Workspace membership revocation handling failed");
            }
          });
        },
      )
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
  const unsubscribePrReviewRoomDeleted = redisAdapter
    ? await redisAdapter.subscribe(PR_REVIEW_ROOM_REDIS_CHANNEL, (payload) => {
        if (!isPrReviewRoomDeletedEvent(payload)) {
          console.error("PR Review room deletion Redis payload is invalid", payload);
          return;
        }

        io.to(createCanvasRoomName(payload)).emit(
          PR_REVIEW_ROOM_DELETED_EVENT,
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
        (socket as AuthedSocket).data.canvasRoomsByName = new Map();
        (socket as AuthedSocket).data.pageCursorPresenceByRoom = {};
        (socket as AuthedSocket).data.revokedClassicCanvasWorkspaceIds =
          new Set();
        (socket as AuthedSocket).data.sqlErdPresenceByRoom = {};
        (socket as AuthedSocket).data.sqlErdRevokedWorkspaceIds = new Set();
        (socket as AuthedSocket).data.sqlErdRoomsByName = new Map();
        next();
      })
      .catch(next);
  });

  io.on("connection", (socket) => {
    const authedSocket = socket as AuthedSocket;

    registerChatSocketHandlers({
      accessService: chatAccessService,
      socket,
    });
    registerWorkspacePresenceSocketHandlers({
      accessService: workspacePresenceAccessService,
      io,
      service: workspacePresenceService,
      socket,
    });

    registerCanvasSocketHandlers({
      emitLockReleases(payload) {
        emitConflictDraftLockReleases(io, payload);
      },
      io,
      presenceService,
      roomCheckpointService,
      roomService,
      roomStateService,
      shapeLockService,
      shapePreviewService,
      socket: authedSocket,
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

      if (
        authedSocket.data.sqlErdRevokedWorkspaceIds.has(
          joinPayload.workspaceId,
        )
      ) {
        socket.emit(
          sqlErdServerEvents.error,
          createSocketErrorPayload("forbidden", "SQLtoERD room access denied"),
        );
        return;
      }

      await socket.join(result.roomName);

      if (
        authedSocket.data.sqlErdRevokedWorkspaceIds.has(
          joinPayload.workspaceId,
        )
      ) {
        const safelyEvicted = await evictSqlErdSocketFromRooms(socket, [
          result.roomName,
        ]);
        if (!safelyEvicted) {
          console.error("SQLtoERD revoked join cleanup failed");
          return;
        }
        socket.emit(
          sqlErdServerEvents.error,
          createSocketErrorPayload("forbidden", "SQLtoERD room access denied"),
        );
        return;
      }

      authedSocket.data.sqlErdRoomsByName.set(result.roomName, joinPayload);
      const sqlErdPresence = await getSqlErdRoomSocketPresence(
        io,
        joinPayload,
        result.roomName,
      );

      if (
        !canEmitSqlErdJoined({
          isRoomJoined: socket.rooms.has(result.roomName),
          room: joinPayload,
          roomName: result.roomName,
          roomsByName: authedSocket.data.sqlErdRoomsByName,
          revokedWorkspaceIds:
            authedSocket.data.sqlErdRevokedWorkspaceIds,
        })
      ) {
        if (
          authedSocket.data.sqlErdRoomsByName.get(result.roomName) ===
          joinPayload
        ) {
          authedSocket.data.sqlErdRoomsByName.delete(result.roomName);
        }

        if (
          authedSocket.data.sqlErdRevokedWorkspaceIds.has(
            joinPayload.workspaceId,
          )
        ) {
          const safelyEvicted = socket.rooms.has(result.roomName)
            ? await evictSqlErdSocketFromRooms(socket, [result.roomName])
            : true;
          if (!safelyEvicted) {
            console.error("SQLtoERD revoked joined snapshot cleanup failed");
            return;
          }
          socket.emit(
            sqlErdServerEvents.error,
            createSocketErrorPayload(
              "forbidden",
              "SQLtoERD room access denied",
            ),
          );
        }
        return;
      }

      socket.emit(sqlErdServerEvents.joined, {
        ...result.payload,
        presence: sqlErdPresence,
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

    socket.on(pdfCollaborationClientEvents.join, async (payload) => {
      const room = readPdfCollaborationRoomRef(payload);
      if (!room) {
        emitPdfCollaborationError(socket, "pdf-collaboration:join payload is invalid");
        return;
      }

      const access = await pdfCollaborationAccessService.getPdfCollaborationRoomAccess(
        authedSocket.data.auth,
        room,
      );
      if (!access) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("forbidden", "PDF collaboration room access denied"),
        );
        return;
      }

      const roomName = createPdfCollaborationRoomName(room);
      await socket.join(roomName);
      const snapshot = pdfCollaborationRoomState.join(room, socket.id, {
        displayName: authedSocket.data.auth.displayName,
        pageNumber: 1,
        userId: authedSocket.data.auth.userId ?? socket.id,
      });
      socket.emit(pdfCollaborationServerEvents.joined, snapshot);
    });

    socket.on(pdfCollaborationClientEvents.leave, async (payload) => {
      const room = readPdfCollaborationRoomRef(payload);
      if (!room) {
        emitPdfCollaborationError(socket, "pdf-collaboration:leave payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(room);
      const presence = pdfCollaborationRoomState.leave(room, socket.id);
      await socket.leave(roomName);
      if (presence) socket.to(roomName).emit(pdfCollaborationServerEvents.leave, presence);
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
      authedSocket.data.sqlErdRoomsByName.delete(roomName);

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
    registerGithubSourceSocketHandlers({
      context: authedSocket.data.auth,
      roomService: githubSourceRoomService,
      socket,
    });

    socket.on(sqlErdClientEvents.presenceUpdate, (payload) => {
      const presencePayload = readSqlErdPresenceUpdatePayload(payload);

      if (!presencePayload) {
        emitSqlErdError(socket, "sql-erd:presence:update payload is invalid");
        return;
      }

      const roomName = createSqlErdRoomName(presencePayload);

      if (
        authedSocket.data.sqlErdRevokedWorkspaceIds.has(
          presencePayload.workspaceId,
        )
      ) {
        socket.emit(
          sqlErdServerEvents.error,
          createSocketErrorPayload("forbidden", "SQLtoERD room access denied"),
        );
        return;
      }

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

    socket.on(pdfCollaborationClientEvents.pageUpdate, (payload) => {
      const update = readPdfCollaborationPageUpdate(payload);
      if (!update) {
        emitPdfCollaborationError(socket, "pdf-collaboration:page:update payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(update);
      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("room_not_joined", "join PDF room before updating page"),
        );
        return;
      }

      const presence = pdfCollaborationRoomState.updatePage(
        update,
        socket.id,
        update.pageNumber,
      );
      if (presence) socket.to(roomName).emit(pdfCollaborationServerEvents.pageUpdate, presence);
    });

    socket.on(pdfCollaborationClientEvents.pointerUpdate, (payload) => {
      const update = readPdfCollaborationPointerUpdate(payload);
      if (!update) {
        emitPdfCollaborationError(socket, "pdf-collaboration:pointer:update payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(update);
      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("room_not_joined", "join PDF room before updating pointer"),
        );
        return;
      }

      const pointer = pdfCollaborationRoomState.updatePointer(update, socket.id, update);
      if (pointer) socket.to(roomName).emit(pdfCollaborationServerEvents.pointerUpdate, pointer);
    });

    socket.on(pdfCollaborationClientEvents.strokeCommit, (payload) => {
      const commit = readPdfCollaborationStrokeCommit(payload);
      if (!commit) {
        emitPdfCollaborationError(socket, "pdf-collaboration:stroke:commit payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(commit);
      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("room_not_joined", "join PDF room before drawing"),
        );
        return;
      }

      const stroke = pdfCollaborationRoomState.commitStroke(commit, commit);
      socket.to(roomName).emit(pdfCollaborationServerEvents.strokeCommit, {
        ...commit,
        stroke,
      });
    });

    socket.on(pdfCollaborationClientEvents.strokeRemove, (payload) => {
      const remove = readPdfCollaborationStrokeRemove(payload);
      if (!remove) {
        emitPdfCollaborationError(socket, "pdf-collaboration:stroke:remove payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(remove);
      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("room_not_joined", "join PDF room before erasing"),
        );
        return;
      }

      if (pdfCollaborationRoomState.removeStroke(remove, remove.pageNumber, remove.strokeId)) {
        socket.to(roomName).emit(pdfCollaborationServerEvents.strokeRemove, remove);
      }
    });

    socket.on(pdfCollaborationClientEvents.strokesClear, (payload) => {
      const clear = readPdfCollaborationPageUpdate(payload);
      if (!clear) {
        emitPdfCollaborationError(socket, "pdf-collaboration:strokes:clear payload is invalid");
        return;
      }

      const roomName = createPdfCollaborationRoomName(clear);
      if (!socket.rooms.has(roomName)) {
        socket.emit(
          pdfCollaborationServerEvents.error,
          createSocketErrorPayload("room_not_joined", "join PDF room before clearing drawings"),
        );
        return;
      }

      pdfCollaborationRoomState.clearPageStrokes(clear, clear.pageNumber);
      socket.to(roomName).emit(pdfCollaborationServerEvents.strokesClear, clear);
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
        const sqlErdClearResults = sqlErdPresenceService.clearSocket(socket.id);
        const pageCursorLeaveEvents: PageCursorPresenceState[] = Object.values(
          authedSocket.data.pageCursorPresenceByRoom,
        );
        const pdfCollaborationLeaveEvents = pdfCollaborationRoomState.clearSocket(socket.id);
        authedSocket.data.pageCursorPresenceByRoom = {};
        authedSocket.data.sqlErdRoomsByName.clear();

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
        for (const pdfCollaborationPresence of pdfCollaborationLeaveEvents) {
          socket
            .to(createPdfCollaborationRoomName(pdfCollaborationPresence))
            .emit(pdfCollaborationServerEvents.leave, pdfCollaborationPresence);
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
      await unsubscribeGithubSourceInvalidations?.();
      await unsubscribeChatEvents?.();
      await unsubscribeWorkspaceMembershipRevocations?.();
      await chatSubscriptionWork.drain();
      await unsubscribePrReviewDecisions?.();
      await unsubscribePrReviewRoomDeleted?.();
      await unsubscribePrReviewConflictDrafts?.();
      await roomCheckpointService.close();
      await io.close();
      await redisAdapter?.close();
      await database.close();
    },
    getCanvasRoomStateStats() {
      return roomStateService.getStats();
    },
  };
}
