import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { NestFactory } = require("@nestjs/core");
const { resolveDatabasePoolSettings } = require("../../dist/database/database.service.js");
const { GithubSyncRunService } = require("../../dist/modules/github-integration/github-sync-run.service.js");
const { GithubSyncJobService } = require("../../dist/modules/github-integration/github-sync-job.service.js");
const { GithubSyncWorkerModule } = require("../../dist/modules/github-integration/github-sync-worker.module.js");
const { GithubSyncObservabilityService } = require("../../dist/modules/github-integration/github-sync-observability.service.js");
const {
  classifyGithubSyncWorkerFailure,
  runGithubSyncWorkerLoop
} = require("../../dist/modules/github-integration/github-sync-worker-loop.js");
const { GithubProjectV2PollingService } = require("../../dist/modules/github-integration/github-project-v2-polling.service.js");
const { GithubAppClient, GithubGraphqlRateLimitError } = require("../../dist/modules/github-integration/github-app.client.js");
const { GithubWebhookService } = require("../../dist/modules/github-integration/github-webhook.service.js");
const root = fileURLToPath(new URL("../../../..", import.meta.url));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const installationId = "33333333-3333-4333-8333-333333333333";
const syncRunId = "44444444-4444-4444-8444-444444444444";

{
  const observabilityPath = `${root}/apps/app-server/src/modules/github-integration/github-sync-observability.service.ts`;
  assert.ok(existsSync(observabilityPath), "GitHub sync observability service must exist");

  const observabilitySource = readFileSync(observabilityPath, "utf8");
  assert.match(observabilitySource, /github_sync_retry/);
  assert.match(observabilitySource, /github_sync_terminal_failure/);
  assert.match(observabilitySource, /github_sync_rate_limit_terminal_failure/);
  assert.match(observabilitySource, /github_sync_worker_poll_retry/);
  assert.match(observabilitySource, /JSON\.stringify/);

  const appClientSource = readFileSync(`${root}/apps/app-server/src/modules/github-integration/github-app.client.ts`, "utf8");
  assert.match(appClientSource, /rateLimitRemaining: number \| null/);
  assert.match(appClientSource, /headers\.get\("x-ratelimit-remaining"\)/);
}

{
  const poolSettings = resolveDatabasePoolSettings({
    DATABASE_APPLICATION_NAME: "pilo-dev-github-sync-worker",
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: "5000",
    DATABASE_POOL_IDLE_TIMEOUT_MS: "10000",
    DATABASE_POOL_MAX: "1"
  });

  assert.deepEqual(poolSettings, {
    application_name: "pilo-dev-github-sync-worker",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    max: 1
  });
  assert.throws(
    () => resolveDatabasePoolSettings({ DATABASE_POOL_MAX: "0" }),
    /DATABASE_POOL_MAX must be a positive integer/
  );
}

