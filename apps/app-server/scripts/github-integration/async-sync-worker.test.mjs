import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { GithubSyncRunService } = require("../../dist/modules/github-integration/github-sync-run.service.js");
const { GithubSyncJobService } = require("../../dist/modules/github-integration/github-sync-job.service.js");
const { GithubGraphqlRateLimitError } = require("../../dist/modules/github-integration/github-app.client.js");
const { GithubWebhookService } = require("../../dist/modules/github-integration/github-webhook.service.js");
const root = fileURLToPath(new URL("../../../..", import.meta.url));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const installationId = "33333333-3333-4333-8333-333333333333";
const syncRunId = "44444444-4444-4444-8444-444444444444";

{
  const workerModulePath = `${root}/apps/app-server/src/modules/github-integration/github-sync-worker.module.ts`;
  assert.ok(existsSync(workerModulePath), "GitHub Sync Worker module must exist");

  const workerMain = readFileSync(`${root}/apps/app-server/src/github-sync-worker-main.ts`, "utf8");
  const workerModule = readFileSync(workerModulePath, "utf8");

  assert.match(workerMain, /import \{ GithubSyncWorkerModule \} from "\.\/modules\/github-integration\/github-sync-worker\.module";/);
  assert.match(workerMain, /createApplicationContext\(GithubSyncWorkerModule/);
  assert.doesNotMatch(workerMain, /AppModule/);
  assert.match(workerModule, /imports: \[DatabaseModule\]/);
  for (const provider of [
    "GithubSyncJobService",
    "GithubIntegrationConfigService",
    "GithubSyncExecutorService",
    "GithubAppClient",
    "GithubProjectV2PollingService",
    "GithubProjectV2SyncTokenService",
    "GithubTokenEncryptionService"
  ]) {
    assert.match(workerModule, new RegExp(provider));
  }
  assert.match(
    workerModule,
    /providers:\s*\[[\s\S]*?GithubProjectV2PollingService,\s*\n\s*GithubProjectV2SyncTokenService/
  );
  for (const excludedModule of [
    "PrReviewModule",
    "AgentModule",
    "MeetingModule",
    "CanvasModule",
    "GithubIntegrationModule"
  ]) {
    assert.doesNotMatch(workerModule, new RegExp(excludedModule));
  }
}

{
  const iam = readFileSync(`${root}/infra/modules/iam/main.tf`, "utf8");
  const env = readFileSync(`${root}/infra/envs/dev/main.tf`, "utf8");
  assert.match(iam, /Action\s*=\s*\["sqs:SendMessage"\][\s\S]*Resource\s*=\s*var\.github_webhooks_queue_arn/);
  assert.match(env, /github_webhooks_queue_arn\s+= module\.sqs\.github_webhooks_queue_arn/);
}

{
  const calls = [];
  const database = {
    async queryOne(text, values) {
      calls.push({ text, values });
      if (/FROM github_installations/.test(text)) return { id: installationId, workspace_id: workspaceId, github_installation_id: 1, account_login: "org", account_type: "Organization" };
      if (/INSERT INTO github_sync_runs/.test(text)) return { id: syncRunId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", status: "queued", started_at: "2026-01-01T00:00:00.000Z", finished_at: null, fetched_count: 0, created_count: 0, updated_count: 0, skipped_count: 0, error_message: null, cursor: {} };
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const queued = [];
  const service = new GithubSyncRunService(database, {}, { assertWorkspaceAccess: async () => {} }, {}, {}, { enqueueSyncJob: async (...args) => queued.push(args) });
  const run = await service.startGithubSyncRun(userId, workspaceId, { target: "full", installationId });
  assert.equal(run.status, "queued");
  assert.deepEqual(queued, [[syncRunId, userId]]);
  assert.match(calls[1].text, /'queued'/);
}

{
  const received = [{ Body: JSON.stringify({ jobId: "job-1" }), ReceiptHandle: "receipt-1" }];
  const commands = [];
  const worker = new GithubSyncJobService({ query: async () => [] }, {}, {}, {});
  worker.client = () => ({ send: async (command) => { commands.push(command.constructor.name); return command.constructor.name === "ReceiveMessageCommand" ? { Messages: received.splice(0, 1) } : {}; } });
  await worker.pollQueue("queue-url", "jobId", async () => "retry");
  assert.deepEqual(commands, ["ReceiveMessageCommand"]);
  received.push({ Body: JSON.stringify({ jobId: "job-1" }), ReceiptHandle: "receipt-2" });
  await worker.pollQueue("queue-url", "jobId", async () => "terminal");
  assert.deepEqual(commands.slice(-2), ["ReceiveMessageCommand", "DeleteMessageCommand"]);
}

{
  const events = [];
  const recoveredSyncRunId = "55555555-5555-4555-8555-555555555555";
  const worker = new GithubSyncJobService(
    { query: async () => [] },
    {},
    {},
    {},
    {},
    {
      claimDueSchedules: async () => [{ syncRunId: recoveredSyncRunId, requestedByUserId: userId }]
    }
  );
  worker.recoverWebhookOutbox = async () => { events.push("recover-webhooks"); };
  worker.enqueueSyncJob = async (runId, requestedByUserId) => {
    events.push(`enqueue:${runId}:${requestedByUserId}`);
  };
  worker.pollQueue = async (queueUrl) => { events.push(`queue:${queueUrl}`); };
  process.env.SQS_GITHUB_SYNC_JOBS_QUEUE_URL = "sync-queue";
  process.env.SQS_GITHUB_WEBHOOKS_QUEUE_URL = "webhook-queue";

  await worker.pollOnce();

  assert.deepEqual(events, [
    "recover-webhooks",
    `enqueue:${recoveredSyncRunId}:${userId}`,
    "queue:sync-queue",
    "queue:webhook-queue"
  ]);
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const terminalCalls = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => ({ fetchedCount: 1, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} }) },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {},
    {
      markRunSucceeded: async (runId, transaction) => terminalCalls.push(["success", runId, transaction]),
      markRunFailed: async (...args) => terminalCalls.push(["failed", ...args])
    }
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.equal(terminalCalls[0][0], "success");
  assert.equal(terminalCalls[0][1], syncRunId);
  assert.ok(terminalCalls[0][2], "schedule success must share the terminal database transaction");
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 3, lease_generation: 1 };
  const terminalCalls = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new Error("provider unavailable"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {},
    {
      markRunFailed: async (...args) => terminalCalls.push(args)
    }
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.equal(terminalCalls[0][0], syncRunId);
  assert.equal(terminalCalls[0][1], "provider unavailable");
  assert.equal(terminalCalls[0][2], false);
  assert.ok(terminalCalls[0][3], "schedule failure must share the terminal database transaction");
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const terminalCalls = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new GithubGraphqlRateLimitError("GitHub API rate limit exceeded"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {},
    { markRunFailed: async (...args) => terminalCalls.push(args) }
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.equal(terminalCalls[0][0], syncRunId);
  assert.equal(terminalCalls[0][1], "GitHub API rate limit exceeded");
  assert.equal(terminalCalls[0][2], true);
  assert.ok(terminalCalls[0][3], "rate-limit failure must share the terminal database transaction");
}

{
  const failedRuns = [];
  const worker = new GithubSyncJobService(
    {
      queryOne: async () => ({ id: "job-1" }),
      transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) })
    },
    {},
    {},
    {},
    {},
    { markRunFailed: async (...args) => failedRuns.push(args) }
  );
  worker.client = () => ({ send: async () => { throw new Error("SQS unavailable"); } });
  process.env.SQS_GITHUB_SYNC_JOBS_QUEUE_URL = "sync-queue";

  await assert.rejects(() => worker.enqueueSyncJob(syncRunId, userId));
  assert.equal(failedRuns[0][0], syncRunId);
  assert.equal(failedRuns[0][1], "GitHub sync job could not be enqueued");
  assert.equal(failedRuns[0][2], false);
  assert.ok(failedRuns[0][3], "enqueue failure must share the terminal database transaction");
}

{
  const queries = [];
  const worker = new GithubSyncJobService({ queryOne: async (text) => { queries.push(text); return null; } }, {}, {}, {});
  assert.equal(await worker.acquireLease("job-1"), null);
  assert.match(queries[0], /lease_expires_at < now\(\)/);
  assert.match(queries[0], /status IN \('queued', 'running'\)/);
  assert.match(queries[0], /lease_generation=lease_generation\+1/i);
  assert.match(queries[0], /RETURNING id, sync_run_id, requested_by_user_id, attempt_count, lease_generation/i);
}

{
  const job = { id: "job-fenced", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 2 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 0 }; } },
    {}, {}, {}
  );

  await assert.rejects(() => worker.renewLease(job), /lease ownership was lost/i);
  assert.match(writes[0].text, /lease_owner=\$2/i);
  assert.match(writes[0].text, /lease_generation=\$3/i);
  assert.deepEqual(writes[0].values, [job.id, worker.workerId, job.lease_generation]);
}

