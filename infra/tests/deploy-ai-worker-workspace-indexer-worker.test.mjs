import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(
  new URL("../../.github/workflows/deploy-ai-worker.yml", import.meta.url),
  "utf8"
);

assert.match(workflow, /ECS_WORKSPACE_INDEXER_WORKER_SERVICE/);
assert.match(workflow, /SQS_WORKSPACE_INDEXING_QUEUE_URL/);
assert.match(workflow, /services\+=\("\$ECS_WORKSPACE_INDEXER_WORKER_SERVICE"\)/);

console.log("Workspace indexer worker deployment workflow tests passed.");
