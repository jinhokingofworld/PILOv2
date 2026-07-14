import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const statusSource = await readFile(
  new URL("./utils/github-manual-sync-status.ts", import.meta.url),
  "utf8"
);
const compiledStatus = ts.transpileModule(statusSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const statusUtility = await import(
  `data:text/javascript;base64,${Buffer.from(compiledStatus).toString("base64")}`
);

assert.equal(
  statusUtility.getGithubManualSyncActionMessage("전체", "queued"),
  "전체 동기화를 시작했습니다. 진행 상태를 확인하고 있습니다."
);
assert.equal(
  statusUtility.getGithubManualSyncActionMessage("Issue", "running"),
  "Issue 동기화가 진행 중입니다."
);
assert.equal(
  statusUtility.getGithubManualSyncActionMessage("전체", "success"),
  "전체 동기화가 성공 상태로 종료되었습니다."
);
assert.equal(
  statusUtility.getGithubManualSyncActionMessage("전체", "failed"),
  "전체 동기화가 실패 상태로 종료되었습니다."
);

const panel = await readFile(
  new URL("./components/github-panel.tsx", import.meta.url),
  "utf8"
);
const handlerStart = panel.indexOf("async function handleStartGithubSyncRun");
const handlerEnd = panel.indexOf("\n  return (", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handler = panel.slice(handlerStart, handlerEnd);

assert.match(
  handler,
  /getGithubManualSyncActionMessage\([\s\S]{0,100}getGithubConnectSyncTargetLabel\(syncRun\.target\),[\s\S]{0,100}syncRun\.status/
);
assert.match(handler, /setHasRunningSyncRun\(true\)/);
assert.match(handler, /await refreshGithubSyncRuns\(\)/);
assert.doesNotMatch(
  handler,
  /loadGithubIntegrationSnapshot/,
  "manual sync must not clear the current repository or ProjectV2 selection"
);

console.log("github manual-sync tests passed");
