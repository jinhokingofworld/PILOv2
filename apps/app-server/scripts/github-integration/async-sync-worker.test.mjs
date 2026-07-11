import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { GithubSyncRunService } = require("../../dist/modules/github-integration/github-sync-run.service.js");
const { GithubSyncJobService } = require("../../dist/modules/github-integration/github-sync-job.service.js");
const { GithubWebhookService } = require("../../dist/modules/github-integration/github-webhook.service.js");
const root = fileURLToPath(new URL("../../../..", import.meta.url));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const installationId = "33333333-3333-4333-8333-333333333333";
const syncRunId = "44444444-4444-4444-8444-444444444444";

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
  const queries = [];
  const worker = new GithubSyncJobService({ queryOne: async (text) => { queries.push(text); return null; } }, {}, {}, {});
  assert.equal(await worker.acquireLease("job-1"), null);
  assert.match(queries[0], /lease_expires_at < now\(\)/);
  assert.match(queries[0], /status IN \('queued', 'running'\)/);
}

{
  const job = { id: "job-1", sync_run_id: syncRunId, requested_by_user_id: userId, workspace_id: workspaceId, installation_id: installationId, repository_id: null, project_v2_id: null, target: "full", attempt_count: 1 };
  const writes = [];
  const worker = new GithubSyncJobService(
    { execute: async (text, values) => { writes.push({ text, values }); return { rowCount: 1 }; } },
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
  assert.equal(writes.length, 2, "maximum attempts terminally fail both run and job");
  assert.match(writes[0].text, /status='failed'/);
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
      if (/status='failed'/.test(text)) delivery = { ...delivery, status: "failed", error_message: values[1] };
      if (/status='received'/.test(text)) delivery = { ...delivery, status: "received", error_message: null, processed_at: null };
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
    }, {}, {}, {}
  );
  const commands = [];
  worker.client = () => ({ send: async (command) => { commands.push(command.constructor.name); return {}; } });
  process.env.SQS_GITHUB_WEBHOOKS_QUEUE_URL = "queue-url";
  await worker.recoverWebhookOutbox();
  assert.deepEqual(commands, ["SendMessageCommand"]);
  assert.match(writes[0].text, /status='received'/);
}

console.log("GitHub async sync worker behavioral tests passed");
