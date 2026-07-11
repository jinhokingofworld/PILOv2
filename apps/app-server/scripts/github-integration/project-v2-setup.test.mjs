import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [installation, projects, controller, workflow, jobs, webhook, reconcile] = await Promise.all([
  read("apps/app-server/src/modules/github-integration/github-app-installation.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-project-v2.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-integration.controller.ts"),
  read(".github/workflows/deploy-app-server.yml"),
  read("apps/app-server/src/modules/github-integration/github-sync-job.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-webhook.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-project-v2-webhook-reconcile.service.ts")
]);

assert.doesNotMatch(installation, /triggerInitialFullSync/);
assert.match(installation, /github_installation_id/);
assert.match(controller, /installations\/:installationId\/projects-v2\/discovery/);
assert.match(projects, /discoverGithubProjectV2/);
assert.match(projects, /connectionRequired: true/);
assert.match(projects, /management/);
assert.match(projects, /syncRunId/);
assert.match(projects, /target: "full"/);
assert.doesNotMatch(jobs, /FROM github_webhook_deliveries/i);
assert.match(reconcile, /status = 'failed'\s+AND error_message = 'GitHub webhook could not be enqueued'/);
assert.match(reconcile, /status = 'processing'\s+AND lease_expires_at < now\(\)/);
assert.doesNotMatch(webhook, /isRecoverableWebhookEnqueueFailure\(existing\) \|\| existing\.status === "received"/);
assert.match(workflow, /ECS_GITHUB_SYNC_WORKER_SERVICE/);
assert.match(workflow, /aws ecs update-service/);
assert.match(workflow, /aws ecs wait services-stable/);

console.log("ProjectV2 setup and worker hardening contract tests passed");
