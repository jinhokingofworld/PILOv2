import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sqs = readFileSync("infra/modules/sqs/main.tf", "utf8");
const outputs = readFileSync("infra/modules/sqs/outputs.tf", "utf8");
const environment = readFileSync("infra/envs/dev/main.tf", "utf8");

assert.match(sqs, /resource "aws_sqs_queue" "workspace_indexing_dlq"/);
assert.match(sqs, /resource "aws_sqs_queue" "workspace_indexing"/);
assert.match(sqs, /visibility_timeout_seconds = 900/);
assert.match(sqs, /maxReceiveCount     = 3/);
assert.match(outputs, /workspace_indexing_queue_url/);
assert.match(outputs, /workspace_indexing_queue_arn/);
assert.match(environment, /SQS_WORKSPACE_INDEXING_QUEUE_URL/);
assert.match(environment, /module\.sqs\.workspace_indexing_queue_url/);

console.log("Workspace indexing infrastructure tests passed.");
