import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ChatService
} = require("../../dist/modules/chat/chat.service.js");
const {
  decodeChatCursor
} = require("../../dist/modules/chat/chat-validation.js");

const userId = "11111111-1111-4111-8111-111111111111";
const mentionedUserId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherWorkspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const malformedWorkspaceId = "workspace-1";
const message1Id = "10000000-0000-4000-8000-000000000001";
const message2Id = "10000000-0000-4000-8000-000000000002";
const message3Id = "10000000-0000-4000-8000-000000000003";
const mention1Id = "20000000-0000-4000-8000-000000000001";
const requestFingerprint =
  "1d932b12bd81ec643f5875a64bedc69fe625159e5b78eb964637d0241b987b13";
const twoMentionRequestFingerprint =
  "7b6bd404585acfb94deffb44c866af90cd1844dc735fc85a06932b667314ee11";

class FakeDatabase {
  constructor(steps = []) {
    this.steps = [...steps];
    this.queries = [];
    this.timeline = [];
  }

  async query(text, values = []) {
    return this.consume("query", text, values);
  }

  async queryOne(text, values = []) {
    return this.consume("queryOne", text, values);
  }

  async execute(text, values = []) {
    return this.consume("execute", text, values);
  }

  async transaction(callback) {
    this.timeline.push("transaction-started");
    const transaction = {
      query: (text, values = []) => this.consume("query", text, values),
      queryOne: (text, values = []) => this.consume("queryOne", text, values),
      execute: (text, values = []) => this.consume("execute", text, values)
    };
    const result = await callback(transaction);
    this.timeline.push("transaction-resolved");
    return result;
  }

  assertConsumed() {
    assert.equal(this.steps.length, 0, "all expected database calls must run");
  }

  async consume(method, text, values) {
    this.queries.push({ method, text, values });
    if (
      /FROM workspace_members AS membership[\s\S]*FOR KEY SHARE/.test(text) &&
      !text.includes("ANY($2::uuid[])")
    ) {
      this.timeline.push("membership-guard");
    }
    const step = this.steps.shift();
    assert.ok(step, `unexpected ${method} query: ${text}`);
    assert.equal(method, step.method);
    if (step.match) assert.match(text, step.match);
    if (step.values) assert.deepEqual(values, step.values);
    if (step.inspect) step.inspect(text, values);
    if (step.error) throw step.error;
    return typeof step.result === "function"
      ? step.result(text, values)
      : (step.result ?? null);
  }
}

class FakeWorkspaceService {
  constructor(timeline) {
    this.calls = [];
    this.timeline = timeline;
  }

  async assertWorkspaceAccess(currentUserId, targetWorkspaceId) {
    this.timeline.push("access-checked");
    this.calls.push({ currentUserId, workspaceId: targetWorkspaceId });
    if (targetWorkspaceId === malformedWorkspaceId) {
      const error = new Error("Workspace not found");
      error.getStatus = () => 404;
      error.getResponse = () => ({
        success: false,
        error: { code: "NOT_FOUND", message: "Workspace not found" }
      });
      throw error;
    }
    return { id: targetWorkspaceId };
  }
}

class FakePublisher {
  constructor(timeline = []) {
    this.events = [];
    this.timeline = timeline;
  }

  async publish(event) {
    this.timeline.push("published");
    this.events.push(event);
  }
}

function messageRow(overrides = {}) {
  return {
    id: message1Id,
    workspace_id: workspaceId,
    sender_user_id: userId,
    client_message_id: "client-1",
    content: "@Sein 확인 부탁해요",
    request_fingerprint: requestFingerprint,
    author_id: userId,
    author_display_name: "Juhyung",
    author_avatar_url: null,
    mentions: [
      {
        userId: mentionedUserId,
        displayText: "@Sein"
      }
    ],
    created_at: new Date("2026-07-16T00:00:00.000Z"),
    deleted_at: null,
    ...overrides
  };
}

function mentionRow(overrides = {}) {
  return {
    id: mention1Id,
    read_at: null,
    message_id: message1Id,
    excerpt: "@Sein 확인 부탁해요",
    actor_id: userId,
    actor_display_name: "Juhyung",
    actor_avatar_url: null,
    workspace_id: workspaceId,
    workspace_name: "PILO",
    created_at: new Date("2026-07-16T00:00:00.000Z"),
    ...overrides
  };
}

