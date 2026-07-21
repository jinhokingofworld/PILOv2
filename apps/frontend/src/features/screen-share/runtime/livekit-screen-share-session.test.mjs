import assert from "node:assert/strict";
import test from "node:test";

import { RoomEvent, ScreenSharePresets, Track } from "livekit-client";

import {
  createPublisherSession,
  createViewerSession,
} from "./livekit-screen-share-session.ts";
import {
  publisherScreenShareRoomOptions,
  screenShareCaptureOptions,
  screenSharePublishOptions,
  viewerScreenShareRoomOptions,
} from "./screen-share-livekit-options.ts";

test("screen share capture preserves picker preferences at 1080p and 15 fps", () => {
  assert.deepEqual(screenShareCaptureOptions, {
    audio: false,
    contentHint: "detail",
    preferCurrentTab: true,
    resolution: { width: 1920, height: 1080, frameRate: 15 },
    selfBrowserSurface: "include",
  });
});

test("screen share publish uses the 1080p source and ordered simulcast layers", () => {
  assert.equal(
    screenSharePublishOptions.screenShareEncoding,
    ScreenSharePresets.h1080fps15.encoding,
  );
  assert.deepEqual(screenSharePublishOptions.screenShareSimulcastLayers, [
    ScreenSharePresets.h360fps3,
    ScreenSharePresets.h720fps5,
  ]);
});

