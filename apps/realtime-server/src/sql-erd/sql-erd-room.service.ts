import { createSqlErdRoomName } from "../socket/room-names";
import type { SqlErdAccessService } from "./sql-erd-access.service";
import type { SqlErdPresenceService } from "./sql-erd-presence.service";
import type {
  SqlErdAccessContext,
  SqlErdJoinedPayload,
  SqlErdJoinPayload,
} from "./sql-erd-types";

export type SqlErdRoomJoinResult =
  | { joined: false; reason: "forbidden" }
  | {
      joined: true;
      payload: SqlErdJoinedPayload;
      roomName: string;
    };

export type SqlErdRoomService = {
  joinSqlErdRoom: (
    context: SqlErdAccessContext,
    payload: SqlErdJoinPayload,
  ) => Promise<SqlErdRoomJoinResult>;
};

export function createSqlErdRoomService({
  accessService,
  presenceService,
}: {
  accessService: SqlErdAccessService;
  presenceService: SqlErdPresenceService;
}): SqlErdRoomService {
  return {
    async joinSqlErdRoom(context, payload) {
      const allowed = await accessService.canJoinSqlErdRoom(context, payload);

      if (!allowed) {
        return { joined: false, reason: "forbidden" };
      }

      return {
        joined: true,
        payload: {
          latestOpSeq: 0,
          presence: presenceService.getPresence(payload),
          sessionId: payload.sessionId,
          workspaceId: payload.workspaceId,
        },
        roomName: createSqlErdRoomName(payload),
      };
    },
  };
}
