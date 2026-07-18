import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

async function compileRuntimeModule(sourcePath, outputPath, replacements = []) {
  let source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
  replacements.forEach(([pattern, replacement]) => {
    source = source.replace(pattern, replacement);
  });
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  await writeFile(outputPath, output, "utf8");
}

async function loadOperationSyncRuntime() {
  const outputDir = await mkdtemp(
    fileURLToPath(new URL("../../.pilo-sqltoerd-realtime-", import.meta.url))
  );
  const outputPath = join(outputDir, "operation-sync-state.mjs");
  const sourceLockOutputPath = join(outputDir, "source-lock-state.mjs");
  const sourceLockControllerOutputPath = join(
    outputDir,
    "source-lock-controller.mjs"
  );
  try {
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/operation-sync-state.ts",
      outputPath
    );
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/source-lock-state.ts",
      sourceLockOutputPath
    );
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/source-lock-controller.ts",
      sourceLockControllerOutputPath,
      [[/from "\.\/source-lock-state"/g, 'from "./source-lock-state.mjs"']]
    );

    return {
      operationSync: await import(`${new URL(`file:///${outputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
      sourceLock: await import(`${new URL(`file:///${sourceLockOutputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
      sourceLockController: await import(`${new URL(`file:///${sourceLockControllerOutputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
      outputDir
    };
  } catch (error) {
    await rm(outputDir, { force: true, recursive: true });
    throw error;
  }
}

async function loadTableMovePreviewRuntime() {
  const outputDir = await mkdtemp(
    fileURLToPath(new URL("../../.pilo-sqltoerd-table-move-preview-", import.meta.url))
  );
  const outputPath = join(outputDir, "sql-erd-table-move-preview.mjs");

  try {
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/sql-erd-table-move-preview.ts",
      outputPath
    );

    return {
      preview: await import(
        `${new URL(`file:///${outputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`
      ),
      outputDir
    };
  } catch (error) {
    await rm(outputDir, { force: true, recursive: true });
    throw error;
  }
}

async function loadOperationSyncHookRuntime() {
  const outputDir = await mkdtemp(
    fileURLToPath(new URL("../../.pilo-sqltoerd-operation-hook-", import.meta.url))
  );
  const hookOutputPath = join(outputDir, "use-sql-erd-operation-sync.mjs");
  const operationSyncOutputPath = join(outputDir, "operation-sync-state.mjs");
  const reactOutputPath = join(outputDir, "react.mjs");
  const clientOutputPath = join(outputDir, "sql-erd-realtime-client.mjs");

  try {
    await writeFile(
      reactOutputPath,
      `let refIndex = 0;
const refs = [];
let stateIndex = 0;
const states = [];
export function useRef(value) {
  const index = refIndex++;
  return (refs[index] ??= { current: value });
}
export function useState(value) {
  const index = stateIndex++;
  states[index] ??= value;
  return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
}
export const useCallback = (callback) => callback;
export const useMemo = (factory) => factory();
export const useEffect = (effect) => { effect(); };
`,
      "utf8"
    );
    await writeFile(
      clientOutputPath,
      `const handlers = new Map();
export const socket = {
  connected: false,
  connect() { this.connected = true; handlers.get("connect")?.(); },
  disconnect() { this.connected = false; },
  emit() {},
  on(event, handler) { handlers.set(event, handler); },
  removeAllListeners() { handlers.clear(); }
};
export const createSqlErdRealtimeSocket = () => socket;
export const getSqlErdRealtimeServerUrl = () => "http://realtime.test";
export const emitServerEvent = (event, payload) => handlers.get(event)?.(payload);
`,
      "utf8"
    );
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/operation-sync-state.ts",
      operationSyncOutputPath
    );
    await compileRuntimeModule(
      "../src/features/sql-erd/realtime/use-sql-erd-operation-sync.ts",
      hookOutputPath,
      [
        [/from "react"/g, 'from "./react.mjs"'],
        [
          /from "\.\/sql-erd-realtime-client"/g,
          'from "./sql-erd-realtime-client.mjs"'
        ],
        [/from "\.\/operation-sync-state"/g, 'from "./operation-sync-state.mjs"']
      ]
    );

    return {
      client: await import(new URL(`file:///${clientOutputPath.replace(/\\\\/g, "/")}`).href),
      hook: await import(`${new URL(`file:///${hookOutputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
      outputDir
    };
  } catch (error) {
    await rm(outputDir, { force: true, recursive: true });
    throw error;
  }
}

