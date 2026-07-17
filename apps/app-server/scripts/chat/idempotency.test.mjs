import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canonicalizeChatRequestPayload,
  computeChatRequestFingerprint
} = require("../../dist/modules/chat/chat-idempotency.js");

const firstUserId = "22222222-2222-4222-8222-222222222222";
const secondUserId = "33333333-3333-4333-8333-333333333333";
const content = "@Sein 확인 부탁해요";
const canonicalPayload = JSON.stringify({
  content,
  mentionedUserIds: [firstUserId, secondUserId]
});

assert.equal(
  canonicalizeChatRequestPayload({
    content,
    mentionedUserIds: [secondUserId, firstUserId, secondUserId]
  }),
  canonicalPayload
);
assert.equal(
  computeChatRequestFingerprint({
    content,
    mentionedUserIds: [secondUserId, firstUserId, secondUserId]
  }),
  "ad7b572e282a8115406130becc9d9da70ad40751961c0f939024e6c1f7235eee"
);
assert.equal(
  computeChatRequestFingerprint({
    content,
    mentionedUserIds: [firstUserId, secondUserId]
  }),
  computeChatRequestFingerprint({
    content,
    mentionedUserIds: [secondUserId, firstUserId, firstUserId]
  })
);
assert.notEqual(
  computeChatRequestFingerprint({
    content: `${content}!`,
    mentionedUserIds: [firstUserId, secondUserId]
  }),
  computeChatRequestFingerprint({
    content,
    mentionedUserIds: [firstUserId, secondUserId]
  })
);
