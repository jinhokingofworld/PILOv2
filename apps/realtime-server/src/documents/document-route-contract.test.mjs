import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("routes only document sync upgrades through the Hocuspocus transport", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");

  assert.match(server, /createDocumentHocuspocusService/);
  assert.match(server, /createDocumentHocuspocusTransport/);
  assert.match(server, /pathname === "\/sync\/documents"/);
  assert.match(server, /documentHocuspocusTransport\s*\.\s*handleUpgrade/);
  assert.match(server, /engine: "hocuspocus"/);
  assert.match(server, /documentHocuspocus\.closeConnections\(\)/);
  assert.match(server, /url\.pathname === "\/sync\/canvas"/);
  assert.match(server, /url\.pathname\.startsWith\("\/socket\.io\/"\)/);
});
