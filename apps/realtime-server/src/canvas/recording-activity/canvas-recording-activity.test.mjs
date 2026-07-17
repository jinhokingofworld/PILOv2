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
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  return { ok: true };
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

  assert.equal(requests.length, 1, "text burst inside the idle window must be one handoff");
  assert.equal(requests[0].activities.length, 1);
  assert.deepEqual(requests[0].activities[0].changedFields, ["text"]);
  assert.equal(requests[0].activities[0].textPreview, "final");
  assert.equal(requests[0].activities[0].receiveSeq, 2);
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
