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

const createMigration = await readSource(
  "../../../../db/migrations/022_create_board_issue_create_operations.sql"
);
const constraintFixMigration = await readSource(
  "../../../../db/migrations/079_allow_board_issue_operation_parent_cleanup.sql"
);

assert.match(
  createMigration,
  /CREATE TABLE public\.board_issue_create_operations/,
  "Migration 022 must create the Board Issue operation table"
);
assert.match(
  createMigration,
  /UNIQUE \(workspace_id, actor_user_id, idempotency_key\)/,
  "Idempotency keys must be unique per Workspace and actor"
);
assert.match(
  createMigration,
  /FOREIGN KEY \(column_id, board_id\)/,
  "Operation column must belong to the same Board"
);
assert.match(
  createMigration,
  /status IN \('processing', 'retryable', 'succeeded'\)/,
  "Operation status values must be constrained"
);
assert.match(
  createMigration,
  /completed_stage IN \([\s\S]*'none'[\s\S]*'github_issue_created'[\s\S]*'project_item_added'[\s\S]*'status_updated'[\s\S]*'cache_persisted'[\s\S]*\)/,
  "Operation stage values must be constrained"
);
assert.match(
  createMigration,
  /lease_token UUID NOT NULL/,
  "Operation attempts must use a lease token"
);
assert.match(
  createMigration,
  /locked_until TIMESTAMPTZ NOT NULL/,
  "Operation attempts must have a lease expiry"
);
assert.match(
  createMigration,
  /CREATE INDEX idx_board_issue_create_operations_status[\s\S]*ON public\.board_issue_create_operations\(status, updated_at\)/,
  "Retryable operations must have a status lookup index"
);
assert.match(
  createMigration,
  /github_issue_node_id[\s\S]*WHERE github_issue_node_id IS NOT NULL/,
  "GitHub Issue node IDs must support future webhook reconciliation"
);
assert.match(
  createMigration,
  /github_project_item_node_id[\s\S]*WHERE github_project_item_node_id IS NOT NULL/,
  "ProjectV2 item node IDs must support future webhook reconciliation"
);

assert.match(
  createMigration,
  /pilo_issue_id BIGINT\s+REFERENCES public\.pilo_issues\(id\) ON DELETE SET NULL/,
  "Deleting a cached PILO Issue must preserve the durable operation record"
);
assert.match(
  constraintFixMigration,
  /DROP CONSTRAINT chk_board_issue_create_operations_success/,
  "Migration 079 must replace the success constraint that blocks ON DELETE SET NULL"
);

const fixedSuccessConstraint = constraintFixMigration.match(
  /ADD CONSTRAINT chk_board_issue_create_operations_success[\s\S]*?CHECK \([\s\S]*?\n\s*\);/
)?.[0];

assert.ok(
  fixedSuccessConstraint,
  "Migration 079 must recreate the Board Issue operation success constraint"
);
assert.match(
  fixedSuccessConstraint,
  /status <> 'succeeded'/,
  "Non-succeeded operations must remain outside the completed-state requirements"
);
assert.match(
  fixedSuccessConstraint,
  /completed_stage = 'cache_persisted'/,
  "Succeeded operations must remain fully cache-persisted"
);
assert.match(
  fixedSuccessConstraint,
  /response_body IS NOT NULL/,
  "Succeeded operations must retain their replay response"
);
assert.match(
  fixedSuccessConstraint,
  /jsonb_typeof\(response_body\) = 'object'/,
  "Succeeded operation responses must remain JSON objects"
);
assert.match(
  fixedSuccessConstraint,
  /completed_at IS NOT NULL/,
  "Succeeded operations must retain their completion timestamp"
);
assert.doesNotMatch(
  fixedSuccessConstraint,
  /pilo_issue_id IS NOT NULL/,
  "Succeeded operations must allow pilo_issue_id to become NULL during parent cleanup"
);