function createSubject(steps = []) {
  const database = new FakeDatabase(steps);
  const workspaceService = new FakeWorkspaceService(database.timeline);
  const publisher = new FakePublisher(database.timeline);
  const service = new ChatService(database, workspaceService, publisher);
  return { database, publisher, service, workspaceService };
}

function membershipGuard(result = { id: userId }) {
  return {
    method: "queryOne",
    match: /FROM workspace_members AS membership[\s\S]*FOR KEY SHARE/,
    values: [workspaceId, userId],
    result
  };
}

for (const [name, action] of [
  ["message list", service => service.listMessages(userId, workspaceId, {})],
  [
    "message context",
    service => service.getMessageContext(userId, workspaceId, message1Id)
  ],
  [
    "message create",
    service =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "membership-revoked",
        content: "확인 부탁해요",
        mentionedUserIds: []
      })
  ],
  [
    "message delete",
    service => service.deleteMessage(userId, workspaceId, message1Id)
  ]
]) {
  const { database, publisher, service, workspaceService } = createSubject([
    membershipGuard(null)
  ]);

  await assertApiError(() => action(service), 403, "FORBIDDEN");
  assert.deepEqual(
    database.timeline,
    ["access-checked", "transaction-started", "membership-guard"],
    `${name} must lock membership first inside its authoritative transaction`
  );
  assert.equal(database.queries.length, 1, `${name} must stop after membership loss`);
  assert.equal(workspaceService.calls.length, 1);
  assert.deepEqual(publisher.events, []);
  database.assertConsumed();
}

async function assertApiError(action, status, code) {
  await assert.rejects(action, error => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().error.code, code);
    return true;
  });
}

for (const [name, action] of [
  ["summary", service => service.getSummary(userId, malformedWorkspaceId)],
  [
    "message list",
    service => service.listMessages(userId, malformedWorkspaceId, {})
  ],
  [
    "message context",
    service =>
      service.getMessageContext(userId, malformedWorkspaceId, message1Id)
  ],
  [
    "message create",
    service =>
      service.createMessage(userId, malformedWorkspaceId, {
        clientMessageId: "invalid-workspace",
        content: "확인 부탁해요",
        mentionedUserIds: []
      })
  ],
  [
    "message delete",
    service => service.deleteMessage(userId, malformedWorkspaceId, message1Id)
  ],
  [
    "read state",
    service =>
      service.updateReadState(userId, malformedWorkspaceId, {
        lastReadMessageId: message1Id
      })
  ],
  [
    "mention list",
    service => service.listMentions(userId, malformedWorkspaceId, {})
  ],
  [
    "mention read",
    service => service.readMention(userId, malformedWorkspaceId, mention1Id)
  ]
]) {
  const { database, service, workspaceService } = createSubject();
  await assertApiError(
    () => action(service),
    400,
    "BAD_REQUEST"
  );
  assert.equal(
    workspaceService.calls.length,
    0,
    `${name} must validate workspaceId before access lookup`
  );
  database.assertConsumed();
}

for (const [name, action] of [
  [
    "context messageId",
    service => service.getMessageContext(userId, workspaceId, "message-1")
  ],
  [
    "delete messageId",
    service => service.deleteMessage(userId, workspaceId, "message-1")
  ],
  [
    "mentionId",
    service => service.readMention(userId, workspaceId, "mention-1")
  ]
]) {
  const { database, service, workspaceService } = createSubject();
  await assertApiError(
    () => action(service),
    400,
    "BAD_REQUEST"
  );
  assert.equal(
    workspaceService.calls.length,
    1,
    `${name} validation must preserve the valid Workspace access boundary`
  );
  database.assertConsumed();
}

