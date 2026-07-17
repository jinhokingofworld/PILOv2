import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { createCanvasRecordingActivityService } = await import(
  "../../../dist/canvas/recording-activity/canvas-recording-activity.service.js"
);
const serviceSource = await readFile(
  new URL("./canvas-recording-activity.service.ts", import.meta.url),
  "utf8",
);

assert.match(serviceSource, /TEXT_BURST_IDLE_MS = 3_000/);
assert.match(serviceSource, /TEXT_BURST_MAX_MS = 30_000/);
assert.match(serviceSource, /existing\.lastCapturedAt/);
assert.match(serviceSource, /entry\.maxTimer = setTimeout/);
assert.match(serviceSource, /captureSessionId = randomUUID\(\)/);

const room = { canvasId: "canvas-1", workspaceId: "workspace-1" };
const shape = (text) => ({
  id: "shape-1",
  props: { text },
  type: "note",
});

function databaseWith(recordings) {
  return {
    async query() {
      return recordings;
    },
  };
}

const originalFetch = globalThis.fetch;
const requests = [];
const fetchOutcomes = [];
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  return { ok: fetchOutcomes.length ? fetchOutcomes.shift() : true };
};

try {
  const ambiguous = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-1" }, { recordingId: "recording-2" }]),
    token: "test-token",
  });
  ambiguous.capture(room, "actor-1", {
    after: shape("decision"),
    before: null,
    operationType: "create",
    receiveSeq: 1,
    shapeId: "shape-1",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 0, "ambiguous active recordings must be ignored");
  await ambiguous.close();

  const noCanvasAtRecordingStart = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-late-join" }]),
    token: "test-token",
  });
  const lateJoinStart = requests.length;
  noCanvasAtRecordingStart.capture(room, "actor-late", {
    after: shape("joined after recording start"),
    before: null,
    operationType: "create",
    receiveSeq: 1,
    shapeId: "shape-late-join",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await noCanvasAtRecordingStart.flushRoom(room);
  assert.equal(requests.length - lateJoinStart, 1, "a participant joining Canvas after recording start must be captured");
  assert.equal(requests[lateJoinStart].activities[0].recordingId, "recording-late-join");
  await noCanvasAtRecordingStart.close();

  let recordingsAfterStart = [];
  const cachedMiss = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: {
      async query() {
        return recordingsAfterStart;
      },
    },
    token: "test-token",
  });
  const invalidationStart = requests.length;
  cachedMiss.capture(room, "actor-cache", {
    after: shape("before recording"),
    before: null,
    operationType: "create",
    receiveSeq: 1,
    shapeId: "shape-cache",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  recordingsAfterStart = [{ recordingId: "recording-after-cache-miss" }];
  cachedMiss.invalidateWorkspace(room.workspaceId);
  cachedMiss.capture(room, "actor-cache", {
    after: shape("after recording start"),
    before: null,
    operationType: "create",
    receiveSeq: 2,
    shapeId: "shape-cache",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await cachedMiss.flushRoom(room);
  assert.equal(requests.length - invalidationStart, 1, "recording_started invalidation must clear a cached miss");
  assert.equal(requests[invalidationStart].activities[0].recordingId, "recording-after-cache-miss");
  await cachedMiss.close();

  const restartStart = requests.length;
  const firstInstance = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-restart" }]),
    token: "test-token",
  });
  const secondInstance = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-restart" }]),
    token: "test-token",
  });
  for (const instance of [firstInstance, secondInstance]) {
    instance.capture(room, "actor-restart", {
      after: shape("receive sequence restarted"),
      before: null,
      operationType: "create",
      receiveSeq: 1,
      shapeId: "shape-restart",
    });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.all([firstInstance.flushRoom(room), secondInstance.flushRoom(room)]);
  const restartCaptureIds = requests
    .slice(restartStart)
    .map(request => request.activities[0].captureId);
  assert.equal(restartCaptureIds.length, 2);
  assert.notEqual(restartCaptureIds[0], restartCaptureIds[1], "service restart must create a new capture namespace");
  await Promise.all([firstInstance.close(), secondInstance.close()]);

  const retryStart = requests.length;
  fetchOutcomes.push(false, true);
  const retryService = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-retry" }]),
    token: "test-token",
  });
  retryService.capture(room, "actor-retry", {
    after: shape("retry me"),
    before: null,
    operationType: "create",
    receiveSeq: 1,
    shapeId: "shape-retry",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await retryService.flushRoom(room);
  for (let attempt = 0; attempt < 15 && requests.length < retryStart + 2; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const retryRequests = requests.slice(retryStart);
  assert.equal(retryRequests.length, 2, "a failed handoff must retry");
  assert.equal(
    retryRequests[0].activities[0].captureId,
    retryRequests[1].activities[0].captureId,
    "the same buffered entry must keep its captureId across HTTP retries",
  );
  await retryService.close();

  const textBurstStart = requests.length;
  const service = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-1" }]),
    token: "test-token",
  });
  service.capture(room, "actor-1", {
    after: shape("first"),
    before: shape("old"),
    operationType: "update",
    receiveSeq: 2,
    shapeId: "shape-1",
  });
  service.capture(room, "actor-1", {
    after: shape("final"),
    before: shape("first"),
    operationType: "update",
    receiveSeq: 3,
    shapeId: "shape-1",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await service.flushRoom(room);

  assert.equal(requests.length - textBurstStart, 1, "text burst inside the idle window must be one handoff");
  assert.equal(requests[textBurstStart].activities.length, 1);
  assert.deepEqual(requests[textBurstStart].activities[0].changedFields, ["text"]);
  assert.equal(requests[textBurstStart].activities[0].textPreview, "final");
  assert.equal(requests[textBurstStart].activities[0].receiveSeq, 2);
  await service.close();

  const RealDate = globalThis.Date;
  let fakeNow = RealDate.parse("2026-07-17T10:00:00.000Z");
  class FakeDate extends RealDate {
    constructor(value) {
      super(value === undefined ? fakeNow : value);
    }

    static now() {
      return fakeNow;
    }
  }
  globalThis.Date = FakeDate;
  try {
    const idleStart = requests.length;
    const idleService = createCanvasRecordingActivityService({
      appServerUrl: "http://app-server",
      database: databaseWith([{ recordingId: "recording-1" }]),
      token: "test-token",
    });
    idleService.capture(room, "actor-1", {
      after: shape("idle-first"),
      before: shape("idle-old"),
      operationType: "update",
      receiveSeq: 10,
      shapeId: "shape-1",
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    fakeNow += 4_000;
    idleService.capture(room, "actor-1", {
      after: shape("idle-second"),
      before: shape("idle-first"),
      operationType: "update",
      receiveSeq: 11,
      shapeId: "shape-1",
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    await idleService.flushRoom(room);
    assert.equal(requests.length - idleStart, 2, "a gap over 3 seconds must start a new burst");
    await idleService.close();

    fakeNow = RealDate.parse("2026-07-17T11:00:00.000Z");
    const maxStart = requests.length;
    const maxService = createCanvasRecordingActivityService({
      appServerUrl: "http://app-server",
      database: databaseWith([{ recordingId: "recording-1" }]),
      token: "test-token",
    });
    let beforeText = "max-old";
    for (let index = 0; index <= 15; index += 1) {
      const afterText = `max-${index}`;
      maxService.capture(room, "actor-1", {
        after: shape(afterText),
        before: shape(beforeText),
        operationType: "update",
        receiveSeq: 20 + index,
        shapeId: "shape-1",
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      beforeText = afterText;
      fakeNow += 2_000;
    }
    await maxService.flushRoom(room);
    assert.equal(requests.length - maxStart, 2, "continuous editing must split at 30 seconds");
    await maxService.close();
  } finally {
    globalThis.Date = RealDate;
  }

  const geometryStart = requests.length;
  const geometryOnly = createCanvasRecordingActivityService({
    appServerUrl: "http://app-server",
    database: databaseWith([{ recordingId: "recording-1" }]),
    token: "test-token",
  });
  geometryOnly.capture(room, "actor-1", {
    after: { ...shape("same"), x: 100 },
    before: { ...shape("same"), x: 50 },
    operationType: "update",
    receiveSeq: 4,
    shapeId: "shape-1",
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await geometryOnly.close();
  assert.equal(requests.length, geometryStart, "geometry-only updates must be ignored");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Realtime Canvas recording activity regression tests passed.");
