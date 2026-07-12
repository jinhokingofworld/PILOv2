import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const {
  GithubProjectV2PollingService
} = require("../../dist/modules/github-integration/github-project-v2-polling.service.js");
const {
  GithubProjectV2Service
} = require("../../dist/modules/github-integration/github-project-v2.service.js");
const {
  GithubAppClient,
  GithubGraphqlRateLimitError
} = require("../../dist/modules/github-integration/github-app.client.js");
const {
  GithubSyncExecutorService
} = require("../../dist/modules/github-integration/github-sync-executor.service.js");

const repositoryId = "11111111-1111-4111-8111-111111111111";
const projectV2Id = "22222222-2222-4222-8222-222222222222";
const requestedByUserId = "33333333-3333-4333-8333-333333333333";
const installationId = "55555555-5555-4555-8555-555555555555";
const workspaceId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ claimedRows = [] } = {}) {
    this.claimedRows = claimedRows;
    this.queries = [];
    this.transactionCalls = 0;
  }

  async transaction(callback) {
    this.transactionCalls += 1;
    return callback({
      execute: async (text, values = []) => {
        this.queries.push({ method: "execute", text, values });
      }
    });
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    return this.claimedRows;
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
  }
}

{
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);

  await service.syncSelectionSchedules({ repositoryId, requestedByUserId });

  const [deleteRemovedSchedules, insertPersonalSchedules] = database.queries;
  assert.match(deleteRemovedSchedules.text, /DELETE FROM github_project_v2_polling_schedules/i);
  assert.match(deleteRemovedSchedules.text, /NOT EXISTS/i);
  assert.match(deleteRemovedSchedules.text, /owner_type = 'User'/i);
  assert.deepEqual(deleteRemovedSchedules.values, [repositoryId]);

  assert.match(insertPersonalSchedules.text, /INSERT INTO github_project_v2_polling_schedules/i);
  assert.match(insertPersonalSchedules.text, /owner_type = 'User'/i);
  assert.match(
    insertPersonalSchedules.text,
    /now\(\) \+ interval '1 minute'/i,
    "a newly selected personal project must wait for the initial full sync"
  );
  assert.match(insertPersonalSchedules.text, /ON CONFLICT \(repository_id, project_v2_id\)/i);
  assert.deepEqual(insertPersonalSchedules.values, [repositoryId, requestedByUserId]);
}

{
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);
  const transactionQueries = [];
  const transaction = {
    execute: async (text, values = []) => {
      transactionQueries.push({ text, values });
    }
  };

  await service.syncSelectionSchedules({ repositoryId, requestedByUserId }, transaction);

  assert.equal(database.transactionCalls, 0, "a caller-owned transaction must be reused");
  assert.equal(transactionQueries.length, 2);
}

