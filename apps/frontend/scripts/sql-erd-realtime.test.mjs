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
  /on `SQL_ERD_WRITE_PROTOCOL_MISMATCH`, the client stops autosave, becomes read-only, and requires a session reload before writing again/i
);

assert.match(types, /"sql-erd:join"/);
assert.match(types, /"sql-erd:presence:update"/);
assert.match(types, /selectedObjects: SqlErdPresenceSelectedObject\[\]/);
assert.match(types, /editingMode: SqlErdPresenceEditingMode/);
assert.match(types, /sentAt: string/);
assert.match(client, /socket\.io-client/);
assert.match(presenceHook, /"sql-erd:joined"/);
assert.match(presenceHook, /"sql-erd:presence:leave"/);
assert.match(presenceHook, /socket\.volatile\.emit\("sql-erd:presence:update"/);
assert.match(presenceHook, /localPresenceRef\.current/);
assert.match(presenceHook, /PRESENCE_HEARTBEAT_MS = 5_000/);
assert.match(presenceHook, /PRESENCE_UPDATE_MIN_INTERVAL_MS = 80/);
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
assert.equal(
  [...canvas.matchAll(/window\.addEventListener\("pointerup", flushPendingLayoutSync\)/g)].length,
  2
);

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

console.log("SQLtoERD realtime frontend tests passed");
