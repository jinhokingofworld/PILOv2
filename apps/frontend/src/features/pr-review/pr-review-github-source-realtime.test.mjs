import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const source = await readFile(
  new URL("./realtime/pr-review-github-source-lifecycle.ts", import.meta.url),
  "utf8",
);
const coordinatorSource = await readFile(
  new URL("./realtime/pr-review-pull-request-refresh.ts", import.meta.url),
  "utf8",
);
const output = typescript.transpileModule(source, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
  },
}).outputText;
const { createPrReviewGithubSourceLifecycle } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);
const coordinatorOutput = typescript.transpileModule(coordinatorSource, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
  },
}).outputText;
const { createPrReviewPullRequestRefreshCoordinator } = await import(
  `data:text/javascript;base64,${Buffer.from(coordinatorOutput).toString("base64")}`
);
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

function createSocket() {
  const listeners = new Map();
  return {
    connected: false,
    emits: [],
    on(event, listener) { listeners.set(event, listener); },
    emit(event, payload) { this.emits.push([event, payload]); },
    connect() { this.connected = true; listeners.get("connect")?.(); },
    disconnect() { this.connected = false; },
    removeAllListeners() { listeners.clear(); },
    trigger(event, payload) { listeners.get(event)?.(payload); },
  };
}

const workspaceId = "11111111-1111-4111-8111-111111111111";
const pullRequestId = "22222222-2222-4222-8222-222222222222";
const socket = createSocket();
let fetchCalls = 0;
let releaseRefresh;
const refreshPending = new Promise((resolve) => { releaseRefresh = resolve; });
const coordinator = createPrReviewPullRequestRefreshCoordinator({
  apply() {},
  load() {
    fetchCalls += 1;
    return fetchCalls === 1 ? refreshPending : Promise.resolve({});
  },
});
const lifecycle = createPrReviewGithubSourceLifecycle({
  pullRequestId,
  refreshPullRequest: coordinator.refresh,
  socket,
  workspaceId,
});

lifecycle.connect();
await Promise.resolve();
assert.deepEqual(socket.emits[0], ["github:source:subscribe", { workspaceId }]);
assert.equal(fetchCalls, 1, "connect refetches the REST snapshot");

const matching = {
  workspaceId,
  repositoryId: "33333333-3333-4333-8333-333333333333",
  sourceId: pullRequestId,
  sourceNumber: 24,
  sourceType: "pull_request",
  updatedAt: "2026-07-16T00:00:00.000Z",
};
socket.trigger("github:source:invalidated", matching);
socket.trigger("github:source:invalidated", matching);
assert.equal(fetchCalls, 1, "the shared coordinator coalesces invalidations");
releaseRefresh();
await refreshPending;
await flushTasks();
assert.equal(
  fetchCalls,
  2,
  "in-flight invalidations queue exactly one trailing PR refresh",
);
await flushTasks();
assert.equal(fetchCalls, 2);
socket.trigger("github:source:invalidated", matching);
await flushTasks();
assert.equal(fetchCalls, 3);
socket.trigger("github:source:invalidated", { ...matching, sourceId: workspaceId });
socket.trigger("github:source:invalidated", { ...matching, sourceType: "issue" });
assert.equal(fetchCalls, 3);

lifecycle.cleanup();
coordinator.dispose();
assert.deepEqual(socket.emits.at(-1), ["github:source:unsubscribe", { workspaceId }]);
assert.equal(socket.connected, false);

console.log("PR Review GitHub source realtime tests passed");
