import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBoardWorkspaceLocation, isBoardWorkspaceLocationRestorable } from "./board-workspace-location.ts";

test("Board는 board ID와 kanban scroll을 capture하고 active board를 검증한다", async () => {
  const location = createBoardWorkspaceLocation("board-1", { clientHeight: 400, clientWidth: 600, scrollHeight: 800, scrollLeft: 600, scrollTop: 200, scrollWidth: 1800 });
  assert.equal(location.context.boardId, "board-1");
  assert.equal(location.viewport.key, "board-kanban");
  assert.equal(isBoardWorkspaceLocationRestorable(location, "board-1"), true);
  assert.equal(isBoardWorkspaceLocationRestorable(location, "board-2"), false);
  const adapter = await readFile(new URL("./board-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /kanban-scroll/);
  const host = await readFile(new URL("./components/board-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /BoardWorkspaceLocationAdapter/);
});
