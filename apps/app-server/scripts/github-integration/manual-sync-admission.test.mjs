import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  fingerprintGithubManualSyncScope,
  hashGithubManualSyncIdempotencyKey,
  readGithubManualSyncIdempotencyKey
} = require("../../dist/modules/github-integration/github-manual-sync-admission.js");
const {
  GithubManualSyncIdempotencyConflictError,
  GithubManualSyncQueueSaturatedError,
  GithubManualSyncRateLimitedError
} = require("../../dist/modules/github-integration/github-manual-sync-error.js");
const {
  GithubIntegrationConfigService
} = require("../../dist/modules/github-integration/github-integration-config.service.js");
const {
  GithubSyncObservabilityService
} = require("../../dist/modules/github-integration/github-sync-observability.service.js");
const { GithubSyncRunService } = require("../../dist/modules/github-integration/github-sync-run.service.js");

const scope = {
  installationId: "installation-1",
  repositoryId: null,
  projectV2Id: null,
  target: "source"
};

assert.equal(readGithubManualSyncIdempotencyKey("  retry-key  "), "  retry-key  ");
for (const value of [
  undefined,
  "",
  "   ",
  "line\nbreak",
  "\u007f",
  "\u00a0retry-key\u00a0",
  "\ufeffretry-key\ufeff",
  "a".repeat(129)
]) {
  assert.throws(
    () => readGithubManualSyncIdempotencyKey(value),
    (error) => error.getResponse().error.message === "Idempotency-Key must be printable ASCII between 1 and 128 bytes"
  );
}

assert.equal(
  hashGithubManualSyncIdempotencyKey("retry-key"),
  "86df9ac2413f27fc568266668e88b6efdca4b7f8f0f102189d0a74867a69c99d"
);
assert.notEqual(
  hashGithubManualSyncIdempotencyKey("  retry-key  "),
  hashGithubManualSyncIdempotencyKey("retry-key")
);
assert.equal(
  fingerprintGithubManualSyncScope(scope),
  "bd0f25b40d0250fc449441e066ca78bc4668275f3483bcbe8f14cdb1eb87156c"
);
assert.notEqual(
  fingerprintGithubManualSyncScope(scope),
  fingerprintGithubManualSyncScope({ ...scope, repositoryId: "repository-1" })
);

