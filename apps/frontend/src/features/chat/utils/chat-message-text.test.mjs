import assert from "node:assert/strict";

import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatComposerRequestScope,
  filterChatMentionMembers,
  findActiveChatMention,
  isChatDraftSubmittable,
  pruneChatMentions,
  pruneChatMentionIds,
  replaceActiveChatMention,
  restoreFailedChatDraft,
  segmentChatMessage,
  upsertChatMentionSelection,
} from "./chat-message-text.ts";

{
  const scope = createChatComposerRequestScope();
  const firstRequestIsCurrent = scope.begin();
  assert.equal(firstRequestIsCurrent(), true);
  scope.invalidate();
  assert.equal(firstRequestIsCurrent(), false);

  const secondRequestIsCurrent = scope.begin();
  assert.equal(secondRequestIsCurrent(), true);
  const thirdRequestIsCurrent = scope.begin();
  assert.equal(secondRequestIsCurrent(), false);
  assert.equal(thirdRequestIsCurrent(), true);
}

{
  const segments = segmentChatMessage("문서 https://pilo.dev @Sein", [
    { userId: "user-2", displayText: "@Sein" },
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["text", "link", "text", "mention"],
  );
  assert.equal(segments[1].href, "https://pilo.dev");
  assert.equal(segments[3].userId, "user-2");
}

{
  const [segment] = segmentChatMessage("javascript:alert(1)", []);
  assert.equal(segment.kind, "text");
  assert.equal(segment.text, "javascript:alert(1)");
}

{
  const segments = segmentChatMessage("@Sein Kim 확인", [
    { userId: "user-short", displayText: "@Sein" },
    { userId: "user-long", displayText: "@Sein Kim" },
  ]);

  assert.deepEqual(segments[0], {
    kind: "mention",
    text: "@Sein Kim",
    userId: "user-long",
  });
}

{
  assert.deepEqual(segmentChatMessage("@Anna 확인", [
    { userId: "user-ann", displayText: "@Ann" },
  ]), [{ kind: "text", text: "@Anna 확인" }]);
  assert.deepEqual(segmentChatMessage("(@Ann), 확인", [
    { userId: "user-ann", displayText: "@Ann" },
  ]).map((segment) => segment.kind), ["text", "mention", "text"]);
}

{
  assert.deepEqual(findActiveChatMention("확인 @se", 6), {
    end: 6,
    query: "se",
    start: 3,
  });
  assert.equal(findActiveChatMention("확인 @sein ", 9), null);
  assert.equal(findActiveChatMention("email@sein", 10), null);
}

{
  const members = [
    { userId: "user-1", displayName: "Current", avatarUrl: null },
    { userId: "user-2", displayName: "Sein Kim", avatarUrl: null },
    { userId: "user-3", displayName: "Juhyeong", avatarUrl: null },
  ];

  assert.deepEqual(
    filterChatMentionMembers(members, "SE", "user-1").map(
      ({ userId }) => userId,
    ),
    ["user-2"],
  );
  assert.deepEqual(
    filterChatMentionMembers(members, "", "user-1").map(
      ({ userId }) => userId,
    ),
    ["user-2", "user-3"],
  );
}

{
  const token = findActiveChatMention("확인 @se 부탁", 6);
  assert.ok(token);
  assert.deepEqual(replaceActiveChatMention("확인 @se 부탁", token, "Sein"), {
    cursor: 9,
    displayText: "@Sein",
    text: "확인 @Sein 부탁",
  });
}

{
  const selections = [
    { userId: "user-2", displayText: "@Sein" },
    { userId: "user-3", displayText: "@Juhyeong" },
    { userId: "user-2", displayText: "@Sein" },
  ];

  assert.deepEqual(pruneChatMentionIds("@Sein 확인 부탁해요", selections), [
    "user-2",
  ]);
  assert.deepEqual(pruneChatMentionIds("@Seina 확인 부탁해요", selections), []);
  assert.deepEqual(pruneChatMentions("@Sein 확인 부탁해요", selections), [
    { userId: "user-2", displayText: "@Sein" },
  ]);
}

{
  const selections = upsertChatMentionSelection(
    [{ userId: "user-alex-1", displayText: "@Alex" }],
    { userId: "user-alex-2", displayText: "@Alex" },
  );

  assert.deepEqual(selections, [
    { userId: "user-alex-2", displayText: "@Alex" },
  ]);
}

{
  assert.equal(CHAT_MESSAGE_MAX_LENGTH, 4_000);
  assert.equal(isChatDraftSubmittable("메시지", false), true);
  assert.equal(isChatDraftSubmittable(" ", false), false);
  assert.equal(isChatDraftSubmittable("a".repeat(4_000), false), true);
  assert.equal(isChatDraftSubmittable("a".repeat(4_001), false), false);
  assert.equal(isChatDraftSubmittable("메시지", true), false);
}

{
  const snapshot = {
    draft: "@Sein 확인 부탁해요",
    mentionSelections: [{ userId: "user-2", displayText: "@Sein" }],
  };

  assert.deepEqual(
    restoreFailedChatDraft({
      currentDraft: "",
      currentMentionSelections: [],
      snapshot,
    }),
    snapshot,
  );
  assert.deepEqual(
    restoreFailedChatDraft({
      currentDraft: "새 메시지",
      currentMentionSelections: [],
      snapshot,
    }),
    { draft: "새 메시지", mentionSelections: [] },
  );
}
