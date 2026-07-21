import assert from "node:assert/strict";
import test from "node:test";

import checkpointModule from "../../dist/canvas/checkpoint/canvas-room-checkpoint.service.js";
import roomModule from "../../dist/canvas/room/canvas-room.service.js";
import roomStateModule from "../../dist/canvas/state/canvas-room-state.service.js";

const { createCanvasRoomCheckpointService } = checkpointModule;
const { createCanvasRoomService } = roomModule;
const { createCanvasRoomStateService } = roomStateModule;

const room = {
  canvasId: "canvas-checkpoint-test",
  workspaceId: "workspace-checkpoint-test",
};

function createNote(text, shapeId = "shape:checkpoint-note") {
  return {
    id: shapeId,
    parentId: "page:page",
    props: {
      h: 120,
      richText: {
        content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
        type: "doc",
      },
      w: 240,
    },
    rotation: 0,
    type: "note",
    x: 100,
    y: 100,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, timeoutMs = 1_000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for checkpoint condition");
    }
    await wait(5);
  }
}

function createSuccessfulCheckpointResponse(operations) {
  return new Response(
    JSON.stringify({
      data: {
        shapes: operations
          .filter((operation) => operation.type !== "delete")
          .map((operation, index) => ({
            contentHash: `hash-${operation.shapeId}`,
            id: operation.shapeId,
            revision: index + 1,
          })),
      },
      success: true,
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  );
}

test("checkpoint 실행 중 발생한 최신 변경은 이전 성공 응답이 dirty에서 제거하지 않는다", () => {
  const service = createCanvasRoomStateService();

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("first")],
  });
  const firstCheckpoint = service.getCheckpointSnapshot(room);

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("latest")],
  });
  const secondCheckpoint = service.getCheckpointSnapshot(room);

  assert.notEqual(
    firstCheckpoint.operations[0]?.clientOperationId,
    secondCheckpoint.operations[0]?.clientOperationId,
  );

  service.markCheckpointSucceeded(
    room,
    firstCheckpoint.operations,
    {
      data: {
        shapes: [
          {
            contentHash: "persisted-first",
            id: "shape:checkpoint-note",
            revision: 1,
          },
        ],
      },
      success: true,
    },
    { advanceCheckpoint: true },
  );

  assert.deepEqual(service.getDirtyShapeIds(room), ["shape:checkpoint-note"]);
  assert.equal(service.getCheckpointState(room).checkpointVersion, 0);

  const latestCheckpoint = service.getCheckpointSnapshot(room);

  assert.equal(latestCheckpoint.operations[0]?.type, "update");
  service.markCheckpointSucceeded(
    room,
    latestCheckpoint.operations,
    {
      data: {
        shapes: [
          {
            contentHash: "persisted-latest",
            id: "shape:checkpoint-note",
            revision: 2,
          },
        ],
      },
      success: true,
    },
    { advanceCheckpoint: true },
  );

  assert.deepEqual(service.getDirtyShapeIds(room), []);
  assert.equal(service.getCheckpointState(room).checkpointVersion, 1);
});

test("already missing delete checkpoint keeps a recent persisted tombstone", async () => {
  const originalFetch = globalThis.fetch;
  const checkpointStatuses = [];
  const service = createCanvasRoomStateService();
  const shape = {
    ...createNote("deleted"),
    revision: 1,
  };

  service.recordLoadedViewport(
    room,
    { height: 600, margin: 200, width: 800, x: 0, y: 0 },
    [shape],
  );
  service.applyShapePatch(room, {
    deletedShapeIds: [shape.id],
    upsertShapes: [],
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Canvas shape not found",
        },
        success: false,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 404,
      },
    );

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      onCheckpointStatus(status) {
        checkpointStatuses.push(status);
      },
      roomStateService: service,
    });

    await checkpointService.flushCheckpointNow(
      room,
      "test-token",
      "test-user",
    );

    assert.deepEqual(service.getDirtyShapeIds(room), []);
    assert.deepEqual(service.getDeletedTombstones(room), [shape.id]);
    assert.equal(checkpointStatuses.at(-1)?.status, "saved");
    assert.equal(checkpointStatuses.at(-1)?.pendingOperations, 0);

    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkpoint는 shape 부모 ID의 접두사를 그대로 보존한다", () => {
  const nestedRoom = { ...room, canvasId: "canvas-parent-checkpoint-test" };
  const service = createCanvasRoomStateService();
  const parent = {
    ...createNote("parent", "shape:parent"),
    props: { h: 300, w: 400 },
    type: "frame",
  };
  const child = {
    ...createNote("child", "shape:child"),
    parentId: parent.id,
  };

  service.applyShapePatch(nestedRoom, {
    deletedShapeIds: [],
    upsertShapes: [parent, child],
  });
  const checkpoint = service.getCheckpointSnapshot(nestedRoom);
  const childOperation = checkpoint.operations.find(
    (operation) => operation.shapeId === child.id,
  );
  const parentOperation = checkpoint.operations.find(
    (operation) => operation.shapeId === parent.id,
  );

  assert.equal(childOperation?.payload?.parentShapeId, "shape:parent");
  assert.equal(parentOperation?.payload?.parentShapeId, null);
});

