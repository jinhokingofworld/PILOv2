import assert from "node:assert/strict";
import test from "node:test";

import {
  initialScreenShareState,
  reduceScreenShareState,
} from "./screen-share-reducer.ts";

test("publisher follows the complete start and stop lifecycle", () => {
  let state = reduceScreenShareState(initialScreenShareState, {
    type: "publisher/selecting",
  });
  assert.deepEqual(state.publisher, {
    status: "selecting",
    sessionId: null,
    error: null,
  });

  state = reduceScreenShareState(state, { type: "publisher/reserving" });
  assert.equal(state.publisher.status, "reserving");
  state = reduceScreenShareState(state, {
    type: "publisher/connecting",
    sessionId: "session-1",
  });
  assert.equal(state.publisher.status, "connecting");
  state = reduceScreenShareState(state, {
    type: "publisher/sharing",
    sessionId: "session-1",
  });
  assert.equal(state.publisher.status, "sharing");
  state = reduceScreenShareState(state, {
    type: "publisher/stopping",
    sessionId: "session-1",
  });
  assert.equal(state.publisher.status, "stopping");
  state = reduceScreenShareState(state, {
    type: "publisher/stopped",
    sessionId: "session-1",
  });
  assert.deepEqual(state.publisher, {
    status: "idle",
    sessionId: null,
    error: null,
  });
});

test("picker cancellation and start failure return publisher to idle", () => {
  const selecting = reduceScreenShareState(initialScreenShareState, {
    type: "publisher/selecting",
  });
  assert.deepEqual(
    reduceScreenShareState(selecting, { type: "publisher/picker-cancelled" })
      .publisher,
    { status: "idle", sessionId: null, error: null },
  );

  const reserving = reduceScreenShareState(selecting, {
    type: "publisher/reserving",
  });
  assert.deepEqual(
    reduceScreenShareState(reserving, {
      type: "publisher/failed",
      sessionId: null,
      error: "Could not start sharing",
    }).publisher,
    {
      status: "idle",
      sessionId: null,
      error: "Could not start sharing",
    },
  );
});

test("publisher failure rejects stale session IDs", () => {
  const connecting = reduceScreenShareState(
    reduceScreenShareState(
      reduceScreenShareState(initialScreenShareState, {
        type: "publisher/selecting",
      }),
      { type: "publisher/reserving" },
    ),
    { type: "publisher/connecting", sessionId: "session-new" },
  );

  assert.equal(
    reduceScreenShareState(connecting, {
      type: "publisher/failed",
      sessionId: "session-old",
      error: "Old request failed",
    }),
    connecting,
  );
  assert.deepEqual(
    reduceScreenShareState(connecting, {
      type: "publisher/failed",
      sessionId: "session-new",
      error: "Connect failed",
    }).publisher,
    {
      status: "idle",
      sessionId: null,
      error: "Connect failed",
    },
  );
});

test("publisher selecting cannot replace an in-flight or active publisher", () => {
  const connecting = reduceScreenShareState(
    reduceScreenShareState(
      reduceScreenShareState(initialScreenShareState, {
        type: "publisher/selecting",
      }),
      { type: "publisher/reserving" },
    ),
    { type: "publisher/connecting", sessionId: "session-1" },
  );
  const sharing = reduceScreenShareState(connecting, {
    type: "publisher/sharing",
    sessionId: "session-1",
  });

  assert.equal(
    reduceScreenShareState(connecting, { type: "publisher/selecting" }),
    connecting,
  );
  assert.equal(
    reduceScreenShareState(sharing, { type: "publisher/selecting" }),
    sharing,
  );
});

test("viewer opts in from closed through connecting and display modes back to closed", () => {
  let state = reduceScreenShareState(initialScreenShareState, {
    type: "viewer/connecting",
    sessionId: "session-1",
  });
  assert.deepEqual(state.viewer, {
    status: "connecting",
    sessionId: "session-1",
    mode: "floating",
    error: null,
  });
  state = reduceScreenShareState(state, {
    type: "viewer/connected",
    sessionId: "session-1",
  });
  assert.equal(state.viewer.status, "viewing");
  assert.equal(state.viewer.mode, "floating");

  state = reduceScreenShareState(state, { type: "viewer/focus-entered" });
  assert.equal(state.viewer.mode, "focus");
  state = reduceScreenShareState(state, { type: "viewer/fullscreen-entered" });
  assert.equal(state.viewer.mode, "fullscreen");
  state = reduceScreenShareState(state, { type: "viewer/fullscreen-exited" });
  assert.equal(state.viewer.mode, "focus");
  state = reduceScreenShareState(state, { type: "viewer/floating-entered" });
  assert.equal(state.viewer.mode, "floating");
  state = reduceScreenShareState(state, {
    type: "viewer/closed",
    sessionId: "session-1",
  });
  assert.deepEqual(state.viewer, {
    status: "closed",
    sessionId: null,
    mode: "floating",
    error: null,
  });
});

test("viewer ended and other session actions reject stale session IDs", () => {
  const viewing = reduceScreenShareState(
    reduceScreenShareState(initialScreenShareState, {
      type: "viewer/connecting",
      sessionId: "session-2",
    }),
    { type: "viewer/connected", sessionId: "session-2" },
  );

  assert.equal(
    reduceScreenShareState(viewing, {
      type: "viewer/ended",
      sessionId: "session-old",
    }),
    viewing,
  );
  assert.equal(
    reduceScreenShareState(viewing, {
      type: "viewer/connected",
      sessionId: "session-old",
    }),
    viewing,
  );
  assert.deepEqual(
    reduceScreenShareState(viewing, {
      type: "viewer/ended",
      sessionId: "session-2",
    }).viewer,
    {
      status: "closed",
      sessionId: null,
      mode: "floating",
      error: null,
    },
  );
});

test("viewer connecting cannot replace a newer non-closed viewer session", () => {
  const connecting = reduceScreenShareState(initialScreenShareState, {
    type: "viewer/connecting",
    sessionId: "session-new",
  });
  const viewing = reduceScreenShareState(connecting, {
    type: "viewer/connected",
    sessionId: "session-new",
  });

  assert.equal(
    reduceScreenShareState(connecting, {
      type: "viewer/connecting",
      sessionId: "session-old",
    }),
    connecting,
  );
  assert.equal(
    reduceScreenShareState(viewing, {
      type: "viewer/connecting",
      sessionId: "session-old",
    }),
    viewing,
  );
});
