import { type Server, type Socket } from "socket.io";
import { createSocketErrorPayload } from "../../socket/socket-errors";
import { createCanvasRoomName } from "../../socket/room-names";
import type { CanvasRoomCheckpointService } from "../checkpoint/canvas-room-checkpoint.service";
import type { CanvasRoomRef } from "../contracts/canvas-types";
import type { CanvasPresenceService } from "../presence/canvas-presence.service";
import type { CanvasShapePreviewService } from "../preview/canvas-shape-preview.service";
import type { CanvasShapeLockService } from "../review-lock/canvas-shape-lock.service";
import { isClassicCanvasRoomAccess } from "../room/canvas-access.service";
import type { CanvasRoomService } from "../room/canvas-room.service";
import type { CanvasRoomStateService } from "../state/canvas-room-state.service";
import type { CanvasRecordingActivityService } from "../recording-activity/canvas-recording-activity.service";
import { canvasClientEvents, canvasServerEvents } from "./canvas-socket-events";
import {
  readCanvasJoinPayload,
  readCanvasPresenceUpdatePayload,
  readCanvasRoomRef,
  readCanvasRoomShapePatchPayload,
  readCanvasShapePreviewClearPayload,
  readCanvasShapePreviewPayload,
  readCanvasViewportLoadedPayload,
} from "./canvas-socket-payloads";
import type { CanvasAuthedSocket } from "./canvas-socket-types";

type CanvasLockReleasePayload = {
  canvasId: string;
  ownerUserId: string;
  shapeIds: string[];
  workspaceId: string;
};

export type RegisterCanvasSocketHandlersOptions = {
  emitLockReleases: (payload: CanvasLockReleasePayload) => void;
  io: Server;
  presenceService: CanvasPresenceService;
  roomCheckpointService: CanvasRoomCheckpointService;
  recordingActivityService: CanvasRecordingActivityService;
  roomService: CanvasRoomService;
  roomStateService: CanvasRoomStateService;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
  socket: CanvasAuthedSocket;
};

export function emitCanvasError(socket: Socket, message: string) {
  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("invalid_payload", message),
  );
}

export function assertCanvasRoomWritable(
  socket: CanvasAuthedSocket,
  roomName: string,
): boolean {
  const access = socket.data.canvasRoomAccess.get(roomName);
  const room = socket.data.canvasRoomsByName.get(roomName);

  if (
    access &&
    room &&
    !access.readOnly &&
    !(
      isClassicCanvasRoomAccess(access) &&
      socket.data.revokedClassicCanvasWorkspaceIds.has(room.workspaceId)
    )
  ) {
    return true;
  }

  socket.emit(
    canvasServerEvents.error,
    createSocketErrorPayload("forbidden", "canvas room is read-only"),
  );
  return false;
}

function hasCanvasRoomAccess(socket: CanvasAuthedSocket, roomName: string) {
  const access = socket.data.canvasRoomAccess.get(roomName);
  const room = socket.data.canvasRoomsByName.get(roomName);

  if (!access || !room) return false;
  return !(
    isClassicCanvasRoomAccess(access) &&
    socket.data.revokedClassicCanvasWorkspaceIds.has(room.workspaceId)
  );
}