const types = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-types.ts",
    import.meta.url,
  ),
  "utf8",
);
const client = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-client.ts",
    import.meta.url,
  ),
  "utf8",
);
const apiClient = await readFile(
  new URL("../src/features/sql-erd/api/client.ts", import.meta.url),
  "utf8",
);
const presenceHook = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/use-sql-erd-presence.ts",
    import.meta.url,
  ),
  "utf8",
);
const operationHook = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/use-sql-erd-operation-sync.ts",
    import.meta.url,
  ),
  "utf8",
);
const sourceLockHook = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/use-sql-erd-source-lock.ts",
    import.meta.url,
  ),
  "utf8",
);
const sourceLockController = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/source-lock-controller.ts",
    import.meta.url,
  ),
  "utf8",
);
const bridge = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-bridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const canvas = await readFile(
  new URL("../src/features/sql-erd/components/sql-erd-canvas.tsx", import.meta.url),
  "utf8",
);
const panel = await readFile(
  new URL("../src/features/sql-erd/components/sql-erd-panel.tsx", import.meta.url),
  "utf8",
);
const apiDocument = await readFile(
  new URL("../../../docs/api/sqltoerd-api.md", import.meta.url),
  "utf8",
);

assert.match(
  apiDocument,
  /`sql-erd:joined` reads `latestOpSeq` from `sql_erd_sessions\.latest_op_seq` in the database for each authorized join/i
);
assert.match(
  apiDocument,
  /on `SQL_ERD_WRITE_PROTOCOL_MISMATCH`, the client pauses autosave and persistence, disables retry, and shows a reload\/read-only 안내\. a session reload is required before persistence resumes/i
);
assert.match(apiDocument, /"sql-erd:table-move:preview"/);
assert.match(apiDocument, /"sql-erd:table-move:clear"/);
assert.match(apiDocument, /emits at most once every 33ms/);
assert.match(apiDocument, /not written to the database/);
assert.match(apiDocument, /position captured before the preview/);
assert.match(apiDocument, /actorUserId, tableId, dragId/);
assert.match(apiDocument, /late preview packets/);
assert.match(apiDocument, /enabled only for `operations_v1` sessions/i);
assert.match(apiDocument, /auto layout.*do not emit.*preview/is);

