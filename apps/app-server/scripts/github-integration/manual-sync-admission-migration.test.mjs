import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../../../../db/migrations/104_create_github_sync_manual_request_admission.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(
  migration,
  /ADD CONSTRAINT github_sync_runs_id_workspace_unique[\s\S]*UNIQUE \(id, workspace_id\)/i
);
assert.match(migration, /CREATE TABLE public\.github_sync_manual_requests/i);
assert.match(
  migration,
  /UNIQUE \(workspace_id, requested_by_user_id, idempotency_key_hash\)/i
);
assert.match(
  migration,
  /FOREIGN KEY \(sync_run_id, workspace_id\)[\s\S]*REFERENCES public\.github_sync_runs \(id, workspace_id\)/i
);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(
  migration,
  /REVOKE ALL ON TABLE public\.github_sync_manual_requests FROM PUBLIC/i
);

console.log("GitHub manual sync admission migration contract tests passed");
