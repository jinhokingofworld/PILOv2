import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const coordinatorSource = await readFile(
  new URL("./utils/board-request-coordinator.ts", import.meta.url),
  "utf8",
).catch((error) => {
  if (error && error.code === "ENOENT") {
    return "";
  }

  throw error;
});

const coordinatorModule = coordinatorSource
  ? await import(
      `data:text/javascript;base64,${Buffer.from(
        typescript.transpileModule(coordinatorSource, {
          compilerOptions: {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64")}`
    )
  : {};

const { createBoardRequestCoordinator, resolveBackgroundSnapshot } =
  coordinatorModule;

assert.equal(
  typeof createBoardRequestCoordinator,
  "function",
  "Board should expose a latest-request coordinator",
);
assert.equal(
  typeof createBoardRequestCoordinator().beginMutation,
  "function",
  "Board mutations should hold a generation lease while local writes are in flight",
);
assert.equal(
  typeof resolveBackgroundSnapshot,
  "function",
  "Background requests should expose an explicit snapshot-preservation policy",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}

{
  const coordinator = createBoardRequestCoordinator();
  const older = deferred();
  const newer = deferred();
  const olderRequest = coordinator.run(() => older.promise);
  const newerRequest = coordinator.run(() => newer.promise);

  newer.resolve("new snapshot");
  assert.deepEqual(await newerRequest, {
    status: "applied",
    value: "new snapshot",
  });

  older.resolve("old snapshot");
  assert.deepEqual(
    await olderRequest,
    { status: "stale" },
    "An out-of-order older response should not be applied",
  );
}

{
  const coordinator = createBoardRequestCoordinator();
  const refresh = deferred();
  const request = coordinator.run(() => refresh.promise);

  coordinator.invalidate();
  refresh.resolve("stale before mutation");

  assert.deepEqual(
    await request,
    { status: "stale" },
    "A local mutation should invalidate an in-flight refresh generation",
  );
}

{
  const coordinator = createBoardRequestCoordinator();
  const existingCatalog = {
    activeSource: { boardId: "board-42" },
    boards: [{ id: "board-42" }],
  };
  const request = coordinator.run(async () => {
    throw new Error("catalog refresh failed");
  });
  const outcome = await request;
  const catalogAfterBackgroundFailure = resolveBackgroundSnapshot(
    existingCatalog,
    outcome,
  );

  assert.equal(outcome.status, "failed");
  assert.equal(
    catalogAfterBackgroundFailure,
    existingCatalog,
    "A background catalog failure should preserve its existing source selection",
  );
}

{
  const coordinator = createBoardRequestCoordinator();
  const beforeMutation = deferred();
  const olderRequest = coordinator.run(() => beforeMutation.promise);
  const mutation = coordinator.beginMutation();

  beforeMutation.resolve("snapshot from before mutation");
  assert.deepEqual(
    await olderRequest,
    { status: "stale" },
    "Beginning a mutation should invalidate a refresh already in flight",
  );

  let requestCalls = 0;
  let requestSettled = false;
  const overlappingRequest = coordinator
    .run(async () => {
      requestCalls += 1;
      return "latest snapshot after mutation";
    })
    .then((outcome) => {
      requestSettled = true;
      return outcome;
    });

  await Promise.resolve();
  assert.equal(
    requestCalls,
    0,
    "A refresh queued during a mutation should not call its request before finish",
  );
  assert.equal(requestSettled, false);

  mutation.finish();

  assert.deepEqual(
    await overlappingRequest,
    { status: "applied", value: "latest snapshot after mutation" },
    "The latest queued refresh should run after the last mutation finishes",
  );
  assert.equal(requestCalls, 1);
}

{
  const coordinator = createBoardRequestCoordinator();
  const mutation = coordinator.beginMutation();
  let olderCalls = 0;
  let latestCalls = 0;

  const olderRequest = coordinator.run(async () => {
    olderCalls += 1;
    return "older queued snapshot";
  });
  const latestRequest = coordinator.run(async () => {
    latestCalls += 1;
    return "latest queued snapshot";
  });

  assert.deepEqual(
    await olderRequest,
    { status: "stale" },
    "Only the latest request queued during a mutation should remain pending",
  );
  assert.equal(olderCalls, 0);
  assert.equal(latestCalls, 0);

  mutation.finish();

  assert.deepEqual(await latestRequest, {
    status: "applied",
    value: "latest queued snapshot",
  });
  assert.equal(latestCalls, 1);
}

{
  const coordinator = createBoardRequestCoordinator();
  const mutation = coordinator.beginMutation();
  let requestCalls = 0;
  const queuedRequest = coordinator.run(async () => {
    requestCalls += 1;
    return "invalidated queued snapshot";
  });

  coordinator.invalidate();
  mutation.finish();

  assert.deepEqual(
    await queuedRequest,
    { status: "stale" },
    "Invalidation should discard a queued refresh without executing it",
  );
  assert.equal(requestCalls, 0);
}

{
  const coordinator = createBoardRequestCoordinator();
  const firstMutation = coordinator.beginMutation();
  let requestCalls = 0;
  let requestSettled = false;
  const queuedRequest = coordinator
    .run(async () => {
      requestCalls += 1;
      return "snapshot after nested mutations";
    })
    .then((outcome) => {
      requestSettled = true;
      return outcome;
    });
  const nestedMutation = coordinator.beginMutation();

  firstMutation.finish();
  firstMutation.finish();
  await Promise.resolve();
  assert.equal(requestCalls, 0);
  assert.equal(requestSettled, false);

  nestedMutation.finish();
  assert.deepEqual(await queuedRequest, {
    status: "applied",
    value: "snapshot after nested mutations",
  });
  assert.equal(
    requestCalls,
    1,
    "Nested mutation leases should release the queued request only after the last finish",
  );
}

{
  const coordinator = createBoardRequestCoordinator();
  const moveMutation = coordinator.beginMutation();
  const createMutation = coordinator.beginMutation();
  let requestCalls = 0;
  let requestSettled = false;
  const queuedRequest = coordinator
    .run(async () => {
      requestCalls += 1;
      return "snapshot after concurrent mutations";
    })
    .then((outcome) => {
      requestSettled = true;
      return outcome;
    });

  moveMutation.finish();
  await Promise.resolve();
  assert.equal(requestCalls, 0);
  assert.equal(requestSettled, false);

  createMutation.finish();
  assert.deepEqual(await queuedRequest, {
    status: "applied",
    value: "snapshot after concurrent mutations",
  });
  assert.equal(requestCalls, 1);
}

console.log("board request coordinator tests passed");
