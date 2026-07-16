import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.BOARD_POSTGRES_TEST_URL;

if (!connectionString) {
  throw new Error(
    "BOARD_POSTGRES_TEST_URL is required for the Board operation PostgreSQL test"
  );
}

const databaseUrl = new URL(connectionString);
const urlLoopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

assert.ok(
  urlLoopbackHosts.has(databaseUrl.hostname),
  "Board operation PostgreSQL tests may only use a loopback database"
);
assert.equal(
  databaseUrl.pathname,
  "/pilo_board_issue_operation_test",
  "Board operation PostgreSQL tests require the disposable pilo_board_issue_operation_test database"
);

const createMigration = await readFile(
  new URL(
    "../../../../db/migrations/022_create_board_issue_create_operations.sql",
    import.meta.url
  ),
  "utf8"
);
const constraintFixMigration = await readFile(
  new URL(
    "../../../../db/migrations/079_allow_board_issue_operation_parent_cleanup.sql",
    import.meta.url
  ),
  "utf8"
);

const client = new pg.Client({ connectionString });
const effectiveLoopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

assert.ok(
  effectiveLoopbackHosts.has(client.connectionParameters.host),
  "The effective node-postgres host must be loopback"
);
assert.equal(
  client.connectionParameters.database,
  "pilo_board_issue_operation_test",
  "The effective node-postgres database must be disposable"
);

await client.connect();
let connectedToDisposableDatabase = false;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const installationId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";
const completedAt = "2026-07-16T00:00:00.000Z";

try {
  const currentDatabase = await client.query(
    "SELECT current_database() AS database_name"
  );
  assert.equal(
    currentDatabase.rows[0].database_name,
    "pilo_board_issue_operation_test",
    "The connected database must be the dedicated disposable test database"
  );
  connectedToDisposableDatabase = true;

  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await client.query(`
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;

    CREATE TABLE public.users (
      id UUID PRIMARY KEY
    );

    CREATE TABLE public.workspaces (
      id UUID PRIMARY KEY
    );

    CREATE TABLE public.github_installations (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL
        REFERENCES public.workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE public.github_projects_v2 (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL
        REFERENCES public.workspaces(id) ON DELETE CASCADE,
      installation_id UUID NOT NULL
        REFERENCES public.github_installations(id) ON DELETE CASCADE
    );

    CREATE TABLE public.github_project_v2_items (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL
        REFERENCES public.workspaces(id) ON DELETE CASCADE,
      project_v2_id UUID NOT NULL
        REFERENCES public.github_projects_v2(id) ON DELETE CASCADE
    );

    CREATE TABLE public.boards (
      id BIGINT PRIMARY KEY
    );

    CREATE TABLE public.board_columns (
      id BIGINT PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
      UNIQUE (id, board_id)
    );

    CREATE TABLE public.pilo_issues (
      id BIGINT PRIMARY KEY,
      project_item_id UUID NOT NULL
        REFERENCES public.github_project_v2_items(id) ON DELETE CASCADE
    );
  `);
  await client.query(createMigration);
  await client.query(constraintFixMigration);

  await client.query("INSERT INTO public.users (id) VALUES ($1)", [userId]);
  await client.query("INSERT INTO public.workspaces (id) VALUES ($1)", [
    workspaceId
  ]);
  await client.query(
    "INSERT INTO public.github_installations (id, workspace_id) VALUES ($1, $2)",
    [installationId, workspaceId]
  );
  await client.query(
    `
      INSERT INTO public.github_projects_v2 (id, workspace_id, installation_id)
      VALUES ($1, $2, $3)
    `,
    [projectId, workspaceId, installationId]
  );
  await client.query(
    `
      INSERT INTO public.github_project_v2_items (id, workspace_id, project_v2_id)
      VALUES ($1, $2, $3)
    `,
    [projectItemId, workspaceId, projectId]
  );
  await client.query("INSERT INTO public.boards (id) VALUES (1)");
  await client.query(
    "INSERT INTO public.board_columns (id, board_id) VALUES (1, 1)"
  );
  await client.query(
    "INSERT INTO public.pilo_issues (id, project_item_id) VALUES (1, $1)",
    [projectItemId]
  );
  await client.query(
    `
      INSERT INTO public.board_issue_create_operations (
        id,
        workspace_id,
        actor_user_id,
        board_id,
        column_id,
        idempotency_key,
        request_hash,
        request_title,
        status,
        completed_stage,
        github_issue_id,
        github_issue_node_id,
        github_issue_snapshot,
        github_project_item_node_id,
        pilo_issue_id,
        response_body,
        completed_at
      )
      VALUES (
        $1,
        $2,
        $3,
        1,
        1,
        'installation-delete-regression',
        repeat('a', 64),
        'Preserved operation',
        'succeeded',
        'cache_persisted',
        42,
        'I_kwDOExample',
        '{"id":"I_kwDOExample"}'::jsonb,
        'PVTI_lADOExample',
        1,
        '{"issue":{"id":"cached"}}'::jsonb,
        $4
      )
    `,
    [operationId, workspaceId, userId, completedAt]
  );

  const deletionResult = await client.query(
    "DELETE FROM public.github_installations WHERE id = $1",
    [installationId]
  );
  assert.equal(deletionResult.rowCount, 1, "The installation delete must succeed");

  const cascadeResult = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM public.github_projects_v2) AS projects,
        (SELECT count(*)::int FROM public.github_project_v2_items) AS items,
        (SELECT count(*)::int FROM public.pilo_issues) AS pilo_issues
    `
  );
  assert.deepEqual(
    cascadeResult.rows[0],
    { projects: 0, items: 0, pilo_issues: 0 },
    "The installation delete must cascade through the cached PILO Issue"
  );

  const operationResult = await client.query(
    `
      SELECT pilo_issue_id, response_body, completed_at
      FROM public.board_issue_create_operations
      WHERE id = $1
    `,
    [operationId]
  );
  assert.equal(operationResult.rowCount, 1, "The durable operation must remain");
  assert.equal(operationResult.rows[0].pilo_issue_id, null);
  assert.deepEqual(operationResult.rows[0].response_body, {
    issue: { id: "cached" }
  });
  assert.equal(operationResult.rows[0].completed_at.toISOString(), completedAt);

  console.log("Board operation parent-cleanup PostgreSQL test passed");
} finally {
  if (connectedToDisposableDatabase) {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  }
  await client.end();
}
