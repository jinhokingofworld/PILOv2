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
  "../../../../db/migrations/022_create_board_issue_create_operations.sql"
);

assert.match(
  migration,
  /CREATE TABLE public\.board_issue_create_operations/,
  "Migration 022 must create the Board Issue operation table"
);
assert.match(
  migration,
  /UNIQUE \(workspace_id, actor_user_id, idempotency_key\)/,
  "Idempotency keys must be unique per Workspace and actor"
);
assert.match(
  migration,
  /FOREIGN KEY \(column_id, board_id\)/,
  "Operation column must belong to the same Board"
);
assert.match(
  migration,
  /status IN \('processing', 'retryable', 'succeeded'\)/,
  "Operation status values must be constrained"
);
assert.match(
  migration,
  /completed_stage IN \([\s\S]*'none'[\s\S]*'github_issue_created'[\s\S]*'project_item_added'[\s\S]*'status_updated'[\s\S]*'cache_persisted'[\s\S]*\)/,
  "Operation stage values must be constrained"
);
assert.match(
  migration,
  /lease_token UUID NOT NULL/,
  "Operation attempts must use a lease token"
);
assert.match(
  migration,
  /locked_until TIMESTAMPTZ NOT NULL/,
  "Operation attempts must have a lease expiry"
);
assert.match(
  migration,
  /CREATE INDEX idx_board_issue_create_operations_status[\s\S]*ON public\.board_issue_create_operations\(status, updated_at\)/,
  "Retryable operations must have a status lookup index"
);
assert.match(
  migration,
  /github_issue_node_id[\s\S]*WHERE github_issue_node_id IS NOT NULL/,
  "GitHub Issue node IDs must support future webhook reconciliation"
);
assert.match(
  migration,
  /github_project_item_node_id[\s\S]*WHERE github_project_item_node_id IS NOT NULL/,
  "ProjectV2 item node IDs must support future webhook reconciliation"
);
