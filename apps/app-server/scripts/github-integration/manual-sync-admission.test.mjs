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

console.log("GitHub manual sync admission primitive tests passed");
