import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chatClientEvents,
  chatServerEvents,
} from "../../dist/chat/chat-events.js";
import { createChatFanOut } from "../../dist/chat/chat-fan-out.js";
import {
  isChatRedisEvent,
  readChatRoomRef,
} from "../../dist/chat/chat-payload.js";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "../../dist/chat/chat-room.service.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const authorUserId = "44444444-4444-4444-8444-444444444444";
const mentionedUserId = "55555555-5555-4555-8555-555555555555";
const otherMentionedUserId = "66666666-6666-4666-8666-666666666666";
const revokedUserId = "77777777-7777-4777-8777-777777777777";

const message = {
  id: messageId,
  workspaceId,
  clientMessageId: "client-message-1",
  content: "@User Two 확인 부탁해요",
  author: {
    id: authorUserId,
    displayName: "User One",
    avatarUrl: null,
  },
  mentions: [{ userId: mentionedUserId, displayText: "@User Two" }],
  createdAt: "2026-07-16T00:00:00.000Z",
  deletedAt: null,
};

const validCreated = {
  version: 1,
  type: "message.created",
  workspaceId,
  occurredAt: "2026-07-16T00:00:01.000Z",
  message,
  mentionedUserIds: [
    mentionedUserId,
    mentionedUserId,
    otherMentionedUserId,
  ],
};

const validDeleted = {
  version: 1,
  type: "message.deleted",
  workspaceId,
  occurredAt: "2026-07-16T00:10:00.000Z",
  messageId,
  deletedAt: "2026-07-16T00:09:59.000Z",
};

const socketServerSource = await readFile(
  new URL("../socket/socket-server.ts", import.meta.url),
  "utf8",
);

let nextSocketId = 1;
function createSocket(
  userId,
  { failDisconnect = false, failLeaveRoom, id } = {},
) {
  const socket = {
    data: { auth: { userId } },
    disconnectCalls: [],
    emitted: [],
    id: id ?? `local-socket-${nextSocketId++}`,
    leaveCalls: [],
    sequence: null,
    disconnect(close) {
      socket.disconnectCalls.push(close);
      socket.sequence?.push(`disconnect:${socket.id}`);
      if (failDisconnect) throw new Error("adapter disconnect failed");
    },
    emit(event, payload) {
      socket.emitted.push({ event, payload });
      socket.sequence?.push(`emit:${socket.id}:${event}`);
    },
    async leave(roomName) {
      socket.leaveCalls.push(roomName);
      socket.sequence?.push(`leave:${socket.id}:${roomName}`);
      if (roomName === failLeaveRoom) {
        throw new Error("adapter leave failed");
      }
    },
  };
  return socket;
}

function createHarness({
  additionalRoomMemberships = [],
  additionalSockets = [],
  discoveryError = null,
  generalSockets = [],
  membershipError = null,
  membershipWait = null,
  membershipUserIds = [],
} = {}) {
  const queries = [];
  const sequence = [];
  const allSockets = [...new Set([...generalSockets, ...additionalSockets])];
  for (const { sockets } of additionalRoomMemberships) {
    for (const socket of sockets) {
      if (!allSockets.includes(socket)) allSockets.push(socket);
    }
  }
  for (const socket of allSockets) socket.sequence = sequence;

  const rooms = new Map([
    [createChatRoomName(workspaceId), new Set(generalSockets.map(({ id }) => id))],
  ]);
  for (const socket of generalSockets) {
    const userId = socket.data.auth?.userId;
    if (typeof userId !== "string") continue;
    const roomName = createChatUserRoomName(workspaceId, userId);
    const socketIds = rooms.get(roomName) ?? new Set();
    socketIds.add(socket.id);
    rooms.set(roomName, socketIds);
  }
  for (const { roomName, sockets } of additionalRoomMemberships) {
    const socketIds = rooms.get(roomName) ?? new Set();
    for (const socket of sockets) socketIds.add(socket.id);
    rooms.set(roomName, socketIds);
  }
  const localSockets = new Map(allSockets.map((socket) => [socket.id, socket]));

  const io = {};
  Object.defineProperty(io, "sockets", {
    get() {
      if (discoveryError) throw discoveryError;
      return {
        adapter: { rooms },
        sockets: localSockets,
      };
    },
  });

  return {
    allSockets,
    database: {
      async query(text, values) {
        queries.push({ text, values });
        sequence.push("membership:queried");
        if (membershipError) throw membershipError;
        if (membershipWait) await membershipWait;
        return membershipUserIds.map((user_id) => ({ user_id }));
      },
    },
    io,
    localSockets,
    queries,
    rooms,
    sequence,
  };
}

