import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./github-recovery-gate.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const gate = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

assert.deepEqual(gate.getGithubRecoveryDecision({ event: "reconnect_required", recovery: false }), {
  action: "recover", recovery: true
});
assert.deepEqual(gate.getGithubRecoveryDecision({ event: "reconnect_required", recovery: true }), {
  action: "terminal", recovery: true
});
assert.deepEqual(gate.getGithubRecoveryDecision({ event: "callback_failed", recovery: false }), {
  action: "manual", recovery: false
});
assert.deepEqual(gate.getGithubRecoveryDecision({ event: "callback_failed", recovery: true }), {
  action: "terminal", recovery: true
});
assert.deepEqual(gate.getGithubRecoveryDecision({ event: "transient_failure", recovery: true }), {
  action: "retry", recovery: true
});
assert.equal(gate.createGithubRecoveryAttemptGate().begin(), true);
const requestGate = gate.createGithubRecoveryAttemptGate();
assert.equal(requestGate.begin(), true);
assert.equal(requestGate.begin(), false);
requestGate.complete();
assert.equal(requestGate.begin(), true);
