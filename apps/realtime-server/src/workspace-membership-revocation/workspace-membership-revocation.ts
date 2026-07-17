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
