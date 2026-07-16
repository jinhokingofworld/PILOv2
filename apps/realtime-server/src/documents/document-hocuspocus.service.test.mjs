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
  });

  const context = await service.authorizeDocument(roomName(), "valid-token");

  assert.deepEqual(context, {
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
