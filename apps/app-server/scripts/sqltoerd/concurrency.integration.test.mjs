import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("reflect-metadata");

const mode = process.argv[2];
if (mode !== "pre" && mode !== "post") {
  throw new Error("Usage: concurrency.integration.test.mjs <pre|post>");
}

const databaseUrl = process.env.SQLTOERD_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SQLTOERD_INTEGRATION_DATABASE_URL is required");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.slice(1);
if (
  !["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) ||
  !databaseName.startsWith("pilo_sqltoerd_") ||
  !databaseName.endsWith("_test")
) {
  throw new Error(
    "SQLtoERD integration tests require a localhost pilo_sqltoerd_*_test database"
  );
}

process.env.DATABASE_URL = databaseUrl;
process.env.APP_ENV = "test";

const { Pool } = require("pg");
const { DatabaseService } = require(
  "../../dist/database/database.service.js"
);
const { SqlErdService } = require(
  "../../dist/modules/sql-erd/sql-erd.service.js"
);

const userId = "11111111-1111-4111-8111-000000000617";
const workspaceIds = {
  singularRace: "22222222-2222-4222-8222-000000000617",
  pluralRace: "33333333-3333-4333-8333-000000000617",
  mixedRace: "44444444-4444-4444-8444-000000000617",
  parallelA: "55555555-5555-4555-8555-000000000617",
  parallelB: "66666666-6666-4666-8666-000000000617"
};
const createBody = {
  modelJson: {
    version: 1,
    schema: {
      tables: [],
      relations: []
    }
  },
  layoutJson: {
    version: 1,
    tableLayouts: []
  }
};

class IntegrationWorkspaceService {
  async assertWorkspaceAccess(_currentUserId, workspaceId) {
    return { id: workspaceId };
  }
}

const setupPool = new Pool({ connectionString: databaseUrl });
const databaseA = new DatabaseService();
const databaseB = new DatabaseService();
const workspaceService = new IntegrationWorkspaceService();
const activityLogService = { async append() {} };
const serviceA = new SqlErdService(
  databaseA,
  workspaceService,
  activityLogService
);
const serviceB = new SqlErdService(
  databaseB,
  workspaceService,
  activityLogService
);

try {
  const [{ pid: pidA }, { pid: pidB }] = await Promise.all([
    databaseA.queryOne("SELECT pg_backend_pid() AS pid"),
    databaseB.queryOne("SELECT pg_backend_pid() AS pid")
  ]);
  assert.notEqual(pidA, pidB, "concurrency tests require different DB connections");

  await seedFixtures();
  await assertMigrationMode();
  await assertSingularRace();
  await assertPluralRace();

  if (mode === "post") {
    await assertMixedRace();
    await assertDifferentWorkspaceCreates();
  }

  console.log(`SQLtoERD ${mode}-migration concurrency tests passed`);
} finally {
  await cleanupFixtures();
  await Promise.all([
    databaseA.onModuleDestroy(),
    databaseB.onModuleDestroy(),
    setupPool.end()
  ]);
}

async function seedFixtures() {
  await cleanupFixtures();
  await setupPool.query(
    `
      INSERT INTO users (id, name, email)
      VALUES ($1, 'SQLtoERD integration', 'sqltoerd-617@example.test')
    `,
    [userId]
  );

  for (const [name, workspaceId] of Object.entries(workspaceIds)) {
    await setupPool.query(
      `
        INSERT INTO workspaces (id, name, owner_user_id)
        VALUES ($1, $2, $3)
      `,
      [workspaceId, `SQLtoERD ${name}`, userId]
    );
  }
}

async function cleanupFixtures() {
  await setupPool.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [
    Object.values(workspaceIds)
  ]);
  await setupPool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function assertMigrationMode() {
  const result = await setupPool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'ux_sql_erd_sessions_workspace_active'
      ) AS has_active_unique
    `
  );
  assert.equal(result.rows[0].has_active_unique, mode === "pre");
}

async function assertSingularRace() {
  const workspaceId = workspaceIds.singularRace;
  const results = await Promise.allSettled([
    serviceA.createSession(userId, workspaceId, createBody),
    serviceB.createSession(userId, workspaceId, createBody)
  ]);

  assert.equal(countFulfilled(results), 1);
  assert.equal(countRejectedWithStatus(results, 409), 1);
  assert.equal(await countActiveSessions(workspaceId), 1);
}

async function assertPluralRace() {
  const workspaceId = workspaceIds.pluralRace;
  const results = await Promise.allSettled([
    serviceA.createPluralSession(userId, workspaceId, createBody),
    serviceB.createPluralSession(userId, workspaceId, createBody)
  ]);

  if (mode === "pre") {
    assert.equal(countFulfilled(results), 1);
    assert.equal(countRejectedWithStatus(results, 409), 1);
    assert.equal(await countActiveSessions(workspaceId), 1);
    return;
  }

  assert.equal(countFulfilled(results), 2);
  assert.equal(await countActiveSessions(workspaceId), 2);
}

async function assertMixedRace() {
  const workspaceId = workspaceIds.mixedRace;
  const results = await Promise.allSettled([
    serviceA.createSession(userId, workspaceId, createBody),
    serviceB.createPluralSession(userId, workspaceId, createBody)
  ]);

  assert.equal(results[1].status, "fulfilled");
  assert.ok(countFulfilled(results) === 1 || countFulfilled(results) === 2);
  assert.equal(countRejectedWithStatus(results, 409), 2 - countFulfilled(results));
  assert.equal(await countActiveSessions(workspaceId), countFulfilled(results));
}

async function assertDifferentWorkspaceCreates() {
  const results = await Promise.allSettled([
    serviceA.createPluralSession(userId, workspaceIds.parallelA, createBody),
    serviceB.createPluralSession(userId, workspaceIds.parallelB, createBody)
  ]);

  assert.equal(countFulfilled(results), 2);
  assert.equal(await countActiveSessions(workspaceIds.parallelA), 1);
  assert.equal(await countActiveSessions(workspaceIds.parallelB), 1);
}

async function countActiveSessions(workspaceId) {
  const result = await setupPool.query(
    `
      SELECT count(*)::integer AS count
      FROM sql_erd_sessions
      WHERE workspace_id = $1
        AND deleted_at IS NULL
    `,
    [workspaceId]
  );
  return result.rows[0].count;
}

function countFulfilled(results) {
  return results.filter((result) => result.status === "fulfilled").length;
}

function countRejectedWithStatus(results, status) {
  return results.filter(
    (result) =>
      result.status === "rejected" &&
      typeof result.reason?.getStatus === "function" &&
      result.reason.getStatus() === status
  ).length;
}
