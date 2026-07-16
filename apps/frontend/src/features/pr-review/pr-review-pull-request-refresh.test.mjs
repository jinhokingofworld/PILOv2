import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const source = await readFile(
  new URL("./realtime/pr-review-pull-request-refresh.ts", import.meta.url),
  "utf8",
);
const output = typescript.transpileModule(source, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
  },
}).outputText;
const { createPrReviewPullRequestRefreshCoordinator } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

{
  const applied = [];
  const resolvers = [];
  let loadCalls = 0;
  const coordinator = createPrReviewPullRequestRefreshCoordinator({
    apply: (value) => applied.push(value),
    load: () => {
      loadCalls += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  void coordinator.refresh();
  await Promise.resolve();
  void coordinator.refresh();
  void coordinator.refresh();
  assert.equal(loadCalls, 1);
  resolvers.shift()("first");
  await flushTasks();
  assert.deepEqual(applied, ["first"]);
  assert.equal(loadCalls, 2, "polling and realtime queue one trailing refresh");
  resolvers.shift()("latest");
  await flushTasks();
  assert.deepEqual(applied, ["first", "latest"]);
  assert.equal(loadCalls, 2);
}

{
  const applied = [];
  let resolveStale;
  const coordinator = createPrReviewPullRequestRefreshCoordinator({
    apply: (value) => applied.push(value),
    load: () => new Promise((resolve) => { resolveStale = resolve; }),
  });

  void coordinator.refresh();
  await Promise.resolve();
  coordinator.dispose();
  resolveStale("stale-session-value");
  await flushTasks();
  assert.deepEqual(
    applied,
    [],
    "a disposed session generation cannot overwrite the next PR session",
  );
}

console.log("PR Review pull request refresh coordinator tests passed");
