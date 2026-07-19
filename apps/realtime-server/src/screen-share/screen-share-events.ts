export const WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL =
  "workspace-screen-share:events:v1";

export const workspaceScreenShareServerEvents = {
  ended: "workspace-screen-share:ended",
  started: "workspace-screen-share:started",
} as const;

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
      event: typeof workspaceScreenShareServerEvents.started;
      workspaceId: string;
      session: PublicWorkspaceScreenShareSession;
    }
  | {
      version: 1;
      event: typeof workspaceScreenShareServerEvents.ended;
      workspaceId: string;
      sessionId: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isPublicSharer(
  value: unknown,
): value is PublicWorkspaceScreenShareSession["sharer"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["userId", "displayName", "avatarUrl"]) &&
    isUuid(value.userId) &&
    typeof value.displayName === "string" &&
    (value.avatarUrl === null || typeof value.avatarUrl === "string")
  );
}

function isPublicSession(
  value: unknown,
): value is PublicWorkspaceScreenShareSession {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "sharer", "startedAt"]) &&
    isUuid(value.id) &&
    isPublicSharer(value.sharer) &&
    isCanonicalIsoTimestamp(value.startedAt)
  );
}

export function readWorkspaceScreenShareRedisEvent(
  value: unknown,
): WorkspaceScreenShareRedisEvent | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isUuid(value.workspaceId)
  ) {
    return null;
  }

  if (value.event === workspaceScreenShareServerEvents.started) {
    if (
      !hasExactKeys(value, ["version", "event", "workspaceId", "session"]) ||
      !isPublicSession(value.session)
    ) {
      return null;
    }

    return {
      event: value.event,
      session: value.session,
      version: value.version,
      workspaceId: value.workspaceId,
    };
  }

  if (value.event === workspaceScreenShareServerEvents.ended) {
    if (
      !hasExactKeys(value, [
        "version",
        "event",
        "workspaceId",
        "sessionId",
      ]) ||
      !isUuid(value.sessionId)
    ) {
      return null;
    }

    return {
      event: value.event,
      sessionId: value.sessionId,
      version: value.version,
      workspaceId: value.workspaceId,
    };
  }

  return null;
}
