import assert from "node:assert/strict";

import {
  findFirstUnreadChatMessageIndex,
  mergeChronologicalChatMessages,
  preservePrependScrollTop,
  shouldObserveChatRead,
  shouldMarkChatRead,
} from "./chat-read-policy.ts";

assert.equal(
  shouldObserveChatRead({ targetMessageId: null, targetPositioned: false }),
  true,
);
assert.equal(
  shouldObserveChatRead({
    targetMessageId: "message-old",
    targetPositioned: false,
  }),
  false,
);
assert.equal(
  shouldObserveChatRead({
    targetMessageId: "message-old",
    targetPositioned: true,
  }),
  true,
);

assert.equal(
  shouldMarkChatRead({
    pathname: "/chat",
    documentVisible: true,
    bottomVisible: true,
  }),
  true,
);
assert.equal(
  shouldMarkChatRead({
    pathname: "/chat",
    documentVisible: false,
    bottomVisible: true,
  }),
  false,
);
assert.equal(
  shouldMarkChatRead({
    pathname: "/board",
    documentVisible: true,
    bottomVisible: true,
  }),
  false,
);
assert.equal(
  shouldMarkChatRead({
    pathname: "/chat/thread",
    documentVisible: true,
    bottomVisible: true,
  }),
  true,
);

{
  const messages = [
    { id: "message-1" },
    { id: "message-2" },
    { id: "message-3" },
  ];

  assert.equal(
    findFirstUnreadChatMessageIndex(messages, "message-1", 2),
    1,
  );
  assert.equal(findFirstUnreadChatMessageIndex(messages, null, 2), 1);
  assert.equal(
    findFirstUnreadChatMessageIndex(messages, "message-3", 0),
    -1,
  );
}

assert.equal(
  preservePrependScrollTop({
    previousScrollHeight: 800,
    previousScrollTop: 120,
    nextScrollHeight: 1_150,
  }),
  470,
);

{
  const messages = mergeChronologicalChatMessages(
    [
      { id: "message-1", createdAt: "2026-07-16T00:01:00.000Z" },
      { id: "message-2", createdAt: "2026-07-16T00:02:00.000Z" },
    ],
    [
      {
        id: "message-2",
        createdAt: "2026-07-16T00:02:00.000Z",
        deletedAt: "2026-07-16T00:03:00.000Z",
      },
      { id: "message-3", createdAt: "2026-07-16T00:03:00.000Z" },
    ],
  );

  assert.deepEqual(
    messages.map(({ id }) => id),
    ["message-1", "message-2", "message-3"],
  );
  assert.equal(messages[1].deletedAt, "2026-07-16T00:03:00.000Z");
}
