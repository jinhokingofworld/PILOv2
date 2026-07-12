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

const repositoryId = "11111111-1111-4111-8111-111111111111";
const projectV2Id = "22222222-2222-4222-8222-222222222222";
const requestedByUserId = "33333333-3333-4333-8333-333333333333";
const installationId = "55555555-5555-4555-8555-555555555555";
const workspaceId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ claimedRows = [] } = {}) {
    this.claimedRows = claimedRows;
    this.queries = [];
  }

  async transaction(callback) {
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
  assert.match(insertPersonalSchedules.text, /ON CONFLICT \(repository_id, project_v2_id\)/i);
  assert.deepEqual(insertPersonalSchedules.values, [repositoryId, requestedByUserId]);
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
  assert.equal(claim.values[0], 3);
}

{
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(null, { status: 429 }),
    new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    new Response(JSON.stringify({ errors: [{ message: "API rate limit exceeded" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  ];
  globalThis.fetch = async () => responses.shift();

  try {
    for (let index = 0; index < 3; index += 1) {
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
  const database = {
    async transaction(callback) {
      return callback({
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
        execute: async () => ({ rows: [] })
      });
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
    { syncSelectionSchedules: async (input) => pollingCalls.push(input) }
  );

  await service.replaceGithubProjectV2Selections(requestedByUserId, workspaceId, {
    installationId,
    repositoryId,
    projectV2Ids: [projectV2Id]
  });

  assert.deepEqual(pollingCalls, [{ repositoryId, requestedByUserId }]);
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
}

console.log("project-v2 polling tests passed");
