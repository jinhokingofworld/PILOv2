import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let membershipRevocationModule;
try {
  membershipRevocationModule = await import(
    "../../dist/documents/document-membership-revocation.js"
  );
} catch {
  assert.fail("Document membership revocation handler is missing");
}

const { createDocumentMembershipRevocationHandler } = membershipRevocationModule;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";

const revocation = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId,
  version: 1,
  workspaceId,
};

function createConnection(context) {
  const connection = {
    closeCalls: [],
    context,
    close(event) {
      connection.closeCalls.push(event);
    },
  };
  return connection;
}

test("closes only document connections owned by the revoked Workspace member", async () => {
  const matchingConnection = createConnection({
    documentId: "55555555-5555-4555-8555-555555555555",
    userId,
    workspaceId,
  });
  const otherWorkspaceConnection = createConnection({
    documentId: "66666666-6666-4666-8666-666666666666",
    userId,
    workspaceId: otherWorkspaceId,
  });
  const otherUserConnection = createConnection({
    documentId: "77777777-7777-4777-8777-777777777777",
    userId: otherUserId,
    workspaceId,
  });
  const handler = createDocumentMembershipRevocationHandler({
    hocuspocus: {
      documents: new Map([
        ["document-a", { getConnections: () => [matchingConnection] }],
        [
          "document-b",
          {
            getConnections: () => [
              otherWorkspaceConnection,
              otherUserConnection,
            ],
          },
        ],
      ]),
    },
  });

  assert.equal(await handler.handle(revocation), true);
  assert.deepEqual(matchingConnection.closeCalls, [
    { code: 4003, reason: "Workspace access revoked" },
  ]);
  assert.deepEqual(otherWorkspaceConnection.closeCalls, []);
  assert.deepEqual(otherUserConnection.closeCalls, []);
});

test("rejects malformed membership revocations without closing document connections", async () => {
  const connection = createConnection({
    documentId: "55555555-5555-4555-8555-555555555555",
    userId,
    workspaceId,
  });
  const handler = createDocumentMembershipRevocationHandler({
    hocuspocus: {
      documents: new Map([["document-a", { getConnections: () => [connection] }]]),
    },
  });

  assert.equal(await handler.handle({ ...revocation, version: 2 }), false);
  assert.deepEqual(connection.closeCalls, []);
});

test("registers the document handler with the shared membership revocation subscription", async () => {
  const serverSource = await readFile(
    new URL("../server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    serverSource,
    /createDocumentMembershipRevocationHandler\(\{[\s\S]*hocuspocus: documentHocuspocus/,
  );
  assert.match(
    serverSource,
    /membershipRevocationHandlers:\s*\[documentMembershipRevocationHandler\]/,
  );
});
