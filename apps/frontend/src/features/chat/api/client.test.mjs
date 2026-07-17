import assert from "node:assert/strict";

import {
  ChatApiError,
  createChatMessage,
  deleteChatMessage,
  getChatMessageContext,
  getChatSummary,
  listChatMentions,
  listChatMessages,
  readChatMention,
  updateChatReadState,
} from "./client.ts";

const originalFetch = globalThis.fetch;
const calls = [];

function success(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return success({ items: [], nextCursor: null });
};

try {
  await createChatMessage("token", "workspace-1", {
    clientMessageId: "client-1",
    content: "hello",
    mentionedUserIds: [],
  });
  assert.equal(
    calls[0].url.endsWith(
      "/api/v1/workspaces/workspace-1/chat/messages",
    ),
    true,
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    clientMessageId: "client-1",
    content: "hello",
    mentionedUserIds: [],
  });

  await getChatSummary("token", "workspace /1");
  assert.match(calls.at(-1).url, /workspaces\/workspace%20%2F1\/chat\/summary$/);
  assert.equal(calls.at(-1).init.method, "GET");

  await listChatMessages("token", "workspace-1", {
    before: "cursor /?",
    limit: 25,
  });
  assert.match(
    calls.at(-1).url,
    /\/chat\/messages\?before=cursor\+%2F%3F&limit=25$/,
  );

  await getChatMessageContext("token", "workspace-1", "message /1");
  assert.match(calls.at(-1).url, /\/messages\/message%20%2F1\/context$/);

  await deleteChatMessage("token", "workspace-1", "message /1");
  assert.match(calls.at(-1).url, /\/messages\/message%20%2F1$/);
  assert.equal(calls.at(-1).init.method, "DELETE");

  await updateChatReadState("token", "workspace-1", "message /1");
  assert.match(calls.at(-1).url, /\/chat\/read-state$/);
  assert.equal(calls.at(-1).init.method, "PUT");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    lastReadMessageId: "message /1",
  });

  await listChatMentions("token", "workspace-1", {
    before: "mention cursor",
    limit: 10,
  });
  assert.match(
    calls.at(-1).url,
    /\/chat\/mentions\?before=mention\+cursor&limit=10$/,
  );

  await readChatMention("token", "workspace-1", "mention /1");
  assert.match(calls.at(-1).url, /\/mentions\/mention%20%2F1\/read$/);
  assert.equal(calls.at(-1).init.method, "PUT");

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "client message id was reused",
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 409,
      },
    );
  };

  await assert.rejects(
    () =>
      createChatMessage("token", "workspace-1", {
        clientMessageId: "client-1",
        content: "changed",
        mentionedUserIds: [],
      }),
    (error) => {
      assert.equal(error instanceof ChatApiError, true);
      assert.equal(error.status, 409);
      assert.equal(error.code, "IDEMPOTENCY_KEY_REUSED");
      assert.match(error.path, /\/chat\/messages$/);
      return true;
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}