test("Chat event와 room contract는 문서의 exact 이름을 사용한다", () => {
  assert.deepEqual(chatClientEvents, {
    join: "chat:join",
    leave: "chat:leave",
  });
  assert.deepEqual(chatServerEvents, {
    error: "chat:error",
    joined: "chat:joined",
    messageCreated: "chat:message-created",
    messageDeleted: "chat:message-deleted",
    mentionCreated: "chat:mention-created",
  });
  assert.equal(createChatRoomName(workspaceId), `workspace:${workspaceId}:chat`);
  assert.equal(
    createChatUserRoomName(workspaceId, mentionedUserId),
    `workspace:${workspaceId}:chat:user:${mentionedUserId}`,
  );
});

test("readChatRoomRef는 workspaceId만 있는 UUID payload만 허용한다", () => {
  assert.deepEqual(readChatRoomRef({ workspaceId: ` ${workspaceId} ` }), {
    workspaceId,
  });
  assert.equal(readChatRoomRef({ workspaceId: "" }), null);
  assert.equal(readChatRoomRef({ workspaceId: "workspace-1" }), null);
  assert.equal(readChatRoomRef({ workspaceId, userId: mentionedUserId }), null);
});

test("isChatRedisEvent는 UUID와 V1 exact wire shape만 허용한다", () => {
  assert.equal(isChatRedisEvent(validCreated), true);
  assert.equal(isChatRedisEvent(validDeleted), true);

  const invalidEvents = [
    { ...validCreated, version: 2 },
    { ...validCreated, workspaceId: "workspace-1" },
    { ...validCreated, extra: true },
    { ...validCreated, occurredAt: "2026-07-16" },
    { ...validCreated, message: { ...message, id: "message-1" } },
    {
      ...validCreated,
      message: { ...message, workspaceId: otherWorkspaceId },
    },
    { ...validCreated, message: { ...message, clientMessageId: "" } },
    {
      ...validCreated,
      message: { ...message, clientMessageId: "x".repeat(129) },
    },
    {
      ...validCreated,
      message: { ...message, author: { ...message.author, id: "user-1" } },
    },
    {
      ...validCreated,
      message: {
        ...message,
        mentions: [{ userId: "user-2", displayText: "@User Two" }],
      },
    },
    { ...validCreated, mentionedUserIds: ["user-2"] },
    { ...validDeleted, messageId: "message-1" },
  ];
  for (const invalidEvent of invalidEvents) {
    assert.equal(isChatRedisEvent(invalidEvent), false);
  }
});

test("isChatRedisEvent는 canonical ISO timestamp만 허용한다", () => {
  assert.equal(
    isChatRedisEvent({
      ...validCreated,
      message: { ...message, createdAt: "2026-07-16T00:00:00Z" },
    }),
    false,
  );
  assert.equal(
    isChatRedisEvent({
      ...validCreated,
      message: {
        ...message,
        deletedAt: "2026-07-16T09:00:00.000+09:00",
      },
    }),
    false,
  );
  assert.equal(
    isChatRedisEvent({
      ...validDeleted,
      deletedAt: "2026-07-16T00:09:59Z",
    }),
    false,
  );
});

