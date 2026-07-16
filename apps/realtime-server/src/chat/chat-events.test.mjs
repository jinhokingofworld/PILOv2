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

const message = {
  id: "message-1",
  workspaceId: "workspace-1",
  clientMessageId: "client-message-1",
  content: "@User Two 확인 부탁해요",
  author: {
    id: "user-1",
    displayName: "User One",
    avatarUrl: null,
  },
  mentions: [{ userId: "user-2", displayText: "@User Two" }],
  createdAt: "2026-07-16T00:00:00.000Z",
  deletedAt: null,
};

const validCreated = {
  version: 1,
  type: "message.created",
  workspaceId: "workspace-1",
  occurredAt: "2026-07-16T00:00:01.000Z",
  message,
  mentionedUserIds: ["user-2", "user-2", "user-3"],
};

const validDeleted = {
  version: 1,
  type: "message.deleted",
  workspaceId: "workspace-1",
  occurredAt: "2026-07-16T00:10:00.000Z",
  messageId: "message-1",
  deletedAt: "2026-07-16T00:09:59.000Z",
};

const socketServerSource = await readFile(
  new URL("../socket/socket-server.ts", import.meta.url),
  "utf8",
);

function createIoHarness() {
  const emits = [];
  return {
    emits,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            emits.push({ event, payload, room });
          },
        };
      },
    },
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
  assert.equal(createChatRoomName("workspace-1"), "workspace:workspace-1:chat");
  assert.equal(
    createChatUserRoomName("workspace-1", "user-2"),
    "workspace:workspace-1:chat:user:user-2",
  );
});

test("readChatRoomRef는 workspaceId만 있는 bounded payload만 허용한다", () => {
  assert.deepEqual(readChatRoomRef({ workspaceId: " workspace-1 " }), {
    workspaceId: "workspace-1",
  });
  assert.deepEqual(readChatRoomRef({ workspaceId: ` ${"x".repeat(256)} ` }), {
    workspaceId: "x".repeat(256),
  });
  assert.equal(readChatRoomRef({ workspaceId: "" }), null);
  assert.equal(readChatRoomRef({ workspaceId: "x".repeat(257) }), null);
  assert.equal(readChatRoomRef({ workspaceId: "workspace-1", userId: "user-2" }), null);
});

test("isChatRedisEvent는 V1 created/deleted wire shape만 허용한다", () => {
  assert.equal(isChatRedisEvent(validCreated), true);
  assert.equal(isChatRedisEvent(validDeleted), true);
  assert.equal(isChatRedisEvent({ ...validCreated, version: 2 }), false);
  assert.equal(isChatRedisEvent({ ...validCreated, workspaceId: "" }), false);
  assert.equal(
    isChatRedisEvent({
      ...validCreated,
      message: { ...message, workspaceId: "workspace-2" },
    }),
    false,
  );
  assert.equal(isChatRedisEvent({ ...validCreated, occurredAt: "invalid" }), false);
  assert.equal(isChatRedisEvent({ ...validCreated, extra: true }), false);
});

test("created fan-out은 Workspace room과 deduplicated mention user room에 보낸다", () => {
  const harness = createIoHarness();
  const fanOut = createChatFanOut({ io: harness.io });

  assert.equal(fanOut.fanOut(validCreated), true);
  assert.deepEqual(harness.emits, [
    {
      room: "workspace:workspace-1:chat",
      event: "chat:message-created",
      payload: message,
    },
    {
      room: "workspace:workspace-1:chat:user:user-2",
      event: "chat:mention-created",
      payload: {
        message,
        occurredAt: "2026-07-16T00:00:01.000Z",
      },
    },
    {
      room: "workspace:workspace-1:chat:user:user-3",
      event: "chat:mention-created",
      payload: {
        message,
        occurredAt: "2026-07-16T00:00:01.000Z",
      },
    },
  ]);
  assert.equal(
    harness.emits.some(({ room }) => room === "workspace:workspace-2:chat"),
    false,
  );
});

test("deleted fan-out은 tombstone만 보내며 mention을 보내지 않는다", () => {
  const harness = createIoHarness();
  const fanOut = createChatFanOut({ io: harness.io });

  assert.equal(fanOut.fanOut(validDeleted), true);
  assert.deepEqual(harness.emits, [
    {
      room: "workspace:workspace-1:chat",
      event: "chat:message-deleted",
      payload: {
        workspaceId: "workspace-1",
        messageId: "message-1",
        deletedAt: "2026-07-16T00:09:59.000Z",
      },
    },
  ]);
});

test("fan-out은 invalid Redis payload를 emit하지 않는다", () => {
  const harness = createIoHarness();
  const fanOut = createChatFanOut({ io: harness.io });

  assert.equal(fanOut.fanOut({ ...validCreated, version: 2 }), false);
  assert.deepEqual(harness.emits, []);
});

test("socket server는 Chat Redis fan-out과 socket lifecycle을 등록하고 해제한다", () => {
  assert.match(socketServerSource, /CHAT_REDIS_CHANNEL = "chat:events"/);
  assert.match(socketServerSource, /createChatAccessService\(database\)/);
  assert.match(socketServerSource, /createChatFanOut\(\{ io \}\)/);
  assert.match(
    socketServerSource,
    /redisAdapter\.subscribe\(CHAT_REDIS_CHANNEL/,
  );
  assert.match(socketServerSource, /chatFanOut\.fanOut\(payload\)/);
  assert.match(socketServerSource, /registerChatSocketHandlers\(\{/);
  assert.match(socketServerSource, /await unsubscribeChatEvents\?\.\(\)/);
});