{
  const inserted = messageRow({ mentions: [] });
  const createdRow = messageRow();
  const { database, publisher, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /client_message_id = \$3/,
      values: [workspaceId, userId, "client-1"],
      result: null
    },
    {
      method: "query",
      match: /FROM workspace_members AS membership/,
      values: [workspaceId, [mentionedUserId]],
      inspect(text) {
        assert.match(text, /FOR KEY SHARE OF membership/);
      },
      result: [
        {
          user_id: mentionedUserId,
          display_name: "Sein"
        }
      ]
    },
    {
      method: "queryOne",
      match: /INSERT INTO workspace_chat_messages/,
      values: [
        workspaceId,
        userId,
        "client-1",
        "@Sein 확인 부탁해요",
        requestFingerprint
      ],
      result: inserted
    },
    {
      method: "execute",
      match: /INSERT INTO workspace_chat_mentions/,
      values: [
        workspaceId,
        message1Id,
        [mentionedUserId],
        ["@Sein"]
      ],
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /message\.id = \$2/,
      values: [workspaceId, message1Id],
      result: createdRow
    }
  ]);

  const created = await service.createMessage(userId, workspaceId, {
    clientMessageId: "client-1",
    content: "@Sein 확인 부탁해요",
    mentionedUserIds: [mentionedUserId]
  });

  assert.equal(created.message.content, "@Sein 확인 부탁해요");
  assert.deepEqual(created.message.mentions, [
    { userId: mentionedUserId, displayText: "@Sein" }
  ]);
  assert.equal(created.replayed, false);
  assert.equal("requestFingerprint" in created.message, false);
  assert.equal("request_fingerprint" in created.message, false);
  assert.equal(publisher.events[0].type, "message.created");
  assert.equal(publisher.events[0].version, 1);
  assert.deepEqual(database.timeline, [
    "access-checked",
    "transaction-started",
    "membership-guard",
    "transaction-resolved",
    "published"
  ]);
  database.assertConsumed();
}

for (const content of ["   ", "x".repeat(4_001)]) {
  const { database, service } = createSubject();
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-validation",
        content,
        mentionedUserIds: []
      }),
    400,
    "BAD_REQUEST"
  );
  database.assertConsumed();
}

{
  const { service } = createSubject();
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-self",
        content: "@Me 확인",
        mentionedUserIds: [userId]
      }),
    400,
    "BAD_REQUEST"
  );
}