test("DB viewport hydrate는 같은 ID의 최신 roomState를 덮어쓰지 않는다", () => {
  const hydrationRoom = { ...room, canvasId: "canvas-hydration-merge-test" };
  const service = createCanvasRoomStateService();
  const bounds = { height: 600, margin: 200, width: 800, x: 0, y: 0 };
  const persistedShape = {
    ...createNote("persisted"),
    contentHash: "persisted-hash",
    revision: 1,
  };
  const roomShape = {
    ...createNote("room-latest"),
    contentHash: "persisted-hash",
    revision: 1,
  };

  service.recordLoadedViewport(hydrationRoom, bounds, [persistedShape]);
  service.applyShapePatch(hydrationRoom, {
    deletedShapeIds: [],
    upsertShapes: [roomShape],
  });
  const hydration = service.recordLoadedViewport(hydrationRoom, bounds, [
    persistedShape,
    createNote("db-only", "shape:db-only"),
  ]);

  const hydratedById = new Map(hydration.shapes.map((shape) => [shape.id, shape]));

  assert.equal(
    hydratedById.get("shape:checkpoint-note")?.props.richText.content[0].content[0].text,
    "room-latest",
  );
  assert.equal(
    hydratedById.get("shape:db-only")?.props.richText.content[0].content[0].text,
    "db-only",
  );
  assert.deepEqual(service.getDirtyShapeIds(hydrationRoom), [
    "shape:checkpoint-note",
  ]);
});

test("delete checkpoint 이후 recent tombstone이 늦은 DB 응답의 부활을 막는다", () => {
  const tombstoneRoom = { ...room, canvasId: "canvas-tombstone-merge-test" };
  const service = createCanvasRoomStateService();
  const bounds = { height: 600, margin: 200, width: 800, x: 0, y: 0 };
  const persistedShape = {
    ...createNote("deleted"),
    revision: 1,
  };

  service.recordLoadedViewport(tombstoneRoom, bounds, [persistedShape]);
  service.applyShapePatch(tombstoneRoom, {
    deletedShapeIds: [persistedShape.id],
    upsertShapes: [],
  });
  const checkpoint = service.getCheckpointSnapshot(tombstoneRoom);

  service.markCheckpointSucceeded(
    tombstoneRoom,
    checkpoint.operations,
    { data: { shapes: [] }, success: true },
    { advanceCheckpoint: true },
  );
  const hydration = service.recordLoadedViewport(tombstoneRoom, bounds, [
    persistedShape,
  ]);

  assert.deepEqual(hydration.shapes, []);
  assert.deepEqual(hydration.deletedShapeIds, [persistedShape.id]);
  assert.deepEqual(service.getDirtyShapeIds(tombstoneRoom), []);
});

test("같은 ID를 다시 생성하면 recent tombstone을 즉시 해제한다", () => {
  const recreateRoom = { ...room, canvasId: "canvas-recreate-test" };
  const service = createCanvasRoomStateService();
  const bounds = { height: 600, margin: 200, width: 800, x: 0, y: 0 };
  const originalShape = {
    ...createNote("original"),
    revision: 1,
  };

  service.recordLoadedViewport(recreateRoom, bounds, [originalShape]);
  service.applyShapePatch(recreateRoom, {
    deletedShapeIds: [originalShape.id],
    upsertShapes: [],
  });
  const deleteCheckpoint = service.getCheckpointSnapshot(recreateRoom);
  service.markCheckpointSucceeded(
    recreateRoom,
    deleteCheckpoint.operations,
    { data: { shapes: [] }, success: true },
    { advanceCheckpoint: true },
  );
  service.applyShapePatch(recreateRoom, {
    deletedShapeIds: [],
    upsertShapes: [createNote("recreated")],
  });

  assert.deepEqual(service.getDeletedTombstones(recreateRoom), []);
  assert.equal(
    service.getViewportHydration(recreateRoom, bounds).shapes[0]?.props.richText
      .content[0].content[0].text,
    "recreated",
  );
});

