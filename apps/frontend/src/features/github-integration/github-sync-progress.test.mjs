import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("./utils/github-sync-progress.ts", import.meta.url),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const progressModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const runningSyncRun = {
  status: "running",
  progressPercent: 42,
  progressStage: "issues"
};

assert.equal(progressModule.getGithubSyncProgress(runningSyncRun), 42);
assert.equal(
  progressModule.getGithubSyncProgress({
    status: "success"
  }),
  100
);
assert.equal(
  progressModule.getGithubSyncProgress({
    status: "failed",
    progressPercent: 65
  }),
  65
);
assert.equal(progressModule.hasRunningGithubSyncRun([runningSyncRun]), true);
assert.equal(
  progressModule.hasRunningGithubSyncRun([
    {
      status: "queued"
    }
  ]),
  true,
  "a queued sync run must keep polling active"
);
assert.equal(
  progressModule.hasRunningGithubSyncRun([
    {
      status: "success",
      progressPercent: 100
    }
  ]),
  false
);
assert.equal(
  progressModule.shouldPollGithubSyncRuns(false, true),
  true
);
assert.equal(progressModule.shouldPollGithubSyncRuns(true, false), true);
assert.equal(progressModule.shouldPollGithubSyncRuns(false, false), false);
assert.equal(progressModule.GITHUB_SYNC_POLL_INTERVAL_MS, 1500);

{
  const requestGate = progressModule.createGithubSyncRequestGate();
  const firstRequest = requestGate.begin();
  assert.equal(requestGate.isCurrent(firstRequest), true);

  const secondRequest = requestGate.begin();
  assert.equal(requestGate.isCurrent(firstRequest), false);
  assert.equal(requestGate.isCurrent(secondRequest), true);

  requestGate.invalidate();
  assert.equal(requestGate.isCurrent(secondRequest), false);
}
