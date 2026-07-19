import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const readOptional = (path) => read(path).catch(() => "");

async function loadPurePolicy(source, marker) {
  const match = source.match(
    new RegExp(
      `// <${marker}>\\n([\\s\\S]*?)// </${marker}>`,
    ),
  );
  assert.ok(match, `${marker} pure policy marker is missing`);
  const output = ts.transpileModule(match[1], {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const [provider, layout] = await Promise.all([
  readOptional("./runtime/screen-share-runtime-provider.tsx"),
  read("../../app/(workspace)/layout.tsx"),
]);

test("Workspace layout mounts screen share beside the Meeting runtime", () => {
  assert.match(
    layout,
    /<WorkspacePresenceProvider>[\s\S]*<ScreenShareRuntimeProvider>[\s\S]*<MeetingRuntimeProvider>[\s\S]*<MainShell>\{children\}<\/MainShell>[\s\S]*<\/MeetingRuntimeProvider>[\s\S]*<\/ScreenShareRuntimeProvider>[\s\S]*<\/WorkspacePresenceProvider>/,
  );
});

test("current-session coordinator serializes invalidations into one follow-up snapshot", async () => {
  const { ScreenShareCurrentSessionCoordinator } = await import(
    "./runtime/screen-share-current-session-coordinator.ts"
  );
  const requests = [];
  const snapshots = [];
  const coordinator = new ScreenShareCurrentSessionCoordinator({
    getCurrent: () => new Promise((resolve) => requests.push(resolve)),
    isCurrentWorkspace: () => true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    workspaceId: "workspace-1",
  });

  coordinator.invalidate();
  coordinator.invalidate();
  coordinator.invalidate();
  assert.equal(requests.length, 1);

  requests.shift()({ session: "stale" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.deepEqual(snapshots, []);

  requests.shift()({ session: "fresh" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(snapshots, [{ session: "fresh" }]);
});

test("current-session coordinator ignores a snapshot after its scope is disposed", async () => {
  const { ScreenShareCurrentSessionCoordinator } = await import(
    "./runtime/screen-share-current-session-coordinator.ts"
  );
  let resolveSnapshot;
  const snapshots = [];
  const coordinator = new ScreenShareCurrentSessionCoordinator({
    getCurrent: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
    isCurrentWorkspace: () => true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    workspaceId: "workspace-1",
  });

  coordinator.invalidate();
  coordinator.dispose();
  resolveSnapshot({ session: "stale" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(snapshots, []);
});

test("publisher publish completion invalidates current state only for the current scope", async () => {
  const { finalizePublishedScreenShare } = await loadPurePolicy(
    provider,
    "screen-share-runtime-pure",
  );
  let completed = 0;

  assert.equal(
    finalizePublishedScreenShare({
      attempt: 2,
      currentAttempt: 2,
      currentWorkspaceId: "workspace-1",
      onCurrentPublish: () => { completed += 1; },
      requestWorkspaceId: "workspace-1",
    }),
    true,
  );
  assert.equal(
    finalizePublishedScreenShare({
      attempt: 1,
      currentAttempt: 2,
      currentWorkspaceId: "workspace-1",
      onCurrentPublish: () => { completed += 1; },
      requestWorkspaceId: "workspace-1",
    }),
    false,
  );
  assert.equal(completed, 1);
});

test("event adapter invalidates for matching presence joins and screen-share events", async () => {
  const { bindScreenShareCurrentSessionInvalidations } = await import(
    "./runtime/screen-share-current-session-events.ts"
  );
  const handlers = new Map();
  const socket = {
    on(event, handler) { handlers.set(event, handler); },
    off(event, handler) {
      if (handlers.get(event) === handler) handlers.delete(event);
    },
  };
  let invalidationCount = 0;
  const unbind = bindScreenShareCurrentSessionInvalidations({
    invalidate: () => { invalidationCount += 1; },
    joinedEvent: "workspace-presence:joined",
    socket,
    workspaceId: "workspace-1",
  });

  handlers.get("workspace-presence:joined")({ workspaceId: "workspace-2" });
  handlers.get("workspace-presence:joined")({ workspaceId: "workspace-1" });
  handlers.get("workspace-screen-share:started")({});
  handlers.get("workspace-screen-share:ended")({});
  assert.equal(invalidationCount, 3);

  unbind();
  assert.equal(handlers.size, 0);
});

test("snapshot closes a viewer when its target differs from the authoritative session", async () => {
  const { getCurrentScreenShareSnapshotOutcome } = await import(
    "./runtime/screen-share-current-session-policy.ts"
  );

  assert.deepEqual(
    getCurrentScreenShareSnapshotOutcome({
      session: screenShareSession("session-b"),
      viewerSessionId: "session-a",
    }),
    { shouldDisconnectViewer: true },
  );
  assert.deepEqual(
    getCurrentScreenShareSnapshotOutcome({
      session: null,
      viewerSessionId: "session-a",
    }),
    { shouldDisconnectViewer: true },
  );
  assert.deepEqual(
    getCurrentScreenShareSnapshotOutcome({
      session: screenShareSession("session-a"),
      viewerSessionId: "session-a",
    }),
    { shouldDisconnectViewer: false },
  );
  assert.deepEqual(
    getCurrentScreenShareSnapshotOutcome({
      session: screenShareSession("session-b"),
      viewerSessionId: null,
    }),
    { shouldDisconnectViewer: false },
  );
});

test("current session loads on scope activation without raw socket reconnect polling", () => {
  assert.match(provider, /new ScreenShareCurrentSessionCoordinator/);
  assert.match(provider, /requestCurrentRef\.current = invalidateCurrent;\s*invalidateCurrent\(\);/);
  assert.doesNotMatch(provider, /socket\.on\("connect"/);
  assert.equal((provider.match(/\.getCurrent\(/g) ?? []).length, 1);
});


test("started reconciliation keeps the active session but suppresses the sharer's toast", async () => {
  const { reconcileStartedScreenShare } = await loadPurePolicy(
    provider,
    "screen-share-runtime-pure",
  );
  const session = screenShareSession("session-1");
  const first = reconcileStartedScreenShare({
    currentUserId: "user-3",
    notifiedSessionIds: new Set(),
    session,
  });
  const duplicate = reconcileStartedScreenShare({
    currentUserId: "user-3",
    notifiedSessionIds: first.notifiedSessionIds,
    session,
  });
  const mine = reconcileStartedScreenShare({
    currentUserId: "user-2",
    notifiedSessionIds: new Set(),
    session,
  });

  assert.equal(first.activeSession, session);
  assert.equal(first.shouldToast, true);
  assert.equal(duplicate.activeSession, session);
  assert.equal(duplicate.shouldToast, false);
  assert.equal(mine.activeSession, session);
  assert.equal(mine.shouldToast, false);
});

test("current-session reconciliation reuses the once-per-session toast policy", async () => {
  const { reconcileCurrentScreenShare } = await loadPurePolicy(
    provider,
    "screen-share-runtime-pure",
  );
  const session = screenShareSession("session-current");
  const first = reconcileCurrentScreenShare({
    currentUserId: "user-3",
    notifiedSessionIds: new Set(),
    session,
  });
  const duplicate = reconcileCurrentScreenShare({
    currentUserId: "user-3",
    notifiedSessionIds: first.notifiedSessionIds,
    session,
  });
  const empty = reconcileCurrentScreenShare({
    currentUserId: "user-3",
    notifiedSessionIds: new Set(),
    session: null,
  });

  assert.equal(first.activeSession, session);
  assert.equal(first.shouldToast, true);
  assert.equal(duplicate.shouldToast, false);
  assert.deepEqual(empty, {
    activeSession: null,
    notifiedSessionIds: empty.notifiedSessionIds,
    shouldToast: false,
  });
});

test("current-session synchronization has no timer polling", () => {
  assert.match(provider, /const reconcileCurrentSession[\s\S]*reconcileCurrentScreenShare/);
  assert.doesNotMatch(provider, /setTimeout|schedulePoll|5_000/);
  assert.match(provider, /coordinator\.dispose\(\)/);
});

test("viewing guard rejects the current user's active share", async () => {
  const { canStartViewingScreenShare } = await loadPurePolicy(
    provider,
    "screen-share-runtime-pure",
  );
  const mine = screenShareSession("session-mine");
  const theirs = screenShareSession("session-theirs");

  assert.equal(
    canStartViewingScreenShare({
      activeSession: mine,
      currentUserId: "user-2",
      sessionId: mine.id,
    }),
    false,
  );
  assert.equal(
    canStartViewingScreenShare({
      activeSession: theirs,
      currentUserId: "user-1",
      sessionId: theirs.id,
    }),
    true,
  );
});

test("Workspace changes clean up publisher and viewer independently", async () => {
  const {
    getWorkspaceScreenShareCleanup,
    isCurrentScreenShareRequest,
  } = await loadPurePolicy(
    provider,
    "screen-share-runtime-pure",
  );

  assert.deepEqual(
    getWorkspaceScreenShareCleanup({
      nextWorkspaceId: "workspace-2",
      previousWorkspaceId: "workspace-1",
      publisherSessionId: "publisher-1",
      viewerSessionId: "viewer-1",
    }),
    { stopPublisher: true, stopViewer: true },
  );
  assert.deepEqual(
    getWorkspaceScreenShareCleanup({
      nextWorkspaceId: "workspace-1",
      previousWorkspaceId: "workspace-1",
      publisherSessionId: "publisher-1",
      viewerSessionId: null,
    }),
    { stopPublisher: false, stopViewer: false },
  );
  assert.equal(
    isCurrentScreenShareRequest({
      attempt: 2,
      currentAttempt: 2,
      currentWorkspaceId: "workspace-2",
      requestWorkspaceId: "workspace-2",
    }),
    true,
  );
  assert.equal(
    isCurrentScreenShareRequest({
      attempt: 1,
      currentAttempt: 2,
      currentWorkspaceId: "workspace-2",
      requestWorkspaceId: "workspace-1",
    }),
    false,
  );
  assert.match(
    provider,
    /if \(cleanup\.stopPublisher\) \{[\s\S]{0,500}publisher\/stopping[\s\S]{0,300}publisher\/stopped/,
  );
});

test("screen sharing owns no Meeting runtime dependency", () => {
  assert.doesNotMatch(provider, /meeting-runtime|useMeetingRuntime|MeetingApi/);
  assert.match(provider, /createPublisherSession/);
  assert.match(provider, /createViewerSession/);
  assert.match(
    provider,
    /api[\s\S]{0,30}\.end\(workspaceId, session\.id\)[\s\S]{0,250}\.catch\(/,
  );
});

test("publisher stores its session before the native-stop listener can run", () => {
  assert.match(
    provider,
    /onSharing: \(publisherSession\) => \{[\s\S]{0,500}publisherSessionRef\.current = publisherSession[\s\S]{0,500}publisher\/sharing/,
  );
  assert.doesNotMatch(
    provider,
    /\.then\(async \(publisherSession\) => \{[\s\S]{0,500}publisherSessionRef\.current = publisherSession/,
  );
});

function screenShareSession(id) {
  return {
    id,
    sharer: {
      avatarUrl: null,
      displayName: "민준",
      userId: "user-2",
    },
    startedAt: "2026-07-18T00:00:01.000Z",
  };
}
