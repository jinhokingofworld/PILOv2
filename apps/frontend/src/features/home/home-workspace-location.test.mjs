import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHomeWorkspaceLocation, getHomeScrollOffset } from "./home-workspace-location.ts";

test("Home은 document scroll ratio를 capture/restore한다", async () => {
  const location = createHomeWorkspaceLocation({ clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollLeft: 200, scrollTop: 500, scrollWidth: 1600 });
  assert.deepEqual(location.viewport, { kind: "document", xRatio: 0.25, yRatio: 0.5 });
  assert.deepEqual(getHomeScrollOffset(location.viewport, { clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollWidth: 1600 }), { left: 200, top: 500 });
  const adapter = await readFile(new URL("./home-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /useWorkspaceLocationAdapter/);
  const host = await readFile(new URL("./components/home-dashboard.tsx", import.meta.url), "utf8");
  assert.match(host, /HomeWorkspaceLocationAdapter/);
  const packageJson = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  assert.match(packageJson.scripts.test, /test:workspace-location/);
  for (const domain of [
    "home",
    "calendar",
    "board",
    "sql-erd",
    "pr-review",
    "meeting",
    "canvas",
    "drive",
  ]) {
    assert.match(
      packageJson.scripts["test:workspace-location"],
      new RegExp(`${domain}-workspace-location`),
    );
  }
});
