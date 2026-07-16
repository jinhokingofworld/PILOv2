import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDriveWorkspaceLocation, readDriveFolderId } from "./drive-workspace-location.ts";

test("Drive는 folder ID와 list scroll을 capture하고 target folder load를 요구한다", async () => {
  const location = createDriveWorkspaceLocation("folder-1", { clientHeight: 300, clientWidth: 500, scrollHeight: 900, scrollLeft: 250, scrollTop: 300, scrollWidth: 1000 });
  assert.equal(location.route.search, "?folderId=folder-1");
  assert.equal(location.viewport.key, "drive-list");
  assert.equal(readDriveFolderId(location), "folder-1");
  const adapter = await readFile(new URL("./drive-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /loadFolder/);
  const host = await readFile(new URL("./components/drive-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /DriveWorkspaceLocationAdapter/);
  assert.match(host, /driveListRef/);
  assert.match(host, /loadedDriveParentIdRef/);
  assert.match(host, /listItems/);
});