export function registerCanvasSocketHandlers({
  emitLockReleases,
  io,
  presenceService,
  roomCheckpointService,
  recordingActivityService,
  roomService,
  roomStateService,
  shapeLockService,
  shapePreviewService,
  socket,
}: RegisterCanvasSocketHandlersOptions) {
  socket.on(canvasClientEvents.join, async (payload) => {
    const joinPayload = readCanvasJoinPayload(payload);

    if (!joinPayload) {
      emitCanvasError(socket, "canvas:join payload is invalid");
      return;
    }

    const result = await roomService.joinCanvasRoom(
      socket.data.auth,
      joinPayload,
    );

    if (!result.joined) {
      socket.emit(
        canvasServerEvents.error,
        createSocketErrorPayload("forbidden", "canvas room access denied"),
      );
      return;
    }

    const hasRevokedClassicAccess = () =>
      isClassicCanvasRoomAccess(result.access) &&
      socket.data.revokedClassicCanvasWorkspaceIds.has(
        joinPayload.workspaceId,
      );
    const rejectRevokedClassicJoin = () => {
      roomCheckpointService.revokeRoomAuthorization(
        joinPayload,
        socket.data.auth.userId,
      );
      socket.emit(
        canvasServerEvents.error,
        createSocketErrorPayload("forbidden", "canvas room access revoked"),
      );
    };

    if (hasRevokedClassicAccess()) {
      rejectRevokedClassicJoin();
      return;
    }

    await roomCheckpointService.flushCheckpointNow(
      joinPayload,
      socket.data.auth.token,
      socket.data.auth.userId,
    );
    if (hasRevokedClassicAccess()) {
      rejectRevokedClassicJoin();
      return;
    }
    const checkpointState = roomStateService.getCheckpointState(joinPayload);
    const joinedPayload = {
      ...result.payload,
      checkpointHistorySeq: checkpointState.checkpointHistorySeq,
      checkpointVersion: checkpointState.checkpointVersion,
      historySeq: checkpointState.historySeq,
      roomShapes: roomStateService.getCachedShapes(joinPayload),
    };

    await socket.join(result.roomName);
    if (hasRevokedClassicAccess()) {
      await socket.leave(result.roomName);
      rejectRevokedClassicJoin();
      return;
    }
    socket.data.canvasRoomAccess.set(result.roomName, result.access);
    socket.data.canvasRoomsByName.set(result.roomName, {
      canvasId: joinPayload.canvasId,
      workspaceId: joinPayload.workspaceId,
    });
    socket.emit(canvasServerEvents.joined, joinedPayload);
  });

  socket.on(canvasClientEvents.leave, async (payload) => {
    const room = readCanvasRoomRef(payload);

    if (!room) {
      emitCanvasError(socket, "canvas:leave payload is invalid");
      return;
    }

    const roomName = createCanvasRoomName(room);
    if (!socket.rooms.has(roomName) || !hasCanvasRoomAccess(socket, roomName)) {
      socket.emit(
        canvasServerEvents.error,
        createSocketErrorPayload(
          "room_not_joined",
          "join canvas room before leaving it",
        ),
      );
      return;
    }
    const leavePayload = presenceService.clearRoomPresence(socket.id, room);
    const lockReleasePayload = await shapeLockService.clearRoomLocks(
      socket.id,
      socket.data.auth.userId ?? socket.id,
      room,
    );
    const previewClearPayload = await shapePreviewService.clearRoomPreview(
      socket.id,
      socket.data.auth.userId ?? socket.id,
      room,
    );

    if (!socket.rooms.has(roomName) || !hasCanvasRoomAccess(socket, roomName)) {
      await socket.leave(roomName);
      return;
    }
    await roomCheckpointService.flushCheckpointNow(
      room,
      socket.data.auth.token,
      socket.data.auth.userId,
    );
    await socket.leave(roomName);
    socket.data.canvasRoomAccess.delete(roomName);
    socket.data.canvasRoomsByName.delete(roomName);

    if (leavePayload) {
      socket.to(roomName).emit(canvasServerEvents.presenceLeave, leavePayload);
    }

    if (lockReleasePayload) {
      emitLockReleases(lockReleasePayload);
    }

    if (previewClearPayload) {
      socket
        .to(roomName)
        .emit(canvasServerEvents.shapePreviewClear, previewClearPayload);
    }
  });

  socket.on(canvasClientEvents.presenceUpdate, (payload) => {
    const presencePayload = readCanvasPresenceUpdatePayload(payload);

    if (!presencePayload) {
      emitCanvasError(socket, "canvas:presence:update payload is invalid");
      return;
    }

    const roomName = createCanvasRoomName(presencePayload);

    if (!socket.rooms.has(roomName) || !hasCanvasRoomAccess(socket, roomName)) {
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
        displayName: socket.data.auth.displayName,
        userId: socket.data.auth.userId ?? socket.id,
      },
      presencePayload,
    );

    socket.to(roomName).emit(canvasServerEvents.presenceUpdate, presence);
  });

  socket.on(canvasClientEvents.viewportLoaded, (payload) => {
    const loadedPayload = readCanvasViewportLoadedPayload(payload);

    if (!loadedPayload) {
      emitCanvasError(socket, "canvas:viewport:loaded payload is invalid");
      return;
    }

    const roomName = createCanvasRoomName(loadedPayload);

    if (!socket.rooms.has(roomName) || !hasCanvasRoomAccess(socket, roomName)) {
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
    const patchPayload = readCanvasRoomShapePatchPayload(payload);

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

    if (!assertCanvasRoomWritable(socket, roomName)) {
      return;
    }

    const actorUserId = socket.data.auth.userId ?? socket.id;
    const authenticatedActorUserId = socket.data.auth.userId;
    const historyState = roomStateService.applyShapePatch(
      patchPayload,
      patchPayload,
      {
        actorUserId,
      },
    );
    if (authenticatedActorUserId) {
      for (const candidate of historyState.activityCandidates) {
        recordingActivityService.capture(
          patchPayload,
          authenticatedActorUserId,
          candidate,
        );
      }
    }
    const patchedShapeIds = [
      ...patchPayload.deletedShapeIds,
      ...patchPayload.upsertShapes.flatMap((shape) =>
        typeof shape.id === "string" ? [shape.id] : [],
      ),
    ];

    roomCheckpointService.scheduleCheckpoint(
      patchPayload,
      socket.data.auth.token,
      socket.data.auth.userId,
    );
    io.to(roomName).emit(canvasServerEvents.shapePatch, {
      ...patchPayload,
      actorUserId,
      canRedo: historyState.canRedo,
      canUndo: historyState.canUndo,
      historySeq: historyState.historySeq,
      sentAt: new Date().toISOString(),
    });
    void shapePreviewService
      .clearRoomPreview(
        socket.id,
        actorUserId,
        patchPayload,
        patchedShapeIds,
      )
      .then((previewClearPayload) => {
        if (!previewClearPayload) return;

        io.to(roomName).emit(
          canvasServerEvents.shapePreviewClear,
          previewClearPayload,
        );
      })
      .catch((error: unknown) => {
        console.warn("Canvas committed shape preview cleanup failed.", error);
      });
  });

  socket.on(canvasClientEvents.historyUndo, (payload) => {
    applyCanvasHistoryChange({
      action: "undo",
      io,
      payload,
      recordingActivityService,
      roomCheckpointService,
      roomStateService,
      socket,
    });
  });

  socket.on(canvasClientEvents.historyRedo, (payload) => {
    applyCanvasHistoryChange({
      action: "redo",
      io,
      payload,
      recordingActivityService,
      roomCheckpointService,
      roomStateService,
      socket,
    });
  });

  socket.on(canvasClientEvents.shapePreview, async (payload) => {
    const previewPayload = readCanvasShapePreviewPayload(payload);

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

    if (!assertCanvasRoomWritable(socket, roomName)) {
      return;
    }

    const previewEvent = {
      ...previewPayload,
      actorUserId: socket.data.auth.userId ?? socket.id,
      sentAt: new Date().toISOString(),
    };

    await shapePreviewService.updatePreview(
      socket.id,
      previewEvent.actorUserId,
      previewEvent,
    );

    if (!hasCanvasRoomAccess(socket, roomName)) {
      await shapePreviewService.clearRoomPreview(
        socket.id,
        previewEvent.actorUserId,
        previewPayload,
      );
      return;
    }

    socket.to(roomName).emit(canvasServerEvents.shapePreview, previewEvent);
  });

  socket.on(canvasClientEvents.shapePreviewClear, async (payload) => {
    const clearPayload = readCanvasShapePreviewClearPayload(payload);

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

    if (!assertCanvasRoomWritable(socket, roomName)) {
      return;
    }

    const clearEvent = await shapePreviewService.clearRoomPreview(
      socket.id,
      socket.data.auth.userId ?? socket.id,
      clearPayload,
      clearPayload.shapeIds,
    );

    if (!clearEvent) return;

    socket.to(roomName).emit(canvasServerEvents.shapePreviewClear, clearEvent);
  });

  socket.on("disconnect", () => {
    void cleanupCanvasSocket({
      emitLockReleases,
      recordingActivityService,
      roomCheckpointService,
      presenceService,
      shapeLockService,
      shapePreviewService,
      socket,
    }).catch((error) => {
      console.error("Realtime Canvas socket disconnect cleanup failed", error);
    });
  });
}