assert.match(types, /"sql-erd:join"/);
assert.match(types, /"sql-erd:presence:update"/);
assert.match(types, /"sql-erd:table-move:preview"/);
assert.match(types, /"sql-erd:table-move:clear"/);
assert.match(types, /selectedObjects: SqlErdPresenceSelectedObject\[\]/);
assert.match(types, /editingMode: SqlErdPresenceEditingMode/);
assert.match(types, /sentAt: string/);
assert.match(client, /socket\.io-client/);
assert.match(presenceHook, /"sql-erd:joined"/);
assert.match(presenceHook, /"sql-erd:presence:leave"/);
assert.match(presenceHook, /socket\.volatile\.emit\("sql-erd:presence:update"/);
assert.match(presenceHook, /localPresenceRef\.current/);
assert.match(presenceHook, /PRESENCE_HEARTBEAT_MS = 5_000/);
assert.match(presenceHook, /PRESENCE_UPDATE_MIN_INTERVAL_MS = 33/);
assert.match(presenceHook, /hasCursorMovedEnough/);
assert.match(types, /"sql-erd:operation"/);
assert.match(operationHook, /useSqlErdOperationSync/);
assert.match(operationHook, /lastSeenOpSeqRef/);
assert.match(operationHook, /liveOperationBufferRef/);
assert.match(operationHook, /catchUpOperations/);
assert.match(operationHook, /sql-erd:operation/);
assert.match(operationHook, /payload\.latestOpSeq > lastSeenOpSeqRef\.current/);
assert.match(sourceLockHook, /SOURCE_LOCK_RENEW_INTERVAL_MS = 10_000/);
assert.match(sourceLockHook, /createSqlErdSourceLockController/);
assert.match(sourceLockController, /acquireSourceLock/);
assert.match(sourceLockController, /renewSourceLock/);
assert.match(sourceLockController, /releaseSourceLock/);
assert.match(apiClient, /listOperations/);
assert.match(apiClient, /listSourceSnapshots/);
assert.match(apiClient, /acquireSourceLock/);
assert.match(apiClient, /publishSourceSnapshot/);
assert.match(bridge, /useEditor/);
assert.match(bridge, /getSelectedShapeIds/);
assert.match(bridge, /pointer-events-none/);
assert.match(bridge, /requestAnimationFrame/);
assert.match(canvas, /useSqlErdPresence/);
assert.match(canvas, /SqlErdRealtimeBridge/);
assert.match(canvas, /cancelPendingTableMovePreviews\(tableIds\)/);
assert.match(
  canvas,
  /shouldClearSqlErdTableMovePreviewAfterDrop\(scheduled\)/
);
assert.match(panel, /context\?\.clientOperationId\?\.trim\(\)/);
assert.match(panel, /recordCommittedTableMove\(operationResult\.operation\)/);
assert.match(
  panel,
  /areSqltoerdLayoutsEqual\(previousLayoutJson, nextLayoutJson\)/
);
assert.match(
  panel,
  /enableTableMovePreview=\{isSqlErdTableMovePreviewEnabled\(\s*sqlErdViewSession\.writeProtocol\s*\)\}/
);
assert.match(
  canvas,
  /enableTableMovePreview\s*\?\s*sqlErdPresence\.sendTableMovePreview\s*:\s*undefined/
);
assert.equal(
  [...canvas.matchAll(/window\.addEventListener\("pointerup", flushPendingLayoutSync\)/g)].length,
  2
);

{
  const { outputDir, preview } = await loadTableMovePreviewRuntime();
  const emitted = [];
  const timers = [];
  let now = 0;

  try {
    const throttle = preview.createSqlErdTableMovePreviewThrottle({
      emit: (payload) => emitted.push(payload),
      now: () => now,
      schedule: (callback, delay) => {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      cancelSchedule: (timer) => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      }
    });

    throttle.push({ tableId: "table.orders", x: 10, y: 20 });
    now = 5;
    throttle.push({ tableId: "table.orders", x: 20, y: 30 });
    now = 10;
    throttle.push({ tableId: "table.orders", x: 30, y: 40 });

    assert.deepEqual(emitted, [{ tableId: "table.orders", x: 10, y: 20 }]);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 28);

    now = 33;
    timers.shift().callback();
    assert.deepEqual(emitted, [
      { tableId: "table.orders", x: 10, y: 20 },
      { tableId: "table.orders", x: 30, y: 40 }
    ]);

    now = 40;
    throttle.push({ tableId: "table.users", x: 50, y: 60 });
    assert.equal(timers.length, 1);
    throttle.cancel();
    assert.equal(timers.length, 0);
    assert.equal(
      preview.shouldClearSqlErdTableMovePreviewAfterDrop(false),
      true
    );
    assert.equal(
      preview.shouldClearSqlErdTableMovePreviewAfterDrop(true),
      false
    );
    assert.equal(
      preview.isSqlErdTableMovePreviewEnabled("operations_v1"),
      true
    );
    assert.equal(preview.isSqlErdTableMovePreviewEnabled("snapshot"), false);

    const firstPreview = {
      actorUserId: "user-se-in",
      dragId: "drag-1",
      sentAt: "2026-07-18T00:00:00.000Z",
      tableId: "table.orders",
      x: 240,
      y: 180
    };
    const initialResolution = preview.resolveSqlErdRemoteTableMovePreview({
      canonicalPosition: null,
      currentPosition: { x: 80, y: 80 },
      preview: firstPreview,
      previousState: null
    });
    assert.deepEqual(initialResolution, {
      dismissPreview: null,
      nextState: {
        actorUserId: "user-se-in",
        basePosition: { x: 80, y: 80 },
        dragId: "drag-1"
      },
      position: { x: 240, y: 180 }
    });

    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: null,
        currentPosition: { x: 240, y: 180 },
        preview: null,
        previousState: initialResolution.nextState
      }),
      {
        dismissPreview: null,
        nextState: null,
        position: { x: 80, y: 80 }
      }
    );

    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 320, y: 260 },
        currentPosition: { x: 240, y: 180 },
        preview: firstPreview,
        previousState: initialResolution.nextState
      }),
      {
        dismissPreview: null,
        nextState: {
          actorUserId: "user-se-in",
          basePosition: { x: 80, y: 80 },
          dragId: "drag-1",
        },
        position: { x: 240, y: 180 }
      }
    );

    const completedDragKeys = new Set([
      preview.createSqlErdTableMoveCompletionKey(
        "user-se-in",
        "table.orders",
        "drag-1"
      )
    ]);
    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 80, y: 80 },
        completedDragKeys,
        currentPosition: { x: 240, y: 180 },
        preview: firstPreview,
        previousState: initialResolution.nextState
      }),
      {
        dismissPreview: {
          actorUserId: "user-se-in",
          dragId: "drag-1",
          sentAt: "2026-07-18T00:00:00.000Z",
          tableId: "table.orders"
        },
        nextState: null,
        position: { x: 80, y: 80 }
      }
    );

    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 80, y: 80 },
        completedDragKeys,
        currentPosition: { x: 80, y: 80 },
        preview: firstPreview,
        previousState: null
      }).position,
      { x: 80, y: 80 }
    );

    const secondPreview = {
      ...firstPreview,
      dragId: "drag-2",
      sentAt: "2026-07-18T00:00:01.000Z",
      x: 360,
      y: 280
    };
    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 80, y: 80 },
        completedDragKeys,
        currentPosition: { x: 80, y: 80 },
        preview: secondPreview,
        previousState: null
      }),
      {
        dismissPreview: null,
        nextState: {
          actorUserId: "user-se-in",
          basePosition: { x: 80, y: 80 },
          dragId: "drag-2"
        },
        position: { x: 360, y: 280 }
      }
    );
    const secondPreviewState =
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 80, y: 80 },
        completedDragKeys,
        currentPosition: { x: 80, y: 80 },
        preview: secondPreview,
        previousState: null
      }).nextState;
    assert.deepEqual(
      preview.resolveSqlErdRemoteTableMovePreview({
        canonicalPosition: { x: 240, y: 180 },
        completedDragKeys,
        currentPosition: { x: 360, y: 280 },
        preview: secondPreview,
        previousState: secondPreviewState
      }),
      {
        dismissPreview: null,
        nextState: secondPreviewState,
        position: { x: 360, y: 280 }
      }
    );

    assert.deepEqual(
      preview.getSqlErdTableMoveCommit({
        actorUserId: "user-se-in",
        clientOperationId: "drag-1",
        patch: {
          tableLayouts: {
            upsert: [{ tableId: "table.orders", x: 80, y: 80 }]
          }
        },
        type: "layout_patch"
      }),
      {
        actorUserId: "user-se-in",
        dragId: "drag-1",
        tableIds: ["table.orders"]
      }
    );
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

