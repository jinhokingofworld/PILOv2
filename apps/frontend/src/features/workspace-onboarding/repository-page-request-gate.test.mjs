import assert from "node:assert/strict";

const { createRepositoryPageRequestGate } = await import(
  new URL("./repository-page-request-gate.ts", import.meta.url)
);

const gate = createRepositoryPageRequestGate();
const firstRequest = gate.begin();
const secondRequest = gate.begin();

assert.equal(gate.isCurrent(firstRequest), false);
assert.equal(gate.isCurrent(secondRequest), true);

gate.invalidate();

assert.equal(gate.isCurrent(secondRequest), false);

console.log("workspace onboarding repository page request gate tests passed");
