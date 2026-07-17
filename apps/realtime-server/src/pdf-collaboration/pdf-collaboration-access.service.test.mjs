import assert from "node:assert/strict";
import test from "node:test";

import { createPdfCollaborationAccessService } from "./pdf-collaboration-access.service.ts";

const workspaceId = "00000000-0000-0000-0000-000000000001";
const fileId = "00000000-0000-0000-0000-000000000002";
const userId = "00000000-0000-0000-0000-000000000003";

test("allows a Workspace member to join a ready PDF file room", async () => {
  const queries = [];
  const service = createPdfCollaborationAccessService({
    database: {
      async queryOne(text, values) {
        queries.push({ text, values });
        return { id: fileId };
      },
    },
  });

  const access = await service.getPdfCollaborationRoomAccess(
    { userId },
    { fileId, workspaceId },
  );

  assert.deepEqual(access, { readOnly: false });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /JOIN workspace_members wm/);
  assert.match(queries[0].text, /item\.item_type = 'file'/);
  assert.match(queries[0].text, /item\.mime_type = 'application\/pdf'/);
  assert.match(queries[0].text, /item\.upload_status = 'ready'/);
  assert.match(queries[0].text, /item\.deleted_at IS NULL/);
  assert.deepEqual(queries[0].values, [workspaceId, fileId, userId]);
});

test("rejects a missing user or an unavailable PDF room without querying", async () => {
  let queryCount = 0;
  const service = createPdfCollaborationAccessService({
    database: {
      async queryOne() {
        queryCount += 1;
        return null;
      },
    },
  });

  assert.equal(
    await service.getPdfCollaborationRoomAccess(
      { userId: "" },
      { fileId, workspaceId },
    ),
    null,
  );
  assert.equal(queryCount, 0);
  assert.equal(
    await service.getPdfCollaborationRoomAccess(
      { userId },
      { fileId: "", workspaceId },
    ),
    null,
  );
  assert.equal(queryCount, 0);
});
