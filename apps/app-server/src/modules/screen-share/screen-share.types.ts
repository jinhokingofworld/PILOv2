export const WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL =
  "workspace-screen-share:events:v1";
export const WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM =
  "workspace-screen-share:outbox:v1";
export const WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM =
  "workspace-screen-share:cleanup:v1";
export const WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATIONS =
  "workspace-screen-share:viewer-revocations:v1";
export const WORKSPACE_SCREEN_SHARE_DEADLINES =
  "workspace-screen-share:deadlines:v1";
export const SCREEN_SHARE_HARD_LIMIT_SECONDS = 12 * 60 * 60;
export const SCREEN_SHARE_STATE_TTL_SECONDS = SCREEN_SHARE_HARD_LIMIT_SECONDS;
export const SCREEN_SHARE_STARTING_LEASE_MS = 60 * 1000;
export const SCREEN_SHARE_ENDED_ROOM_TOMBSTONE_TTL_SECONDS = 5 * 60;
export const SCREEN_SHARE_JOIN_TOKEN_TTL_SECONDS = 45;
export const SCREEN_SHARE_VIEWER_REGISTRY_TTL_SECONDS = 60;

export type WorkspaceScreenShareSession = {
  sessionId: string;
  workspaceId: string;
  sharerUserId: string;
  sharerDisplayName: string;
  sharerAvatarUrl: string | null;
  sharerLiveKitIdentity: string;
  livekitRoomName: string;
  status: "starting" | "active";
  createdAt: string;
  startedAt: string | null;
};

export type PublicWorkspaceScreenShareSession = {
  id: string;
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: string;
};

export type WorkspaceScreenShareRedisEvent =
  | {
      version: 1;
      event: "workspace-screen-share:started";
      workspaceId: string;
      session: PublicWorkspaceScreenShareSession;
    }
  | {
      version: 1;
      event: "workspace-screen-share:ended";
      workspaceId: string;
      sessionId: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspaceScreenShareSession(
  encoded: string
): WorkspaceScreenShareSession {
  const value: unknown = JSON.parse(encoded);
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.sharerUserId !== "string" ||
    typeof value.sharerDisplayName !== "string" ||
    (typeof value.sharerAvatarUrl !== "string" &&
      value.sharerAvatarUrl !== null) ||
    typeof value.sharerLiveKitIdentity !== "string" ||
    typeof value.livekitRoomName !== "string" ||
    (value.status !== "starting" && value.status !== "active") ||
    typeof value.createdAt !== "string" ||
    (typeof value.startedAt !== "string" && value.startedAt !== null)
  ) {
    throw new Error("Invalid Workspace screen share session");
  }

  return {
    sessionId: value.sessionId,
    workspaceId: value.workspaceId,
    sharerUserId: value.sharerUserId,
    sharerDisplayName: value.sharerDisplayName,
    sharerAvatarUrl: value.sharerAvatarUrl,
    sharerLiveKitIdentity: value.sharerLiveKitIdentity,
    livekitRoomName: value.livekitRoomName,
    status: value.status,
    createdAt: value.createdAt,
    startedAt: value.startedAt
  };
}