{
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);

  await service.terminateDeselectedQueuedRuns({
    repositoryId,
    retainedProjectV2Ids: []
  });

  const [cancellation] = database.queries;
  assert.match(cancellation.text, /deselected_schedules AS MATERIALIZED/i);
  assert.match(cancellation.text, /NOT \(schedule\.project_v2_id = ANY\(\$2::uuid\[\]\)\)/i);
  assert.match(cancellation.text, /locked_jobs AS MATERIALIZED/i);
  assert.match(cancellation.text, /job\.status = 'queued'/i);
  assert.match(cancellation.text, /job\.lease_owner IS NULL/i);
  assert.match(cancellation.text, /job\.lease_expires_at IS NULL/i);
  assert.match(cancellation.text, /FOR UPDATE OF job/i);
  assert.match(cancellation.text, /terminal_jobs AS \([\s\S]*?lease_generation = locked_jobs\.lease_generation/i);
  assert.match(
    cancellation.text,
    /terminal_runs AS \([\s\S]*?FROM deselected_schedules AS schedule[\s\S]*?run\.id = schedule\.active_sync_run_id[\s\S]*?run\.status = 'queued'/i,
    "a claimed run without a job must be terminalized before its deselected schedule is deleted"
  );
  assert.doesNotMatch(cancellation.text, /job\.status = 'running'/i);
  assert.deepEqual(cancellation.values, [repositoryId, []]);
}

{
  const syncRunId = "44444444-4444-4444-8444-444444444444";
  const database = new FakeDatabase({
    claimedRows: [{
      sync_run_id: syncRunId,
      repository_id: repositoryId,
      project_v2_id: projectV2Id,
      requested_by_user_id: requestedByUserId
    }]
  });
  const service = new GithubProjectV2PollingService(database);

  const claims = await service.claimDueSchedules(3);

  assert.deepEqual(claims, [{
    syncRunId,
    repositoryId,
    projectV2Id,
    requestedByUserId
  }]);
  const [claim] = database.queries;
  assert.match(claim.text, /FOR UPDATE OF schedule SKIP LOCKED/i);
  assert.match(claim.text, /INSERT INTO github_sync_runs/i);
  assert.match(claim.text, /'project_v2_items'/i);
  assert.match(claim.text, /active_sync_run_id = claimed_run\.sync_run_id/i);
  assert.match(
    claim.text,
    /schedule\.active_sync_run_id IS NULL[\s\S]*?schedule\.lease_expires_at < now\(\)/i,
    "an expired active lease must be claimable for recovery"
  );
  assert.match(
    claim.text,
    /active_run\.status IN \('queued', 'running'\)/i,
    "a stale queued or running active sync run must be eligible for re-enqueue"
  );
  assert.match(
    claim.text,
    /NOT EXISTS\s*\(\s*SELECT 1\s+FROM github_sync_jobs AS active_job[\s\S]*?active_job\.sync_run_id = schedule\.active_sync_run_id/i,
    "a missing durable job must allow the existing active run to be republished"
  );
  assert.match(
    claim.text,
    /active_job\.status IN \('queued', 'running'\)[\s\S]*?active_job\.lease_expires_at < now\(\)/i,
    "an expired job lease must allow the existing active run to be republished"
  );
  assert.match(
    claim.text,
    /active_job\.lease_expires_at >= now\(\)/i,
    "a live active job lease must prevent schedule reclamation"
  );
  assert.match(
    claim.text,
    /THEN schedule\.active_sync_run_id[\s\S]*?schedule\.reusable_sync_run_id AS sync_run_id/i,
    "a reclaimed schedule must return the original sync run instead of creating a duplicate"
  );
  assert.match(claim.text, /lease_owner = \$2/i);
  assert.match(claim.text, /lease_expires_at = now\(\) \+ interval '10 minutes'/i);
  assert.match(
    claim.text,
    /NOT EXISTS\s*\(\s*SELECT 1\s+FROM github_sync_runs AS full_sync[\s\S]*?full_sync\.repository_id = schedule\.repository_id[\s\S]*?full_sync\.target = 'full'[\s\S]*?full_sync\.status IN \('queued', 'running'\)/i,
    "polling must not claim a project while its repository full sync is queued or running"
  );
  assert.equal(claim.values[0], 3);
}

{
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(null, { status: 429 }),
    new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    new Response(null, { status: 403, headers: { "retry-after": "60" } }),
    new Response(JSON.stringify({ errors: [{ message: "API rate limit exceeded" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  ];
  globalThis.fetch = async () => responses.shift();

  try {
    for (let index = 0; index < 4; index += 1) {
      await assert.rejects(
        () => new GithubAppClient().getProjectV2Item({
          installationId: 1,
          appId: "unused",
          privateKey: "unused",
          projectItemNodeId: "PVT_kwDOExample",
          userAccessToken: "user-oauth-token",
          accountType: "Organization"
        }),
        (error) => {
          assert.ok(error instanceof GithubGraphqlRateLimitError);
          assert.equal(error.getStatus(), 400);
          assert.deepEqual(error.getResponse(), {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "GitHub ProjectV2 item lookup failed"
            }
          });
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const syncRunId = "77777777-7777-4777-8777-777777777777";
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);

  await service.markRunSucceeded(syncRunId);

  const [completion] = database.queries;
  assert.match(completion.text, /active_sync_run_id = NULL/i);
  assert.match(completion.text, /lease_owner = NULL/i);
  assert.match(completion.text, /next_poll_at = now\(\) \+ interval '1 minute'/i);
  assert.match(completion.text, /failure_count = 0/i);
  assert.deepEqual(completion.values, [syncRunId]);
}

{
  const syncRunId = "88888888-8888-4888-8888-888888888888";
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);

  await service.markRunFailed(syncRunId, "provider unavailable", false);

  const [completion] = database.queries;
  assert.match(completion.text, /active_sync_run_id = NULL/i);
  assert.match(completion.text, /next_poll_at = now\(\) \+ interval '5 minutes'/i);
  assert.match(completion.text, /failure_count = failure_count \+ 1/i);
  assert.match(completion.text, /last_error = \$2/i);
  assert.deepEqual(completion.values, [syncRunId, "provider unavailable"]);
}

{
  const syncRunId = "99999999-9999-4999-8999-999999999999";
  const database = new FakeDatabase();
  const service = new GithubProjectV2PollingService(database);

  await service.markRunFailed(syncRunId, "GitHub API rate limit exceeded", true);

  const [completion] = database.queries;
  assert.match(completion.text, /next_poll_at = now\(\) \+ interval '30 minutes'/i);
}

{
  const pollingCalls = [];
  const selectionQueries = [];
  const selectionEvents = [];
  let transactionCalls = 0;
  let selectionTransaction;
  const database = {
    async transaction(callback) {
      transactionCalls += 1;
      selectionEvents.push("transaction-begin");
      const transaction = {
        queryOne: async (text) => {
          if (/FROM github_installations/i.test(text)) return { id: installationId };
          if (/FROM github_repositories/i.test(text)) {
            return { id: repositoryId, installation_id: installationId };
          }
          return null;
        },
        query: async (text, values) => {
          if (/FROM github_projects_v2/i.test(text)) {
            return values[1].map((id) => ({ id, installation_id: installationId }));
          }
          if (/FROM github_project_v2_repositories/i.test(text)) {
            return values[1].map((project_v2_id) => ({ project_v2_id }));
          }
          return [];
        },
        execute: async (text, values) => {
          selectionQueries.push({ text, values });
          if (/DELETE FROM github_project_v2_selections/i.test(text)) selectionEvents.push("delete-selections");
          return { rows: [] };
        }
      };
      selectionTransaction = transaction;
      const result = await callback(transaction);
      selectionEvents.push("transaction-commit");
      return result;
    }
  };
  const service = new GithubProjectV2Service(
    database,
    { assertWorkspaceAccess: async () => {} },
    {},
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      terminateDeselectedQueuedRuns: async (input, transaction) => {
        pollingCalls.push({ type: "cancel", input, transaction });
        selectionEvents.push("cancel-queued-polling");
      },
      syncSelectionSchedules: async (input, transaction) => {
        pollingCalls.push({ type: "sync", input, transaction });
        selectionEvents.push("sync-schedules");
      }
    }
  );

  await service.replaceGithubProjectV2Selections(requestedByUserId, workspaceId, {
    installationId,
    repositoryId,
    projectV2Ids: [projectV2Id]
  });

  assert.equal(pollingCalls[0].type, "cancel");
  assert.deepEqual(pollingCalls[0].input, {
    repositoryId,
    retainedProjectV2Ids: [projectV2Id]
  });
  const deleteSelectionIndex = selectionQueries.findIndex(({ text }) => /DELETE FROM github_project_v2_selections/i.test(text));
  assert.ok(deleteSelectionIndex >= 0, "selection replacement must still delete old selection rows");
  assert.ok(
    selectionEvents.indexOf("cancel-queued-polling") < selectionEvents.indexOf("delete-selections"),
    "queued polling jobs must be terminalized while their selection-backed schedules still exist"
  );
  assert.equal(pollingCalls[1].type, "sync");
  assert.deepEqual(pollingCalls[1].input, { repositoryId, requestedByUserId });
  assert.equal(pollingCalls[1].transaction, selectionTransaction);
  assert.equal(transactionCalls, 1, "selection scheduling must not open a post-commit transaction");
  assert.ok(
    selectionEvents.indexOf("sync-schedules") < selectionEvents.indexOf("transaction-commit"),
    "selection schedules must be synchronized before the selection transaction commits"
  );
}

{
  const appServerRoot = resolve(import.meta.dirname, "..", "..");
  const migration = await readFile(
    resolve(
      appServerRoot,
      "..",
      "..",
      "db/migrations/038_create_github_project_v2_polling_schedules.sql"
    ),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE github_project_v2_polling_schedules/i);
  assert.match(migration, /PRIMARY KEY \(repository_id, project_v2_id\)/i);
  assert.match(migration, /FOREIGN KEY \(repository_id, project_v2_id\)[\s\S]*github_project_v2_selections[\s\S]*ON DELETE CASCADE/i);
  assert.match(migration, /ALTER TABLE github_project_v2_polling_schedules ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /idx_github_project_v2_polling_schedules_due/i);

  const fenceMigration = await readFile(
    resolve(appServerRoot, "..", "..", "db/migrations/039_add_github_sync_job_lease_generation.sql"),
    "utf8"
  );
  assert.match(fenceMigration, /ADD COLUMN lease_generation BIGINT NOT NULL DEFAULT 0/i);
  assert.match(fenceMigration, /CHECK \(lease_generation >= 0\)/i);
}

class ProjectV2ItemSnapshotDatabase {
  constructor() {
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });

    if (/FROM github_issues/i.test(text)) {
      return { id: "issue-1", repository_id: repositoryId };
    }

    if (/FROM github_project_v2_fields/i.test(text)) {
      return { id: "field-1", created: false };
    }

    if (/INSERT INTO github_project_v2_items/i.test(text)) {
      return { id: "project-item-1", created: false };
    }

    if (/hydrate_pilo_board_from_github/i.test(text)) {
      return { board_id: "board-1" };
    }

    throw new Error(`Unexpected queryOne: ${text}`);
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    assert.match(text, /FROM boards/i);
    assert.deepEqual(values, [workspaceId, projectV2Id]);
    return [{ project_v2_id: projectV2Id, repository_id: repositoryId }];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    return { rowCount: 1 };
  }
}

function projectV2ItemSnapshotApiItem() {
  return {
    id: "PVTI_remote-current",
    databaseId: 9001,
    contentType: "ISSUE",
    contentNodeId: "I_kgDOExample",
    isArchived: false,
    statusFieldNodeId: null,
    statusOptionId: null,
    statusName: null,
    position: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    fieldValues: [{
      id: "PVTFV_status",
      fieldNodeId: "PVTF_status",
      fieldName: "Status",
      fieldDataType: "SINGLE_SELECT",
      textValue: null,
      numberValue: null,
      dateValue: null,
      singleSelectOptionId: "option-in-progress",
      singleSelectName: "In Progress",
      iterationId: null,
      iterationTitle: null,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      raw: {}
    }],
    raw: {}
  };
}

function projectV2ItemSnapshotContext() {
  return {
    currentUserId: requestedByUserId,
    workspaceId,
    installation: {
      id: installationId,
      workspace_id: workspaceId,
      github_installation_id: 123,
      account_login: "octocat",
      account_type: "User"
    },
    repository: null,
    projectV2: {
      id: projectV2Id,
      workspace_id: workspaceId,
      installation_id: installationId,
      github_project_node_id: "PVT_kgDOExample"
    },
    githubUserAccessToken: "user-oauth-token",
    config: {
      appId: "12345",
      privateKey: "unused",
      now: () => new Date("2026-07-12T00:00:00.000Z")
    }
  };
}

{
  const database = new ProjectV2ItemSnapshotDatabase();
  const executor = new GithubSyncExecutorService(database, {
    async listProjectV2Items() {
      return [projectV2ItemSnapshotApiItem()];
    }
  });

  await executor.runGithubSyncTarget("project_v2_items", projectV2ItemSnapshotContext());

  const fieldValueDeleteIndex = database.queries.findIndex(({ text }) =>
    /DELETE FROM github_project_v2_item_field_values/i.test(text)
  );
  const itemArchiveIndex = database.queries.findIndex(({ text }) =>
    /UPDATE github_project_v2_items[\s\S]*SET is_archived = true/i.test(text)
  );
  const hydrationIndex = database.queries.findIndex(({ text }) =>
    /hydrate_pilo_board_from_github/i.test(text)
  );

  assert.ok(fieldValueDeleteIndex >= 0, "missing field values must be deleted");
  assert.ok(itemArchiveIndex >= 0, "cached items absent from the remote snapshot must be archived");
  assert.ok(fieldValueDeleteIndex < hydrationIndex, "field values must be reconciled before Board hydration");
  assert.ok(itemArchiveIndex < hydrationIndex, "items must be archived before Board hydration");
  assert.deepEqual(database.queries[fieldValueDeleteIndex].values, [
    "project-item-1",
    ["Status"]
  ]);
  assert.deepEqual(database.queries[itemArchiveIndex].values, [
    workspaceId,
    projectV2Id,
    ["PVTI_remote-current"]
  ]);
}

{
  const database = new ProjectV2ItemSnapshotDatabase();
  const executor = new GithubSyncExecutorService(database, {
    async listProjectV2Items() {
      return [projectV2ItemSnapshotApiItem()];
    }
  });
  let leaseChecks = 0;
  const context = {
    ...projectV2ItemSnapshotContext(),
    assertLease: async () => {
      leaseChecks += 1;
      if (leaseChecks === 3) throw new Error("lease lost");
    }
  };

  await assert.rejects(
    () => executor.runGithubSyncTarget("project_v2_items", context),
    /lease lost/
  );
  assert.equal(
    database.queries.some(({ text }) => /INSERT INTO github_project_v2_items/i.test(text)),
    false,
    "a worker that loses its lease must stop before the next item cache write"
  );
}

console.log("project-v2 polling tests passed");
