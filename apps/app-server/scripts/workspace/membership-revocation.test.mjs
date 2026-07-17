import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceService } from "../../dist/modules/workspace/workspace.service.js";

const ownerUserId = "11111111-1111-4111-8111-111111111111";
const memberUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

function workspaceRow(role) {
  return {
    id: workspaceId,
    name: "PILO",
    icon: null,
    owner_user_id: ownerUserId,
    role,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
  };
}

function createDatabase({ role, failCommit = false, sequence }) {
  return {
    async execute() {
      sequence.push("membership:deleted-without-transaction");
      return { rowCount: 1, rows: [] };
    },
    async queryOne() {
      return workspaceRow(role);
    },
    async transaction(callback) {
      sequence.push("transaction:begin");
      const result = await callback({
        async execute() {
          sequence.push("membership:deleted");
          return { rowCount: 1, rows: [] };
        },
        async queryOne() {
          return { role: "member" };
        },
      });
      if (failCommit) {
        sequence.push("transaction:rollback");
        throw new Error("commit failed");
      }
      sequence.push("transaction:commit");
      return result;
    },
  };
}

function createPublisher(sequence, { reject = false } = {}) {
  return {
    calls: [],
    async publishMembershipRevoked(targetWorkspaceId, targetUserId) {
      sequence.push("revocation:published");
      this.calls.push({
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      });
      if (reject) throw new Error("Redis publish failed");
    },
  };
}

test("removeMember는 membership transaction commit 후 회수 event를 발행한다", async () => {
  const sequence = [];
  const publisher = createPublisher(sequence);
  const service = new WorkspaceService(
    createDatabase({ role: "owner", sequence }),
    publisher,
  );

  assert.deepEqual(
    await service.removeMember(ownerUserId, workspaceId, memberUserId),
    { removed: true },
  );
  assert.deepEqual(publisher.calls, [{ workspaceId, userId: memberUserId }]);
  assert.ok(
    sequence.indexOf("transaction:commit") <
      sequence.indexOf("revocation:published"),
  );
});

test("leaveWorkspace는 membership transaction commit 후 회수 event를 발행한다", async () => {
  const sequence = [];
  const publisher = createPublisher(sequence);
  const service = new WorkspaceService(
    createDatabase({ role: "member", sequence }),
    publisher,
  );

  assert.deepEqual(await service.leaveWorkspace(memberUserId, workspaceId), {
    removed: true,
  });
  assert.deepEqual(publisher.calls, [{ workspaceId, userId: memberUserId }]);
  assert.ok(
    sequence.indexOf("transaction:commit") <
      sequence.indexOf("revocation:published"),
  );
});

for (const operation of ["removeMember", "leaveWorkspace"]) {
  test(`${operation} transaction 실패는 회수 event를 발행하지 않는다`, async () => {
    const sequence = [];
    const publisher = createPublisher(sequence);
    const service = new WorkspaceService(
      createDatabase({
        failCommit: true,
        role: operation === "removeMember" ? "owner" : "member",
        sequence,
      }),
      publisher,
    );

    await assert.rejects(() =>
      operation === "removeMember"
        ? service.removeMember(ownerUserId, workspaceId, memberUserId)
        : service.leaveWorkspace(memberUserId, workspaceId),
    );
    assert.deepEqual(publisher.calls, []);
  });
}

for (const operation of ["removeMember", "leaveWorkspace"]) {
  test(`${operation} 회수 event 발행 실패는 성공 응답을 바꾸지 않는다`, async () => {
    const sequence = [];
    const publisher = createPublisher(sequence, { reject: true });
    const service = new WorkspaceService(
      createDatabase({
        role: operation === "removeMember" ? "owner" : "member",
        sequence,
      }),
      publisher,
    );

    const result =
      operation === "removeMember"
        ? await service.removeMember(ownerUserId, workspaceId, memberUserId)
        : await service.leaveWorkspace(memberUserId, workspaceId);

    assert.deepEqual(result, { removed: true });
    assert.equal(publisher.calls.length, 1);
  });
}
