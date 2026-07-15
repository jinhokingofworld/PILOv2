import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { ActivityLogService } = await import(
  "../../dist/common/activity-log.service.js"
);

const migration = await readFile(
  new URL(
    "../../../../db/migrations/070_create_activity_log_foundation_constraints.sql",
    import.meta.url
  ),
  "utf8"
);
const rlsMigration = await readFile(
  new URL("../../../../db/migrations/002_enable_all_deny_rls.sql", import.meta.url),
  "utf8"
);
const workspaceService = await readFile(
  new URL("../../src/modules/workspace/workspace.service.ts", import.meta.url),
  "utf8"
);

const executed = [];
const transaction = {
  execute: async (text, values) => {
    executed.push({ text, values });
    return { rows: [] };
  }
};
const service = new ActivityLogService();

await service.append(transaction, createInput());
assert.equal(executed.length, 1);
assert.match(executed[0].text, /INSERT INTO activity_logs/);
assert.doesNotMatch(executed[0].text, /occurred_at/);
assert.match(executed[0].text, /ON CONFLICT \(workspace_id, dedupe_key\) DO NOTHING/);
assert.equal(executed[0].values[6], "calendar:calendar_event_updated:event-1:v2");

await assert.rejects(
  () => service.append(transaction, createInput({ action: "unknown_action" })),
  (error) => hasBadRequestMessage(error, "Activity Log action must be registered")
);
await assert.rejects(
  () =>
    service.append(
      transaction,
      createInput({ actor: { type: "user", userId: null } })
    ),
  (error) => hasBadRequestMessage(error, "Activity Log user actor requires userId")
);
await assert.rejects(
  () =>
    service.append(
      transaction,
      createInput({ metadata: { version: 1, summary: "", data: {} } })
    ),
  (error) => hasBadRequestMessage(error, "Activity Log metadata.summary")
);
await assert.rejects(
  () =>
    service.append(
      transaction,
      createInput({ metadata: { version: 1, summary: "일정을 변경했습니다.", data: [] } })
    ),
  (error) => hasBadRequestMessage(error, "Activity Log metadata.data must be an object")
);
assert.equal(executed.length, 1);

assert.match(migration, /activity_logs_dedupe_key_max_length_check/);
assert.match(migration, /length\(dedupe_key\) <= 512/);
assert.match(migration, /activity_logs_actor_type_check/);
assert.doesNotMatch(
  migration,
  /actor_type <> 'user' OR actor_user_id IS NOT NULL/
);
assert.match(migration, /activity_logs_metadata_envelope_check/);
assert.match(migration, /jsonb_typeof\(metadata -> 'data'\) = 'object'/);
assert.match(migration, /UPDATE public\.activity_logs/);
assert.match(migration, /'legacyMetadata', metadata/);
assert.match(
  migration,
  /VALIDATE CONSTRAINT activity_logs_metadata_envelope_check/
);
assert.match(migration, /NOT VALID/);
assert.match(migration, /CREATE TRIGGER trg_activity_logs_prevent_mutation/);
assert.match(migration, /TG_OP = 'DELETE'/);
assert.match(migration, /pilo\.activity_log_tenant_purge/);
assert.match(migration, /OLD\.actor_user_id IS NOT NULL/);
assert.match(rlsMigration, /ALTER TABLE public\.activity_logs ENABLE ROW LEVEL SECURITY/);
assert.match(workspaceService, /database\.transaction/);
assert.match(workspaceService, /set_config\('pilo\.activity_log_tenant_purge', 'on', true\)/);
assert.match(workspaceService, /DELETE FROM workspaces WHERE id = \$1/);

console.log("Common Activity Log tests passed.");

function createInput(overrides = {}) {
  return {
    workspaceId: "workspace-1",
    actor: { type: "user", userId: "user-1" },
    action: "calendar_event_updated",
    target: { type: "calendar_event", id: "event-1" },
    dedupeKey: "calendar:calendar_event_updated:event-1:v2",
    metadata: {
      version: 1,
      summary: "디자인 리뷰 일정을 변경했습니다.",
      data: { changedFields: ["startAt"] }
    },
    ...overrides
  };
}

function hasBadRequestMessage(error, message) {
  return (
    error?.getResponse?.()?.error?.code === "BAD_REQUEST" &&
    error.getResponse().error.message.includes(message)
  );
}
