export const WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL =
  "workspace:membership-revocations";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceMembershipRevokedEventV1 = {
  version: 1;
  type: "membership.revoked";
  workspaceId: string;
  userId: string;
  occurredAt: string;
};

export type WorkspaceMembershipRevocationSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
  };
  disconnect: (close?: boolean) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
};

export type WorkspaceMembershipRevocationIo = {
  sockets: {
    adapter: {
      rooms: ReadonlyMap<string, ReadonlySet<string>>;
    };
    sockets: ReadonlyMap<string, WorkspaceMembershipRevocationSocket>;
  };
};

type LocalSocketRegistry = {
  rooms: ReadonlyMap<string, ReadonlySet<string>>;
  sockets: ReadonlyMap<string, WorkspaceMembershipRevocationSocket>;
};

export type WorkspaceMembershipRevocationFence = {
  clearSocket: (socketId: string) => void;
  isRevoked: (socketId: string, workspaceId: string) => boolean;
  revokeUserWorkspace: (
    io: WorkspaceMembershipRevocationIo,
    userId: string,
    workspaceId: string,
  ) => void;
};

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
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

export function readAuthenticatedMembershipUserId(
  socket: WorkspaceMembershipRevocationSocket,
): string | null {
  return isUuid(socket.data.auth?.userId) ? socket.data.auth.userId : null;
}

export function disconnectMembershipSocket(
  socket: WorkspaceMembershipRevocationSocket,
): boolean {
  try {
    socket.disconnect(true);
    return true;
  } catch {
    return false;
  }
}

export function readLocalMembershipRoomSockets(
  io: WorkspaceMembershipRevocationIo,
  roomName: string,
): WorkspaceMembershipRevocationSocket[] | null {
  let registry: LocalSocketRegistry;
  try {
    registry = {
      rooms: io.sockets.adapter.rooms,
      sockets: io.sockets.sockets,
    };
  } catch {
    return null;
  }

  const socketIds = registry.rooms.get(roomName);
  if (!socketIds) return [];

  const sockets: WorkspaceMembershipRevocationSocket[] = [];
  for (const socketId of socketIds) {
    const socket = registry.sockets.get(socketId);
    if (!socket) return null;
    sockets.push(socket);
  }
  return sockets;
}

export function createWorkspaceMembershipRevocationFence(): WorkspaceMembershipRevocationFence {
  const revokedWorkspaceIdsBySocket = new Map<string, Set<string>>();

  return {
    clearSocket(socketId) {
      revokedWorkspaceIdsBySocket.delete(socketId);
    },
    isRevoked(socketId, workspaceId) {
      return revokedWorkspaceIdsBySocket.get(socketId)?.has(workspaceId) ?? false;
    },
    revokeUserWorkspace(io, userId, workspaceId) {
      for (const socket of io.sockets.sockets.values()) {
        if (readAuthenticatedMembershipUserId(socket) !== userId) continue;
        const revokedWorkspaceIds =
          revokedWorkspaceIdsBySocket.get(socket.id) ?? new Set<string>();
        revokedWorkspaceIds.add(workspaceId);
        revokedWorkspaceIdsBySocket.set(socket.id, revokedWorkspaceIds);
      }
    }
  };
}