test("created fan-out은 local unique user를 한 번 조회하고 local socket에 직접 보낸다", async () => {
  const firstAuthorTab = createSocket(authorUserId);
  const secondAuthorTab = createSocket(authorUserId);
  const mentionedTab = createSocket(mentionedUserId);
  const harness = createHarness({
    generalSockets: [firstAuthorTab, secondAuthorTab, mentionedTab],
    membershipUserIds: [authorUserId, mentionedUserId],
  });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut(validCreated), true);
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].text, /FROM workspace_members/);
  assert.match(harness.queries[0].text, /user_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(harness.queries[0].values, [
    workspaceId,
    [authorUserId, mentionedUserId],
  ]);
  for (const socket of [firstAuthorTab, secondAuthorTab]) {
    assert.deepEqual(socket.emitted, [
      { event: chatServerEvents.messageCreated, payload: message },
    ]);
  }
  assert.deepEqual(mentionedTab.emitted, [
    { event: chatServerEvents.messageCreated, payload: message },
    {
      event: chatServerEvents.mentionCreated,
      payload: { message, occurredAt: validCreated.occurredAt },
    },
  ]);
});

test("user room에만 남은 socket에는 authorized batch 밖 mention을 보내지 않는다", async () => {
  const authorSocket = createSocket(authorUserId);
  const strandedTarget = createSocket(revokedUserId);
  const harness = createHarness({
    additionalRoomMemberships: [
      {
        roomName: createChatUserRoomName(workspaceId, revokedUserId),
        sockets: [strandedTarget],
      },
    ],
    generalSockets: [authorSocket],
    membershipUserIds: [authorUserId],
  });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(
    await fanOut.fanOut({
      ...validCreated,
      mentionedUserIds: [revokedUserId],
    }),
    true,
  );
  assert.deepEqual(authorSocket.emitted.map(({ event }) => event), [
    chatServerEvents.messageCreated,
  ]);
  assert.deepEqual(strandedTarget.emitted, []);
});

test("fan-out은 revoked local socket을 퇴출한 뒤 authorized local socket에 emit한다", async () => {
  const authorizedSocket = createSocket(authorUserId);
  const revokedSocket = createSocket(revokedUserId);
  const harness = createHarness({
    generalSockets: [authorizedSocket, revokedSocket],
    membershipUserIds: [authorUserId],
  });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut(validCreated), true);
  assert.deepEqual(revokedSocket.leaveCalls, [
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, revokedUserId),
  ]);
  assert.deepEqual(revokedSocket.emitted, []);
  assert.deepEqual(authorizedSocket.emitted.map(({ event }) => event), [
    chatServerEvents.messageCreated,
  ]);
  assert.ok(
    harness.sequence.findIndex((entry) => entry.startsWith("leave:")) <
      harness.sequence.findIndex((entry) => entry.startsWith("emit:")),
  );
});

test("leave 실패 후 disconnect 성공은 안전한 퇴출로 처리한다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const revokedSocket = createSocket(revokedUserId, {
    failLeaveRoom: generalRoom,
  });
  const harness = createHarness({ generalSockets: [revokedSocket] });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut(validDeleted), true);
  assert.deepEqual(revokedSocket.leaveCalls, [
    generalRoom,
    createChatUserRoomName(workspaceId, revokedUserId),
  ]);
  assert.deepEqual(revokedSocket.disconnectCalls, [true]);
  assert.deepEqual(revokedSocket.emitted, []);
});

test("leave와 disconnect가 모두 실패하면 fan-out은 fail closed한다", async () => {
  const authorizedSocket = createSocket(authorUserId);
  const unsafeSocket = createSocket(revokedUserId, {
    failDisconnect: true,
    failLeaveRoom: createChatRoomName(workspaceId),
  });
  const harness = createHarness({
    generalSockets: [authorizedSocket, unsafeSocket],
    membershipUserIds: [authorUserId],
  });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut(validCreated), false);
  assert.deepEqual(authorizedSocket.emitted, []);
  assert.deepEqual(unsafeSocket.emitted, []);
});

test("local socket discovery 또는 membership query 실패는 emit하지 않는다", async () => {
  for (const failure of ["discovery", "membership"]) {
    const socket = createSocket(authorUserId);
    const harness = createHarness({
      discoveryError:
        failure === "discovery" ? new Error("adapter unavailable") : null,
      generalSockets: [socket],
      membershipError:
        failure === "membership" ? new Error("database unavailable") : null,
    });
    const fanOut = createChatFanOut({
      database: harness.database,
      io: harness.io,
    });

    assert.equal(await fanOut.fanOut(validCreated), false);
    assert.deepEqual(socket.emitted, []);
  }
});

