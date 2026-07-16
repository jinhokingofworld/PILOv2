import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSqlErdWorkspaceLocation, readSqlErdCamera } from "./sql-erd-workspace-location.ts";

test("SQL ERD는 session route와 tldraw camera를 capture/restore한다", async () => {
  const location = createSqlErdWorkspaceLocation("session-1", { x: 10, y: 20, z: 1.5 });
  assert.equal(location.route.pathname, "/sql-erd/session");
  assert.equal(location.route.search, "?sessionId=session-1");
  assert.deepEqual(readSqlErdCamera(location, "session-1"), { x: 10, y: 20, z: 1.5 });
  assert.equal(readSqlErdCamera(location, "session-2"), null);
  const adapter = await readFile(new URL("./sql-erd-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /getCamera/);
  assert.match(adapter, /setCamera/);
  const host = await readFile(new URL("./components/sql-erd-canvas.tsx", import.meta.url), "utf8");
  assert.match(host, /SqlErdWorkspaceLocationAdapter/);
});
