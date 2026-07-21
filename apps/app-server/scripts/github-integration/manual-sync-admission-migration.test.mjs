import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../../../../db/migrations/104_create_github_sync_manual_request_admission.sql",
    import.meta.url
  ),
  "utf8"
);

const outsideProceduralBodies = migration.replace(
  /\$pilo_roles\$[\s\S]*?\$pilo_roles\$/g,
  ""
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
  /CONSTRAINT github_sync_manual_requests_idempotency_key_hash_check[\s\S]*CHECK \(idempotency_key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i
);
assert.match(
  migration,
  /CONSTRAINT github_sync_manual_requests_request_fingerprint_check[\s\S]*CHECK \(request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/i
);
assert.match(
  migration,
  /FOREIGN KEY \(sync_run_id, workspace_id\)[\s\S]*REFERENCES public\.github_sync_runs \(id, workspace_id\)[\s\S]*ON DELETE CASCADE/i
);
assert.match(
  migration,
  /CREATE INDEX idx_github_sync_manual_requests_workspace_requester_created_at[\s\S]*ON public\.github_sync_manual_requests[\s\S]*\(\s*workspace_id,\s*requested_by_user_id,\s*created_at DESC\s*\)/i
);
assert.match(
  migration,
  /CREATE INDEX idx_github_sync_manual_requests_workspace_created_at[\s\S]*ON public\.github_sync_manual_requests \(workspace_id, created_at DESC\)/i
);
assert.match(
  migration,
  /CREATE INDEX idx_github_sync_manual_requests_sync_run_id[\s\S]*ON public\.github_sync_manual_requests \(sync_run_id\)/i
);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(
  migration,
  /REVOKE ALL ON TABLE public\.github_sync_manual_requests FROM PUBLIC/i
);
assert.match(migration, /DO \$pilo_roles\$/i);
assert.match(
  migration,
  /FOREACH target_role IN ARRAY ARRAY\['anon', 'authenticated', 'service_role'\]/i
);
assert.match(
  migration,
  /FROM pg_catalog\.pg_roles[\s\S]*WHERE rolname = target_role/i
);
assert.match(
  migration,
  /EXECUTE pg_catalog\.format\([\s\S]*REVOKE ALL ON TABLE public\.github_sync_manual_requests FROM %I[\s\S]*target_role/i
);
assert.doesNotMatch(
  migration,
  /REVOKE ALL ON TABLE public\.github_sync_manual_requests\s+FROM anon, authenticated, service_role/i
);
assert.doesNotMatch(
  outsideProceduralBodies,
  /^\s*(?:BEGIN|COMMIT|END|ROLLBACK|START\s+TRANSACTION|SET\s+TRANSACTION|SAVEPOINT|RELEASE)\b/im
);
assert.doesNotMatch(migration, /^\s*\\/m);

console.log("GitHub manual sync admission migration contract tests passed");
