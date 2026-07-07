import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasAccessContext,
  CanvasAccessService,
} from "./canvas-access.service";
import type { CanvasJoinedPayload, CanvasJoinPayload } from "./canvas-types";
import type { CanvasPresenceService } from "./canvas-presence.service";

export type CanvasRoomJoinResult =
  | {
      joined: false;
      reason: "forbidden";
    }
  | {
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
}: {
  accessService: CanvasAccessService;
  presenceService: CanvasPresenceService;
}): CanvasRoomService {
  return {
    async joinCanvasRoom(context, payload) {
      const canJoin = await accessService.canJoinCanvas(context, payload);

      if (!canJoin) {
        return { joined: false, reason: "forbidden" };
      }

      const latestOpSeq = 0;

      return {
        joined: true,
        payload: {
          canvasId: payload.canvasId,
          latestOpSeq,
          presence: presenceService.getPresence(payload),
          syncRequired: (payload.lastSeenOpSeq ?? 0) < latestOpSeq,
          workspaceId: payload.workspaceId,
        },
        roomName: createCanvasRoomName(payload),
      };
    },
  };
}
