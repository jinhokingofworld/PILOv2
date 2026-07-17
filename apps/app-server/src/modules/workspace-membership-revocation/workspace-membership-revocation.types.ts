export const WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL =
  "workspace:membership-revocations";

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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
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
  value: unknown
): value is WorkspaceMembershipRevokedEventV1 {
  if (!isRecord(value)) return false;

  const keys = ["version", "type", "workspaceId", "userId", "occurredAt"];
  return (
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)) &&
    value.version === 1 &&
    value.type === "membership.revoked" &&
    isUuid(value.workspaceId) &&
    isUuid(value.userId) &&
    isCanonicalIsoTimestamp(value.occurredAt)
  );
}
