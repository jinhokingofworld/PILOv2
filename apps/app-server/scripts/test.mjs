import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(
  new URL("../src/app.controller.ts", import.meta.url),
  "utf8"
);
const service = await readFile(new URL("../src/app.service.ts", import.meta.url), "utf8");

assert.match(controller, /@Get\("health"\)/);
assert.match(service, /pilo-app-server/);
assert.match(service, /status: "ok"/);
