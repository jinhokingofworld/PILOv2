import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocumentRealtimeServerUrl,
  createDocumentCollaborator,
  createDocumentRealtimeRoomName,
  createDocumentSnapshotSaveQueue,
  shouldUseDocumentSnapshotFallback
} from "./document-realtime.ts";

test("문서 realtime room 이름은 Workspace와 문서 식별자를 포함한다", () => {
  assert.equal(
    createDocumentRealtimeRoomName({
      workspaceId: "workspace-1",
      documentId: "document-1"
    }),
    "workspace:workspace-1:document:document-1:yjs"
  );
});

test("문서 realtime URL은 HTTP(S) origin을 WebSocket protocol과 documents 경로로 바꾼다", () => {
  assert.equal(
    buildDocumentRealtimeServerUrl("https://realtime.pilo.local"),
    "wss://realtime.pilo.local/sync/documents"
  );
  assert.equal(
    buildDocumentRealtimeServerUrl("wss://realtime.pilo.local"),
    "wss://realtime.pilo.local/sync/documents"
  );
});

test("문서 공동 편집자는 사용자 ID 기준의 안정적인 색상과 표시 이름을 갖는다", () => {
  assert.deepEqual(
    createDocumentCollaborator({
      displayName: "은재",
      userId: "user-123"
    }),
    {
      color: "#0f766e",
      name: "은재"
    }
  );
  assert.equal(
    createDocumentCollaborator({
      displayName: "",
      userId: "user-123"
    }).name,
    "알 수 없는 사용자"
  );
});

test("문서 snapshot 저장은 1초 debounce 후 실행하고 flush는 대기 변경을 즉시 저장한다", async () => {
  const savedAt = [];
  const queue = createDocumentSnapshotSaveQueue({
    delayMs: 1000,
    save: async () => {
      savedAt.push(Date.now());
    }
  });

  queue.schedule();
  queue.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(savedAt.length, 0);

  await queue.flush();
  assert.equal(savedAt.length, 1);

  queue.schedule();
  await queue.flush();
  assert.equal(savedAt.length, 2);

  queue.destroy();
});

test("문서 snapshot 저장이 실패하면 대기 변경을 보존해 재시도할 수 있다", async () => {
  let attempts = 0;
  const queue = createDocumentSnapshotSaveQueue({
    delayMs: 1000,
    save: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("network failed");
      }
    }
  });

  queue.schedule();
  await assert.rejects(() => queue.flush(), /network failed/);
  await queue.flush();

  assert.equal(attempts, 2);
  queue.destroy();
});

test("uses browser snapshot autosave only without a realtime transport", () => {
  assert.equal(shouldUseDocumentSnapshotFallback(true), false);
  assert.equal(shouldUseDocumentSnapshotFallback(false), true);
});
