import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const helperSource = await readFile(
  new URL("./utils/github-manual-sync-idempotency.ts", import.meta.url),
  "utf8"
);
const compiledHelper = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const helper = await import(
  `data:text/javascript;base64,${Buffer.from(compiledHelper).toString("base64")}`
);

const keys = ["key-1", "key-2", "key-3"];
const pending = helper.createGithubManualSyncIdempotency(() => keys.shift());
const sourceScope = { installationId: "installation-1", repositoryId: null, projectV2Id: null, target: "source" };
const repositoryScope = { ...sourceScope, repositoryId: "repository-1", target: "issues" };

assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "transport_failure");
assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "rate_limited");
assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "success");
assert.equal(pending.getKey(sourceScope), "key-2");
assert.equal(pending.getKey(repositoryScope), "key-3");

const clientSource = await readFile(new URL("./api/client.ts", import.meta.url), "utf8");
assert.match(clientSource, /startGithubSyncRun\(\s*workspaceId: string,\s*body: StartGithubSyncRunInput,\s*idempotencyKey: string/s);
assert.match(clientSource, /headers: \{\s*"Idempotency-Key": idempotencyKey\s*\}/s);

const panelSource = await readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8");
assert.match(panelSource, /초 후 다시 시도할 수 있습니다/);
assert.match(panelSource, /동기화 대기열이 혼잡합니다/);
assert.match(panelSource, /retryAfterSeconds/);
assert.doesNotMatch(panelSource, /queuedTotal|maxQueuedJobs/);

console.log("github manual-sync idempotency tests passed");
