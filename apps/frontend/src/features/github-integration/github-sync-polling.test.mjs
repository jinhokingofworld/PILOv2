import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const pollUtilitySource = await readFile(
  new URL("./utils/github-sync-progress.ts", import.meta.url),
  "utf8"
);
const compiledPollUtility = ts.transpileModule(pollUtilitySource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const pollUtility = await import(
  `data:text/javascript;base64,${Buffer.from(compiledPollUtility).toString("base64")}`
);

function createManualScheduler() {
  const scheduled = [];

  return {
    schedule(callback) {
      scheduled.push(callback);
      return callback;
    },
    clear(callback) {
      const index = scheduled.indexOf(callback);
      if (index >= 0) {
        scheduled.splice(index, 1);
      }
    },
    runNext() {
      const callback = scheduled.shift();
      assert.ok(callback, "expected a scheduled poll");
      callback();
    },
    get size() {
      return scheduled.length;
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

{
  const scheduler = createManualScheduler();
  const requestGate = pollUtility.createGithubSyncRequestGate();
  let resolveRequest;
  const loop = pollUtility.createGithubSyncPollLoop({
    intervalMs: 1500,
    poll: async () => {
      const generation = requestGate.begin();
      await new Promise((resolve) => {
        resolveRequest = resolve;
      });
      return requestGate.isCurrent(generation) ? true : null;
    },
    shouldContinue: (hasRunningRun) => hasRunningRun !== false,
    onError: () => assert.fail("poll should not fail"),
    schedule: (callback) => scheduler.schedule(callback),
    clear: (callback) => scheduler.clear(callback)
  });

  loop.start();
  scheduler.runNext();
  requestGate.begin();
  resolveRequest();
  await flushPromises();
  assert.equal(
    scheduler.size,
    1,
    "an invalidated response must not terminate an active polling loop"
  );
  loop.stop();
}

{
  const scheduler = createManualScheduler();
  let resolveRequest;
  const loop = pollUtility.createGithubSyncPollLoop({
    intervalMs: 1500,
    poll: () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    shouldContinue: () => true,
    onError: () => assert.fail("poll should not fail"),
    schedule: (callback) => scheduler.schedule(callback),
    clear: (callback) => scheduler.clear(callback)
  });

  loop.start();
  scheduler.runNext();
  loop.stop();
  resolveRequest(true);
  await flushPromises();
  assert.equal(scheduler.size, 0, "a stopped loop must ignore in-flight results");
}

{
  const scheduler = createManualScheduler();
  const loop = pollUtility.createGithubSyncPollLoop({
    intervalMs: 1500,
    poll: async () => false,
    shouldContinue: (hasRunningRun) => hasRunningRun === true,
    onError: () => assert.fail("poll should not fail"),
    schedule: (callback) => scheduler.schedule(callback),
    clear: (callback) => scheduler.clear(callback)
  });

  loop.start();
  scheduler.runNext();
  await flushPromises();
  assert.equal(scheduler.size, 0, "a terminal response must stop polling");
}

{
  const scheduler = createManualScheduler();
  const syncRunPages = [[{ status: "queued" }], [{ status: "success" }]];
  const loop = pollUtility.createGithubSyncPollLoop({
    intervalMs: 1500,
    poll: async () =>
      pollUtility.hasRunningGithubSyncRun(syncRunPages.shift()),
    shouldContinue: (hasActiveRun) => hasActiveRun === true,
    onError: () => assert.fail("poll should not fail"),
    schedule: (callback) => scheduler.schedule(callback),
    clear: (callback) => scheduler.clear(callback)
  });

  loop.start();
  scheduler.runNext();
  await flushPromises();
  assert.equal(
    scheduler.size,
    1,
    "a queued sync run must schedule another poll before it reaches a terminal state"
  );
  scheduler.runNext();
  await flushPromises();
  assert.equal(scheduler.size, 0, "a terminal sync run must stop polling");
}

{
  const scheduler = createManualScheduler();
  const errors = [];
  let attempts = 0;
  const loop = pollUtility.createGithubSyncPollLoop({
    intervalMs: 1500,
    poll: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary failure");
      }
      return false;
    },
    shouldContinue: (hasRunningRun) => hasRunningRun === true,
    onError: (error) => errors.push(error),
    schedule: (callback) => scheduler.schedule(callback),
    clear: (callback) => scheduler.clear(callback)
  });

  loop.start();
  scheduler.runNext();
  await flushPromises();
  assert.equal(scheduler.size, 1, "a transient failure must schedule a retry");
  scheduler.runNext();
  await flushPromises();
  assert.equal(errors.length, 1);
  assert.equal(scheduler.size, 0, "a recovered terminal poll must stop retrying");
}

const githubPanel = await readFile(
  new URL("./components/github-panel.tsx", import.meta.url),
  "utf8"
);
const githubConnectSync = await readFile(
  new URL("./components/github-connect-sync.tsx", import.meta.url),
  "utf8"
);
const githubConnectPrimitives = await readFile(
  new URL("./components/github-connect-primitives.tsx", import.meta.url),
  "utf8"
);

assert.match(githubPanel, /async function refreshGithubSyncRuns/);
assert.match(githubPanel, /shouldPollGithubSyncRuns/);
assert.match(githubPanel, /GITHUB_SYNC_POLL_INTERVAL_MS/);
assert.match(githubPanel, /schedule:\s*\(callback, delayMs\) => setTimeout/);
assert.match(githubPanel, /clear:\s*\(timer\) => clearTimeout/);
assert.match(githubPanel, /apiClient\.listGithubSyncRuns/);
assert.match(githubPanel, /status:\s*"running"/);
assert.match(githubPanel, /status:\s*"queued"/);
assert.match(
  githubPanel,
  /apiClient\.listGithubSyncRuns\(workspaceId, \{\s*status:\s*"queued",\s*limit:\s*1\s*\}\)/,
  "queued-run detection must continue to include every trigger source"
);
assert.match(
  githubPanel,
  /apiClient\.listGithubSyncRuns\(workspaceId, \{\s*status:\s*"running",\s*limit:\s*1\s*\}\)/,
  "running-run detection must continue to include every trigger source"
);
assert.match(
  githubPanel,
  /apiClient\.listGithubSyncRuns\(workspaceId, \{\s*triggerSource:\s*"manual",\s*limit:\s*8\s*\}\)/,
  "visible history must request only manual sync runs"
);
assert.match(githubPanel, /createGithubSyncRequestGate/);
assert.match(githubPanel, /createGithubSyncPollLoop/);
assert.match(githubPanel, /syncPollingError/);

assert.match(githubConnectSync, /getGithubSyncProgress/);
assert.match(githubConnectSync, /getGithubSyncProgressStageLabel/);
assert.match(githubConnectSync, /title="최근 수동 실행"/);
assert.match(githubConnectSync, /수동 동기화 기록/);
assert.match(githubConnectSync, /아직 수동 동기화 기록이 없습니다\./);
assert.match(githubConnectSync, /조회 \{syncRun\.fetchedCount\}/);
assert.match(githubConnectSync, /추가 \{syncRun\.createdCount\}/);
assert.match(githubConnectSync, /업데이트\{" "\}/);
assert.match(
  githubConnectSync,
  /isGithubSyncActiveStatus\(syncRun\.status\) \? \([\s\S]*?<GithubConnectProgress value=\{progress\} \/>[\s\S]*?\{progress\}%[\s\S]*?\) : null/,
  "progress must render only for queued or running sync runs"
);
assert.match(githubConnectPrimitives, /aria-valuenow=\{value\}/);