test("viewport hydration은 보이는 room-only Shape와 중첩 자식을 함께 포함한다", () => {
  const nestedRoom = { ...room, canvasId: "canvas-nested-hydration-test" };
  const service = createCanvasRoomStateService();
  const bounds = { height: 600, margin: 0, width: 800, x: 0, y: 0 };
  const parent = {
    ...createNote("parent", "shape:parent"),
    props: { h: 300, w: 400 },
    type: "frame",
  };
  const child = {
    ...createNote("child", "shape:child"),
    parentId: "shape:parent",
    x: 1_500,
    y: 1_500,
  };
  const grandchild = {
    ...createNote("grandchild", "shape:grandchild"),
    parentId: "shape:child",
    x: 2_000,
    y: 2_000,
  };

  service.applyShapePatch(nestedRoom, {
    deletedShapeIds: [],
    upsertShapes: [parent, child, grandchild],
  });
  const hydration = service.getViewportHydration(nestedRoom, bounds);

  assert.deepEqual(
    new Set(hydration.shapes.map((shape) => shape.id)),
    new Set(["shape:parent", "shape:child", "shape:grandchild"]),
  );
});

test("viewport hydration은 중첩 Shape의 로컬 좌표를 Canvas 좌표로 판정하지 않는다", () => {
  const nestedRoom = { ...room, canvasId: "canvas-far-parent-hydration-test" };
  const service = createCanvasRoomStateService();
  const bounds = { height: 600, margin: 0, width: 800, x: 0, y: 0 };
  const parent = {
    ...createNote("far-parent", "shape:far-parent"),
    props: { h: 300, w: 400 },
    type: "frame",
    x: 20_000,
    y: 20_000,
  };
  const child = {
    ...createNote("local-child", "shape:local-child"),
    parentId: parent.id,
    x: 100,
    y: 100,
  };

  service.applyShapePatch(nestedRoom, {
    deletedShapeIds: [],
    upsertShapes: [parent, child],
  });

  assert.deepEqual(
    service.getViewportHydration(nestedRoom, bounds).shapes,
    [],
  );
  assert.deepEqual(
    new Set(
      service
        .getViewportHydration(nestedRoom, bounds, {
          includeShapeIds: [child.id],
        })
        .shapes.map((shape) => shape.id),
    ),
    new Set([parent.id, child.id]),
  );
});