function applyCanvasHistoryChange({
  action,
  io,
  payload,
  recordingActivityService,
  roomCheckpointService,
  roomStateService,
  socket,
}: {
  action: "redo" | "undo";
  io: Server;
  payload: unknown;
  recordingActivityService: CanvasRecordingActivityService;
  roomCheckpointService: CanvasRoomCheckpointService;
  roomStateService: CanvasRoomStateService;
  socket: CanvasAuthedSocket;
}) {
  const room = readCanvasRoomRef(payload);

  if (!room) {
    emitCanvasError(
      socket,
      `canvas:room:history:${action} payload is invalid`,
    );
    return;
  }

  const roomName = createCanvasRoomName(room);

  if (!socket.rooms.has(roomName)) {
    socket.emit(
      canvasServerEvents.error,
      createSocketErrorPayload(
        "room_not_joined",
        `join canvas room before ${action === "undo" ? "undoing" : "redoing"} room history`,
      ),
    );
    return;
  }

  if (!assertCanvasRoomWritable(socket, roomName)) {
    return;
  }

  const historyPatch =
    action === "undo"
      ? roomStateService.undoLastHistory(room, {
          actorUserId: socket.data.auth.userId ?? socket.id,
        })
      : roomStateService.redoLastHistory(room, {
          actorUserId: socket.data.auth.userId ?? socket.id,
        });

  if (!historyPatch) return;

  const actorUserId = socket.data.auth.userId ?? socket.id;
  if (socket.data.auth.userId) {
    for (const candidate of historyPatch.activityCandidates) {
      recordingActivityService.capture(room, socket.data.auth.userId, candidate);
    }
  }

  roomCheckpointService.scheduleCheckpoint(
    room,
    socket.data.auth.token,
    socket.data.auth.userId,
  );
  io.to(roomName).emit(canvasServerEvents.shapePatch, {
    ...room,
    actorUserId,
    canRedo: historyPatch.canRedo,
    canUndo: historyPatch.canUndo,
    deletedShapeIds: historyPatch.deletedShapeIds,
    historySeq: historyPatch.historySeq,
    sentAt: new Date().toISOString(),
    upsertShapes: historyPatch.upsertShapes,
  });
}

