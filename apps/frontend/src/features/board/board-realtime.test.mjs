import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const readBoardFile = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  boardRealtimeClient,
  boardRealtimeHook,
  boardPanel,
  boardRealtimeTypes,
  boardRealtimeLifecycle,
] = await Promise.all([
  readBoardFile("./realtime/board-realtime-client.ts"),
  readBoardFile("./realtime/use-board-realtime.ts"),
  readBoardFile("./components/board-panel.tsx"),
  readBoardFile("./realtime/board-realtime-types.ts"),
  readBoardFile("./realtime/board-realtime-lifecycle.ts").catch(() => ""),
]);

const lifecycleModule = boardRealtimeLifecycle
  ? await import(
      `data:text/javascript;base64,${Buffer.from(
        typescript.transpileModule(boardRealtimeLifecycle, {
          compilerOptions: {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64")}`,
    )
  : {};
const { createBoardRealtimeLifecycle } = lifecycleModule;

assert.equal(typeof createBoardRealtimeLifecycle, "function");

function createFakeSocket() {
  const listeners = new Map();

  return {
    connected: false,
    connectCalls: 0,
    disconnectCalls: 0,
    emits: [],
    listenerCount: () => listeners.size,
    on(event, listener) {
      listeners.set(event, listener);
    },
    removeAllListenersCalls: 0,
    removeAllListeners() {
      listeners.clear();
      this.removeAllListenersCalls += 1;
    },
    connect() {
      this.connectCalls += 1;
      this.connected = true;
      this.trigger("connect");
    },
    disconnect() {
      this.connected = false;
      this.disconnectCalls += 1;
    },
    emit(event, payload) {
      this.emits.push([event, payload]);
    },
    trigger(event, payload) {
      listeners.get(event)?.(payload);
    },
  };
}

const room = {
  boardId: "42",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const socket = createFakeSocket();
let reloadCalls = 0;
const lifecycle = createBoardRealtimeLifecycle({
  reloadBoard() {
    reloadCalls += 1;
  },
  room,
  socket,
});

lifecycle.connect();
assert.equal(socket.connectCalls, 1);
assert.deepEqual(socket.emits[0], ["board:join", room]);
assert.equal(reloadCalls, 1);

socket.trigger("board:invalidated", {
  ...room,
  boardId: "43",
  updatedAt: "2026-07-12T00:00:00.000Z",
});
assert.equal(reloadCalls, 1);

socket.trigger("board:invalidated", {
  ...room,
  updatedAt: "2026-07-12T00:00:00.000Z",
});
assert.equal(reloadCalls, 2);

lifecycle.cleanup();
assert.deepEqual(socket.emits.at(-1), ["board:leave", room]);
assert.equal(socket.removeAllListenersCalls, 1);
assert.equal(socket.disconnectCalls, 1);
assert.equal(socket.listenerCount(), 0);

assert.match(boardRealtimeClient, /socket\.emit\("board:join"/);
assert.match(boardRealtimeHook, /createBoardRealtimeLifecycle/);
assert.match(boardPanel, /useBoardRealtime/);
assert.match(boardRealtimeClient, /socket\.emit\("board:leave"/);
assert.match(boardRealtimeTypes, /"board:invalidated"/);
assert.doesNotMatch(boardRealtimeHook, /setBoardState|setIssues|setColumns/);
assert.doesNotMatch(boardRealtimeHook, /realtimeSocket\.on\("connect"/);
assert.doesNotMatch(boardRealtimeHook, /realtimeSocket\.on\("board:invalidated"/);

console.log("board realtime frontend behavior tests passed");