const config = new GithubIntegrationConfigService();
const admissionEnvNames = [
  "GITHUB_MANUAL_SYNC_USER_LIMIT",
  "GITHUB_MANUAL_SYNC_WORKSPACE_LIMIT",
  "GITHUB_MANUAL_SYNC_RATE_WINDOW_SECONDS",
  "GITHUB_MANUAL_SYNC_COOLDOWN_SECONDS",
  "GITHUB_MANUAL_SYNC_MAX_QUEUED_JOBS"
];
const originalAdmissionEnv = Object.fromEntries(admissionEnvNames.map((name) => [name, process.env[name]]));
for (const name of admissionEnvNames) delete process.env[name];
try {
  assert.deepEqual(config.getGithubManualSyncAdmissionConfig(), {
    userLimit: 5,
    workspaceLimit: 10,
    rateWindowSeconds: 600,
    cooldownSeconds: 30,
    maxQueuedJobs: 100
  });
  process.env.GITHUB_MANUAL_SYNC_USER_LIMIT = "0";
  assert.throws(
    () => config.getGithubManualSyncAdmissionConfig(),
    (error) => error.getResponse().error.message === "GITHUB_MANUAL_SYNC_USER_LIMIT must be a positive integer"
  );
} finally {
  for (const name of admissionEnvNames) {
    if (originalAdmissionEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalAdmissionEnv[name];
  }
}

for (const [error, status, response] of [
  [new GithubManualSyncIdempotencyConflictError(), 409, { success: false, error: { code: "GITHUB_SYNC_IDEMPOTENCY_CONFLICT", message: "GitHub manual sync idempotency key conflicts with a different request" } }],
  [new GithubManualSyncRateLimitedError("user", 17), 429, { success: false, error: { code: "GITHUB_SYNC_RATE_LIMITED", message: "GitHub manual sync is temporarily rate limited", details: { limitScope: "user", retryAfterSeconds: 17 } } }],
  [new GithubManualSyncQueueSaturatedError(12), 503, { success: false, error: { code: "GITHUB_SYNC_QUEUE_SATURATED", message: "GitHub manual sync queue is saturated", details: { retryAfterSeconds: 12 } } }]
]) {
  assert.equal(error.getStatus(), status);
  assert.deepEqual(error.getResponse(), response);
}

const output = [];
const originalWrite = process.stdout.write;
process.stdout.write = (chunk, encoding, callback) => {
  output.push(String(chunk));
  const done = typeof encoding === "function" ? encoding : callback;
  if (typeof done === "function") done();
  return true;
};
try {
  const observability = new GithubSyncObservabilityService();
  observability.emitManualSyncIdempotencyReplay();
  observability.emitManualSyncActiveRunReuse();
  observability.emitManualSyncAdmissionRejected("workspace", 9);
  observability.emitManualSyncQueueSaturated(15);
} finally {
  process.stdout.write = originalWrite;
}
assert.deepEqual(output.map((line) => JSON.parse(line)), [
  { event: "github_manual_sync_idempotency_replay" },
  { event: "github_manual_sync_active_run_reused" },
  { event: "github_manual_sync_admission_rejected", limitScope: "workspace", retryAfterSeconds: 9 },
  { event: "github_manual_sync_queue_saturated", retryAfterSeconds: 15 }
]);

const runRow = (id = "run-1") => ({
  id, workspace_id: "workspace-1", installation_id: "installation-1", repository_id: null,
  project_v2_id: null, target: "source", status: "queued", trigger_source: "manual",
  started_at: "2026-01-01T00:00:00.000Z", finished_at: null, fetched_count: 0,
  created_count: 0, updated_count: 0, skipped_count: 0, error_message: null, cursor: {}
});

async function admitManual({ replay = null, active = [], userTotal = 0, workspaceTotal = 0, userCooldown = null, workspaceCooldown = null, queuedTotal = 0, sharedQueue = null, failPrepare = false } = {}) {
  const events = [];
  const database = {
    async queryOne(text) {
      if (/FROM github_installations/.test(text)) return { id: "installation-1" };
      if (/INSERT INTO github_sync_runs/.test(text)) return runRow("new-run");
      throw new Error(`unexpected root query ${text}`);
    },
    async transaction(callback) {
      events.push("begin");
      try {
        const value = await callback({
          async execute(text) { events.push(/global-admission/.test(text) ? "global-lock" : /workspace:/.test(text) ? "workspace-lock" : "ledger"); },
          async query(text) { assert.match(text, /trigger_source = 'manual'/); return active; },
          async queryOne(text) {
            if (/github_sync_manual_requests/.test(text)) return replay;
            if (/FROM github_sync_runs AS run/.test(text)) {
              const total = events.includes("user-limit") ? workspaceTotal : userTotal;
              events.push(events.includes("user-limit") ? "workspace-limit" : "user-limit");
              return { total, window_retry_after_seconds: 19, cooldown_retry_after_seconds: events.includes("workspace-limit") ? workspaceCooldown : userCooldown };
            }
            if (/FROM github_sync_jobs AS job/.test(text)) return { total: sharedQueue?.total ?? queuedTotal, retry_after_seconds: 7 };
            if (/INSERT INTO github_sync_runs/.test(text)) return runRow("new-run");
            throw new Error(`unexpected transaction query ${text}`);
          }
        });
        events.push("commit"); return value;
      } catch (error) { events.push("rollback"); throw error; }
    }
  };
  const published = [];
  const jobs = {
    async prepareSyncJob(_tx, syncRunId) { if (failPrepare) throw new Error("prepare failed"); events.push("prepare"); if (sharedQueue) sharedQueue.total += 1; return { id: "job-1", syncRunId, leaseGeneration: "1" }; },
    async publishPreparedSyncJob(job) { published.push(job); }
  };
  const service = new GithubSyncRunService(database, { getGithubManualSyncAdmissionConfig: () => ({ userLimit: 5, workspaceLimit: 10, rateWindowSeconds: 600, cooldownSeconds: 30, maxQueuedJobs: 100 }) }, { assertWorkspaceOwnerAccess: async () => {}, assertWorkspaceAccess: async () => {} }, {}, {}, jobs);
  const start = () => service.startGithubSyncRun("user-1", "workspace-1", { target: "source", installationId: "installation-1" }, "manual", "key-1");
  return { start, events, published };
}

{
  const { start, events, published } = await admitManual({ replay: { ...runRow("old-run"), request_fingerprint: fingerprintGithubManualSyncScope(scope) } });
  assert.equal((await start()).id, "old-run");
  assert.deepEqual(events.slice(1, 3), ["global-lock", "workspace-lock"]);
  assert.deepEqual(published, []);
}
{
  const { start } = await admitManual({ replay: { ...runRow(), request_fingerprint: "different" } });
  await assert.rejects(start, (error) => error.getStatus() === 409);
}
{
  const { start, events, published } = await admitManual({ active: [runRow("active-run")] });
  assert.equal((await start()).id, "active-run");
  assert.ok(events.includes("ledger")); assert.deepEqual(published, []);
}
{
  const { start } = await admitManual({ active: [{ ...runRow("other-scope"), target: "full" }] });
  await assert.rejects(start, (error) => error.getStatus() === 409);
}
for (const options of [{ userTotal: 5 }, { workspaceTotal: 10 }]) {
  const { start } = await admitManual(options);
  await assert.rejects(start, (error) => error.getStatus() === 429 && error.getResponse().error.details.retryAfterSeconds >= 1);
}
for (const options of [{ userCooldown: 23 }, { workspaceCooldown: 29 }]) {
  const { start } = await admitManual(options);
  await assert.rejects(start, (error) => error.getStatus() === 429 && error.getResponse().error.details.retryAfterSeconds === (options.userCooldown ?? options.workspaceCooldown));
}
{
  const { start } = await admitManual({ queuedTotal: 100 });
  await assert.rejects(start, (error) => error.getStatus() === 503 && error.getResponse().error.details.retryAfterSeconds === 7);
}
{
  const sharedQueue = { total: 99 };
  const first = await admitManual({ sharedQueue });
  const second = await admitManual({ sharedQueue });
  await first.start();
  await assert.rejects(second.start, (error) => error.getStatus() === 503);
  assert.equal(first.published.length, 1);
  assert.equal(second.published.length, 0);
}
{
  const calls = [];
  const automatic = new GithubSyncRunService({
    async queryOne(text) {
      if (/github_installations/.test(text)) return { id: "installation-1" };
      if (/INSERT INTO github_sync_runs/.test(text)) return { ...runRow("automatic-run"), trigger_source: "automatic" };
      throw new Error(`unexpected automatic query ${text}`);
    },
    async transaction() { throw new Error("automatic sync must bypass manual admission transaction"); }
  }, {}, { assertWorkspaceAccess: async () => calls.push("member"), assertWorkspaceOwnerAccess: async () => { throw new Error("automatic sync must not require owner"); } }, {}, {}, { enqueueSyncJob: async (...args) => calls.push(args) });
  const result = await automatic.startGithubSyncRun("user-1", "workspace-1", { target: "source", installationId: "installation-1" }, "automatic");
  assert.equal(result.id, "automatic-run");
  assert.deepEqual(calls, ["member", ["automatic-run", "user-1"]]);
}
{
  const { start, events } = await admitManual({ failPrepare: true });
  await assert.rejects(start, /prepare failed/); assert.ok(events.includes("rollback"));
}

console.log("GitHub manual sync admission primitive tests passed");
