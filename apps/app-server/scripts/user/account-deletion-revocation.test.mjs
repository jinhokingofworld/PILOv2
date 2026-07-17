import assert from "node:assert/strict";
import test from "node:test";

import { UserService } from "../../dist/modules/user/user.service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceIds = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function createDatabase({ failCommit = false, sequence }) {
  const database = {
    transactionResult: Symbol("not-called"),
    async queryOne() {
      return { count: "0" };
    },
    async transaction(callback) {
      sequence.push("transaction:begin");
      const result = await callback({
        async execute(text) {
          sequence.push(
            text.includes("DELETE FROM workspace_members")
              ? "membership:deleted"
              : "account:mutated",
          );
          return { rowCount: 1, rows: [] };
        },
        async query(text) {
          assert.match(text, /DELETE FROM workspace_members/);
          assert.match(text, /RETURNING workspace_id/);
          sequence.push("membership:deleted-returning");
          return workspaceIds.map((workspace_id) => ({ workspace_id }));
        },
      });
      database.transactionResult = result;
      if (failCommit) {
        sequence.push("transaction:rollback");
        throw new Error("commit failed");
      }
      sequence.push("transaction:commit");
      return result;
    },
  };
  return database;
}

function createOutbox(sequence, { publishFailedWorkspaceId } = {}) {
  return {
    enqueued: [],
    published: [],
    async enqueueMembershipRevoked(_transaction, workspaceId, targetUserId) {
      sequence.push(`revocation:enqueued:${workspaceId}`);
      const id = `outbox:${workspaceId}:${targetUserId}`;
      this.enqueued.push({ id, workspaceId, userId: targetUserId });
      return id;
    },
    async publishOutbox(id) {
      const workspaceId = id.split(":")[1];
      sequence.push(
        workspaceId === publishFailedWorkspaceId
          ? `revocation:publish-failed:${workspaceId}`
          : `revocation:published:${workspaceId}`,
      );
      this.published.push(id);
    },
  };
}

test("계정 탈퇴 transaction은 삭제한 모든 Workspace membership id를 반환한다", async () => {
  const sequence = [];
  const database = createDatabase({ sequence });
  const service = new UserService(database, createOutbox(sequence));

  await service.deleteCurrentUser(userId, { confirmationText: "계정 탈퇴" });

  assert.deepEqual(
    database.transactionResult,
    workspaceIds.map((workspaceId) => `outbox:${workspaceId}:${userId}`),
  );
});

test("계정 탈퇴는 commit 후 Workspace별 회수 event를 한 번씩 발행한다", async () => {
  const sequence = [];
  const database = createDatabase({ sequence });
  const outbox = createOutbox(sequence);
  const service = new UserService(database, outbox);

  assert.deepEqual(
    await service.deleteCurrentUser(userId, { confirmationText: "계정 탈퇴" }),
    { deleted: true },
  );
  assert.deepEqual(
    outbox.enqueued,
    workspaceIds.map((workspaceId) => ({
      id: `outbox:${workspaceId}:${userId}`,
      workspaceId,
      userId,
    })),
  );
  assert.deepEqual(
    outbox.published,
    workspaceIds.map((workspaceId) => `outbox:${workspaceId}:${userId}`),
  );
  const commitIndex = sequence.indexOf("transaction:commit");
  assert.ok(
    sequence
      .filter((entry) => entry.startsWith("revocation:enqueued:"))
      .every((entry) => sequence.indexOf(entry) < commitIndex),
  );
  assert.ok(
    sequence
      .filter((entry) => entry.startsWith("revocation:published:"))
      .every((entry) => sequence.indexOf(entry) > commitIndex),
  );
});

test("계정 탈퇴 transaction 실패는 회수 event를 발행하지 않는다", async () => {
  const sequence = [];
  const outbox = createOutbox(sequence);
  const service = new UserService(
    createDatabase({ failCommit: true, sequence }),
    outbox,
  );

  await assert.rejects(() =>
    service.deleteCurrentUser(userId, { confirmationText: "계정 탈퇴" }),
  );
  assert.deepEqual(outbox.published, []);
});

test("계정 탈퇴 회수 event 발행 실패는 성공 응답과 다른 Workspace 발행을 막지 않는다", async () => {
  const sequence = [];
  const outbox = createOutbox(sequence, {
    publishFailedWorkspaceId: workspaceIds[0],
  });
  const service = new UserService(createDatabase({ sequence }), outbox);

  assert.deepEqual(
    await service.deleteCurrentUser(userId, { confirmationText: "계정 탈퇴" }),
    { deleted: true },
  );
  assert.deepEqual(
    outbox.published,
    workspaceIds.map((workspaceId) => `outbox:${workspaceId}:${userId}`),
  );
});
