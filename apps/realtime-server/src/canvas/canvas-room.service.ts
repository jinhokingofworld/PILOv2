import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasAccessContext,
  CanvasAccessService,
  CanvasRoomAccess,
} from "./canvas-access.service";
import type { CanvasJoinedPayload, CanvasJoinPayload } from "./canvas-types";
import type { CanvasPresenceService } from "./canvas-presence.service";

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
}: {
  accessService: CanvasAccessService;
  presenceService: CanvasPresenceService;
}): CanvasRoomService {
  return {
    async joinCanvasRoom(context, payload) {
      const access = await accessService.getCanvasRoomAccess(context, payload);

      if (!access) {
        return { joined: false, reason: "forbidden" };
      }

      const latestOpSeq = 0;

      return {
        access,
        joined: true,
        payload: {
          canvasId: payload.canvasId,
          latestOpSeq,
          presence: presenceService.getPresence(payload),
          readOnly: access.readOnly,
          syncRequired: (payload.lastSeenOpSeq ?? 0) < latestOpSeq,
          workspaceId: payload.workspaceId,
        },
        roomName: createCanvasRoomName(payload),
      };
    },
  };
}
