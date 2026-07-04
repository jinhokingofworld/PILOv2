import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

assert.match(server, /notifications_status_only/);
assert.match(server, /\/health/);
assert.match(server, /pathname\.startsWith\("\/ws\/"\)/);
assert.match(server, /type: "ready"/);
