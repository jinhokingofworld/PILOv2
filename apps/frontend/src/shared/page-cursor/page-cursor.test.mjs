import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  workspaceLayout,
  realtimeProvider,
  pageCursorSurface,
  pageCursorHook,
  homeDashboard,
  calendarPanel,
  boardPanel,
  boardKanban,
] = await Promise.all([
  readSource("../../app/(workspace)/layout.tsx"),
  readSource("../realtime/realtime-provider.tsx"),
  readSource("./PageCursorSurface.tsx"),
  readSource("./use-page-cursor-room.ts"),
  readSource("../../features/home/components/home-dashboard.tsx"),
  readSource("../../features/calendar/components/calendar-panel.tsx"),
  readSource("../../features/board/components/board-panel.tsx"),
  readSource("../../features/board/components/board-kanban.tsx"),
]);

assert.match(workspaceLayout, /RealtimeProvider/);
assert.match(realtimeProvider, /createRealtimeSocket/);
assert.match(realtimeProvider, /realtimeSocket\.connect\(\)/);
assert.match(pageCursorHook, /page-cursor:join/);
assert.match(pageCursorHook, /page-cursor:update/);
assert.match(pageCursorHook, /page-cursor:leave/);
assert.match(pageCursorHook, /CURSOR_SEND_THROTTLE_MS = 50/);
assert.match(pageCursorHook, /STALE_CURSOR_MS = 12_000/);
assert.match(pageCursorHook, /PAGE_CURSOR_TARGET_TYPE_ATTR/);
assert.match(pageCursorHook, /targetPoint/);
assert.match(pageCursorSurface, /fallback\.xRatio/);
assert.match(pageCursorSurface, /querySelector/);
assert.match(pageCursorSurface, /overflow-hidden/);
assert.doesNotMatch(pageCursorSurface, /cursor\.target\?\.label \?\?/);
assert.match(homeDashboard, /page="home"/);
assert.match(calendarPanel, /page="calendar"/);
assert.match(boardPanel, /page="board"/);
assert.match(boardPanel, /boardId=\{selectedBoardId\}/);
assert.match(boardKanban, /type: "board_issue"/);
assert.match(boardKanban, /type: "board_column"/);

console.log("page cursor frontend behavior tests passed");
