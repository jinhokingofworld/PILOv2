import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [devEnvironment, iamMain, iamVariables, secretsOutputs] = await Promise.all([
  readFile(new URL("../envs/dev/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../modules/iam/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../modules/iam/variables.tf", import.meta.url), "utf8"),
  readFile(new URL("../modules/secrets/outputs.tf", import.meta.url), "utf8")
]);

assert.match(devEnvironment, /workspace-indexer-worker\s*=\s*\{/);
assert.match(devEnvironment, /desired_count\s*=\s*1/);
assert.match(devEnvironment, /app\.workspace_indexing_worker_runtime/);
assert.match(devEnvironment, /SQS_WORKSPACE_INDEXING_QUEUE_URL/);
assert.match(devEnvironment, /workspace_indexer_worker_task_role_arn/);
assert.match(iamVariables, /workspace_indexer_worker_queue_arns/);
assert.match(iamMain, /aws_iam_role" "workspace_indexer_worker_task/);
assert.match(iamMain, /Resource = var\.workspace_indexer_worker_queue_arns/);
assert.match(secretsOutputs, /workspace_indexer_worker_ecs_secrets/);

console.log("Workspace indexer worker infrastructure tests passed.");
