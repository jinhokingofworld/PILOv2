import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsDirectory = new URL("../../../../db/migrations/", import.meta.url);
const migrationName =
  "083_preserve_github_project_v2_reconnect_identity.sql";
const migrationNames = await readdir(migrationsDirectory);

assert.ok(
  migrationNames.includes(migrationName),
  `Expected reconnect identity migration ${migrationName}`
);

const migration = await readFile(
  new URL(migrationName, migrationsDirectory),
  "utf8"
);
const syncExecutor = await readFile(
  new URL(
    "../../src/modules/github-integration/github-sync-executor.service.ts",
    import.meta.url
  ),
  "utf8"
);
const boardHydration = await readFile(
  new URL(
    "../../../../db/migrations/066_fix_board_hydration_timestamp.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(
  migration,
  /ALTER TABLE public\.github_projects_v2[\s\S]*ALTER COLUMN installation_id DROP NOT NULL/i
);
assert.match(
  migration,
  /DROP CONSTRAINT IF EXISTS github_projects_v2_installation_id_fkey/i
);
assert.match(
  migration,
  /FOREIGN KEY \(installation_id\)[\s\S]*REFERENCES public\.github_installations\(id\)[\s\S]*ON DELETE SET NULL/i
);
assert.doesNotMatch(
  migration,
  /\b(?:DELETE FROM|TRUNCATE|UPDATE)\s+public\.(?:github_projects_v2|github_repositories|github_project_v2_repositories|boards)\b/i,
  "The reconnect migration must preserve existing cache identities"
);

assert.match(
  syncExecutor,
  /ON CONFLICT \(workspace_id, github_repository_id\)[\s\S]*installation_id = EXCLUDED\.installation_id/i
);
assert.match(
  syncExecutor,
  /ON CONFLICT \(workspace_id, github_project_node_id\)[\s\S]*installation_id = EXCLUDED\.installation_id/i
);
assert.match(
  boardHydration,
  /ON CONFLICT \(project_v2_id, repository_id\)[\s\S]*DO UPDATE SET/i
);

console.log("GitHub ProjectV2 reconnect identity migration contract tests passed");
