import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { io } from "socket.io-client";

const { createRealtimeSocketServer } = await import(
  "../dist/socket/socket-server.js"
);

const room = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
};
const sockets = [];

function waitForEvent(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };

    socket.once(event, onEvent);
  });
}

function expectNoEvent(socket, event, timeoutMs = 50) {
  return new Promise((resolve, reject) => {
    const onEvent = (payload) => {
      clearTimeout(timeout);
      reject(new Error(`Unexpected ${event}: ${JSON.stringify(payload)}`));
    };
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, timeoutMs);

    socket.once(event, onEvent);
  });
}

function createTestDatabase() {
  const sessions = new Map([
    [
      createHash("sha256").update("se-in", "utf8").digest("hex"),
      { display_name: "세인", user_id: "user-se-in" },
    ],
    [
      createHash("sha256").update("observer", "utf8").digest("hex"),
      { display_name: "동료", user_id: "user-observer" },
    ],
    [
      createHash("sha256").update("forbidden", "utf8").digest("hex"),
      { display_name: "권한 없음", user_id: "user-forbidden" },
    ],
  ]);

  return {
    async close() {},
    async execute() {
      return { rows: [] };
    },
    async query() {
      return [];
    },
    async queryOne(text, values = []) {
      if (text.includes("UPDATE user_sessions")) {
        return sessions.get(values[0]) ?? null;
      }

      if (text.includes("FROM sql_erd_sessions AS s")) {
        return values[0] === "forbidden-session"
          ? null
          : { id: values[0], latest_op_seq: 7 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function createPresence(cursor) {
  return {
    ...room,
    cursor,
    editingMode: null,
    selectedObjects: [],
    sentAt: "2026-07-14T00:00:00.000Z",
    tool: "select",
  };
}

const httpServer = createServer();
const socketServer = await createRealtimeSocketServer({
  config: {
    corsOrigin: "*",
    databaseApplicationName: "sql-erd-socket-lifecycle-test",
    databasePoolConnectionTimeoutMs: 50,
    databasePoolIdleTimeoutMs: 50,
    databasePoolMax: 1,
    databaseSsl: false,
    databaseUrl: "postgresql://unused:unused@localhost:1/unused",
    port: 0,
    redisUrl: null,
    scope: "test",
  },
  database: createTestDatabase(),
  httpServer,
});

try {
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;

  const connect = async (token) => {
    const socket = io(url, {
      auth: { token },
      reconnection: false,
      transports: ["websocket"],
    });
    sockets.push(socket);
    await waitForEvent(socket, "connect");
    return socket;
  };
  const join = async (socket, payload = room) => {
    const joined = waitForEvent(socket, "sql-erd:joined");
    socket.emit("sql-erd:join", payload);
    return joined;
  };

  const firstTab = await connect("se-in");
  const secondTab = await connect("se-in");
  const observer = await connect("observer");
  const [firstJoined, secondJoined, observerJoined] = await Promise.all([
    join(firstTab),
    join(secondTab),
    join(observer)
  ]);
  assert.equal(firstJoined.latestOpSeq, 7);
  assert.equal(secondJoined.latestOpSeq, 7);
  assert.equal(observerJoined.latestOpSeq, 7);

  let update = waitForEvent(observer, "sql-erd:presence:update");
  firstTab.emit("sql-erd:presence:update", createPresence({ x: 10, y: 20 }));
  assert.deepEqual((await update).cursor, { x: 10, y: 20 });

  update = waitForEvent(observer, "sql-erd:presence:update");
  secondTab.emit("sql-erd:presence:update", createPresence({ x: 30, y: 40 }));
  assert.deepEqual((await update).cursor, { x: 30, y: 40 });

  update = waitForEvent(observer, "sql-erd:presence:update");
  const noLeaveAfterExplicitLeave = expectNoEvent(observer, "sql-erd:presence:leave");
  secondTab.emit("sql-erd:leave", room);
  assert.deepEqual((await update).cursor, { x: 10, y: 20 });
  await noLeaveAfterExplicitLeave;

  await join(secondTab);
  update = waitForEvent(observer, "sql-erd:presence:update");
  secondTab.emit("sql-erd:presence:update", createPresence({ x: 50, y: 60 }));
  assert.deepEqual((await update).cursor, { x: 50, y: 60 });

  update = waitForEvent(observer, "sql-erd:presence:update");
  const noLeaveAfterDisconnect = expectNoEvent(observer, "sql-erd:presence:leave");
  secondTab.disconnect();
  assert.deepEqual((await update).cursor, { x: 10, y: 20 });
  await noLeaveAfterDisconnect;

  const leave = waitForEvent(observer, "sql-erd:presence:leave");
  firstTab.emit("sql-erd:leave", room);
  assert.deepEqual(await leave, { ...room, userId: "user-se-in" });

  const forbidden = await connect("forbidden");
  const forbiddenError = waitForEvent(forbidden, "sql-erd:error");
  forbidden.emit("sql-erd:join", { ...room, sessionId: "forbidden-session" });
  assert.equal((await forbiddenError).code, "forbidden");
} finally {
  sockets.forEach((socket) => socket.disconnect());
  await socketServer.close();
  await new Promise((resolve) => httpServer.close(resolve));
}

console.log("SQLtoERD socket lifecycle tests passed");
