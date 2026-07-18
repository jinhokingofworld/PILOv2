import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as locationModule from "./sql-erd-workspace-location.ts";

const {
  createSqlErdInspectorWorkspaceLocation,
  createSqlErdWorkspaceLocation,
  getSqlErdInspectorScrollOffset,
  readSqlErdCamera,
  readSqlErdWorkspaceTarget,
  waitForSqlErdInspectorTarget,
} = locationModule;

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

test("SQL ERD camera 위치는 선택 객체와 닫힌 Inspector 상태를 함께 복원한다", () => {
  assert.equal(typeof readSqlErdWorkspaceTarget, "function");
  const location = createSqlErdWorkspaceLocation(
    "session-1",
    { x: 10, y: 20, z: 1.5 },
    { type: "column", tableId: "table-1", columnId: "column-2" },
  );

  assert.deepEqual(location.context, {
    sessionId: "session-1",
    sqlErdInspectorOpen: "false",
    sqlErdSelectionId: "column-2",
    sqlErdSelectionTableId: "table-1",
    sqlErdSelectionType: "column",
  });
  assert.deepEqual(readSqlErdWorkspaceTarget(location, "session-1"), {
    camera: { x: 10, y: 20, z: 1.5 },
    inspectorOpen: false,
    selection: { type: "column", tableId: "table-1", columnId: "column-2" },
    surface: "canvas",
  });
});

test("SQL ERD Inspector 위치는 선택 객체와 내부 세로 scroll ratio만 capture한다", () => {
  assert.equal(typeof createSqlErdInspectorWorkspaceLocation, "function");
  assert.equal(typeof getSqlErdInspectorScrollOffset, "function");
  const location = createSqlErdInspectorWorkspaceLocation({
    metrics: {
      clientHeight: 400,
      scrollHeight: 1_400,
      scrollTop: 500,
    },
    selection: { type: "relation", relationId: "relation-1" },
    sessionId: "session-1",
  });

  assert.deepEqual(location, {
    context: {
      sessionId: "session-1",
      sqlErdInspectorOpen: "true",
      sqlErdSelectionId: "relation-1",
      sqlErdSelectionTableId: null,
      sqlErdSelectionType: "relation",
    },
    page: "sql-erd",
    route: {
      pathname: "/sql-erd/session",
      search: "?sessionId=session-1",
    },
    viewport: {
      kind: "element",
      key: "sql-erd-inspector",
      xRatio: 0,
      yRatio: 0.5,
    },
  });
  assert.deepEqual(readSqlErdWorkspaceTarget(location, "session-1"), {
    inspectorOpen: true,
    selection: { type: "relation", relationId: "relation-1" },
    surface: "inspector",
    viewport: location.viewport,
  });
  assert.deepEqual(
    getSqlErdInspectorScrollOffset(location.viewport, {
      clientHeight: 300,
      scrollHeight: 1_300,
    }),
    { top: 500 },
  );
});

test("SQL ERD Inspector restore 대기는 abort 후 늦게 mount된 target을 무시한다", async () => {
  assert.equal(typeof waitForSqlErdInspectorTarget, "function");
  const controller = new AbortController();
  let target = null;
  setTimeout(() => controller.abort(), 3);
  setTimeout(() => {
    target = { id: "stale-inspector" };
  }, 8);

  assert.equal(
    await waitForSqlErdInspectorTarget({
      findTarget: () => target,
      intervalMs: 1,
      signal: controller.signal,
      timeoutMs: 100,
    }),
    null,
  );
});

test("SQL ERD Follow adapter는 selectedObjects realtime을 재사용하거나 덮어쓰지 않는다", async () => {
  const adapter = await readFile(
    new URL("./sql-erd-workspace-location-adapter.tsx", import.meta.url),
    "utf8",
  );
  const panel = await readFile(
    new URL("./components/sql-erd-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(adapter, /selectedObjects/);
  assert.match(panel, /data-workspace-follow-surface="sql-erd-inspector"/);
});