async function cleanupCanvasSocket({
  emitLockReleases,
  recordingActivityService,
  presenceService,
  roomCheckpointService,
  shapeLockService,
  shapePreviewService,
  socket,
}: {
  emitLockReleases: (payload: CanvasLockReleasePayload) => void;
  recordingActivityService: CanvasRecordingActivityService;
  presenceService: CanvasPresenceService;
  roomCheckpointService: CanvasRoomCheckpointService;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
  socket: CanvasAuthedSocket;
}) {
  const canvasRooms: CanvasRoomRef[] = Array.from(
    socket.data.canvasRoomsByName.values(),
  );
  const leaveEvents = presenceService.clearSocket(socket.id);

  socket.data.canvasRoomAccess.clear();
  socket.data.canvasRoomsByName.clear();

  const [lockReleaseEvents, previewClearEvents] = await Promise.all([
    shapeLockService.clearSocket(socket.id),
    shapePreviewService.clearSocket(socket.id)
  ]);

  await Promise.all(canvasRooms.map(room =>
    roomCheckpointService.flushCheckpointNow(
      room,
      socket.data.auth.token,
      socket.data.auth.userId,
    )
  ));
  await Promise.all(canvasRooms.map(room => recordingActivityService.flushRoom(room)));

  for (const leavePayload of leaveEvents) {
    socket
      .to(createCanvasRoomName(leavePayload))
      .emit(canvasServerEvents.presenceLeave, leavePayload);
  }

  for (const lockReleasePayload of lockReleaseEvents) {
    emitLockReleases(lockReleasePayload);
  }

  for (const previewClearPayload of previewClearEvents) {
    socket
      .to(createCanvasRoomName(previewClearPayload))
      .emit(canvasServerEvents.shapePreviewClear, previewClearPayload);
  }
}