{
  const mentionIds = Array.from(
    { length: 21 },
    (_, index) => `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  );
  const { service } = createSubject();
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-too-many-mentions",
        content: "확인 부탁해요",
        mentionedUserIds: mentionIds
      }),
    400,
    "BAD_REQUEST"
  );
}

{
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /FROM workspace_members AS membership[\s\S]*FOR KEY SHARE/,
      values: [workspaceId, userId],
      result: null
    }
  ]);
  await assertApiError(
    () =>
      service.updateReadState(userId, workspaceId, {
        lastReadMessageId: message2Id
      }),
    403,
    "FORBIDDEN"
  );
  assert.deepEqual(database.timeline, [
    "access-checked",
    "transaction-started",
    "membership-guard"
  ]);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    { method: "queryOne", match: /client_message_id = \$3/, result: null },
    {
      method: "query",
      match: /FROM workspace_members AS membership/,
      result: []
    }
  ]);
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-nonmember",
        content: "@Unknown 확인",
        mentionedUserIds: [otherUserId]
      }),
    400,
    "BAD_REQUEST"
  );
  database.assertConsumed();
}

{
  const existing = messageRow({
    content: "@Sein @Other 확인 부탁해요",
    request_fingerprint: twoMentionRequestFingerprint,
    mentions: [
      { userId: mentionedUserId, displayText: "@Sein" },
      { userId: otherUserId, displayText: "@Other" }
    ]
  });
  const { database, publisher, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /client_message_id = \$3/,
      result: existing
    }
  ]);
  const replay = await service.createMessage(userId, workspaceId, {
    clientMessageId: "client-1",
    content: "@Sein @Other 확인 부탁해요",
    mentionedUserIds: [otherUserId, mentionedUserId, otherUserId]
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.message.id, message1Id);
  assert.deepEqual(publisher.events, []);
  database.assertConsumed();
}

{
  const deletedAt = new Date("2026-07-16T00:10:00.000Z");
  const deletedRow = messageRow({
    content: null,
    deleted_at: deletedAt,
    mentions: []
  });
  const { database, publisher, service } = createSubject([
    membershipGuard(),
    {
      method: "queryOne",
      match: /FOR UPDATE OF message/,
      result: messageRow()
    },
    {
      method: "execute",
      match: /UPDATE workspace_chat_messages/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /message\.id = \$2/,
      result: deletedRow
    }
  ]);

  const deleted = await service.deleteMessage(userId, workspaceId, message1Id);
  assert.equal(deleted.deletedAt, deletedAt.toISOString());
  assert.equal(publisher.events[0].type, "message.deleted");
  assert.deepEqual(database.timeline, [
    "access-checked",
    "transaction-started",
    "membership-guard",
    "transaction-resolved",
    "published"
  ]);
  database.assertConsumed();
}

{
  const deletedAt = new Date("2026-07-16T00:10:00.000Z");
  const tombstone = messageRow({
    content: null,
    deleted_at: deletedAt,
    mentions: []
  });
  const { database, publisher, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /client_message_id = \$3/,
      result: tombstone
    }
  ]);
  const replay = await service.createMessage(userId, workspaceId, {
    clientMessageId: "client-1",
    content: "@Sein 확인 부탁해요",
    mentionedUserIds: [mentionedUserId, mentionedUserId]
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.message.content, null);
  assert.equal(replay.message.deletedAt, deletedAt.toISOString());
  assert.deepEqual(replay.message.mentions, []);
  assert.deepEqual(publisher.events, []);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /client_message_id = \$3/,
      result: messageRow({
        content: null,
        deleted_at: new Date("2026-07-16T00:10:00.000Z"),
        mentions: []
      })
    }
  ]);
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-1",
        content: "다른 내용",
        mentionedUserIds: [mentionedUserId]
      }),
    409,
    "IDEMPOTENCY_KEY_REUSED"
  );
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "execute",
      match: /pg_advisory_xact_lock/,
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /client_message_id = \$3/,
      result: messageRow()
    }
  ]);
  await assertApiError(
    () =>
      service.createMessage(userId, workspaceId, {
        clientMessageId: "client-1",
        content: "다른 내용",
        mentionedUserIds: [mentionedUserId]
      }),
    409,
    "IDEMPOTENCY_KEY_REUSED"
  );
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "queryOne",
      match: /FOR UPDATE OF message/,
      values: [workspaceId, message1Id],
      result: messageRow({ sender_user_id: otherUserId, author_id: otherUserId })
    }
  ]);
  await assertApiError(
    () => service.deleteMessage(userId, workspaceId, message1Id),
    403,
    "FORBIDDEN"
  );
  database.assertConsumed();
}

{
  const deletedAt = new Date("2026-07-16T00:10:00.000Z");
  const tombstone = messageRow({
    content: null,
    deleted_at: deletedAt,
    mentions: []
  });
  const { database, publisher, service } = createSubject([
    membershipGuard(),
    {
      method: "queryOne",
      match: /FOR UPDATE OF message/,
      result: tombstone
    }
  ]);
  const deleted = await service.deleteMessage(userId, workspaceId, message1Id);
  assert.equal(deleted.content, null);
  assert.equal(deleted.deletedAt, deletedAt.toISOString());
  assert.deepEqual(publisher.events, []);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "queryOne",
      match: /FROM workspace_chat_messages AS target/,
      values: [workspaceId, message1Id],
      result: null
    }
  ]);
  await assertApiError(
    () => service.getMessageContext(userId, workspaceId, message1Id),
    404,
    "NOT_FOUND"
  );
  assert.ok(
    database.queries[1].text.includes("target.workspace_id = $1"),
    "cross-Workspace lookup must be hidden by workspace_id"
  );
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /FROM workspace_members AS membership[\s\S]*FOR KEY SHARE/,
      result: { id: userId }
    },
    {
      method: "execute",
      match: /INSERT INTO workspace_chat_reads/,
      values: [workspaceId, userId, message2Id],
      inspect(text) {
        assert.match(text, /FROM workspace_chat_messages AS target_message/);
        assert.match(text, /target_message\.workspace_id = \$1/);
        assert.match(text, /ON CONFLICT \(workspace_id, user_id\) DO NOTHING/);
      },
      result: { rows: [], rowCount: 1 }
    },
    {
      method: "queryOne",
      match: /FOR UPDATE/,
      values: [workspaceId, userId, message2Id],
      inspect(text) {
        assert.match(
          text,
          /\(target_message\.created_at, target_message\.id\)\s*>\s*\(current_message\.created_at, current_message\.id\)/
        );
        assert.match(text, /FOR UPDATE OF read_state/);
      },
      result: {
        workspace_id: workspaceId,
        user_id: userId,
        last_read_message_id: null,
        last_read_at: null,
        target_is_newer: true
      }
    },
    {
      method: "queryOne",
      match: /UPDATE workspace_chat_reads AS read_state/,
      values: [workspaceId, userId, message2Id],
      inspect(text) {
        assert.match(text, /last_read_message_id = \$3/);
      },
      result: {
        workspace_id: workspaceId,
        user_id: userId,
        last_read_message_id: message2Id,
        last_read_at: new Date("2026-07-16T00:10:00.000Z")
      }
    }
  ]);
  const read = await service.updateReadState(userId, workspaceId, {
    lastReadMessageId: message2Id
  });
  assert.equal(read.lastReadMessageId, message2Id);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /FROM workspace_members AS membership[\s\S]*FOR KEY SHARE/,
      values: [workspaceId, userId],
      result: { id: userId }
    },
    {
      method: "execute",
      match: /INSERT INTO workspace_chat_reads/,
      result: { rows: [], rowCount: 0 }
    },
    {
      method: "queryOne",
      match: /FOR UPDATE/,
      result: {
        workspace_id: workspaceId,
        user_id: userId,
        last_read_message_id: message3Id,
        last_read_at: new Date("2026-07-16T00:20:00.000Z"),
        target_is_newer: false
      }
    }
  ]);
  const stale = await service.updateReadState(userId, workspaceId, {
    lastReadMessageId: message1Id
  });
  assert.equal(stale.lastReadMessageId, message3Id);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /membership\.joined_at/,
      values: [workspaceId, userId],
      inspect(text) {
        assert.match(text, /unread_message\.sender_user_id <> \$2/);
        assert.match(text, /unread_message\.deleted_at IS NULL/);
        assert.match(text, /mention_message\.deleted_at IS NULL/);
        assert.match(text, /mention\.mentioned_user_id = \$2/);
      },
      result: {
        latest_message_id: message3Id,
        last_read_message_id: null,
        unread_count: "2",
        mention_unread_count: "1"
      }
    }
  ]);
  const summary = await service.getSummary(userId, workspaceId);
  assert.deepEqual(summary, {
    latestMessageId: message3Id,
    lastReadMessageId: null,
    unreadCount: 2,
    mentionUnreadCount: 1
  });
  assert.deepEqual(database.timeline, ["access-checked"]);
  database.assertConsumed();
}

{
  const rows = [
    messageRow({
      id: message3Id,
      client_message_id: "client-3",
      content: "third",
      mentions: [],
      created_at: new Date("2026-07-16T00:03:00.000Z")
    }),
    messageRow({
      id: message2Id,
      client_message_id: "client-2",
      content: "second",
      mentions: [],
      created_at: new Date("2026-07-16T00:02:00.000Z")
    }),
    messageRow({
      id: message1Id,
      client_message_id: "client-1",
      content: "first",
      mentions: [],
      created_at: new Date("2026-07-16T00:01:00.000Z")
    })
  ];
  const { database, service } = createSubject([
    membershipGuard(),
    {
      method: "query",
      match: /ORDER BY message\.created_at DESC, message\.id DESC/,
      values: [workspaceId, null, null, 3],
      result: rows
    }
  ]);
  const page = await service.listMessages(userId, workspaceId, { limit: "2" });
  assert.deepEqual(page.items.map(item => item.id), [message2Id, message3Id]);
  assert.deepEqual(decodeChatCursor(page.nextCursor), {
    createdAt: "2026-07-16T00:02:00.000Z",
    id: message2Id
  });
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    {
      method: "query",
      match: /FROM workspace_chat_mentions AS mention/,
      values: [workspaceId, userId, null, null, 51],
      result: [mentionRow()]
    }
  ]);
  const page = await service.listMentions(userId, workspaceId, {});
  assert.equal(page.items[0].id, mention1Id);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(database.timeline, ["access-checked"]);
  database.assertConsumed();
}

{
  const readAt = new Date("2026-07-16T00:10:00.000Z");
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /UPDATE workspace_chat_mentions AS mention/,
      values: [workspaceId, userId, mention1Id],
      result: mentionRow({ read_at: readAt })
    }
  ]);
  const mention = await service.readMention(
    userId,
    workspaceId,
    mention1Id
  );
  assert.equal(mention.readAt, readAt.toISOString());
  assert.deepEqual(database.timeline, ["access-checked"]);
  database.assertConsumed();
}

{
  const { database, service } = createSubject([
    {
      method: "queryOne",
      match: /UPDATE workspace_chat_mentions AS mention/,
      result: null
    }
  ]);
  await assertApiError(
    () => service.readMention(userId, otherWorkspaceId, mention1Id),
    404,
    "NOT_FOUND"
  );
  assert.ok(database.queries[0].text.includes("mention.workspace_id = $1"));
  database.assertConsumed();
}
