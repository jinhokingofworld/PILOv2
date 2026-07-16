import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [client, editor, panel, types] = await Promise.all([
  readFile(new URL("./api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("./components/document-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/drive-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./types/index.ts", import.meta.url), "utf8")
]);

assert.match(types, /DriveItemType = "folder" \| "file" \| "document"/);
assert.match(types, /DocumentBootstrapPayload/);
assert.match(types, /SaveDocumentSnapshotInput/);
assert.match(
  types,
  /UpdateDriveItemInput =\s*\| \{ name: string \}\s*\| \{ parentId: string \| null \}/
);
assert.match(client, /async createDocument\(/);
assert.match(client, /async getDocument\(/);
assert.match(client, /async saveDocumentSnapshot\(/);
assert.match(client, /drive\/documents/);
assert.match(editor, /Collaboration\.configure/);
assert.match(editor, /Y\.encodeStateAsUpdate/);
assert.match(editor, /expectedVersion/);
assert.match(editor, /immediatelyRender: false/);
assert.match(panel, /documentId/);
assert.match(panel, /DriveDocumentEditor/);
assert.match(panel, /function MoveItemSheet\(/);
assert.match(panel, /onOpenMove/);
assert.match(
  panel,
  /await driveClient\.updateItem\(workspaceId, moveItem\.id, \{ parentId \}\)/
);
assert.match(panel, /destinationParentId: string \| null/);
assert.match(panel, /isDestinationReady: boolean/);
assert.match(panel, /hasDestinationError: boolean/);
assert.match(panel, /onRetry: \(\) => void/);

console.log("Drive document contract tests passed.");
