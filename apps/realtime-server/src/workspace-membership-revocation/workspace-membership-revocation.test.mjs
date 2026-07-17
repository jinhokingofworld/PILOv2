import assert from "node:assert/strict";
import test from "node:test";

let membershipRevocationModule;
try {
  membershipRevocationModule = await import(
    "../../dist/workspace-membership-revocation/workspace-membership-revocation.js"
  );
} catch {
  assert.fail("Workspace membership revocation contract is missing");
}

const { isWorkspaceMembershipRevokedEvent } = membershipRevocationModule;

const event = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId: "22222222-2222-4222-8222-222222222222",
  version: 1,
  workspaceId: "11111111-1111-4111-8111-111111111111",
};

test("accepts only an exact Workspace membership revocation V1 event", () => {
  assert.equal(isWorkspaceMembershipRevokedEvent(event), true);

  for (const invalidEvent of [
    { ...event, version: 2 },
    { ...event, userId: "not-a-uuid" },
    { ...event, extra: true },
  ]) {
    assert.equal(isWorkspaceMembershipRevokedEvent(invalidEvent), false);
  }
});
