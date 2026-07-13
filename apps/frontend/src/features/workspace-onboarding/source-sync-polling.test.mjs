import assert from "node:assert/strict";
import ts from "typescript";

const source = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("./source-sync-polling.ts", import.meta.url), "utf8")
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const polling = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const sourceRun = (overrides = {}) => ({
  installationId: "installation-7",
  target: "source",
  status: "queued",
  errorMessage: null,
  ...overrides
});

assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ status: "queued" })],
    "installation-7"
  ),
  { status: "polling" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ status: "running" })],
    "installation-7"
  ),
  { status: "polling" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ status: "success" })],
    "installation-7"
  ),
  { status: "success" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ status: "success" }), sourceRun({ status: "failed" })],
    "installation-7"
  ),
  { status: "success" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ status: "failed", errorMessage: "Sync failed" })],
    "installation-7"
  ),
  { status: "failed", errorMessage: "Sync failed" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ installationId: "installation-elsewhere", status: "success" })],
    "installation-7"
  ),
  { status: "missing" }
);
assert.deepEqual(
  polling.getGithubSourceSyncPollingState(
    [sourceRun({ target: "full", status: "success" })],
    "installation-7"
  ),
  { status: "missing" }
);
