import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

async function compileRuntimeModule(sourcePath, outputPath) {
  const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
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
  await compileRuntimeModule(
    "../src/features/sql-erd/realtime/operation-sync-state.ts",
    outputPath
  );
  await compileRuntimeModule(
    "../src/features/sql-erd/realtime/source-lock-state.ts",
    sourceLockOutputPath
  );

  return {
    operationSync: await import(`${new URL(`file:///${outputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
    sourceLock: await import(`${new URL(`file:///${sourceLockOutputPath.replace(/\\\\/g, "/")}`).href}?${Date.now()}`),
    outputDir
  };
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
assert.match(sourceLockHook, /SOURCE_LOCK_RENEW_INTERVAL_MS = 10_000/);
assert.match(sourceLockHook, /acquireSourceLock/);
assert.match(sourceLockHook, /renewSourceLock/);
assert.match(sourceLockHook, /releaseSourceLock/);
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
  const { operationSync, outputDir, sourceLock } = await loadOperationSyncRuntime();
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
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

console.log("SQLtoERD realtime frontend tests passed");
