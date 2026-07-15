import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path) {
  try {
    return await readFile(new URL(path, import.meta.url), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

const migration = await readSource(
  "../../../../db/migrations/066_fix_board_hydration_timestamp.sql"
);

assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.hydrate_pilo_board_from_github\(\s*p_project_v2_id UUID,\s*p_repository_id UUID\s*\)/,
  "Migration 066 must redefine hydrate_pilo_board_from_github(UUID, UUID)"
);
assert.match(
  migration,
  /LANGUAGE plpgsql\s+SET search_path = public, pg_temp;/,
  "Board hydration must keep an explicit hardened search_path"
);

const boardUpsert = migration.match(
  /INSERT INTO boards \([\s\S]*?RETURNING id INTO v_board_id;/
)?.[0];

assert.ok(boardUpsert, "Migration 066 must preserve the Board upsert");
assert.match(
  boardUpsert,
  /'success'::github_sync_status,\s*now\(\)\s+FROM github_projects_v2 gp/,
  "Board last_synced_at must use the successful hydration time"
);
assert.doesNotMatch(
  boardUpsert,
  /gp\.last_synced_at/,
  "Board last_synced_at must not reuse ProjectV2 metadata sync time"
);
assert.match(
  boardUpsert,
  /ON CONFLICT \(project_v2_id, repository_id\)[\s\S]*last_synced_at = EXCLUDED\.last_synced_at/,
  "Existing Boards must receive the new hydration timestamp"
);

const statusOptionHydration = migration.match(
  /INSERT INTO board_columns \(\s*board_id,\s*name,\s*position,\s*color,\s*status_option_id,[\s\S]*?ON CONFLICT \(board_id, status_option_id\)[\s\S]*?;/
)?.[0];

assert.ok(
  statusOptionHydration,
  "Migration 066 must preserve Status option column hydration"
);
assert.match(
  migration,
  /INSERT INTO board_columns \([\s\S]*?'Unmapped'[\s\S]*?bc\.normalized_name = 'unmapped'/,
  "Migration 066 must preserve the Unmapped column"
);
assert.match(
  migration,
  /PERFORM refresh_pilo_issues_from_github\(v_board_id\);/,
  "Migration 066 must preserve issue hydration"
);
assert.match(
  migration,
  /RETURN v_board_id;/,
  "Migration 066 must preserve the hydrated Board return value"
);
