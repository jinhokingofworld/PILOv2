import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocumentHocuspocusService,
} from "../../dist/documents/document-hocuspocus.service.js";

const workspaceId = "00000000-0000-0000-0000-000000000001";
const documentId = "00000000-0000-0000-0000-000000000002";

function roomName() {
  return `workspace:${workspaceId}:document:${documentId}:yjs`;
}

test("authenticates a Workspace member for the requested document room", async () => {
  const accessCalls = [];
  const service = createDocumentHocuspocusService({
    accessService: {
      async getDocumentRoomAccess(context, room) {
        accessCalls.push({ context, room });
        return { readOnly: false };
      },
    },
    sessionService: {
      async validateSessionToken(token) {
        assert.equal(token, "valid-token");
        return { displayName: "PILO", userId: "user-1" };
      },
    },
    checkpointService: {
      async loadDocument() {
        return new Uint8Array();
      },
      async storeDocument() {},
    },
  });

  const context = await service.authorizeDocument(roomName(), "valid-token");

  assert.deepEqual(context, {
    accessToken: "valid-token",
    documentId,
    userId: "user-1",
    workspaceId,
  });
  assert.deepEqual(accessCalls, [
    {
      context: { userId: "user-1" },
      room: { documentId, workspaceId },
    },
  ]);
});

test("rejects an unauthenticated user before a document is loaded", async () => {
  const service = createDocumentHocuspocusService({
    accessService: {
      async getDocumentRoomAccess() {
        throw new Error("access lookup should not run");
      },
    },
    sessionService: {
      async validateSessionToken() {
        return null;
      },
    },
    checkpointService: {
      async loadDocument() {
        return new Uint8Array();
      },
      async storeDocument() {},
    },
  });

  await assert.rejects(
    () => service.authorizeDocument(roomName(), "expired-token"),
    /NOT_AUTHENTICATED/,
  );
});

test("rejects malformed names and documents outside the member's Workspace", async () => {
  const service = createDocumentHocuspocusService({
    accessService: {
      async getDocumentRoomAccess() {
        return null;
      },
    },
    sessionService: {
      async validateSessionToken() {
        return { displayName: "PILO", userId: "user-1" };
      },
    },
    checkpointService: {
      async loadDocument() {
        return new Uint8Array();
      },
      async storeDocument() {},
    },
  });

  await assert.rejects(
    () => service.authorizeDocument("not-a-document-room", "valid-token"),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () => service.authorizeDocument(roomName(), "valid-token"),
    /FORBIDDEN/,
  );
});

test("loads and stores a room through the checkpoint service with the authenticated token", async () => {
  const calls = [];
  const service = createDocumentHocuspocusService({
    accessService: {
      async getDocumentRoomAccess() {
        return { readOnly: false };
      },
    },
    sessionService: {
      async validateSessionToken() {
        return { displayName: "PILO", userId: "user-1" };
      },
    },
    checkpointService: {
      async loadDocument(context) {
        calls.push({ type: "load", context });
        return new Uint8Array([1, 2, 3]);
      },
      async storeDocument(input) {
        calls.push({ type: "store", input });
      },
    },
  });
  const context = await service.authorizeDocument(roomName(), "valid-token");
  const document = { getXmlFragment() {} };

  assert.deepEqual(await service.loadDocument(context), new Uint8Array([1, 2, 3]));
  await service.storeDocument(context, document);

  assert.deepEqual(calls, [
    { type: "load", context },
    { type: "store", input: { ...context, document } },
  ]);
});
