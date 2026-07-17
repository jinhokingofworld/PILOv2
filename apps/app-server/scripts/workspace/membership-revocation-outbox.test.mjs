import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  WorkspaceMembershipRevocationOutboxService,
  getWorkspaceMembershipRevocationRetryDelayMs,
} = require(
  "../../dist/modules/workspace-membership-revocation/workspace-membership-revocation-outbox.service.js",
);

const outboxId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function createClaim(attemptCount = 1) {
  return {
    attempt_count: attemptCount,
    claim_token: "44444444-4444-4444-8444-444444444444",
    id: outboxId,
    occurred_at: "2026-07-17T00:00:00.000Z",
    user_id: userId,
    workspace_id: workspaceId,
  };
}

class FakeDatabase {
  constructor({ claim = null, dueRows = [] } = {}) {
    this.claim = claim;
    this.dueRows = dueRows;
    this.executeCalls = [];
    this.queryCalls = [];
    this.queryOneCalls = [];
  }

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rowCount: 1, rows: [] };
  }

  async query(text, values = []) {
    this.queryCalls.push({ text, values });
    return this.dueRows;
  }

  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    if (text.includes("INSERT INTO workspace_membership_revocation_outbox")) {
      return { id: outboxId };
    }
    return this.claim;
  }

  async transaction(callback) {
    return callback(this);
  }
}

function createPublisher(result) {
  return {
    calls: [],
    async publishMembershipRevoked(event) {
      this.calls.push(event);
      return result;
    },
  };
}

{
  const database = new FakeDatabase();
  const service = new WorkspaceMembershipRevocationOutboxService(
    database,
    createPublisher(true),
  );

  assert.equal(
    await service.enqueueMembershipRevoked(database, workspaceId, userId),
    outboxId,
  );
  assert.match(database.queryOneCalls[0].text, /INSERT INTO workspace_membership_revocation_outbox/);
  assert.deepEqual(database.queryOneCalls[0].values, [workspaceId, userId]);
}

{
  const database = new FakeDatabase({ claim: createClaim() });
  const publisher = createPublisher(true);
  const service = new WorkspaceMembershipRevocationOutboxService(database, publisher);

  await service.publishOutbox(outboxId);

  assert.deepEqual(publisher.calls, [
    {
      version: 1,
      type: "membership.revoked",
      workspaceId,
      userId,
      occurredAt: "2026-07-17T00:00:00.000Z",
    },
  ]);
  assert.match(database.executeCalls[0].text, /status = 'delivered'/);
}

{
  const database = new FakeDatabase({ claim: createClaim(3) });
  const service = new WorkspaceMembershipRevocationOutboxService(
    database,
    createPublisher(false),
  );

  await service.publishOutbox(outboxId);

  assert.match(database.executeCalls[0].text, /status = 'pending'/);
  assert.match(
    database.executeCalls[0].text,
    /WORKSPACE_MEMBERSHIP_REVOCATION_PUBLISH_FAILED/,
  );
  assert.equal(getWorkspaceMembershipRevocationRetryDelayMs(1), 1_000);
  assert.equal(getWorkspaceMembershipRevocationRetryDelayMs(99), 60_000);
}

{
  const database = new FakeDatabase({ dueRows: [{ id: outboxId }] });
  const publisher = createPublisher(true);
  const service = new WorkspaceMembershipRevocationOutboxService(database, publisher);

  await service.publishDue();

  assert.equal(database.queryCalls.length, 1);
  assert.match(database.queryCalls[0].text, /claimed_at <= now/);
}

const migration = await readFile(
  new URL("../../../../db/migrations/085_create_workspace_membership_revocation_outbox.sql", import.meta.url),
  "utf8",
);
const outboxServiceSource = await readFile(
  new URL(
    "../../src/modules/workspace-membership-revocation/workspace-membership-revocation-outbox.service.ts",
    import.meta.url,
  ),
  "utf8",
);
assert.match(migration, /CREATE TABLE public\.workspace_membership_revocation_outbox/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(outboxServiceSource, /FOR UPDATE SKIP LOCKED/);
