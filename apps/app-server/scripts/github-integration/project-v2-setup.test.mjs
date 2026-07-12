import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [installation, projects, controller, workflow, jobs, webhook, reconcile, observability, observabilityTerraform, devTerraform, operationsRunbook] = await Promise.all([
  read("apps/app-server/src/modules/github-integration/github-app-installation.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-project-v2.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-integration.controller.ts"),
  read(".github/workflows/deploy-app-server.yml"),
  read("apps/app-server/src/modules/github-integration/github-sync-job.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-webhook.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-project-v2-webhook-reconcile.service.ts"),
  read("apps/app-server/src/modules/github-integration/github-sync-observability.service.ts"),
  read("infra/modules/github-sync-observability/main.tf"),
  read("infra/envs/dev/main.tf"),
  read("docs/infra/github-sync-operations.md")
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

for (const event of [
  "github_sync_retry",
  "github_sync_terminal_failure",
  "github_sync_rate_limit_terminal_failure"
]) assert.match(observability, new RegExp(event));
assert.match(observability, /process\.stdout\.write/);
assert.match(observabilityTerraform, /\/ecs\/\$\{var\.name_prefix\}\/github-sync-worker/);
assert.match(observabilityTerraform, /aws_cloudwatch_log_metric_filter/);
assert.match(observabilityTerraform, /ApproximateAgeOfOldestMessage/);
assert.match(observabilityTerraform, /ApproximateNumberOfMessagesVisible/);
assert.match(observabilityTerraform, /RunningTaskCount/);
assert.match(devTerraform, /module "github_sync_observability"/);
assert.match(devTerraform, /source = "\.\.\/\.\.\/modules\/github-sync-observability"/);

for (const threshold of ["60", "300", "20", "100", "600", "1800", "10", "50", "1", "0"]) {
  assert.match(operationsRunbook, new RegExp(threshold));
}
for (const heading of [
  "Metrics and alarms",
  "Structured operation logs",
  "DLQ recovery procedure",
  "Incident response paths",
  "Dev smoke checklist",
  "Cost scope"
]) assert.match(operationsRunbook, new RegExp(`## ${heading}`));
assert.match(operationsRunbook, /authorized operator/i);
assert.match(operationsRunbook, /must not be run automatically by the worker/i);
assert.match(operationsRunbook, /bounded sample/i);
assert.match(operationsRunbook, /15-minute window/i);
assert.match(operationsRunbook, /backlog-per-running-worker exceeds 100/i);

console.log("ProjectV2 setup and worker hardening contract tests passed");