{
  const {
    operationSync,
    outputDir,
    sourceLock,
    sourceLockController
  } = await loadOperationSyncRuntime();
  const operations = Array.from({ length: 101 }, (_, index) => ({
    id: `operation-${index + 1}`,
    opSeq: index + 1
  }));
  const requestedAfterSequences = [];
  const appliedSequences = [];

  try {
    const lastSeenOpSeq = await operationSync.catchUpSqlErdOperationPages({
      afterSeq: 0,
      applyOperations: async (page) => {
        appliedSequences.push(...page.map((operation) => operation.opSeq));
      },
      fetchPage: async (afterSeq) => {
        requestedAfterSequences.push(afterSeq);
        const items = operations.filter((operation) => operation.opSeq > afterSeq).slice(0, 100);
        return {
          items,
          latestOpSeq: 101,
          nextAfterSeq: items.length === 100 ? items.at(-1).opSeq : null
        };
      }
    });

    assert.deepEqual(requestedAfterSequences, [0, 100]);
    assert.deepEqual(appliedSequences, operations.map((operation) => operation.opSeq));
    assert.equal(lastSeenOpSeq, 101);

    const buffered = operationSync.bufferSqlErdOperation(
      { bufferedOperations: [], lastSeenOpSeq: 1 },
      { id: "operation-3", opSeq: 3 }
    );
    const withSelfEcho = operationSync.bufferSqlErdOperation(
      buffered,
      { id: "operation-1", opSeq: 1 }
    );
    const afterGap = operationSync.takeContiguousSqlErdOperations(withSelfEcho);
    assert.deepEqual(afterGap.operations, []);
    assert.deepEqual(afterGap.state, {
      bufferedOperations: [{ id: "operation-3", opSeq: 3 }],
      lastSeenOpSeq: 1
    });

    const afterMissingOperation = operationSync.takeContiguousSqlErdOperations(
      operationSync.bufferSqlErdOperation(afterGap.state, {
        id: "operation-2",
        opSeq: 2
      })
    );
    assert.deepEqual(
      afterMissingOperation.operations.map((operation) => operation.opSeq),
      [2, 3]
    );
    assert.equal(afterMissingOperation.state.lastSeenOpSeq, 3);

    assert.equal(sourceLock.getSourceLockIntervalRequest("held"), "renew");
    assert.equal(sourceLock.getSourceLockIntervalRequest("read_only"), "acquire");

    const heldLeases = new Map();
    const requests = [];
    let shouldRejectNextRenewal = false;
    const createClient = (actor) => ({
      acquireSourceLock: async (leaseId) => {
        requests.push(`acquire:${actor}:${leaseId}`);
        if (heldLeases.size) throw new Error("SQL source is locked by another user.");

        heldLeases.set(actor, leaseId);
        return { leaseId };
      },
      releaseSourceLock: async (leaseId) => {
        requests.push(`release:${actor}:${leaseId}`);
        if (heldLeases.get(actor) === leaseId) heldLeases.delete(actor);
      },
      renewSourceLock: async (leaseId) => {
        requests.push(`renew:${actor}:${leaseId}`);
        if (shouldRejectNextRenewal) {
          shouldRejectNextRenewal = false;
          heldLeases.delete(actor);
          throw new Error("SQL source lock expired.");
        }
        if (heldLeases.get(actor) !== leaseId) {
          throw new Error("SQL source lock is not held.");
        }
        return { leaseId };
      }
    });
    let nextLeaseNumber = 0;
    const createController = (actor) =>
      sourceLockController.createSqlErdSourceLockController({
        client: createClient(actor),
        createLeaseId: () => `${actor}-lease-${++nextLeaseNumber}`
      });
    const firstEditor = createController("first");
    const secondEditor = createController("second");

    await firstEditor.start();
    await secondEditor.start();
    assert.equal(firstEditor.getState().status, "held");
    assert.equal(secondEditor.getState().status, "read_only");

    await firstEditor.stop();
    await secondEditor.tick();
    assert.equal(secondEditor.getState().status, "held");
    assert.deepEqual(requests, [
      "acquire:first:first-lease-1",
      "acquire:second:second-lease-2",
      "release:first:first-lease-1",
      "acquire:second:second-lease-3"
    ]);

    await secondEditor.tick();
    assert.equal(secondEditor.getState().status, "held");
    shouldRejectNextRenewal = true;
    await secondEditor.tick();
    assert.equal(secondEditor.getState().status, "read_only");
    await secondEditor.tick();
    assert.equal(secondEditor.getState().status, "held");
    await secondEditor.stop();
    assert.deepEqual(requests.slice(-4), [
      "renew:second:second-lease-3",
      "renew:second:second-lease-3",
      "acquire:second:second-lease-4",
      "release:second:second-lease-4"
    ]);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

{
  const { client, hook, outputDir } = await loadOperationSyncHookRuntime();
  const catchUpAfterSequences = [];

  try {
    hook.useSqlErdOperationSync(
      {
        authToken: "token",
        currentUser: { displayName: "Se-in", userId: "user-1" },
        enabled: true,
        sessionId: "session-1",
        workspaceId: "workspace-1"
      },
      {
        applyOperations: () => {},
        catchUpOperations: async (afterSeq) => {
          catchUpAfterSequences.push(afterSeq);
          return { items: [], latestOpSeq: 7, nextAfterSeq: null };
        },
        initialLatestOpSeq: 4,
        writeProtocol: "operations_v1"
      }
    );

    client.emitServerEvent("sql-erd:joined", {
      latestOpSeq: 7,
      presence: [],
      sessionId: "session-1",
      workspaceId: "workspace-1"
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(catchUpAfterSequences, [4]);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

{
  const { client, hook, outputDir } = await loadOperationSyncHookRuntime();
  const catchUpAfterSequences = [];
  let resolveCatchUp;

  try {
    hook.useSqlErdOperationSync(
      {
        authToken: "token",
        currentUser: { displayName: "Se-in", userId: "user-1" },
        enabled: true,
        sessionId: "session-1",
        workspaceId: "workspace-1"
      },
      {
        applyOperations: () => {},
        catchUpOperations: async (afterSeq) => {
          catchUpAfterSequences.push(afterSeq);
          return new Promise((resolve) => {
            resolveCatchUp = resolve;
          });
        },
        initialLatestOpSeq: 4,
        writeProtocol: "operations_v1"
      }
    );

    client.emitServerEvent("sql-erd:joined", {
      latestOpSeq: 5,
      presence: [],
      sessionId: "session-1",
      workspaceId: "workspace-1"
    });
    await new Promise((resolve) => setImmediate(resolve));

    client.emitServerEvent("sql-erd:operation", {
      id: "operation-5",
      opSeq: 5,
      sessionId: "session-1",
      workspaceId: "workspace-1"
    });
    resolveCatchUp({
      items: [{ id: "operation-5", opSeq: 5 }],
      latestOpSeq: 5,
      nextAfterSeq: null
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(catchUpAfterSequences, [4]);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

console.log("SQLtoERD realtime frontend tests passed");