{
  const job = { id: "job-terminal-fence", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 3 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 0 }; } }) },
    {}, {}, {}
  );

  await worker.completeSuccess(job, { fetchedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} });
  assert.match(writes[0].text, /lease_owner=\$2/i);
  assert.match(writes[0].text, /lease_generation=\$3/i);
  assert.match(writes[0].text, /UPDATE github_sync_runs/i);
  assert.match(writes[0].text, /UPDATE github_sync_jobs/i);
  assert.deepEqual(writes[0].values.slice(0, 3), [job.id, worker.workerId, job.lease_generation]);
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const writes = [];
  let heartbeat;
  let completeSync;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    heartbeat = callback;
    assert.equal(delay, 5 * 60 * 1000, "the heartbeat must renew before the ten-minute lease expires");
    return "heartbeat";
  };
  globalThis.clearInterval = (timer) => assert.equal(timer, "heartbeat");

  try {
    const worker = new GithubSyncJobService(
      {
        execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; },
        transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) })
      },
      { getGithubAppConfig: () => ({}) },
      { runGithubSyncTarget: async () => new Promise((resolve) => { completeSync = resolve; }) },
      { resolvePersonalProjectV2UserAccessToken: async () => null }
    );
    worker.acquireLease = async () => job;
    worker.installation = async () => ({ id: installationId });

    const processing = worker.processSyncJob("job-1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof heartbeat, "function", "a leased job must start a heartbeat");
    await heartbeat();

    assert.equal(writes.length, 1);
    assert.match(writes[0].text, /UPDATE github_sync_jobs/i);
    assert.match(writes[0].text, /lease_owner=\$2/i);
    assert.match(writes[0].text, /lease_expires_at=now\(\) \+ interval '10 minutes'/i);
    assert.match(writes[0].text, /UPDATE github_project_v2_polling_schedules/i);
    assert.match(writes[0].text, /active_sync_run_id=renewed_job\.sync_run_id/i);
    assert.match(writes[0].text, /schedule\.lease_owner=\$2/i);
    assert.deepEqual(writes[0].values, [job.id, worker.workerId, job.lease_generation]);

    completeSync({ fetchedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} });
    assert.equal(await processing, "terminal");
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

