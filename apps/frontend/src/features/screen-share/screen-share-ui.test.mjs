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

const [headerControl, notificationItem, viewer, shell, dropdown] =
  await Promise.all([
    readOptional("./components/screen-share-header-control.tsx"),
    readOptional("./components/screen-share-notification-item.tsx"),
    readOptional("./components/screen-share-viewer.tsx"),
    read("../../components/main-shell.tsx"),
    read("../../components/header-notification-dropdown.tsx"),
  ]);

test("header policy maps start, starting, stop, and another sharer's view", async () => {
  const { getHeaderScreenShareAction } = await loadPurePolicy(
    headerControl,
    "screen-share-header-pure",
  );
  const mine = screenShareSession("session-mine", "user-1", "나");
  const theirs = screenShareSession("session-theirs", "user-2", "민준");

  assert.deepEqual(
    getHeaderScreenShareAction({
      activeSession: null,
      currentUserId: "user-1",
      publisherStatus: "idle",
    }),
    { kind: "start", label: "화면 공유" },
  );
  assert.deepEqual(
    getHeaderScreenShareAction({
      activeSession: null,
      currentUserId: "user-1",
      publisherStatus: "selecting",
    }),
    { kind: "starting", label: "공유 준비 중" },
  );
  assert.deepEqual(
    getHeaderScreenShareAction({
      activeSession: mine,
      currentUserId: "user-1",
      publisherStatus: "sharing",
    }),
    { kind: "stop", label: "공유 종료" },
  );
  assert.deepEqual(
    getHeaderScreenShareAction({
      activeSession: theirs,
      currentUserId: "user-1",
      publisherStatus: "idle",
    }),
    {
      kind: "view",
      label: "민준님 공유 중 · 시청하기",
      sharerLabel: "민준님 공유 중",
      sessionId: "session-theirs",
      watchLabel: "시청하기",
    },
  );
  assert.match(
    headerControl,
    /action\.kind === "view" && mode === "header" && "max-w-52"/,
  );
  assert.match(
    headerControl,
    /mode === "header" \? "hidden sm:inline" : "inline"/,
  );
  assert.match(
    headerControl,
    /<span className="shrink-0">\{action\.watchLabel\}<\/span>/,
  );
});

test("notification policy hides the current user's active share", async () => {
  const {
    getScreenShareNotificationUnreadCount,
    shouldShowScreenShareNotification,
  } = await loadPurePolicy(
    notificationItem,
    "screen-share-notification-pure",
  );
  assert.equal(shouldShowScreenShareNotification({
    activeSession: null,
    currentUserId: "user-1",
  }), false);
  assert.equal(
    shouldShowScreenShareNotification({
      activeSession: screenShareSession("session-1", "user-2", "민준"),
      currentUserId: "user-1",
    }),
    true,
  );
  assert.equal(
    shouldShowScreenShareNotification({
      activeSession: screenShareSession("session-1", "user-1", "나"),
      currentUserId: "user-1",
    }),
    false,
  );
  assert.equal(
    getScreenShareNotificationUnreadCount({
      activeSession: screenShareSession("session-1", "user-2", "민준"),
      currentUserId: "user-1",
    }),
    1,
  );
  assert.equal(
    getScreenShareNotificationUnreadCount({
      activeSession: screenShareSession("session-1", "user-1", "나"),
      currentUserId: "user-1",
    }),
    0,
  );
  assert.match(dropdown, /<ScreenShareNotificationItem/);
  assert.match(dropdown, /shouldShowScreenShareNotification/);
  assert.match(
    dropdown,
    /const screenShareNotificationSession =\s*activeSession &&\s*shouldShowScreenShareNotification\([\s\S]{0,200}activeSession[\s\S]{0,200}currentUserId/,
  );
  assert.match(
    dropdown,
    /workspaceInvitations\.length === 0[\s\S]{0,300}!screenShareNotificationSession/,
  );
  assert.match(dropdown, /startViewing\(session\.id\)/);
  assert.match(dropdown, /const screenShareUnread = getScreenShareNotificationUnreadCount/);
  assert.doesNotMatch(notificationItem, /localStorage|mark.*Read|history/i);
});

test("viewer policy transitions floating, focus, fullscreen, and Escape collapse", async () => {
  const { getNextScreenShareViewerMode } = await loadPurePolicy(
    viewer,
    "screen-share-viewer-pure",
  );

  assert.equal(getNextScreenShareViewerMode("floating", "expand"), "focus");
  assert.equal(getNextScreenShareViewerMode("focus", "fullscreen"), "fullscreen");
  assert.equal(getNextScreenShareViewerMode("fullscreen", "browser-exit"), "focus");
  assert.equal(getNextScreenShareViewerMode("focus", "escape"), "floating");
  assert.equal(getNextScreenShareViewerMode("fullscreen", "escape"), "fullscreen");
});

test("viewer preserves one video host and implements Fullscreen API accessibility", () => {
  assert.match(viewer, /requestFullscreen\(\)/);
  assert.match(viewer, /fullscreenchange/);
  assert.match(viewer, /document\.fullscreenElement/);
  assert.match(viewer, /key === "Escape"/);
  assert.match(viewer, /aria-label="전체 화면"/);
  assert.match(viewer, /aria-label="시청 종료"/);
  assert.match(viewer, /role="alert"/);
  assert.match(viewer, /appendChild\(mediaElement\)/);
  assert.equal((viewer.match(/<video/g) ?? []).length, 0);
});

test("header controls remain adjacent to avatars in the shared workspace header", () => {
  assert.match(
    shell,
    /<ScreenShareHeaderControl mode="header" \/>\s*<WorkspaceMemberAvatars mode="header" \/>/,
  );
  assert.doesNotMatch(shell, /mode="floating"/);
  assert.match(shell, /data-sqltoerd-workspace-header/);
});

function screenShareSession(id, userId, displayName) {
  return {
    id,
    sharer: { avatarUrl: null, displayName, userId },
    startedAt: "2026-07-18T00:00:01.000Z",
  };
}
