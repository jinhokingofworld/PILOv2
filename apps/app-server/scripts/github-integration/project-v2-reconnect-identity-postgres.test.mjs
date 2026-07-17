import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.GITHUB_RECONNECT_POSTGRES_TEST_URL;

if (!connectionString) {
  console.log(
    "GitHub ProjectV2 reconnect identity PostgreSQL test skipped: GITHUB_RECONNECT_POSTGRES_TEST_URL is not configured"
  );
} else {
  const databaseUrl = new URL(connectionString);
  const urlLoopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

  assert.ok(
    urlLoopbackHosts.has(databaseUrl.hostname),
    "GitHub reconnect PostgreSQL tests may only use a loopback database"
  );
  assert.equal(
    databaseUrl.pathname,
    "/pilo_github_reconnect_identity_test",
    "GitHub reconnect PostgreSQL tests require the disposable pilo_github_reconnect_identity_test database"
  );

  const reconnectMigration = await readFile(
    new URL(
      "../../../../db/migrations/083_preserve_github_project_v2_reconnect_identity.sql",
      import.meta.url
    ),
    "utf8"
  );
  const hydrationMigration = await readFile(
    new URL(
      "../../../../db/migrations/066_fix_board_hydration_timestamp.sql",
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
    "pilo_github_reconnect_identity_test",
    "The effective node-postgres database must be disposable"
  );

  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const repositoryId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const fieldId = "44444444-4444-4444-8444-444444444444";
  const optionId = "55555555-5555-4555-8555-555555555555";
  const installationIds = [
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888"
  ];
  let connectedToDisposableDatabase = false;

  async function reconnect(installationId) {
    await client.query(
      "INSERT INTO public.github_installations (id, workspace_id) VALUES ($1, $2)",
      [installationId, workspaceId]
    );
    const repository = await client.query(
      `
        INSERT INTO public.github_repositories (
          id, workspace_id, installation_id, github_repository_id, owner_login, name
        )
        VALUES ($1, $2, $3, 101, 'Developer-EJ', 'PILO')
        ON CONFLICT (workspace_id, github_repository_id)
        DO UPDATE SET installation_id = EXCLUDED.installation_id
        RETURNING id
      `,
      [repositoryId, workspaceId, installationId]
    );
    const project = await client.query(
      `
        INSERT INTO public.github_projects_v2 (
          id, workspace_id, installation_id, github_project_node_id, title
        )
        VALUES ($1, $2, $3, 'PVT_kwDOReconnect', 'PILO Project')
        ON CONFLICT (workspace_id, github_project_node_id)
        DO UPDATE SET installation_id = EXCLUDED.installation_id
        RETURNING id
      `,
      [projectId, workspaceId, installationId]
    );
    await client.query(
      `
        INSERT INTO public.github_project_v2_repositories (
          project_v2_id, repository_id
        )
        VALUES ($1, $2)
        ON CONFLICT (project_v2_id, repository_id) DO NOTHING
      `,
      [projectId, repositoryId]
    );
    const board = await client.query(
      "SELECT public.hydrate_pilo_board_from_github($1, $2)::text AS id",
      [projectId, repositoryId]
    );

    assert.equal(repository.rows[0].id, repositoryId);
    assert.equal(project.rows[0].id, projectId);
    return board.rows[0].id;
  }

  try {
    await client.connect();
    const connection = await client.query(
      "SELECT current_database() AS database_name, inet_server_addr()::text AS server_address"
    );
    assert.equal(
      connection.rows[0].database_name,
      "pilo_github_reconnect_identity_test",
      "The connected database must be the dedicated disposable test database"
    );
    assert.ok(
      effectiveLoopbackHosts.has(connection.rows[0].server_address),
      "The connected PostgreSQL server must resolve to a loopback address"
    );
    connectedToDisposableDatabase = true;

    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await client.query(`
      CREATE TYPE public.github_sync_status AS ENUM ('success', 'partial', 'failed');

      CREATE TABLE public.workspaces (
        id UUID PRIMARY KEY
      );

      CREATE TABLE public.github_installations (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE public.github_repositories (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        installation_id UUID REFERENCES public.github_installations(id) ON DELETE SET NULL,
        github_repository_id BIGINT NOT NULL,
        owner_login TEXT NOT NULL,
        name TEXT NOT NULL,
        UNIQUE (workspace_id, github_repository_id)
      );

      CREATE TABLE public.github_projects_v2 (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        installation_id UUID NOT NULL,
        github_project_node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        CONSTRAINT github_projects_v2_installation_id_fkey
          FOREIGN KEY (installation_id)
          REFERENCES public.github_installations(id)
          ON DELETE CASCADE,
        UNIQUE (workspace_id, github_project_node_id)
      );

      CREATE TABLE public.github_project_v2_repositories (
        project_v2_id UUID NOT NULL REFERENCES public.github_projects_v2(id) ON DELETE CASCADE,
        repository_id UUID NOT NULL REFERENCES public.github_repositories(id) ON DELETE CASCADE,
        PRIMARY KEY (project_v2_id, repository_id)
      );

      CREATE TABLE public.github_project_v2_fields (
        id UUID PRIMARY KEY,
        project_v2_id UUID NOT NULL REFERENCES public.github_projects_v2(id) ON DELETE CASCADE,
        github_field_node_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        is_status_field BOOLEAN NOT NULL DEFAULT false
      );

      CREATE TABLE public.github_project_v2_field_options (
        id UUID PRIMARY KEY,
        field_id UUID NOT NULL REFERENCES public.github_project_v2_fields(id) ON DELETE CASCADE,
        github_option_id TEXT NOT NULL,
        option_name TEXT NOT NULL,
        color TEXT,
        position INTEGER,
        normalized_name TEXT NOT NULL
      );

      CREATE TABLE public.boards (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        repository_id UUID REFERENCES public.github_repositories(id) ON DELETE SET NULL,
        project_v2_id UUID REFERENCES public.github_projects_v2(id) ON DELETE SET NULL,
        status_field_id UUID REFERENCES public.github_project_v2_fields(id) ON DELETE SET NULL,
        last_sync_status public.github_sync_status,
        last_synced_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (project_v2_id, repository_id)
      );

      CREATE TABLE public.board_columns (
        id BIGSERIAL PRIMARY KEY,
        board_id BIGINT NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        color TEXT,
        status_option_id UUID REFERENCES public.github_project_v2_field_options(id) ON DELETE SET NULL,
        status_option_github_id TEXT,
        normalized_name TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (board_id, status_option_id)
      );

      CREATE OR REPLACE FUNCTION public.refresh_pilo_issues_from_github(BIGINT)
      RETURNS VOID
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN;
      END;
      $$;
    `);
    await client.query(reconnectMigration);
    await client.query(hydrationMigration);
    await client.query("INSERT INTO public.workspaces (id) VALUES ($1)", [
      workspaceId
    ]);

    const initialBoardId = await reconnect(installationIds[0]);
    await client.query(
      `
        INSERT INTO public.github_project_v2_fields (
          id, project_v2_id, github_field_node_id, field_name, is_status_field
        )
        VALUES ($1, $2, 'PVTSSF_lADOReconnect', 'Status', true)
      `,
      [fieldId, projectId]
    );
    await client.query(
      `
        INSERT INTO public.github_project_v2_field_options (
          id, field_id, github_option_id, option_name, color, position, normalized_name
        )
        VALUES ($1, $2, 'todo-option', 'Todo', 'GRAY', 0, 'todo')
      `,
      [optionId, fieldId]
    );
    const hydratedBoard = await client.query(
      "SELECT public.hydrate_pilo_board_from_github($1, $2)::text AS id",
      [projectId, repositoryId]
    );
    assert.equal(hydratedBoard.rows[0].id, initialBoardId);

    for (const installationId of installationIds.slice(1)) {
      const deleted = await client.query(
        "DELETE FROM public.github_installations WHERE workspace_id = $1",
        [workspaceId]
      );
      assert.equal(deleted.rowCount, 1);

      const disconnected = await client.query(`
        SELECT
          (SELECT installation_id FROM public.github_repositories WHERE id = '${repositoryId}') AS repository_installation_id,
          (SELECT installation_id FROM public.github_projects_v2 WHERE id = '${projectId}') AS project_installation_id,
          (SELECT count(*)::int FROM public.github_project_v2_repositories) AS link_count,
          (SELECT count(*)::int FROM public.boards) AS board_count,
          (SELECT id::text FROM public.boards LIMIT 1) AS board_id
      `);
      assert.deepEqual(disconnected.rows[0], {
        repository_installation_id: null,
        project_installation_id: null,
        link_count: 1,
        board_count: 1,
        board_id: initialBoardId
      });

      const reconnectedBoardId = await reconnect(installationId);
      assert.equal(reconnectedBoardId, initialBoardId);
      const identityCounts = await client.query(`
        SELECT
          (SELECT count(*)::int FROM public.github_repositories) AS repositories,
          (SELECT count(*)::int FROM public.github_projects_v2) AS projects,
          (SELECT count(*)::int FROM public.github_project_v2_repositories) AS links,
          (SELECT count(*)::int FROM public.boards) AS boards
      `);
      assert.deepEqual(identityCounts.rows[0], {
        repositories: 1,
        projects: 1,
        links: 1,
        boards: 1
      });
    }

    console.log("GitHub ProjectV2 reconnect identity PostgreSQL test passed");
  } finally {
    if (connectedToDisposableDatabase) {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    }
    await client.end();
  }
}
