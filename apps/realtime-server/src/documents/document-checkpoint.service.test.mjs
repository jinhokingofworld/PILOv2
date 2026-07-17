import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const Y = createRequire(import.meta.url)("yjs");

import {
  DocumentCheckpointError,
  createDocumentCheckpointService,
} from "../../dist/documents/document-checkpoint.service.js";

const workspaceId = "00000000-0000-0000-0000-000000000001";
const documentId = "00000000-0000-0000-0000-000000000002";
const room = { documentId, workspaceId };

function toBase64(update) {
  return Buffer.from(update).toString("base64");
}

function createDocumentWithText(text) {
  const document = new Y.Doc();
  document.getText("checkpoint-test").insert(0, text);
  return document;
}

function readCheckpointText(yjsState) {
  const document = new Y.Doc();
  Y.applyUpdate(document, Buffer.from(yjsState, "base64"));
  return document.getText("checkpoint-test").toString();
}

function bootstrap(document, currentVersion) {
  return {
    document: { currentVersion },
    snapshot: { yjsState: toBase64(Y.encodeStateAsUpdate(document)) },
  };
}

test("stores one room checkpoint with the version loaded from App Server", async () => {
  const saved = [];
  const service = createDocumentCheckpointService({
    client: {
      async getDocument() {
        return bootstrap(createDocumentWithText("initial"), 4);
      },
      async saveDocumentSnapshot(input) {
        saved.push(input);
        return { document: { currentVersion: 5 } };
      },
    },
  });
  const document = createDocumentWithText("edited");

  const initialUpdate = await service.loadDocument({
    accessToken: "session-token",
    room,
  });
  assert.equal(readCheckpointText(toBase64(initialUpdate)), "initial");

  await service.storeDocument({
    accessToken: "session-token",
    document,
    room,
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].accessToken, "session-token");
  assert.equal(saved[0].expectedVersion, 4);
  assert.equal(readCheckpointText(saved[0].yjsState), "edited");
  assert.deepEqual(saved[0].contentJson.type, "doc");
});

test("merges the latest snapshot and retries exactly once after a checkpoint 409", async () => {
  const saved = [];
  const latestDocument = createDocumentWithText("remote");
  let getCalls = 0;
  const service = createDocumentCheckpointService({
    client: {
      async getDocument() {
        getCalls += 1;
        return bootstrap(latestDocument, getCalls === 1 ? 1 : 2);
      },
      async saveDocumentSnapshot(input) {
        saved.push(input);
        if (saved.length === 1) {
          throw new DocumentCheckpointError(409, "Document version is outdated");
        }
        return { document: { currentVersion: 3 } };
      },
    },
  });
  const document = createDocumentWithText("local");
  const transactionOrigins = [];
  document.on("afterTransaction", (transaction) => {
    transactionOrigins.push(transaction.origin);
  });

  await service.loadDocument({ accessToken: "session-token", room });
  await service.storeDocument({ accessToken: "session-token", document, room });

  assert.equal(getCalls, 2);
  assert.deepEqual(
    saved.map(({ expectedVersion }) => expectedVersion),
    [1, 2],
  );
  assert.match(readCheckpointText(saved[1].yjsState), /local/);
  assert.match(readCheckpointText(saved[1].yjsState), /remote/);
  assert.deepEqual(
    transactionOrigins.at(-1),
    { skipStoreHooks: true, source: "local" },
  );
});

test("does not retry a second 409 checkpoint conflict", async () => {
  let saveCalls = 0;
  const service = createDocumentCheckpointService({
    client: {
      async getDocument() {
        return bootstrap(createDocumentWithText("remote"), 2);
      },
      async saveDocumentSnapshot() {
        saveCalls += 1;
        throw new DocumentCheckpointError(409, "Document version is outdated");
      },
    },
  });
  const document = createDocumentWithText("local");

  await service.loadDocument({ accessToken: "session-token", room });
  await assert.rejects(
    () => service.storeDocument({ accessToken: "session-token", document, room }),
    /Document version is outdated/,
  );

  assert.equal(saveCalls, 2);
});
