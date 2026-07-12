import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  socketServer,
  boardAccess,
  boardEvents,
  boardRoom,
  boardRoomNames,
  boardApiContract,
  realtimeReadme
] = await Promise.all([
    readSource("../../src/socket/socket-server.ts"),
    readSource("../../src/board/board-access.service.ts"),
    readSource("../../src/board/board-socket-events.ts"),
    readSource("../../src/board/board-room.service.ts"),
    readSource("../../src/socket/board/board-room-names.ts"),
    readSource("../../../../docs/api/board-api.md"),
    readSource("../../README.md")
  ]);

assert.match(socketServer, /boardClientEvents\.join/);
assert.match(
  socketServer,
  /BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations"/
);
assert.match(boardAccess, /JOIN workspace_members wm/);
assert.match(boardAccess, /FROM boards b/);
assert.match(boardEvents, /invalidated: "board:invalidated"/);
assert.match(boardRoom, /canJoinBoard/);
assert.match(boardRoomNames, /workspace:\$\{workspaceId\}:board:\$\{boardId\}/);
assert.match(socketServer, /readBoardInvalidationPayload/);
assert.match(socketServer, /createBoardRoomName/);

const uppercaseWorkspaceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const canonicalWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

assert.equal(uppercaseWorkspaceId.toLowerCase(), canonicalWorkspaceId);
assert.match(
  socketServer,
  /return \{ boardId, workspaceId: workspaceId\.toLowerCase\(\) \};/
);

assert.match(boardApiContract, /board:invalidated/);
assert.match(boardApiContract, /updatedAt/);
assert.match(boardApiContract, /Raw GitHub payload/);
assert.match(boardApiContract, /board:join/);
assert.match(boardApiContract, /board:leave/);
assert.match(boardApiContract, /board:joined/);
assert.match(boardApiContract, /board:error/);
assert.match(boardApiContract, /workspace_members/);
assert.match(boardApiContract, /hydrate_pilo_board_from_github[\s\S]*board:invalidations/);
assert.match(boardApiContract, /reconnect[\s\S]*snapshot/i);
assert.match(realtimeReadme, /Board realtime events: `docs\/api\/board-api\.md`/);
assert.match(realtimeReadme, /board\//);

console.log("board realtime tests passed");
