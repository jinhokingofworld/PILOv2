import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasAccessContext,
  CanvasAccessService,
  CanvasRoomAccess,
} from "./canvas-access.service";
import type {
  CanvasJoinedPayload,
  CanvasJoinPayload,
  CanvasLoadedViewportBounds,
  CanvasRoomRef,
} from "./canvas-types";
import type { CanvasPresenceService } from "./canvas-presence.service";
import type { CanvasRoomStateService } from "./canvas-room-state.service";
import type { CanvasShapeLockService } from "./canvas-shape-lock.service";
import type { CanvasShapePreviewService } from "./canvas-shape-preview.service";

export type CanvasRoomJoinResult =
  | {
      joined: false;
      reason: "forbidden";
    }
  | {
      access: CanvasRoomAccess;
      joined: true;
      payload: CanvasJoinedPayload;
      roomName: string;
    };

export type CanvasRoomService = {
  joinCanvasRoom: (
    context: CanvasAccessContext,
    payload: CanvasJoinPayload,
  ) => Promise<CanvasRoomJoinResult>;
};

export function createCanvasRoomService({
  accessService,
  appServerUrl,
  presenceService,
  roomStateService,
  shapeLockService,
  shapePreviewService,
}: {
  accessService: CanvasAccessService;
  appServerUrl: string;
  presenceService: CanvasPresenceService;
  roomStateService: CanvasRoomStateService;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
}): CanvasRoomService {
  async function hydrateInitialViewportIfNeeded(
    context: CanvasAccessContext,
    room: CanvasRoomRef,
    bounds: CanvasLoadedViewportBounds | undefined,
  ) {
    if (!bounds || roomStateService.getCachedShapes(room).length > 0) {
      return;
    }

    const search = new URLSearchParams({
      height: String(bounds.height),
      margin: String(bounds.margin),
      width: String(bounds.width),
      x: String(bounds.x),
      y: String(bounds.y),
    });
    const path = `/workspaces/${encodeURIComponent(
      room.workspaceId,
    )}/canvases/${encodeURIComponent(room.canvasId)}/shapes?${search.toString()}`;

    try {
      const response = await fetch(`${appServerUrl}${path}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${context.token}`,
        },
        method: "GET",
      });

      if (!response.ok) {
        console.warn("Canvas room initial viewport hydrate failed.", {
          canvasId: room.canvasId,
          status: response.status,
          workspaceId: room.workspaceId,
        });
        return;
      }

      const responseBody = await readResponseJson(response);
      const shapes = readApiShapeList(responseBody);

      if (!shapes) {
        console.warn("Canvas room initial viewport hydrate returned invalid payload.", {
          canvasId: room.canvasId,
          workspaceId: room.workspaceId,
        });
        return;
      }

      roomStateService.recordLoadedViewport(room, bounds, shapes);
    } catch (error) {
      console.warn("Canvas room initial viewport hydrate failed.", error);
    }
  }

  return {
    async joinCanvasRoom(context, payload) {
      const access = await accessService.getCanvasRoomAccess(context, payload);

      if (!access) {
        return { joined: false, reason: "forbidden" };
      }

      await hydrateInitialViewportIfNeeded(
        context,
        payload,
        payload.initialViewportBounds,
      );

      const latestOpSeq = 0;
      const checkpointState = roomStateService.getCheckpointState(payload);
      const historyState = roomStateService.getHistoryState(payload);

      return {
        access,
        joined: true,
        payload: {
          canRedo: historyState.canRedo,
          canUndo: historyState.canUndo,
          canvasId: payload.canvasId,
          checkpointHistorySeq: checkpointState.checkpointHistorySeq,
          checkpointVersion: checkpointState.checkpointVersion,
          historySeq: historyState.historySeq,
          latestOpSeq,
          loadedRegions: roomStateService.getLoadedRegions(payload),
          previews: await shapePreviewService.getRoomPreviews(payload),
          presence: presenceService.getPresence(payload),
          readOnly: access.readOnly,
          roomShapes: roomStateService.getCachedShapes(payload),
          shapeLocks: await shapeLockService.getRoomLocks(payload),
          syncRequired: (payload.lastSeenOpSeq ?? 0) < latestOpSeq,
          workspaceId: payload.workspaceId,
        },
        roomName: createCanvasRoomName(payload),
      };
    },
  };
}

async function readResponseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapApiResponseData(value: unknown) {
  if (isRecord(value) && value.success === true && "data" in value) {
    return value.data;
  }

  return value;
}

function readApiShapeList(value: unknown): Record<string, unknown>[] | null {
  const data = unwrapApiResponseData(value);

  if (!Array.isArray(data) || !data.every(isRecord)) {
    return null;
  }

  return data;
}