test("screen share rooms use role-specific media optimization", () => {
  assert.deepEqual(publisherScreenShareRoomOptions, { dynacast: true });
  assert.deepEqual(viewerScreenShareRoomOptions, { adaptiveStream: true });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createLocalTrack(source = Track.Source.ScreenShare) {
  const listeners = new Map();
  return {
    source,
    stopped: 0,
    mediaStreamTrack: {
      addEventListener(event, listener) {
        listeners.set(event, listener);
      },
      removeEventListener(event, listener) {
        if (listeners.get(event) === listener) listeners.delete(event);
      },
    },
    emitEnded() {
      listeners.get("ended")?.();
    },
    stop() {
      this.stopped += 1;
    },
  };
}

function createRoomHarness({ connectError, publishError } = {}) {
  const handlers = new Map();
  const published = [];
  const unpublished = [];
  const room = {
    connectCalls: [],
    disconnectCalls: 0,
    localParticipant: {
      async publishTrack(track, options) {
        published.push([track, options]);
        if (publishError) throw publishError;
      },
      async unpublishTrack(track) {
        unpublished.push(track);
      },
    },
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    off(event, handler) {
      if (handlers.get(event) === handler) handlers.delete(event);
      return this;
    },
    async connect(url, token) {
      this.connectCalls.push([url, token]);
      if (connectError) throw connectError;
    },
    async disconnect() {
      this.disconnectCalls += 1;
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
  };
  return { handlers, published, room, unpublished };
}

function publisherStart() {
  return {
    id: "session-1",
    status: "starting",
    startedAt: null,
    sharer: {
      userId: "user-1",
      displayName: "Sharer",
      avatarUrl: null,
    },
    livekitUrl: "wss://livekit.example.com",
    livekitToken: "publisher-token",
    expiresAt: "2026-07-18T01:00:00.000Z",
  };
}

test("publisher captures video before reserving, connects, and publishes only screen share", async () => {
  const track = createLocalTrack();
  const capture = deferred();
  const order = [];
  const lifecycle = [];
  const { published, room } = createRoomHarness();
  const api = {
    async start() {
      order.push("start");
      return publisherStart();
    },
    async end() {
      return { sessionId: "session-1", ended: true };
    },
  };
  let captureOptions;
  const creating = createPublisherSession({
    workspaceId: "workspace-1",
    api,
    async createLocalScreenTracks(options) {
      captureOptions = options;
      order.push("capture");
      return capture.promise;
    },
    createRoom: () => room,
    onNativeStop() {},
    onReserving() {
      lifecycle.push("reserving");
    },
    onConnecting(sessionId) {
      lifecycle.push(`connecting:${sessionId}`);
    },
    onSharing(session) {
      lifecycle.push(`sharing:${session.sessionId}`);
    },
  });

  await Promise.resolve();
  assert.equal(captureOptions, screenShareCaptureOptions);
  assert.deepEqual(order, ["capture"]);
  capture.resolve([track]);
  const session = await creating;

  assert.deepEqual(order, ["capture", "start"]);
  assert.deepEqual(lifecycle, [
    "reserving",
    "connecting:session-1",
    "sharing:session-1",
  ]);
  assert.deepEqual(room.connectCalls, [
    ["wss://livekit.example.com", "publisher-token"],
  ]);
  assert.deepEqual(published, [[track, screenSharePublishOptions]]);
  assert.equal(session.sessionId, "session-1");
  await session.stop();
});

test("publisher picker cancellation makes no API request", async () => {
  let starts = 0;
  const pickerError = new Error("picker cancelled");

  await assert.rejects(
    () =>
      createPublisherSession({
        workspaceId: "workspace-1",
        api: {
          async start() {
            starts += 1;
          },
          async end() {},
        },
        async createLocalScreenTracks() {
          throw pickerError;
        },
        createRoom() {
          throw new Error("room should not be created");
        },
        onNativeStop() {},
      }),
    pickerError,
  );
  assert.equal(starts, 0);
});

for (const failure of ["api", "connect", "publish"]) {
  test(`publisher ${failure} failure stops every capture and cleans acquired resources`, async () => {
    const screenTrack = createLocalTrack();
    const extraTrack = createLocalTrack(Track.Source.Microphone);
    const expected = new Error(`${failure} failed`);
    const ended = [];
    const { room } = createRoomHarness({
      connectError: failure === "connect" ? expected : undefined,
      publishError: failure === "publish" ? expected : undefined,
    });

    await assert.rejects(
      () =>
        createPublisherSession({
          workspaceId: "workspace-1",
          api: {
            async start() {
              if (failure === "api") throw expected;
              return publisherStart();
            },
            async end(workspaceId, sessionId) {
              ended.push([workspaceId, sessionId]);
              return { sessionId, ended: true };
            },
          },
          async createLocalScreenTracks() {
            return [screenTrack, extraTrack];
          },
          createRoom: () => room,
          onNativeStop() {},
        }),
      expected,
    );

    assert.equal(screenTrack.stopped, 1);
    assert.equal(extraTrack.stopped, 1);
    assert.equal(room.disconnectCalls, failure === "api" ? 0 : 1);
    assert.deepEqual(
      ended,
      failure === "api" ? [] : [["workspace-1", "session-1"]],
    );
  });
}

test("publisher native track end cleans resources and then invokes the callback once", async () => {
  const track = createLocalTrack();
  const ended = [];
  const { room, unpublished } = createRoomHarness();
  let nativeStops = 0;
  const session = await createPublisherSession({
    workspaceId: "workspace-1",
    api: {
      async start() {
        return publisherStart();
      },
      async end(_workspaceId, sessionId) {
        ended.push(sessionId);
        return { sessionId, ended: true };
      },
    },
    async createLocalScreenTracks() {
      return [track];
    },
    createRoom: () => room,
    onNativeStop() {
      nativeStops += 1;
    },
  });

  track.emitEnded();
  track.emitEnded();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(track.stopped, 1);
  assert.deepEqual(unpublished, [track]);
  assert.equal(room.disconnectCalls, 1);
  assert.deepEqual(ended, ["session-1"]);
  assert.equal(nativeStops, 1);
  await session.stop();
  assert.equal(track.stopped, 1);
  assert.deepEqual(unpublished, [track]);
  assert.equal(room.disconnectCalls, 1);
  assert.deepEqual(ended, ["session-1"]);
  assert.equal(nativeStops, 1);
});

test("publisher exposes the session before an immediate native stop cleans up", async () => {
  const track = createLocalTrack();
  const ended = [];
  const { room } = createRoomHarness();
  let publishedSession;

  await createPublisherSession({
    workspaceId: "workspace-1",
    api: {
      async start() {
        return publisherStart();
      },
      async end(_workspaceId, sessionId) {
        ended.push(sessionId);
        return { sessionId, ended: true };
      },
    },
    async createLocalScreenTracks() {
      return [track];
    },
    createRoom: () => room,
    onNativeStop() {},
    onSharing(session) {
      publishedSession = session;
      track.emitEnded();
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publishedSession.sessionId, "session-1");
  assert.equal(track.stopped, 1);
  assert.deepEqual(ended, ["session-1"]);
});

test("viewer subscribes only to screen share, attaches one video, and fully cleans up", async () => {
  const { room } = createRoomHarness();
  const screenTrack = { source: Track.Source.ScreenShare };
  const cameraTrack = { source: Track.Source.Camera };
  const microphoneTrack = { source: Track.Source.Microphone };
  const element = { id: "video-1" };
  const attached = [];
  const detached = [];
  const session = await createViewerSession({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    api: {
      async createViewerToken() {
        return {
          livekitUrl: "wss://livekit.example.com",
          livekitToken: "viewer-token",
          expiresAt: "2026-07-18T01:00:00.000Z",
        };
      },
    },
    createRoom: () => room,
    mediaElements: {
      attach(track) {
        attached.push(track);
        return element;
      },
      detach(track, attachedElement) {
        detached.push([track, attachedElement]);
      },
    },
  });

  room.emit(RoomEvent.TrackSubscribed, microphoneTrack, {
    source: Track.Source.Microphone,
  });
  room.emit(RoomEvent.TrackSubscribed, cameraTrack, {
    source: Track.Source.Camera,
  });
  room.emit(RoomEvent.TrackSubscribed, screenTrack, {
    source: Track.Source.ScreenShare,
  });
  room.emit(RoomEvent.TrackSubscribed, { source: Track.Source.ScreenShare }, {
    source: Track.Source.ScreenShare,
  });

  assert.deepEqual(room.connectCalls, [
    ["wss://livekit.example.com", "viewer-token"],
  ]);
  assert.deepEqual(attached, [screenTrack]);
  assert.equal(session.element, element);
  await session.stop();
  assert.deepEqual(detached, [[screenTrack, element]]);
  assert.equal(room.disconnectCalls, 1);
});

test("viewer connect failure disconnects without attaching media", async () => {
  const expected = new Error("connect failed");
  const { room } = createRoomHarness({ connectError: expected });
  let attaches = 0;

  await assert.rejects(
    () =>
      createViewerSession({
        workspaceId: "workspace-1",
        sessionId: "session-1",
        api: {
          async createViewerToken() {
            return {
              livekitUrl: "wss://livekit.example.com",
              livekitToken: "viewer-token",
              expiresAt: "2026-07-18T01:00:00.000Z",
            };
          },
        },
        createRoom: () => room,
        mediaElements: {
          attach() {
            attaches += 1;
          },
          detach() {},
        },
      }),
    expected,
  );
  assert.equal(attaches, 0);
  assert.equal(room.disconnectCalls, 1);
});
