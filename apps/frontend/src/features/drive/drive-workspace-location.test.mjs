import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as locationModule from "./drive-workspace-location.ts";

const {
  createDriveDocumentWorkspaceLocation,
  createDrivePdfWorkspaceLocation,
  createDriveWorkspaceLocation,
  getDriveScrollOffset,
  readDriveFolderId,
  readDriveWorkspaceTarget,
  waitForDriveSurfaceTarget,
} = locationModule;

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

test("Drive 문서 읽기 위치는 document ID와 document scroll만 capture한다", () => {
  assert.equal(typeof createDriveDocumentWorkspaceLocation, "function");
  assert.equal(typeof readDriveWorkspaceTarget, "function");
  const location = createDriveDocumentWorkspaceLocation("document-1", {
    clientHeight: 500,
    clientWidth: 800,
    scrollHeight: 1_500,
    scrollLeft: 0,
    scrollTop: 500,
    scrollWidth: 800,
  });

  assert.deepEqual(location.context, {
    documentId: "document-1",
    folderId: null,
    pdfFileId: null,
    pdfPage: null,
  });
  assert.equal(location.route.search, "?documentId=document-1");
  assert.equal(location.viewport.kind, "document");
  assert.deepEqual(readDriveWorkspaceTarget(location), {
    documentId: "document-1",
    surface: "document",
    viewport: location.viewport,
  });
  assert.equal(JSON.stringify(location).includes("contentJson"), false);
  assert.equal(JSON.stringify(location).includes("yjsState"), false);
});

test("Drive PDF 읽기 위치는 opaque file ID, page와 읽기 영역 scroll ratio만 capture한다", () => {
  assert.equal(typeof createDrivePdfWorkspaceLocation, "function");
  const location = createDrivePdfWorkspaceLocation({
    fileId: "pdf-1",
    folderId: "folder-1",
    metrics: {
      clientHeight: 400,
      clientWidth: 600,
      scrollHeight: 1_400,
      scrollLeft: 200,
      scrollTop: 500,
      scrollWidth: 1_400,
    },
    pageNumber: 3,
  });

  assert.deepEqual(location.context, {
    documentId: null,
    folderId: "folder-1",
    pdfFileId: "pdf-1",
    pdfPage: "3",
  });
  assert.equal(location.route.search, "?folderId=folder-1");
  assert.deepEqual(location.viewport, {
    kind: "element",
    key: "drive-pdf",
    xRatio: 0.25,
    yRatio: 0.5,
  });
  assert.deepEqual(readDriveWorkspaceTarget(location), {
    fileId: "pdf-1",
    folderId: "folder-1",
    pageNumber: 3,
    surface: "pdf",
    viewport: location.viewport,
  });
  assert.deepEqual(
    getDriveScrollOffset(location.viewport, {
      clientHeight: 300,
      clientWidth: 500,
      scrollHeight: 1_300,
      scrollWidth: 1_300,
    }),
    { left: 200, top: 500 },
  );
});

test("Drive read surface restore 대기는 abort 후 늦게 mount된 target을 무시한다", async () => {
  assert.equal(typeof waitForDriveSurfaceTarget, "function");
  const controller = new AbortController();
  let target = null;
  setTimeout(() => controller.abort(), 3);
  setTimeout(() => {
    target = { id: "stale-document" };
  }, 8);

  assert.equal(
    await waitForDriveSurfaceTarget({
      findTarget: () => target,
      intervalMs: 1,
      signal: controller.signal,
      timeoutMs: 100,
    }),
    null,
  );
});

test("Drive adapter는 document early return과 PDF controlled page surface에서도 mount된다", async () => {
  const panel = await readFile(
    new URL("./components/drive-panel.tsx", import.meta.url),
    "utf8",
  );
  const documentEditor = await readFile(
    new URL("./components/document-editor.tsx", import.meta.url),
    "utf8",
  );
  const pdfSurface = await readFile(
    new URL("./components/pdf-collaboration-surface.tsx", import.meta.url),
    "utf8",
  );

  assert.match(panel, /workspaceLocationAdapter/);
  assert.match(panel, /if \(documentId\)[\s\S]*workspaceLocationAdapter[\s\S]*DriveDocumentEditor/);
  assert.match(documentEditor, /data-workspace-follow-drive-document-id/);
  assert.match(pdfSurface, /data-workspace-follow-drive-pdf-file-id/);
  assert.doesNotMatch(pdfSurface, /useState\(1\)/);
  assert.match(
    pdfSurface,
    /if \(pageNumber > nextNumPages\) onPageNumberChange\(nextNumPages\)/,
  );
});
