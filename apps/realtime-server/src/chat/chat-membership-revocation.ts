import { isUuid } from "./chat-identifiers";
import {
  readChatLocalSocketRegistry,
  readLocalChatRoomSockets,
} from "./chat-local-sockets";
import {
  type ChatMembershipSocket,
  disconnectInvalidChatSocket,
  evictChatSocket,
  readAuthenticatedChatUserId,
} from "./chat-membership-eviction";
import { createChatUserRoomName } from "./chat-room.service";

export const WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL =
  "workspace:membership-revocations";

export type WorkspaceMembershipRevokedEventV1 = {
  version: 1;
  type: "membership.revoked";
  workspaceId: string;
  userId: string;
  occurredAt: string;
};

type ChatMembershipIo = Parameters<typeof readChatLocalSocketRegistry>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const valueKeys = Object.keys(value);
  return (
    valueKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export function isWorkspaceMembershipRevokedEvent(
  value: unknown,
): value is WorkspaceMembershipRevokedEventV1 {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "version",
      "type",
      "workspaceId",
      "userId",
      "occurredAt",
    ]) &&
    value.version === 1 &&
    value.type === "membership.revoked" &&
    isUuid(value.workspaceId) &&
    isUuid(value.userId) &&
    isCanonicalIsoTimestamp(value.occurredAt)
  );
}

export function createChatMembershipRevocationHandler({
  io,
}: {
  io: ChatMembershipIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      const registry = readChatLocalSocketRegistry(io);
      if (!registry) return false;
      const sockets = readLocalChatRoomSockets(
        registry,
        createChatUserRoomName(payload.workspaceId, payload.userId),
      );
      if (!sockets) return false;

      const cleanupResults = await Promise.all(
        sockets.map((socket) => {
          if (readAuthenticatedChatUserId(socket) !== payload.userId) {
            return disconnectInvalidChatSocket(socket);
          }
          return evictChatSocket(socket, payload.workspaceId, payload.userId);
        }),
      );
      return cleanupResults.every(Boolean);
    },
  };
}
