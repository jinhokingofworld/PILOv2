import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanvasWorkspaceLocation, readCanvasCamera } from "./canvas-workspace-location.ts";

test("Canvas는 canvas ID와 tldraw camera를 capture/restore한다", async () => {
  const location = createCanvasWorkspaceLocation("canvas-1", { x: 3, y: 4, z: 2 });
  assert.equal(location.route.search, "?canvasId=canvas-1");
  assert.deepEqual(readCanvasCamera(location, "canvas-1"), { x: 3, y: 4, z: 2 });
  const adapter = await readFile(new URL("./canvas-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /getCamera/);
  assert.match(adapter, /setCamera/);
  const host = await readFile(new URL("./components/engine/surface/PiloTldrawCanvas.tsx", import.meta.url), "utf8");
  assert.match(host, /CanvasWorkspaceLocationAdapter/);
  const syncHost = await readFile(new URL("./components/engine/runtime/PiloTldrawSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(syncHost, /CanvasWorkspaceLocationAdapter/);
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /await searchParams/);
  const panel = await readFile(new URL("./components/canvas-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /useSearchParams/);
  assert.match(panel, /canvasId/);
});
