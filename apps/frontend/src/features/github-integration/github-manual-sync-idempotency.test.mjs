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
const { createGithubManualSyncIdempotency } = await import(
  `data:text/javascript;base64,${Buffer.from(compiledHelper).toString("base64")}`
);

const keys = ["key-1", "key-2", "key-3"];
const pending = createGithubManualSyncIdempotency(() => keys.shift());
const sourceScope = {
  installationId: "installation-1",
  repositoryId: null,
  projectV2Id: null,
  target: "source"
};
const repositoryScope = { ...sourceScope, repositoryId: "repository-1", target: "issues" };

assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "transport_failure");
assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "rate_limited");
assert.equal(pending.getKey(sourceScope), "key-1");
pending.complete(sourceScope, "definitive_failure");
assert.equal(pending.getKey(sourceScope), "key-2");
pending.complete(sourceScope, "success");
assert.equal(pending.getKey(sourceScope), "key-3");
assert.equal(pending.getKey(repositoryScope), undefined);

console.log("github manual-sync idempotency tests passed");
