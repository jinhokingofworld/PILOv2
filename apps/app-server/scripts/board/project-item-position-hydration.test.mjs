import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertContains(source, text) {
  assert.match(source, new RegExp(escapeRegExp(text)));
}

const migration = await readSource(
  "../../../../db/migrations/018_fix_project_item_sync_positions.sql"
);

assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION refresh_pilo_issues_from_github/
);
assert.doesNotMatch(
  migration,
  /COALESCE\(gpi\.position,\s*0\)\s+AS\s+item_position/i,
  "Hydration must not coalesce every null ProjectV2 item position to 0"
);
assertContains(migration, "ROW_NUMBER() OVER (");
assertContains(migration, "PARTITION BY positioned_source_items.column_id");
assertContains(
  migration,
  "ORDER BY positioned_source_items.remote_position ASC NULLS LAST"
);
assertContains(migration, "- 1 AS item_position");
assert.match(
  migration,
  /UPDATE pilo_issues pi\s+SET position = pi\.position \+ position_offset\.offset_value/i,
  "Existing board issues should be moved away before upserted positions are reused"
);
