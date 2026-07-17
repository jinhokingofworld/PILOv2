import assert from "node:assert/strict";
import test from "node:test";

import {
  DocumentCheckpointError,
  createDocumentAppServerClient,
} from "../../dist/documents/document-app-server-client.js";

const room = {
  documentId: "document-1",
  workspaceId: "workspace-1",
};

test("uses the existing Drive document API with the authenticated bearer token", async () => {
  const requests = [];
  const client = createDocumentAppServerClient({
    appServerUrl: "http://app-server.local/api/v1",
    fetcher: async (url, init) => {
      requests.push({ init, url });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            document: { currentVersion: init?.method === "PUT" ? 3 : 2 },
            snapshot: { yjsState: "AQID" },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });

  const bootstrap = await client.getDocument({ ...room, accessToken: "session-token" });
  const saved = await client.saveDocumentSnapshot({
    ...room,
    accessToken: "session-token",
    contentJson: { type: "doc" },
    expectedVersion: 2,
    yjsState: "AQID",
  });

  assert.equal(bootstrap.document.currentVersion, 2);
  assert.equal(saved.document.currentVersion, 3);
  assert.equal(
    requests[0].url,
    "http://app-server.local/api/v1/workspaces/workspace-1/drive/documents/document-1",
  );
  assert.equal(requests[0].init.headers.Authorization, "Bearer session-token");
  assert.equal(requests[1].init.method, "PUT");
  assert.equal(
    requests[1].url,
    "http://app-server.local/api/v1/workspaces/workspace-1/drive/documents/document-1/snapshot",
  );
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    contentJson: { type: "doc" },
    expectedVersion: 2,
    yjsState: "AQID",
  });
});

test("preserves a Drive API 409 for checkpoint retry handling", async () => {
  const client = createDocumentAppServerClient({
    appServerUrl: "http://app-server.local/api/v1",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { message: "Document version is outdated" },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  });

  await assert.rejects(
    () => client.getDocument({ ...room, accessToken: "session-token" }),
    (error) =>
      error instanceof DocumentCheckpointError &&
      error.status === 409 &&
      error.message === "Document version is outdated",
  );
});