test("deleted fan-out은 recheck 뒤 authorized local socket에 tombstone만 보낸다", async () => {
  const socket = createSocket(authorUserId);
  const harness = createHarness({
    generalSockets: [socket],
    membershipUserIds: [authorUserId],
  });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut(validDeleted), true);
  assert.deepEqual(socket.emitted, [
    {
      event: chatServerEvents.messageDeleted,
      payload: {
        workspaceId,
        messageId,
        deletedAt: validDeleted.deletedAt,
      },
    },
  ]);
});

test("membership query 대기 중 general room을 떠난 socket에는 어떤 Chat event도 보내지 않는다", async () => {
  for (const payload of [validCreated, validDeleted]) {
    let releaseMembershipQuery;
    const membershipWait = new Promise((resolve) => {
      releaseMembershipQuery = resolve;
    });
    const socket = createSocket(mentionedUserId);
    const harness = createHarness({
      generalSockets: [socket],
      membershipUserIds: [mentionedUserId],
      membershipWait,
    });
    const fanOut = createChatFanOut({
      database: harness.database,
      io: harness.io,
    });

    const pendingFanOut = fanOut.fanOut(payload);
    assert.deepEqual(harness.sequence, ["membership:queried"]);
    harness.rooms.get(createChatRoomName(workspaceId)).delete(socket.id);
    releaseMembershipQuery();

    assert.equal(await pendingFanOut, true);
    assert.deepEqual(socket.emitted, []);
  }
});

test("각 Realtime node는 같은 Redis event를 local socket에 정확히 한 번만 처리한다", async () => {
  const nodeASocket = createSocket(authorUserId, { id: "node-a-local" });
  const nodeBSocket = createSocket(mentionedUserId, { id: "node-b-local" });
  const nodeA = createHarness({
    generalSockets: [nodeASocket],
    membershipUserIds: [authorUserId],
  });
  const nodeB = createHarness({
    generalSockets: [nodeBSocket],
    membershipUserIds: [mentionedUserId],
  });

  assert.equal(
    await createChatFanOut({ database: nodeA.database, io: nodeA.io }).fanOut(
      validCreated,
    ),
    true,
  );
  assert.equal(
    await createChatFanOut({ database: nodeB.database, io: nodeB.io }).fanOut(
      validCreated,
    ),
    true,
  );

  assert.deepEqual(nodeASocket.emitted.map(({ event }) => event), [
    chatServerEvents.messageCreated,
  ]);
  assert.deepEqual(nodeBSocket.emitted.map(({ event }) => event), [
    chatServerEvents.messageCreated,
    chatServerEvents.mentionCreated,
  ]);
  assert.deepEqual(nodeASocket.leaveCalls, []);
  assert.deepEqual(nodeBSocket.leaveCalls, []);
});

test("fan-out은 invalid Redis payload를 조회하거나 emit하지 않는다", async () => {
  const socket = createSocket(authorUserId);
  const harness = createHarness({ generalSockets: [socket] });
  const fanOut = createChatFanOut({
    database: harness.database,
    io: harness.io,
  });

  assert.equal(await fanOut.fanOut({ ...validCreated, version: 2 }), false);
  assert.deepEqual(harness.queries, []);
  assert.deepEqual(socket.emitted, []);
});

test("socket server는 Chat Redis fan-out과 socket lifecycle을 등록하고 해제한다", () => {
  assert.match(socketServerSource, /CHAT_REDIS_CHANNEL = "chat:events"/);
  assert.match(socketServerSource, /createChatAccessService\(database\)/);
  assert.match(socketServerSource, /createChatFanOut\(\{ database, io \}\)/);
  assert.match(
    socketServerSource,
    /redisAdapter\.subscribe\(CHAT_REDIS_CHANNEL/,
  );
  assert.match(socketServerSource, /chatFanOut\.fanOut\(payload\)/);
  assert.match(socketServerSource, /registerChatSocketHandlers\(\{/);
  assert.match(socketServerSource, /await unsubscribeChatEvents\?\.\(\)/);
});
