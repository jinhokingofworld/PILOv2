import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanvasWorkspaceLocation, readCanvasCamera } from "./canvas-workspace-location.ts";
import { shouldReuseLoadedCanvasBoard } from "./components/screen/canvas-board-load-policy.ts";

test("Canvas는 canvas ID와 tldraw camera를 capture/restore한다", async () => {
  const location = createCanvasWorkspaceLocation("canvas-1", { x: 3, y: 4, z: 2 });
  assert.equal(location.route.search, "?canvasId=canvas-1");
  assert.deepEqual(readCanvasCamera(location, "canvas-1"), { x: 3, y: 4, z: 2 });
  const adapter = await readFile(new URL("./canvas-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /getCamera/);
  assert.match(adapter, /setCamera/);
  const host = await readFile(new URL("./engine/editor/CanvasEditor.tsx", import.meta.url), "utf8");
  assert.match(host, /CanvasWorkspaceLocationAdapter/);
  const syncHost = await readFile(new URL("./engine/runtime/TldrawSyncCanvasRuntime.tsx", import.meta.url), "utf8");
  assert.match(syncHost, /CanvasWorkspaceLocationAdapter/);
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /await searchParams/);
  const panel = await readFile(new URL("./components/canvas-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /useSearchParams/);
  assert.match(panel, /canvasId/);
});

test("이미 열린 Canvas 링크는 현재 보드를 재사용한다", () => {
  const client = {};
  const loadedBoard = {
    boardId: "canvas-1",
    client,
    workspaceId: "workspace-1",
  };

  assert.equal(
    shouldReuseLoadedCanvasBoard({
      client,
      loadedBoard,
      requestedBoardId: "canvas-1",
      workspaceId: "workspace-1",
    }),
    true,
  );
  assert.equal(
    shouldReuseLoadedCanvasBoard({
      client,
      loadedBoard,
      requestedBoardId: "canvas-2",
      workspaceId: "workspace-1",
    }),
    false,
  );
  assert.equal(
    shouldReuseLoadedCanvasBoard({
      client: {},
      loadedBoard,
      requestedBoardId: "canvas-1",
      workspaceId: "workspace-1",
    }),
    false,
  );
});

test("WorkspaceCanvas는 동일한 Canvas 링크에서 현재 런타임을 유지한다", async () => {
  const workspaceCanvas = await readFile(
    new URL("./components/screen/WorkspaceCanvas.tsx", import.meta.url),
    "utf8",
  );

  assert.match(workspaceCanvas, /shouldReuseLoadedCanvasBoard/);
});
