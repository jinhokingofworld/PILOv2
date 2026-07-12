import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readBoardFile = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [boardRealtimeClient, boardRealtimeHook, boardPanel, boardRealtimeTypes] =
  await Promise.all([
    readBoardFile("./realtime/board-realtime-client.ts"),
    readBoardFile("./realtime/use-board-realtime.ts"),
    readBoardFile("./components/board-panel.tsx"),
    readBoardFile("./realtime/board-realtime-types.ts")
  ]);

assert.match(boardRealtimeClient, /socket\.emit\("board:join"/);
assert.match(boardRealtimeHook, /"connect"/);
assert.match(boardRealtimeHook, /"board:invalidated"/);
assert.match(boardRealtimeHook, /reloadBoard\(\)/);
assert.match(boardPanel, /useBoardRealtime/);
assert.match(boardRealtimeClient, /socket\.emit\("board:leave"/);
assert.match(boardRealtimeHook, /\.disconnect\(\)/);
assert.match(boardRealtimeHook, /event\.workspaceId === room\.workspaceId/);
assert.match(boardRealtimeHook, /event\.boardId === room\.boardId/);
assert.match(boardRealtimeTypes, /"board:invalidated"/);
assert.doesNotMatch(boardRealtimeHook, /setBoardState|setIssues|setColumns/);

console.log("board realtime frontend tests passed");