{
  const job = { id: "job-lease-renewal", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const warnings = [];
  let heartbeat;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    heartbeat = callback;
    return "heartbeat";
  };
  globalThis.clearInterval = () => {};

  try {
    const worker = new GithubSyncJobService(
      { execute: async () => { throw new Error("token=not-safe-to-log"); } },
      {},
      {},
      {}
    );
    worker.logger = { warn: (message) => warnings.push(message) };
    const { timer } = worker.startLeaseHeartbeat(job);
    await heartbeat();
    clearInterval(timer);

    assert.deepEqual(warnings, [`GitHub sync job ${job.id} lease renewal failed`]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const writes = [];
  const worker = new GithubSyncJobService(
    {
      transaction: async (callback) => callback({
        execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; }
      })
    },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new Error("transient provider failure"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null }
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });
  assert.equal(await worker.processSyncJob("job-1"), "retry");
  assert.equal(writes.length, 0, "transient failure keeps the SQS message and job runnable");
  job.attempt_count = 3;
  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.equal(writes.length, 1, "maximum attempts terminally fail the fenced run and job atomically");
  assert.match(writes[0].text, /status='failed'/);
  assert.match(writes[0].text, /lease_generation=\$3/);
}

{
  let delivery = null;
  let sends = 0;
  const database = {
    async queryOne(text, values) {
      if (/WHERE delivery_id/.test(text)) return delivery;
      if (/INSERT INTO github_webhook_deliveries/.test(text)) {
        delivery = { delivery_id: values[0], event_name: values[1], status: values[2], received_at: "2026-01-01T00:00:00.000Z", processed_at: null, error_message: values[3] };
        return delivery;
      }
      return null;
    },
    async execute(text, values) {
      if (/SET\s+status='failed'/.test(text)) {
        delivery = { ...delivery, status: "failed", error_message: values[1] };
      }
      if (/SET\s+status='received'/.test(text)) {
        delivery = { ...delivery, status: "received", error_message: null, processed_at: null };
      }
      return { rowCount: 1 };
    }
  };
  const jobs = { enqueueWebhookDelivery: async () => { sends += 1; if (sends === 1) throw new Error("SQS unavailable"); } };
  const service = new GithubWebhookService(database, { getGithubWebhookConfig: () => ({ webhookSecret: "secret" }) }, jobs);
  const rawBody = Buffer.from('{"ok":true}');
  const { createHmac } = await import("node:crypto");
  const signature256 = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
  await assert.rejects(() => service.receiveGithubWebhook({ deliveryId: "delivery-1", eventName: "issues", signature256, rawBody, body: {} }));
  assert.equal(delivery.status, "failed");
  const recovered = await service.receiveGithubWebhook({ deliveryId: "delivery-1", eventName: "issues", signature256, rawBody, body: {} });
  assert.equal(sends, 2);
  assert.equal(recovered.status, "received");
}

{
  const writes = [];
  const worker = new GithubSyncJobService(
    {
      query: async () => [{ delivery_id: "persisted-delivery" }],
      execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; }
    }, {}, {}, {}, {
      recoverDeliveries: async (enqueueDelivery) => {
        await enqueueDelivery("persisted-delivery");
        return [];
      }
    }
  );
  const commands = [];
  worker.client = () => ({ send: async (command) => { commands.push(command.constructor.name); return {}; } });
  process.env.SQS_GITHUB_WEBHOOKS_QUEUE_URL = "queue-url";
  await worker.recoverWebhookOutbox();
  assert.deepEqual(commands, ["SendMessageCommand"]);
  assert.equal(writes.length, 0, "worker recovery must not update webhook delivery lifecycle state");
}

console.log("GitHub async sync worker behavioral tests passed");
