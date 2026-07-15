import type { IncomingMessage } from "node:http";
import {
  TLSocketRoom,
  TLSyncErrorCloseEventCode,
  TLSyncErrorCloseEventReason,
  type RoomSnapshot,
  type WebSocketMinimal,
} from "@tldraw/sync-core";
import type { WebSocket } from "ws";

import { createRealtimeSessionService } from "../auth/session.service";
import type { RealtimeDatabase } from "../database/database";
import { createCanvasTldrawSyncRoomName } from "../socket/room-names";
import { createCanvasAccessService } from "./canvas-access.service";
import type { CanvasRoomRef } from "./canvas-types";

const CANVAS_TLDRAW_SYNC_PROVIDER_TYPE = "tldraw_sync";
const CANVAS_TLDRAW_SYNC_PERSIST_DEBOUNCE_MS = 1_000;

type CanvasTldrawSyncRoomServiceOptions = {
  database: RealtimeDatabase;
};

type CanvasTldrawSyncRoomService = {
  close: () => Promise<void>;
  handleConnection: (
    websocket: WebSocket,
    request: IncomingMessage,
  ) => Promise<void>;
};

type CanvasSyncDocumentRow = {
  snapshot: unknown | null;
  version: number;
};

type ActiveRoom = {
  room: TLSocketRoom;
  persistTimer: NodeJS.Timeout | null;
  roomRef: CanvasRoomRef;
};

export function createCanvasTldrawSyncRoomService({
  database,
}: CanvasTldrawSyncRoomServiceOptions): CanvasTldrawSyncRoomService {
  const sessionService = createRealtimeSessionService(database);
  const accessService = createCanvasAccessService(database);
  const rooms = new Map<string, ActiveRoom>();

  async function loadRoomSnapshot(roomRef: CanvasRoomRef) {
    const document = await database.queryOne<CanvasSyncDocumentRow>(
      `
        SELECT snapshot, version
        FROM canvas_sync_documents
        WHERE workspace_id = $1
          AND canvas_id = $2
          AND provider_type = $3
        LIMIT 1
      `,
      [
        roomRef.workspaceId,
        roomRef.canvasId,
        CANVAS_TLDRAW_SYNC_PROVIDER_TYPE,
      ],
    );

    if (!isRoomSnapshot(document?.snapshot)) {
      return null;
    }

    return document.snapshot;
  }

  async function persistRoomSnapshot(activeRoom: ActiveRoom) {
    const snapshot = activeRoom.room.getCurrentSnapshot();

    await database.execute(
      `
        INSERT INTO canvas_sync_documents (
          workspace_id,
          canvas_id,
          provider_type,
          snapshot,
          version,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, 1, now(), now())
        ON CONFLICT (workspace_id, canvas_id, provider_type)
        DO UPDATE SET
          snapshot = EXCLUDED.snapshot,
          version = canvas_sync_documents.version + 1,
          updated_at = now()
      `,
      [
        activeRoom.roomRef.workspaceId,
        activeRoom.roomRef.canvasId,
        CANVAS_TLDRAW_SYNC_PROVIDER_TYPE,
        JSON.stringify(snapshot),
      ],
    );
  }

  function schedulePersist(roomName: string) {
    const activeRoom = rooms.get(roomName);
    if (!activeRoom) {
      return;
    }

    if (activeRoom.persistTimer) {
      clearTimeout(activeRoom.persistTimer);
    }

    activeRoom.persistTimer = setTimeout(() => {
      activeRoom.persistTimer = null;
      void persistRoomSnapshot(activeRoom).catch((error) => {
        console.error("Canvas tldraw sync snapshot persist failed", {
          canvasId: activeRoom.roomRef.canvasId,
          error,
          workspaceId: activeRoom.roomRef.workspaceId,
        });
      });
    }, CANVAS_TLDRAW_SYNC_PERSIST_DEBOUNCE_MS);
  }

  async function getOrCreateRoom(roomRef: CanvasRoomRef) {
    const roomName = createCanvasTldrawSyncRoomName(roomRef);
    const existingRoom = rooms.get(roomName);

    if (existingRoom && !existingRoom.room.isClosed()) {
      return existingRoom;
    }

    const snapshot = await loadRoomSnapshot(roomRef);
    const activeRoom: ActiveRoom = {
      persistTimer: null,
      room: new TLSocketRoom({
        initialSnapshot: snapshot ?? undefined,
        onDataChange: () => schedulePersist(roomName),
        onSessionRemoved: (room, { numSessionsRemaining }) => {
          if (numSessionsRemaining > 0) {
            return;
          }

          const currentRoom = rooms.get(roomName);
          if (!currentRoom || currentRoom.room !== room) {
            return;
          }

          if (currentRoom.persistTimer) {
            clearTimeout(currentRoom.persistTimer);
            currentRoom.persistTimer = null;
          }

          void persistRoomSnapshot(currentRoom)
            .catch((error) => {
              console.error("Canvas tldraw sync room close persist failed", {
                canvasId: currentRoom.roomRef.canvasId,
                error,
                workspaceId: currentRoom.roomRef.workspaceId,
              });
            })
            .finally(() => {
              room.close();
              rooms.delete(roomName);
            });
        },
      }),
      roomRef,
    };

    rooms.set(roomName, activeRoom);
    return activeRoom;
  }

  return {
    async close() {
      const closePromises: Array<Promise<void>> = [];

      for (const [roomName, activeRoom] of rooms) {
        if (activeRoom.persistTimer) {
          clearTimeout(activeRoom.persistTimer);
          activeRoom.persistTimer = null;
        }

        closePromises.push(
          persistRoomSnapshot(activeRoom)
            .catch((error) => {
              console.error("Canvas tldraw sync shutdown persist failed", {
                canvasId: activeRoom.roomRef.canvasId,
                error,
                workspaceId: activeRoom.roomRef.workspaceId,
              });
            })
            .finally(() => {
              activeRoom.room.close();
              rooms.delete(roomName);
            }),
        );
      }

      await Promise.all(closePromises);
    },
    async handleConnection(websocket, request) {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
      const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
      const canvasId = url.searchParams.get("canvasId")?.trim() ?? "";
      const token =
        url.searchParams.get("accessToken")?.trim() ??
        url.searchParams.get("token")?.trim() ??
        "";
      const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";

      if (!workspaceId || !canvasId || !token || !sessionId) {
        closeSocket(websocket, TLSyncErrorCloseEventReason.NOT_AUTHENTICATED);
        return;
      }

      const session = await sessionService.validateSessionToken(token);
      if (!session) {
        closeSocket(websocket, TLSyncErrorCloseEventReason.NOT_AUTHENTICATED);
        return;
      }

      const roomRef = { canvasId, workspaceId };
      const access = await accessService.getCanvasTldrawSyncRoomAccess(
        { token, userId: session.userId },
        roomRef,
      );

      if (!access) {
        closeSocket(websocket, TLSyncErrorCloseEventReason.FORBIDDEN);
        return;
      }

      const activeRoom = await getOrCreateRoom(roomRef);
      activeRoom.room.handleSocketConnect({
        isReadonly: access.readOnly,
        sessionId,
        socket: websocket as unknown as WebSocketMinimal,
      });
    },
  };
}

function closeSocket(
  websocket: WebSocket,
  reason: TLSyncErrorCloseEventReason,
) {
  websocket.close(TLSyncErrorCloseEventCode, reason);
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    return false;
  }

  return value.documents.every(
    (document) =>
      isRecord(document) &&
      typeof document.lastChangedClock === "number" &&
      isRecord(document.state),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
