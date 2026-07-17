import {
  isWorkspaceMembershipRevokedEvent,
} from "../workspace-membership-revocation/workspace-membership-revocation";
import { pdfCollaborationServerEvents } from "./pdf-collaboration-events";
import { createPdfCollaborationRoomName } from "./pdf-collaboration-room";
import type { createPdfCollaborationRoomState } from "./pdf-collaboration-room-state";
import type { PdfCollaborationPresence } from "./pdf-collaboration-types";

type PdfMembershipSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
  };
  disconnect: (close?: boolean) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
};

type PdfMembershipIo = {
  sockets: {
    sockets: ReadonlyMap<string, PdfMembershipSocket>;
  };
  to: (roomName: string) => {
    emit: (event: string, payload: PdfCollaborationPresence) => unknown;
  };
};

type PdfCollaborationRoomState = ReturnType<
  typeof createPdfCollaborationRoomState
>;

export function createPdfCollaborationMembershipRevocationHandler({
  io,
  roomState,
}: {
  io: PdfMembershipIo;
  roomState: PdfCollaborationRoomState;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      try {
        const results = await Promise.all(
          Array.from(io.sockets.sockets.values(), async (socket) => {
            if (socket.data.auth?.userId !== payload.userId) return true;

            const removedPresence = roomState.clearWorkspaceSocket(
              socket.id,
              payload.workspaceId,
            );
            if (!removedPresence.length) return true;

            const leaveResults = await Promise.allSettled(
              removedPresence.map((presence) =>
                socket.leave(createPdfCollaborationRoomName(presence)),
              ),
            );
            for (const presence of removedPresence) {
              io.to(createPdfCollaborationRoomName(presence)).emit(
                pdfCollaborationServerEvents.leave,
                presence,
              );
            }

            if (leaveResults.every((result) => result.status === "fulfilled")) {
              return true;
            }

            try {
              socket.disconnect(true);
              return true;
            } catch {
              return false;
            }
          }),
        );
        return results.every(Boolean);
      } catch {
        return false;
      }
    },
  };
}
