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
  assert.match(claim.text, /active_sync_run_id = created_run\.id/i);
  assert.match(claim.text, /lease_owner = \$2/i);
  assert.match(claim.text, /lease_expires_at = now\(\) \+ interval '10 minutes'/i);
  assert.equal(claim.values[0], 3);
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
