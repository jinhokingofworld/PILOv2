import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const boardDirectory = new URL("../src/board/", import.meta.url);
const [parserSource, roomSource, handlerSource, fanOutSource, eventsSource, socketServerSource] = await Promise.all([
  readFile(new URL("board-source-payload.parser.ts", boardDirectory), "utf8"),
  readFile(new URL("board-source-room.service.ts", boardDirectory), "utf8"),
  readFile(new URL("board-source-socket-handlers.ts", boardDirectory), "utf8"),
  readFile(new URL("board-source-fan-out.ts", boardDirectory), "utf8"),
  readFile(new URL("board-socket-events.ts", boardDirectory), "utf8"),
  readFile(new URL("../src/socket/socket-server.ts", import.meta.url), "utf8")
]);

function load(source) {
  return import(`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 }
  }).outputText).toString("base64")}`);
}

const { parseBoardSourceUpdatedPayload } = await load(parserSource);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const event = { workspaceId, boardId: "42", changedAt: "2026-07-14T00:00:00.000Z" };

assert.deepEqual(parseBoardSourceUpdatedPayload(event), event);
assert.equal(parseBoardSourceUpdatedPayload({ ...event, unknown: true }), null);
assert.equal(parseBoardSourceUpdatedPayload({ ...event, changedAt: "invalid" }), null);
assert.match(roomSource, /`workspace:\$\{workspaceId\}:boards`/);
assert.match(handlerSource, /try \{[\s\S]*?joinWorkspaceSourceRoom[\s\S]*?\} catch \{/);
assert.match(handlerSource, /internal_error", "board source room access failed/);
assert.match(handlerSource, /internal_error", "board source room leave failed/);
assert.match(fanOutSource, /parseBoardSourceUpdatedPayload/);
assert.match(fanOutSource, /createBoardSourceRoomName/);
assert.match(fanOutSource, /sourceUpdated/);
assert.match(eventsSource, /sourceJoin: "board:source:join"/);
assert.match(eventsSource, /sourceUpdated: "board:source:updated"/);
assert.match(socketServerSource, /board:source-events/);

console.log("board source realtime tests passed");
