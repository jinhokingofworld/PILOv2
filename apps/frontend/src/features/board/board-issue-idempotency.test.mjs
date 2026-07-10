import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [boardTypes, boardApiClient, boardIssueCreateForm, idempotency] =
  await Promise.all([
    readFeatureFile("./types/index.ts"),
    readFeatureFile("./api/client.ts"),
    readFeatureFile("./components/board-issue-create-form.tsx"),
    readFeatureFile("./utils/board-issue-create-idempotency.ts")
  ]);

assert.match(boardTypes, /export type CreateBoardIssueCommand/);
assert.match(boardTypes, /idempotencyKey: string/);

assert.match(boardApiClient, /body: CreateBoardIssueCommand/);
assert.match(boardApiClient, /const \{ idempotencyKey, \.\.\.requestBody \} = body/);
assert.match(boardApiClient, /"Idempotency-Key": idempotencyKey/);
assert.match(boardApiClient, /withJsonBody\(requestBody/);

assert.match(idempotency, /crypto\.randomUUID\(\)/);
assert.match(idempotency, /currentKey \?\?/);

assert.match(boardIssueCreateForm, /useState<string \| null>\(null\)/);
assert.match(boardIssueCreateForm, /resolveBoardIssueCreateIdempotencyKey/);
assert.match(boardIssueCreateForm, /idempotencyKey,/);
assert.match(
  boardIssueCreateForm,
  /if \(created === false\) \{\s*return;\s*\}/,
  "failed submissions must retain the current key"
);
assert.match(boardIssueCreateForm, /setIdempotencyKey\(null\)/);
assert.match(boardIssueCreateForm, /handleTitleChange/);
assert.match(boardIssueCreateForm, /handleBodyChange/);
assert.match(boardIssueCreateForm, /handleColumnChange/);
