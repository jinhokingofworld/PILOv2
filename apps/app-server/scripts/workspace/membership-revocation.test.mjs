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

function createOutbox(sequence, { publishFailed = false } = {}) {
  return {
    enqueued: [],
    published: [],
    async enqueueMembershipRevoked(_transaction, targetWorkspaceId, targetUserId) {
      sequence.push("revocation:enqueued");
      const id = `outbox:${targetWorkspaceId}:${targetUserId}`;
      this.enqueued.push({ id, userId: targetUserId, workspaceId: targetWorkspaceId });
      return id;
    },
    async publishOutbox(id) {
      sequence.push(publishFailed ? "revocation:publish-failed" : "revocation:published");
      this.published.push(id);
    },
  };
}

test("removeMember는 membership transaction 안에서 회수 outbox를 만들고 commit 후 발행한다", async () => {
  const sequence = [];
  const outbox = createOutbox(sequence);
  const service = new WorkspaceService(
    createDatabase({ role: "owner", sequence }),
    outbox,
  );

  assert.deepEqual(
    await service.removeMember(ownerUserId, workspaceId, memberUserId),
    { removed: true },
  );
  assert.deepEqual(outbox.enqueued, [
    { id: `outbox:${workspaceId}:${memberUserId}`, workspaceId, userId: memberUserId },
  ]);
  assert.deepEqual(outbox.published, [`outbox:${workspaceId}:${memberUserId}`]);
  assert.ok(
    sequence.indexOf("revocation:enqueued") < sequence.indexOf("transaction:commit"),
  );
  assert.ok(
    sequence.indexOf("transaction:commit") <
      sequence.indexOf("revocation:published"),
  );
});

test("leaveWorkspace는 membership transaction 안에서 회수 outbox를 만들고 commit 후 발행한다", async () => {
  const sequence = [];
  const outbox = createOutbox(sequence);
  const service = new WorkspaceService(
    createDatabase({ role: "member", sequence }),
    outbox,
  );

  assert.deepEqual(await service.leaveWorkspace(memberUserId, workspaceId), {
    removed: true,
  });
  assert.deepEqual(outbox.enqueued, [
    { id: `outbox:${workspaceId}:${memberUserId}`, workspaceId, userId: memberUserId },
  ]);
  assert.deepEqual(outbox.published, [`outbox:${workspaceId}:${memberUserId}`]);
  assert.ok(
    sequence.indexOf("revocation:enqueued") < sequence.indexOf("transaction:commit"),
  );
  assert.ok(
    sequence.indexOf("transaction:commit") <
      sequence.indexOf("revocation:published"),
  );
});

for (const operation of ["removeMember", "leaveWorkspace"]) {
  test(`${operation} transaction 실패는 회수 event를 발행하지 않는다`, async () => {
    const sequence = [];
    const outbox = createOutbox(sequence);
    const service = new WorkspaceService(
      createDatabase({
        failCommit: true,
        role: operation === "removeMember" ? "owner" : "member",
        sequence,
      }),
      outbox,
    );

    await assert.rejects(() =>
      operation === "removeMember"
        ? service.removeMember(ownerUserId, workspaceId, memberUserId)
        : service.leaveWorkspace(memberUserId, workspaceId),
    );
    assert.deepEqual(outbox.published, []);
  });
}

for (const operation of ["removeMember", "leaveWorkspace"]) {
  test(`${operation} 회수 event 발행 실패는 성공 응답을 바꾸지 않는다`, async () => {
    const sequence = [];
    const outbox = createOutbox(sequence, { publishFailed: true });
    const service = new WorkspaceService(
      createDatabase({
        role: operation === "removeMember" ? "owner" : "member",
        sequence,
      }),
      outbox,
    );

    const result =
      operation === "removeMember"
        ? await service.removeMember(ownerUserId, workspaceId, memberUserId)
        : await service.leaveWorkspace(memberUserId, workspaceId);

    assert.deepEqual(result, { removed: true });
    assert.equal(outbox.published.length, 1);
  });
}
