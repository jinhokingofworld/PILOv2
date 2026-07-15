import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createWorkspacePresenceState,
  reduceWorkspacePresence,
} from "./workspace-presence-reducer.ts";

const workspaceId = "workspace-1";

function presence(userId, page = "home") {
  return {
    displayName: userId,
    focused: true,
    lastActiveAt: "2026-07-16T00:00:00.000Z",
    location: {
      context: {},
      page,
      route: { pathname: `/${page}`, search: "" },
      viewport: { kind: "document", xRatio: 0, yRatio: 0 },
    },
    userId,
    visible: true,
    workspaceId,
  };
}

test("joined snapshot은 현재 사용자를 제외하고 저장한다", () => {
  const state = reduceWorkspacePresence(
    createWorkspacePresenceState(),
    { type: "joined", presence: [presence("me"), presence("user-2")] },
    "me",
  );

  assert.deepEqual(state.onlineUsers.map((user) => user.userId), ["user-2"]);
});

test("update는 userId 기준으로 교체하고 leave는 제거한다", () => {
  let state = reduceWorkspacePresence(
    createWorkspacePresenceState(),
    { type: "joined", presence: [presence("user-2")] },
    "me",
  );
  state = reduceWorkspacePresence(
    state,
    { type: "update", presence: presence("user-2", "calendar") },
    "me",
  );
  assert.equal(state.onlineUsers[0]?.location?.page, "calendar");

  state = reduceWorkspacePresence(
    state,
    { type: "leave", userId: "user-2" },
    "me",
  );
  assert.deepEqual(state.onlineUsers, []);
});

test("workspace 변경 reset은 이전 roster를 제거한다", () => {
  const initial = {
    onlineUsers: [presence("user-2")],
  };
  assert.deepEqual(
    reduceWorkspacePresence(initial, { type: "reset" }, "me"),
    createWorkspacePresenceState(),
  );
});

test("provider는 기존 realtime socket을 재사용하고 focus와 visibility를 보고한다", async () => {
  const provider = await readFile(
    new URL("./workspace-presence-provider.tsx", import.meta.url),
    "utf8",
  );
  const adapterHook = await readFile(
    new URL("./use-workspace-location-adapter.ts", import.meta.url),
    "utf8",
  );

  assert.match(provider, /useRealtimeSocket\(\)/);
  assert.doesNotMatch(provider, /createRealtimeSocket/);
  assert.match(provider, /workspacePresenceClientEvents\.join/);
  assert.match(provider, /workspacePresenceClientEvents\.update/);
  assert.match(provider, /visibilitychange/);
  assert.match(provider, /focus/);
  assert.match(provider, /100/);
  assert.match(adapterHook, /registerAdapter/);
});