test("Canvas 입장은 access 직후 DB baseline을 조회하고 최신 roomState로 병합한다", async () => {
  const originalFetch = globalThis.fetch;
  const joinRoom = { ...room, canvasId: "canvas-join-hydration-test" };
  const service = createCanvasRoomStateService();
  const lifecycle = [];
  const persistedShape = {
    ...createNote("persisted"),
    revision: 1,
  };
  const latestRoomShape = {
    ...createNote("room-latest"),
    revision: 1,
  };

  service.applyShapePatch(joinRoom, {
    deletedShapeIds: [],
    upsertShapes: [latestRoomShape],
  });
  globalThis.fetch = async () => {
    lifecycle.push("db-baseline");
    return new Response(JSON.stringify({ data: [persistedShape], success: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const roomService = createCanvasRoomService({
      accessService: {
        async getCanvasRoomAccess() {
          lifecycle.push("access");
          return {
            boardType: "freeform",
            readOnly: false,
          };
        },
      },
      appServerUrl: "https://app-server.test",
      presenceService: { getPresence: () => [] },
      roomStateService: service,
      shapeLockService: { getRoomLocks: async () => [] },
      shapePreviewService: { getRoomPreviews: async () => [] },
    });
    const result = await roomService.joinCanvasRoom(
      { token: "test-token", userId: "test-user" },
      {
        ...joinRoom,
        initialViewportBounds: {
          height: 600,
          margin: 200,
          width: 800,
          x: 0,
          y: 0,
        },
      },
      {
        onAccessGranted() {
          lifecycle.push("access-granted");
        },
      },
    );

    assert.deepEqual(lifecycle, ["access", "access-granted", "db-baseline"]);
    assert.equal(result.joined, true);
    assert.equal(
      result.payload.roomShapes[0]?.props.richText.content[0].content[0].text,
      "room-latest",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revoked user checkpoint authorization is discarded without dropping dirty operations", async () => {
  const originalFetch = globalThis.fetch;
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("pending")],
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("revoked authorization must not reach the App Server");
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      roomStateService: service,
    });

    checkpointService.scheduleCheckpoint(
      room,
      "revoked-token",
      "revoked-user",
    );
    checkpointService.revokeRoomAuthorization(room, "revoked-user");
    await checkpointService.flushCheckpointNow(room);

    assert.equal(fetchCalls, 0);
    assert.deepEqual(service.getDirtyShapeIds(room), ["shape:checkpoint-note"]);

    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("한 사용자 권한이 철회돼도 room의 다른 참여자 권한으로 checkpoint한다", async () => {
  const originalFetch = globalThis.fetch;
  const service = createCanvasRoomStateService();
  let authorizationHeader = null;

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("authorized participant")],
  });
  globalThis.fetch = async (_url, init) => {
    authorizationHeader = new Headers(init.headers).get("authorization");
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      roomStateService: service,
    });

    checkpointService.registerRoomParticipant(
      room,
      "socket-a",
      "token-a",
      "user-a",
    );
    checkpointService.registerRoomParticipant(
      room,
      "socket-b",
      "token-b",
      "user-b",
    );
    checkpointService.revokeRoomAuthorization(room, "user-b");
    await checkpointService.flushCheckpointNow(room);

    assert.equal(authorizationHeader, "Bearer token-a");
    assert.deepEqual(service.getDirtyShapeIds(room), []);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("같은 Shape의 반복 변경은 dirty ID와 payload를 최신 상태 하나로 유지한다", () => {
  const service = createCanvasRoomStateService();

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("x".repeat(10_000))],
  });
  const largeDirtyState = service.getDirtyState(room);

  for (let index = 0; index < 100; index += 1) {
    service.applyShapePatch(room, {
      deletedShapeIds: [],
      upsertShapes: [createNote(`latest-${index}`)],
    });
  }

  const latestDirtyState = service.getDirtyState(room);

  assert.equal(latestDirtyState.shapeCount, 1);
  assert.ok(latestDirtyState.payloadBytes < largeDirtyState.payloadBytes);
});

