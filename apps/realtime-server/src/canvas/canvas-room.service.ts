import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasAccessContext,
  CanvasAccessService,
  CanvasRoomAccess,
} from "./canvas-access.service";
import type { CanvasJoinedPayload, CanvasJoinPayload } from "./canvas-types";
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
  presenceService,
  roomStateService,
  shapeLockService,
  shapePreviewService,
}: {
  accessService: CanvasAccessService;
  presenceService: CanvasPresenceService;
  roomStateService: CanvasRoomStateService;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
}): CanvasRoomService {
  return {
    async joinCanvasRoom(context, payload) {
      const access = await accessService.getCanvasRoomAccess(context, payload);

      if (!access) {
        return { joined: false, reason: "forbidden" };
      }

      const latestOpSeq = 0;
      const checkpointState = roomStateService.getCheckpointState(payload);

      return {
        access,
        joined: true,
        payload: {
          canvasId: payload.canvasId,
          checkpointHistorySeq: checkpointState.checkpointHistorySeq,
          checkpointVersion: checkpointState.checkpointVersion,
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