{
  const output = [];
  const originalWrite = process.stdout.write;
  const observability = new GithubSyncObservabilityService();
  process.stdout.write = (chunk, encoding, callback) => {
    output.push(String(chunk));
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") done();
    return true;
  };

  try {
    observability.emitWorkerPollRetry(1500, "database_session_pool_exhausted");
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(output.map((line) => JSON.parse(line)), [{
    event: "github_sync_worker_poll_retry",
    jobId: null,
    syncRunId: null,
    deliveryId: null,
    target: "worker_poll",
    attemptCount: null,
    failureKind: "database_session_pool_exhausted",
    retryAfterSeconds: 2,
    rateLimitRemaining: null
  }]);
}

{
  const observed = [];
  const delays = [];
  let calls = 0;
  const worker = {
    async pollOnce() {
      calls += 1;
      if (calls === 1) {
        const error = new Error("connection pool exhausted");
        error.code = "EMAXCONNSESSION";
        throw error;
      }
      if (calls === 2) throw new Error("safe test failure");
    }
  };

  await runGithubSyncWorkerLoop(
    worker,
    {
      emitWorkerPollRetry: (retryAfterMilliseconds, failureKind) => {
        observed.push({ retryAfterMilliseconds, failureKind });
      }
    },
    () => calls >= 3,
    async (milliseconds) => { delays.push(milliseconds); }
  );

  assert.equal(calls, 3, "the worker must retry a failed poll instead of exiting");
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(observed, [
    { retryAfterMilliseconds: 1000, failureKind: "database_session_pool_exhausted" },
    { retryAfterMilliseconds: 2000, failureKind: "unknown" }
  ]);
  assert.equal(
    classifyGithubSyncWorkerFailure(new Error("password=not-logged")),
    "unknown"
  );
}

{
  const output = [];
  const originalWrite = process.stdout.write;
  const observability = new GithubSyncObservabilityService();
  const input = {
    jobId: "job-observability",
    syncRunId,
    target: "full",
    attemptCount: 2,
    rateLimitRemaining: null
  };

  process.stdout.write = (chunk, encoding, callback) => {
    output.push(String(chunk));
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") done();
    return true;
  };
  try {
    observability.emitRetry(input, 900);
    observability.emitTerminalFailure({ ...input, rateLimitRemaining: 0 }, true);
    observability.emitWebhookRetry("delivery-observability");
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(output.map((line) => JSON.parse(line)), [
    { event: "github_sync_retry", ...input, deliveryId: null, retryAfterSeconds: 900 },
    { event: "github_sync_rate_limit_terminal_failure", ...input, deliveryId: null, rateLimitRemaining: 0 },
    {
      event: "github_sync_retry",
      jobId: null,
      syncRunId: null,
      deliveryId: "delivery-observability",
      target: "webhook_delivery",
      attemptCount: null,
      retryAfterSeconds: 120,
      rateLimitRemaining: null
    }
  ]);
  assert.ok(output.every((line) => line.endsWith("\n")), "each event must be one raw stdout JSON line");
}

{
  const output = [];
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stdout.write;
  const observability = new GithubSyncObservabilityService();
  const client = new GithubAppClient(observability);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-remaining": "42"
    }
  });
  process.stdout.write = (chunk) => { output.push(String(chunk)); return true; };

  try {
    assert.deepEqual(
      await client.fetchGraphqlWithToken("test-user-access-token", "query Test { viewer { login } }", {}, "GraphQL test failed"),
      {}
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(output.map((line) => JSON.parse(line)), [{
    event: "github_sync_rate_limit_observed",
    jobId: null,
    syncRunId: null,
    deliveryId: null,
    target: "graphql",
    attemptCount: null,
    rateLimitRemaining: 42
  }]);
  assert.doesNotMatch(output.join(""), /test-user-access-token|viewer/);
}

{
  const deliveryEvents = [];
  const worker = new GithubSyncJobService(
    {}, {}, {}, {},
    { processDelivery: async () => "retry" },
    undefined,
    { emitWebhookRetry: (deliveryId) => deliveryEvents.push(deliveryId) }
  );

  assert.equal(await worker.processWebhookDelivery("delivery-retry-observability"), "retry");
  assert.deepEqual(deliveryEvents, ["delivery-retry-observability"]);
}

{
  const workerModulePath = `${root}/apps/app-server/src/modules/github-integration/github-sync-worker.module.ts`;
  assert.ok(existsSync(workerModulePath), "GitHub Sync Worker module must exist");

  const workerMain = readFileSync(`${root}/apps/app-server/src/github-sync-worker-main.ts`, "utf8");
  const workerModule = readFileSync(workerModulePath, "utf8");

  assert.match(workerMain, /import \{ GithubSyncWorkerModule \} from "\.\/modules\/github-integration\/github-sync-worker\.module";/);
  assert.match(workerMain, /createApplicationContext\(GithubSyncWorkerModule/);
  assert.match(workerMain, /runGithubSyncWorkerLoop\(worker, observability/);
  assert.doesNotMatch(workerMain, /AppModule/);
  assert.match(workerModule, /imports: \[DatabaseModule\]/);
  for (const provider of [
    "GithubSyncJobService",
    "GithubIntegrationConfigService",
    "GithubSyncExecutorService",
    "GithubAppClient",
    "GithubProjectV2PollingService",
    "GithubProjectV2SyncTokenService",
    "GithubOAuthConnectionService",
    "GithubTokenEncryptionService"
  ]) {
    assert.match(workerModule, new RegExp(provider));
  }
  assert.match(
    workerModule,
    /providers:\s*\[[\s\S]*?GithubProjectV2PollingService,\s*\n\s*GithubProjectV2SyncTokenService/
  );
  assert.match(workerModule, /GithubSyncObservabilityService/);
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
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  const app = await NestFactory.createApplicationContext(GithubSyncWorkerModule, { logger: false });
  try {
    assert.ok(app.get(GithubSyncJobService), "GitHub sync worker must bootstrap its job service");
  } finally {
    await app.close();
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousAppEnv;
    }
  }
}

{
  const iam = readFileSync(`${root}/infra/modules/iam/main.tf`, "utf8");
  const env = readFileSync(`${root}/infra/envs/dev/main.tf`, "utf8");
  const observabilityInfra = readFileSync(
    `${root}/infra/modules/github-sync-observability/main.tf`,
    "utf8"
  );
  assert.match(iam, /Action\s*=\s*\["sqs:SendMessage"\][\s\S]*Resource\s*=\s*var\.github_sync_worker_queue_arns/);
  assert.match(env, /github_sync_worker_queue_arns\s+= module\.sqs\.github_sync_worker_queue_arns/);
  assert.match(env, /github_webhooks_queue_arn\s+= module\.sqs\.github_webhooks_queue_arn/);
  assert.match(
    env,
    /app-server\s*=\s*\{[\s\S]*?DATABASE_POOL_MAX\s+=\s+"2"[\s\S]*?DATABASE_APPLICATION_NAME\s+=\s+"pilo-dev-app-server"/
  );
  assert.match(
    env,
    /realtime-server\s*=\s*\{[\s\S]*?DATABASE_POOL_MAX\s+=\s+"1"[\s\S]*?DATABASE_APPLICATION_NAME\s+=\s+"pilo-dev-realtime-server"/
  );
  assert.match(
    env,
    /github-sync-worker\s*=\s*\{[\s\S]*?DATABASE_POOL_MAX\s+=\s+"1"[\s\S]*?DATABASE_APPLICATION_NAME\s+=\s+"pilo-dev-github-sync-worker"/
  );
  assert.match(observabilityInfra, /DatabasePoolExhaustedCount/);
  assert.match(observabilityInfra, /database_session_pool_exhausted/);
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
  const claimedPollingRunId = "55555555-5555-4555-8555-555555555555";
  const state = { runStatus: "queued", createdJobId: null, cancellationSql: "", enqueueSql: "" };
  const database = {
    async query() {
      return [{
        sync_run_id: claimedPollingRunId,
        repository_id: "66666666-6666-4666-8666-666666666666",
        project_v2_id: "77777777-7777-4777-8777-777777777777",
        requested_by_user_id: userId
      }];
    },
    async execute(text) {
      state.cancellationSql = text;
      state.runStatus = "failed";
      return { rowCount: 1 };
    },
    async queryOne(text) {
      if (/INSERT INTO github_sync_jobs/i.test(text)) {
        state.enqueueSql = text;
        if (state.runStatus !== "queued") return null;
        state.createdJobId = "job-created-after-deselect";
        return { id: state.createdJobId, lease_generation: "0" };
      }
      return null;
    }
  };
  const polling = new GithubProjectV2PollingService(database);
  let executorCalls = 0;
  const worker = new GithubSyncJobService(
    database,
    {},
    { runGithubSyncTarget: async () => { executorCalls += 1; } },
    {}
  );
  let sentMessages = 0;
  worker.client = () => ({ send: async () => { sentMessages += 1; } });

  const [claim] = await polling.claimDueSchedules(1);
  await polling.terminateDeselectedQueuedRuns({ repositoryId: claim.repositoryId, retainedProjectV2Ids: [] });
  const enqueued = await worker.enqueueSyncJob(claim.syncRunId, claim.requestedByUserId, {
    skipIfRunIsNoLongerQueued: true
  });

  assert.equal(state.runStatus, "failed", "deselecting after a claim must terminalize the still-queued run");
  assert.match(
    state.cancellationSql,
    /terminal_runs AS \([\s\S]*?FROM deselected_schedules AS schedule[\s\S]*?run\.status = 'queued'/i
  );
  assert.equal(enqueued, false, "late polling enqueue must be skipped after the claimed run was terminalized");
  assert.match(state.enqueueSql, /locked_polling_schedule AS MATERIALIZED[\s\S]*?FOR UPDATE OF schedule[\s\S]*?queued_run AS \([\s\S]*?github_sync_runs AS run[\s\S]*?run\.status='queued'/i);
  assert.equal(state.createdJobId, null, "late enqueue must not create an orphan sync job");
  assert.equal(sentMessages, 0, "late enqueue must not publish an orphan job message");
  assert.equal(await worker.processSyncJob("job-created-after-deselect"), "terminal");
  assert.equal(executorCalls, 0, "late enqueue must not reach the sync executor");
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const writes = [];
  const worker = new GithubSyncJobService(
    {
      queryOne: async () => ({ ok: 1 }),
      transaction: async (callback) => callback({ execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; } })
    },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => ({ fetchedCount: 1, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} }) },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {}
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.match(writes[0].text, /terminal_job AS \([\s\S]*lease_generation=\$3[\s\S]*terminal_run AS \([\s\S]*FROM terminal_job[\s\S]*terminal_schedule AS \([\s\S]*FROM terminal_run/i);
  assert.match(writes[0].text, /next_poll_at=now\(\) \+ interval '1 minute'/i);
  assert.deepEqual(writes[0].values.slice(0, 3), [job.id, worker.workerId, job.lease_generation]);
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 3, lease_generation: 1 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; } }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new Error("provider unavailable"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {}
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.match(writes[0].text, /terminal_run AS \([\s\S]*FROM terminal_job[\s\S]*terminal_schedule AS \([\s\S]*FROM terminal_run/i);
  assert.match(writes[0].text, /next_poll_at=now\(\) \+ interval '5 minutes'/i);
  assert.equal(writes[0].values[3], "provider unavailable");
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; } }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new GithubGraphqlRateLimitError("GitHub API rate limit exceeded"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {}
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.match(writes[0].text, /next_poll_at=now\(\) \+ interval '30 minutes'/i);
  assert.match(writes[0].text, /terminal_schedule AS \([\s\S]*FROM terminal_run/i);
}

{
  const queries = [];
  const writes = [];
  const worker = new GithubSyncJobService(
    {
      queryOne: async (text) => {
        queries.push(text);
        return { id: "job-1", lease_generation: "7" };
      },
      transaction: async (callback) => callback({
        execute: async (text, values) => {
          writes.push({ text, values });
          return { rowCount: 1 };
        }
      })
    },
    {},
    {},
    {},
    {}
  );
  worker.client = () => ({ send: async () => { throw new Error("SQS unavailable"); } });
  process.env.SQS_GITHUB_SYNC_JOBS_QUEUE_URL = "sync-queue";

  await assert.rejects(() => worker.enqueueSyncJob(syncRunId, userId));
  assert.match(queries[0], /ON CONFLICT \(sync_run_id\) DO UPDATE/i);
  assert.match(queries[0], /locked_polling_schedule AS MATERIALIZED[\s\S]*?FOR UPDATE OF schedule[\s\S]*?queued_run AS/i);
  assert.match(queries[0], /SET status='queued', lease_owner=NULL, lease_expires_at=NULL/i);
  assert.match(queries[0], /lease_generation=github_sync_jobs\.lease_generation\+1/i);
  assert.match(queries[0], /RETURNING id, lease_generation/i);
  assert.equal(writes.length, 1, "enqueue failure must transition job, run, and schedule in one transaction");
  assert.match(
    writes[0].text,
    /locked_polling_schedule AS MATERIALIZED[\s\S]*?FOR UPDATE OF schedule[\s\S]*?terminal_job AS \([\s\S]*status='queued'[\s\S]*lease_owner IS NULL[\s\S]*lease_expires_at IS NULL[\s\S]*lease_generation=\$3[\s\S]*terminal_run AS \([\s\S]*FROM terminal_job[\s\S]*terminal_schedule AS \([\s\S]*FROM terminal_run/i,
    "a delayed publisher cannot fail a job that has already been leased by a newer generation"
  );
  assert.deepEqual(writes[0].values, ["job-1", syncRunId, "7"]);
}

{
  const queries = [];
  const writes = [];
  let sendCount = 0;
  let rejectFirstSend;
  const worker = new GithubSyncJobService(
    {
      queryOne: async (text) => {
        queries.push(text);
        return { id: "job-reenqueue-fence", lease_generation: sendCount === 0 ? "7" : "8" };
      },
      transaction: async (callback) => callback({
        execute: async (text, values) => {
          writes.push({ text, values, rowCount: 0 });
          return { rowCount: 0 };
        }
      })
    },
    {},
    {},
    {},
    {}
  );
  worker.client = () => ({
    send: async () => {
      sendCount += 1;
      if (sendCount === 1) {
        return new Promise((resolve, reject) => { rejectFirstSend = reject; });
      }
    }
  });
  process.env.SQS_GITHUB_SYNC_JOBS_QUEUE_URL = "sync-queue";

  const publisherA = worker.enqueueSyncJob(syncRunId, userId);
  await new Promise((resolve) => setImmediate(resolve));
  await worker.enqueueSyncJob(syncRunId, userId);
  rejectFirstSend(new Error("publisher A timed out"));
  await assert.rejects(() => publisherA);

  assert.equal(queries.length, 2, "publisher B must reserve a newer queue fence before it sends");
  assert.match(queries[1], /lease_generation=github_sync_jobs\.lease_generation\+1/i);
  assert.equal(writes.length, 1, "only the delayed publisher A attempts its fenced failure transition");
  assert.deepEqual(writes[0].values, ["job-reenqueue-fence", syncRunId, "7"]);
  assert.match(writes[0].text, /lease_generation=\$3/i);
  assert.equal(writes[0].rowCount, 0, "the stale A generation must affect zero terminal rows after B has published generation 8");
}

{
  const queries = [];
  const worker = new GithubSyncJobService(
    { queryOne: async (text) => { queries.push(text); return { id: "job-expired-recovery", lease_generation: "9" }; } },
    {}, {}, {}, {}
  );
  worker.client = () => ({ send: async () => {} });
  process.env.SQS_GITHUB_SYNC_JOBS_QUEUE_URL = "sync-queue";

  await worker.enqueueSyncJob(syncRunId, userId, { skipIfRunIsNoLongerQueued: true });

  assert.match(
    queries[0],
    /run\.status='queued'[\s\S]*?OR \([\s\S]*?run\.status='running'[\s\S]*?FROM github_sync_jobs AS existing_job[\s\S]*?existing_job\.sync_run_id=run\.id[\s\S]*?existing_job\.status IN \('queued', 'running'\)[\s\S]*?existing_job\.lease_expires_at IS NULL OR existing_job\.lease_expires_at < now\(\)/i,
    "only a running run with its own expired, requeueable job may be republished"
  );
  assert.match(queries[0], /locked_polling_schedule AS MATERIALIZED[\s\S]*?FOR UPDATE OF schedule[\s\S]*?queued_run AS/i);
  assert.doesNotMatch(queries[0], /run\.status IN \('queued', 'running'\)/i, "terminal runs must not be accepted as recovery candidates");
}

{
  const queries = [];
  const worker = new GithubSyncJobService({ queryOne: async (text) => { queries.push(text); return null; } }, {}, {}, {});
  assert.equal(await worker.acquireLease("job-1"), null);
  assert.match(queries[0], /lease_expires_at < now\(\)/);
  assert.match(queries[0], /status IN \('queued', 'running'\)/);
  assert.match(queries[0], /lease_generation=lease_generation\+1/i);
  assert.match(queries[0], /locked_polling_schedule AS MATERIALIZED[\s\S]*?FOR UPDATE OF schedule[\s\S]*?leased AS \([\s\S]*?UPDATE github_sync_jobs AS job/i);
  assert.match(queries[0], /run\.status IN \('queued', 'running'\)/i, "a terminal run must not be revived by a stale queue message");
  assert.match(queries[0], /RETURNING job\.id, job\.sync_run_id, job\.requested_by_user_id, job\.attempt_count, job\.lease_generation/i);
  assert.match(queries[0], /leased_schedule AS/i);
  assert.match(queries[0], /SET lease_owner=\$2, lease_expires_at=now\(\) \+ interval '10 minutes'/i);
  assert.match(queries[0], /AS is_polling/i);
}

{
  const job = { id: "job-polling-lease", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "project_v2_items", attempt_count: 1, lease_generation: 4, is_polling: true };
  const writes = [];
  const worker = new GithubSyncJobService(
    { execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 0 }; } },
    {}, {}, {}
  );

  await assert.rejects(() => worker.renewLease(job), /lease ownership was lost/i);
  assert.match(
    writes[0].text,
    /owned_schedule AS MATERIALIZED \([\s\S]*FROM github_project_v2_polling_schedules AS schedule[\s\S]*INNER JOIN github_sync_jobs AS job[\s\S]*FOR UPDATE OF schedule[\s\S]*\), renewed_job AS \([\s\S]*UPDATE github_sync_jobs/i,
    "polling renewal must lock the schedule before its job to match selection cancellation"
  );
  assert.match(writes[0].text, /job\.sync_run_id=schedule\.active_sync_run_id/i);
  assert.match(writes[0].text, /FROM owned_schedule AS schedule/i);
  assert.match(writes[0].text, /SELECT 1 FROM renewed_schedule/i);
  assert.deepEqual(writes[0].values, [job.id, worker.workerId, job.lease_generation]);
}

{
  const job = { id: "job-polling-terminal", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "project_v2_items", attempt_count: 1, lease_generation: 7, is_polling: true };
  const writes = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; } }) },
    {}, {}, {}
  );

  await worker.completeSuccess(job, { fetchedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} });

  assert.match(
    writes[0].text,
    /locked_schedule AS MATERIALIZED \([\s\S]*?FROM github_project_v2_polling_schedules AS schedule[\s\S]*?FOR UPDATE OF schedule[\s\S]*?\), terminal_job AS \([\s\S]*?UPDATE github_sync_jobs/i,
    "polling completion must lock the schedule before terminalizing its job"
  );
  assert.deepEqual(writes[0].values.slice(0, 4), [job.id, worker.workerId, job.lease_generation, job.sync_run_id]);
}

{
  const job = { id: "job-polling-assert", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "project_v2_items", attempt_count: 1, lease_generation: 5, is_polling: true };
  const queries = [];
  const worker = new GithubSyncJobService(
    { queryOne: async (text, values) => { queries.push({ text, values }); return null; } },
    {}, {}, {}
  );

  const heartbeat = worker.startLeaseHeartbeat(job);
  await assert.rejects(() => heartbeat.assertLease(), /lease ownership was lost/i);
  clearInterval(heartbeat.timer);
  assert.match(queries[0].text, /INNER JOIN github_project_v2_polling_schedules AS schedule/i);
  assert.match(queries[0].text, /schedule\.active_sync_run_id=job\.sync_run_id/i);
  assert.match(queries[0].text, /schedule\.lease_owner=\$2/i);
  assert.match(queries[0].text, /schedule\.lease_expires_at >= now\(\)/i);
  assert.deepEqual(queries[0].values, [job.id, worker.workerId, job.lease_generation]);
}

{
  const job = { id: "job-deselected-while-running", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 8, is_polling: true };
  const writes = [];
  const worker = new GithubSyncJobService(
    {
      queryOne: async () => null,
      transaction: async (callback) => callback({
        execute: async (text, values) => {
          writes.push({ text, values });
          return { rowCount: 1 };
        }
      })
    },
    { getGithubAppConfig: () => ({}) },
    {
      runGithubSyncTarget: async () => ({ fetchedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} })
    },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {}
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob(job.id), "terminal");
  assert.equal(writes.length, 1, "a deselected running poll must terminalize its owned job and run");
  assert.match(
    writes[0].text,
    /locked_schedule AS MATERIALIZED \([\s\S]*?FOR UPDATE OF schedule[\s\S]*?terminal_job AS \([\s\S]*?job\.status='running'[\s\S]*?job\.lease_owner=\$2[\s\S]*?job\.lease_generation=\$3[\s\S]*?terminal_run AS \([\s\S]*?FROM terminal_job/i,
    "lease loss must fence the job before failing its run"
  );
  assert.match(
    writes[0].text,
    /EXISTS \([\s\S]*?FROM locked_schedule[\s\S]*?OR NOT EXISTS \([\s\S]*?FROM github_project_v2_polling_schedules/i,
    "a deleted polling schedule must still allow the current owned job and run to terminate"
  );
  assert.match(
    writes[0].text,
    /locked_schedule AS MATERIALIZED \([\s\S]*?schedule\.active_sync_run_id=\$4[\s\S]*?schedule\.lease_owner=\$2[\s\S]*?FOR UPDATE OF schedule/i,
    "a lost-lease worker may only terminalize a schedule it still owns"
  );
  assert.deepEqual(
    writes[0].values.slice(0, 5),
    [job.id, worker.workerId, job.lease_generation, job.sync_run_id, "GitHub sync job lease ownership was lost"],
    "a newer lease generation must not be terminalized by the stale worker"
  );
}

{
  const job = { id: "job-stale-a", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 9, is_polling: true };
  const state = {
    job: { status: "running", lease_owner: "worker-a", lease_generation: "9" },
    run: { status: "running" },
    schedule: { active_sync_run_id: syncRunId, lease_owner: "worker-b" }
  };
  let terminalWrites = 0;
  const worker = new GithubSyncJobService(
    {
      transaction: async (callback) => callback({
        execute: async (text, values) => {
          assert.match(text, /schedule\.lease_owner=\$2/i);
          const scheduleAbsent = state.schedule === null;
          const scheduleOwnedByStaleWorker = state.schedule?.lease_owner === values[1];
          const fencedJob = state.job.status === "running"
            && state.job.lease_owner === values[1]
            && state.job.lease_generation === String(values[2]);
          if (fencedJob && (scheduleAbsent || scheduleOwnedByStaleWorker)) {
            state.job.status = "failed";
            state.run.status = "failed";
            terminalWrites += 1;
          }
          return { rowCount: terminalWrites };
        }
      })
    },
    {}, {}, {}
  );
  state.job.lease_owner = worker.workerId;

  await worker.completeLostLeaseFailure(job, "GitHub sync job lease ownership was lost");

  assert.equal(terminalWrites, 0, "worker A must not terminalize a run after worker B reclaims its schedule");
  assert.equal(state.job.status, "running");
  assert.equal(state.run.status, "running");
  assert.equal(state.schedule.lease_owner, "worker-b");
}

{
  const job = { id: "job-deleted-schedule", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 10, is_polling: true };
  const state = {
    job: { status: "running", lease_owner: "worker-a", lease_generation: "10" },
    run: { status: "running" },
    schedule: null
  };
  let terminalWrites = 0;
  const worker = new GithubSyncJobService(
    {
      transaction: async (callback) => callback({
        execute: async (text, values) => {
          assert.match(text, /OR NOT EXISTS \([\s\S]*?FROM github_project_v2_polling_schedules/i);
          const scheduleAbsent = state.schedule === null;
          const fencedJob = state.job.status === "running"
            && state.job.lease_owner === values[1]
            && state.job.lease_generation === String(values[2]);
          if (fencedJob && scheduleAbsent) {
            state.job.status = "failed";
            state.run.status = "failed";
            terminalWrites += 1;
          }
          return { rowCount: terminalWrites };
        }
      })
    },
    {}, {}, {}
  );
  state.job.lease_owner = worker.workerId;

  await worker.completeLostLeaseFailure(job, "GitHub sync job lease ownership was lost");

  assert.equal(terminalWrites, 1, "a deleted schedule must still allow its old owned job and run to terminate");
  assert.equal(state.job.status, "failed");
  assert.equal(state.run.status, "failed");
}

{
  let executorCalls = 0;
  const worker = new GithubSyncJobService(
    { queryOne: async () => null },
    {},
    { runGithubSyncTarget: async () => { executorCalls += 1; } },
    {}
  );

  assert.equal(
    await worker.processSyncJob("job-deselected-before-acquire"),
    "terminal",
    "a message for a selection-cancelled queued polling job must be acknowledged without retry"
  );
  assert.equal(executorCalls, 0, "a deselected queued polling job must never enter the executor");
}

{
  const job = { id: "job-manual-assert", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "project_v2_items", attempt_count: 1, lease_generation: 6, is_polling: false };
  const queries = [];
  const worker = new GithubSyncJobService(
    { queryOne: async (text, values) => { queries.push({ text, values }); return { ok: 1 }; } },
    {}, {}, {}
  );

  const heartbeat = worker.startLeaseHeartbeat(job);
  await heartbeat.assertLease();
  clearInterval(heartbeat.timer);
  assert.doesNotMatch(queries[0].text, /github_project_v2_polling_schedules/i);
}

{
  const job = { id: "job-fenced", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 2 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 0 }; } },
    {}, {}, {}
  );

  await assert.rejects(() => worker.renewLease(job), /lease ownership was lost/i);
  assert.match(
    writes[0].text,
    /RETURNING sync_run_id\s*\)\s*,\s*renewed_schedule AS \(/i,
    "renewed_schedule must be separated from renewed_job by a CTE comma"
  );
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
  assert.match(
    writes[0].text,
    /terminal_job AS \([\s\S]*lease_generation=\$3[\s\S]*terminal_run AS \([\s\S]*FROM terminal_job[\s\S]*terminal_schedule AS \([\s\S]*FROM terminal_run/i,
    "a stale generation cannot transition the run or its polling schedule"
  );
  assert.match(writes[0].text, /WHERE schedule\.active_sync_run_id=terminal_run\.id/i);
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
        queryOne: async () => ({ ok: 1 }),
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
  const events = [];
  const observability = {
    emitRetry: (input, retryAfterSeconds) => events.push({ type: "retry", input, retryAfterSeconds }),
    emitTerminalFailure: (input, isRateLimited) => events.push({ type: "terminal_failure", input, isRateLimited })
  };
  const worker = new GithubSyncJobService(
    {
      transaction: async (callback) => callback({
        execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; }
      })
    },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw new Error("transient provider failure"); } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {},
    undefined,
    observability
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });
  assert.equal(await worker.processSyncJob("job-1"), "retry");
  assert.equal(writes.length, 0, "transient failure keeps the SQS message and job runnable");
  assert.deepEqual(events, [{
    type: "retry",
    input: {
      jobId: job.id,
      syncRunId: job.sync_run_id,
      target: job.target,
      attemptCount: 1,
      rateLimitRemaining: null
    },
    retryAfterSeconds: 900
  }]);
  job.attempt_count = 3;
  assert.equal(await worker.processSyncJob("job-1"), "terminal");
  assert.equal(writes.length, 1, "maximum attempts terminally fail the fenced run and job atomically");
  assert.match(writes[0].text, /status='failed'/);
  assert.match(writes[0].text, /lease_generation=\$3/);
  assert.deepEqual(events[1], {
    type: "terminal_failure",
    input: {
      jobId: job.id,
      syncRunId: job.sync_run_id,
      target: job.target,
      attemptCount: 3,
      rateLimitRemaining: null
    },
    isRateLimited: false
  });
}

{
  const rateLimitError = new GithubGraphqlRateLimitError("GitHub API rate limit reached", 0);
  assert.equal(rateLimitError.rateLimitRemaining, 0);

  const job = { id: "job-rate-limit", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
  const events = [];
  const worker = new GithubSyncJobService(
    { transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) }) },
    { getGithubAppConfig: () => ({}) },
    { runGithubSyncTarget: async () => { throw rateLimitError; } },
    { resolvePersonalProjectV2UserAccessToken: async () => null },
    {},
    undefined,
    {
      emitRetry: (input, retryAfterSeconds) => events.push({ type: "retry", input, retryAfterSeconds }),
      emitTerminalFailure: (input, isRateLimited) => events.push({ type: "terminal_failure", input, isRateLimited })
    }
  );
  worker.acquireLease = async () => job;
  worker.installation = async () => ({ id: installationId });

  assert.equal(await worker.processSyncJob(job.id), "terminal");
  assert.deepEqual(events, [{
    type: "terminal_failure",
    input: {
      jobId: job.id,
      syncRunId: job.sync_run_id,
      target: job.target,
      attemptCount: 1,
      rateLimitRemaining: 0
    },
    isRateLimited: true
  }]);
}

{
  const job = { id: "job-lost-lease-observability", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1, is_polling: false };

  for (const [terminalRowCount, expectedEvents] of [
    [0, []],
    [1, [{
      type: "terminal_failure",
      input: {
        jobId: job.id,
        syncRunId: job.sync_run_id,
        target: job.target,
        attemptCount: job.attempt_count,
        rateLimitRemaining: null
      },
      isRateLimited: false
    }]]
  ]) {
    const events = [];
    const worker = new GithubSyncJobService(
      {
        queryOne: async () => null,
        transaction: async (callback) => callback({
          execute: async () => ({ rowCount: terminalRowCount })
        })
      },
      { getGithubAppConfig: () => ({}) },
      {
        runGithubSyncTarget: async (_target, input) => {
          await input.assertLease();
          return { fetchedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, cursor: {} };
        }
      },
      { resolvePersonalProjectV2UserAccessToken: async () => null },
      {},
      undefined,
      {
        emitRetry: (input, retryAfterSeconds) => events.push({ type: "retry", input, retryAfterSeconds }),
        emitTerminalFailure: (input, isRateLimited) => events.push({ type: "terminal_failure", input, isRateLimited })
      }
    );
    worker.acquireLease = async () => job;
    worker.installation = async () => ({ id: installationId });

    assert.equal(await worker.processSyncJob(job.id), "terminal");
    assert.deepEqual(events, expectedEvents, "lost lease emits only after its fenced terminal transition succeeds");
  }
}

{
  const originalFetch = globalThis.fetch;
  try {
    for (const [headerValue, expectedRemaining] of [
      ["100", 100],
      ["0", 0],
      ["not-a-number", null],
      [null, null]
    ]) {
      globalThis.fetch = async () => new Response(null, {
        status: 429,
        headers: headerValue === null ? {} : { "x-ratelimit-remaining": headerValue }
      });

      let rateLimitError;
      await assert.rejects(
        () => new GithubAppClient().getProjectV2Item({
          installationId: 1,
          appId: "unused",
          privateKey: "unused",
          projectItemNodeId: "PVT_rate_limit_test",
          userAccessToken: "test-user-access-token",
          accountType: "Organization"
        }),
        (error) => {
          assert.ok(error instanceof GithubGraphqlRateLimitError);
          rateLimitError = error;
          return true;
        }
      );

      const job = { id: `job-rate-limit-header-${expectedRemaining ?? "null"}`, sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1, lease_generation: 1 };
      const events = [];
      const worker = new GithubSyncJobService(
        { transaction: async (callback) => callback({ execute: async () => ({ rowCount: 1 }) }) },
        { getGithubAppConfig: () => ({}) },
        { runGithubSyncTarget: async () => { throw rateLimitError; } },
        { resolvePersonalProjectV2UserAccessToken: async () => null },
        {},
        undefined,
        {
          emitRetry: (input, retryAfterSeconds) => events.push({ type: "retry", input, retryAfterSeconds }),
          emitTerminalFailure: (input, isRateLimited) => events.push({ type: "terminal_failure", input, isRateLimited })
        }
      );
      worker.acquireLease = async () => job;
      worker.installation = async () => ({ id: installationId });

      assert.equal(await worker.processSyncJob(job.id), "terminal");
      assert.deepEqual(events, [{
        type: "terminal_failure",
        input: {
          jobId: job.id,
          syncRunId: job.sync_run_id,
          target: job.target,
          attemptCount: 1,
          rateLimitRemaining: expectedRemaining
        },
        isRateLimited: true
      }]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
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
