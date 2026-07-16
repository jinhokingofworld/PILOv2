import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentAccessService } from "./document-access.service.ts";

const workspaceId = "00000000-0000-0000-0000-000000000001";
const documentId = "00000000-0000-0000-0000-000000000002";
const userId = "00000000-0000-0000-0000-000000000003";

test("allows a Workspace member to join an active native document room", async () => {
  const queries = [];
  const service = createDocumentAccessService({
    database: {
      async queryOne(text, values) {
        queries.push({ text, values });
        return { id: documentId };
      },
    },
  });

  const access = await service.getDocumentRoomAccess(
    { userId },
    { documentId, workspaceId },
  );

  assert.deepEqual(access, { readOnly: false });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /JOIN workspace_members wm/);
  assert.match(queries[0].text, /item\.item_type = 'document'/);
  assert.match(queries[0].text, /item\.deleted_at IS NULL/);
  assert.deepEqual(queries[0].values, [workspaceId, documentId, userId]);
});

test("rejects a non-member or deleted document room without granting access", async () => {
  const service = createDocumentAccessService({
    database: {
      async queryOne() {
        return null;
      },
    },
  });

  const access = await service.getDocumentRoomAccess(
    { userId },
    { documentId, workspaceId },
  );

  assert.equal(access, null);
});

test("rejects missing room identity without querying the database", async () => {
  let queryCount = 0;
  const service = createDocumentAccessService({
    database: {
      async queryOne() {
        queryCount += 1;
        return { id: documentId };
      },
    },
  });

  const access = await service.getDocumentRoomAccess(
    { userId: "" },
    { documentId, workspaceId },
  );

  assert.equal(access, null);
  assert.equal(queryCount, 0);
});