test("350개 dirty Shape는 100개 단위로 중단 없이 drain한다", async () => {
  const originalFetch = globalThis.fetch;
  const service = createCanvasRoomStateService();
  const batchSizes = [];
  const checkpointStatuses = [];
  const shapes = Array.from({ length: 350 }, (_, index) =>
    createNote(`note-${index}`, `shape:note-${index}`),
  );

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: shapes,
  });
  globalThis.fetch = async (_url, init) => {
    const operations = JSON.parse(init.body).operations;

    batchSizes.push(operations.length);
    return createSuccessfulCheckpointResponse(operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      onCheckpointStatus(status) {
        checkpointStatuses.push(status.status);
      },
      roomStateService: service,
    });

    await checkpointService.flushCheckpointNow(
      room,
      "test-token",
      "test-user",
    );

    assert.deepEqual(batchSizes, [100, 100, 100, 50]);
    assert.deepEqual(service.getDirtyShapeIds(room), []);
    assert.deepEqual(checkpointStatuses, ["saving", "saved"]);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("idle과 hard-age 타이머가 각각 checkpoint를 실행한다", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const idleState = createCanvasRoomStateService();
    const idleCheckpoint = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      idleCheckpointMs: 20,
      maxDirtyAgeMs: 500,
      roomStateService: idleState,
    });

    idleState.applyShapePatch(room, {
      deletedShapeIds: [],
      upsertShapes: [createNote("idle")],
    });
    idleCheckpoint.scheduleCheckpoint(room, "test-token", "test-user");
    await waitUntil(() => fetchCalls === 1);
    await idleCheckpoint.close();

    const hardAgeRoom = { ...room, canvasId: "canvas-hard-age-test" };
    const hardAgeState = createCanvasRoomStateService();
    const hardAgeCheckpoint = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      idleCheckpointMs: 500,
      maxDirtyAgeMs: 30,
      roomStateService: hardAgeState,
    });

    hardAgeState.applyShapePatch(hardAgeRoom, {
      deletedShapeIds: [],
      upsertShapes: [createNote("first")],
    });
    hardAgeCheckpoint.scheduleCheckpoint(
      hardAgeRoom,
      "test-token",
      "test-user",
    );
    await wait(10);
    hardAgeState.applyShapePatch(hardAgeRoom, {
      deletedShapeIds: [],
      upsertShapes: [createNote("latest")],
    });
    hardAgeCheckpoint.scheduleCheckpoint(
      hardAgeRoom,
      "test-token",
      "test-user",
    );

    await waitUntil(() => fetchCalls === 2);
    await hardAgeCheckpoint.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dirty payload 1MB 도달 시 idle을 기다리지 않고 checkpoint한다", async () => {
  const originalFetch = globalThis.fetch;
  const payloadRoom = { ...room, canvasId: "canvas-payload-test" };
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      idleCheckpointMs: 5_000,
      maxDirtyAgeMs: 5_000,
      roomStateService: service,
    });

    service.applyShapePatch(payloadRoom, {
      deletedShapeIds: [],
      upsertShapes: [createNote("x".repeat(1024 * 1024), "shape:large")],
    });
    checkpointService.scheduleCheckpoint(
      payloadRoom,
      "test-token",
      "test-user",
    );

    await waitUntil(() => fetchCalls === 1);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("실패한 checkpoint는 backoff 후 dirty Shape를 재시도한다", async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [];
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("retry")],
  });
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({ success: false }), {
        headers: { "content-type": "application/json" },
        status: 500,
      });
    }
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      onCheckpointStatus(status) {
        statuses.push(status.status);
      },
      retryDelaysMs: [10],
      roomStateService: service,
    });

    await checkpointService.flushCheckpointNow(
      room,
      "test-token",
      "test-user",
    );
    assert.deepEqual(service.getDirtyShapeIds(room), ["shape:checkpoint-note"]);

    await waitUntil(() => fetchCalls === 2);
    await waitUntil(() => service.getDirtyShapeIds(room).length === 0);
    assert.deepEqual(statuses, ["saving", "delayed", "saving", "saved"]);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("분리 가능한 일부 실패는 정상 Shape를 저장하고 실패 Shape만 dirty로 남긴다", async () => {
  const originalFetch = globalThis.fetch;
  const partialRoom = { ...room, canvasId: "canvas-partial-failure-test" };
  const service = createCanvasRoomStateService();
  let allowBadShape = false;

  service.applyShapePatch(partialRoom, {
    deletedShapeIds: [],
    upsertShapes: [
      createNote("good-a", "shape:good-a"),
      createNote("bad", "shape:bad"),
      createNote("good-b", "shape:good-b"),
    ],
  });
  globalThis.fetch = async (_url, init) => {
    const operations = JSON.parse(init.body).operations;
    const containsBadShape = operations.some(
      (operation) => operation.shapeId === "shape:bad",
    );

    if (containsBadShape && !allowBadShape) {
      return new Response(JSON.stringify({ success: false }), {
        headers: { "content-type": "application/json" },
        status: 422,
      });
    }
    return createSuccessfulCheckpointResponse(operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      retryDelaysMs: [1_000],
      roomStateService: service,
    });

    await checkpointService.flushCheckpointNow(
      partialRoom,
      "test-token",
      "test-user",
    );
    assert.deepEqual(service.getDirtyShapeIds(partialRoom), ["shape:bad"]);

    allowBadShape = true;
    await checkpointService.flushCheckpointNow(partialRoom);
    assert.deepEqual(service.getDirtyShapeIds(partialRoom), []);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("마지막 사용자 퇴장만 유예 후 drain하고 비어 있는 roomState를 정리한다", async () => {
  const originalFetch = globalThis.fetch;
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      emptyRoomGraceMs: 20,
      idleCheckpointMs: 500,
      maxDirtyAgeMs: 1_000,
      roomStateService: service,
    });

    checkpointService.registerRoomParticipant(
      room,
      "socket-a",
      "test-token",
      "test-user-a",
    );
    checkpointService.registerRoomParticipant(
      room,
      "socket-b",
      "test-token",
      "test-user-b",
    );
    service.applyShapePatch(room, {
      deletedShapeIds: [],
      upsertShapes: [createNote("empty room")],
    });
    checkpointService.scheduleCheckpoint(room, "test-token", "test-user-a");

    checkpointService.unregisterRoomParticipant(room, "socket-b");
    await wait(30);
    assert.equal(fetchCalls, 0);

    checkpointService.unregisterRoomParticipant(room, "socket-a");
    await waitUntil(() => fetchCalls === 1);
    await waitUntil(() => service.getStats().roomCount === 0);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("마지막 사용자 퇴장 유예 중 재입장하면 checkpoint와 room GC를 취소한다", async () => {
  const originalFetch = globalThis.fetch;
  const rejoinRoom = { ...room, canvasId: "canvas-rejoin-test" };
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      emptyRoomGraceMs: 30,
      idleCheckpointMs: 1_000,
      maxDirtyAgeMs: 1_000,
      roomStateService: service,
    });

    checkpointService.registerRoomParticipant(
      rejoinRoom,
      "socket-a",
      "test-token",
      "test-user",
    );
    service.applyShapePatch(rejoinRoom, {
      deletedShapeIds: [],
      upsertShapes: [createNote("rejoin")],
    });
    checkpointService.scheduleCheckpoint(
      rejoinRoom,
      "test-token",
      "test-user",
    );
    checkpointService.unregisterRoomParticipant(rejoinRoom, "socket-a");
    await wait(10);
    checkpointService.registerRoomParticipant(
      rejoinRoom,
      "socket-b",
      "test-token",
      "test-user",
    );
    await wait(40);

    assert.equal(fetchCalls, 0);
    assert.equal(service.getDirtyState(rejoinRoom).shapeCount, 1);
    assert.ok(service.getStats().roomCount > 0);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("서버 전체 checkpoint 동시 실행 수를 제한한다", async () => {
  const originalFetch = globalThis.fetch;
  const rooms = Array.from({ length: 3 }, (_, index) => ({
    canvasId: `canvas-concurrency-${index}`,
    workspaceId: room.workspaceId,
  }));
  const stateService = createCanvasRoomStateService();
  let activeRequests = 0;
  let maxActiveRequests = 0;

  globalThis.fetch = async (_url, init) => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await wait(20);
    activeRequests -= 1;
    return createSuccessfulCheckpointResponse(JSON.parse(init.body).operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      maxConcurrentRooms: 2,
      roomStateService: stateService,
    });

    rooms.forEach((targetRoom, roomIndex) => {
      stateService.applyShapePatch(targetRoom, {
        deletedShapeIds: [],
        upsertShapes: Array.from({ length: 100 }, (_, shapeIndex) =>
          createNote(
            `room-${roomIndex}-${shapeIndex}`,
            `shape:${roomIndex}-${shapeIndex}`,
          ),
        ),
      });
      checkpointService.scheduleCheckpoint(
        targetRoom,
        "test-token",
        `test-user-${roomIndex}`,
      );
    });

    await waitUntil(
      () => rooms.every((targetRoom) => !stateService.getDirtyState(targetRoom).shapeCount),
      2_000,
    );
    assert.equal(maxActiveRequests, 2);
    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("graceful shutdown은 남은 dirty Shape를 모두 drain한다", async () => {
  const originalFetch = globalThis.fetch;
  const shutdownRoom = { ...room, canvasId: "canvas-shutdown-test" };
  const service = createCanvasRoomStateService();
  const batchSizes = [];

  globalThis.fetch = async (_url, init) => {
    const operations = JSON.parse(init.body).operations;

    batchSizes.push(operations.length);
    return createSuccessfulCheckpointResponse(operations);
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      batchYieldMs: 0,
      roomStateService: service,
    });

    checkpointService.registerRoomParticipant(
      shutdownRoom,
      "socket-a",
      "test-token",
      "test-user",
    );
    service.applyShapePatch(shutdownRoom, {
      deletedShapeIds: [],
      upsertShapes: Array.from({ length: 250 }, (_, index) =>
        createNote(`shutdown-${index}`, `shape:shutdown-${index}`),
      ),
    });

    await checkpointService.close();
    assert.deepEqual(batchSizes, [100, 100, 50]);
    assert.equal(service.getDirtyState(shutdownRoom).shapeCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
