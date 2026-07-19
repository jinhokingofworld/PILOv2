import assert from "node:assert/strict";
import test from "node:test";

import {
  ScreenShareApiError,
  createScreenShareApiClient,
} from "./client.ts";

const session = {
  id: "session-1",
  sharer: {
    userId: "user-1",
    displayName: "Sharer",
    avatarUrl: null,
  },
  startedAt: "2026-07-18T00:00:01.000Z",
};

const startPayload = {
  id: "session-1",
  status: "starting",
  startedAt: null,
  sharer: session.sharer,
  livekitUrl: "wss://livekit.example.com",
  livekitToken: "publisher-token",
  expiresAt: "2026-07-18T01:00:00.000Z",
};

function response(data, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("screen share client calls all four endpoints with exact paths, methods, and auth", async () => {
  const calls = [];
  const responses = [
    response({ session }),
    response(startPayload, 201),
    response({
      livekitUrl: "wss://livekit.example.com",
      livekitToken: "viewer-token",
      expiresAt: "2026-07-18T01:00:00.000Z",
    }),
    response({ sessionId: "session /1", ended: true }),
  ];
  const client = createScreenShareApiClient({
    accessToken: "access-token",
    baseUrl: "https://app.example.com/api/v1/",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });

  assert.deepEqual(await client.getCurrent("workspace /1"), { session });
  assert.deepEqual(await client.start("workspace /1"), startPayload);
  assert.deepEqual(
    await client.createViewerToken("workspace /1", "session /1"),
    {
      livekitUrl: "wss://livekit.example.com",
      livekitToken: "viewer-token",
      expiresAt: "2026-07-18T01:00:00.000Z",
    },
  );
  assert.deepEqual(await client.end("workspace /1", "session /1"), {
    sessionId: "session /1",
    ended: true,
  });

  const base =
    "https://app.example.com/api/v1/workspaces/workspace%20%2F1/screen-share-sessions";
  assert.deepEqual(
    calls.map(({ url, init }) => ({
      url,
      method: init.method,
      authorization: new Headers(init.headers).get("Authorization"),
      body: init.body,
    })),
    [
      {
        url: `${base}/current`,
        method: "GET",
        authorization: "Bearer access-token",
        body: undefined,
      },
      {
        url: base,
        method: "POST",
        authorization: "Bearer access-token",
        body: undefined,
      },
      {
        url: `${base}/session%20%2F1/viewer-token`,
        method: "POST",
        authorization: "Bearer access-token",
        body: undefined,
      },
      {
        url: `${base}/session%20%2F1`,
        method: "DELETE",
        authorization: "Bearer access-token",
        body: undefined,
      },
    ],
  );
});

test("screen share client maps API error status, code, path, and message", async () => {
  const client = createScreenShareApiClient({
    accessToken: "access-token",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "SCREEN_SHARE_ALREADY_ACTIVE",
            message: "Screen share is already active",
            details: { session },
          },
        }),
        { status: 409 },
      ),
  });

  await assert.rejects(
    () => client.start("workspace-1"),
    (error) => {
      assert.equal(error instanceof ScreenShareApiError, true);
      assert.equal(error.status, 409);
      assert.equal(error.code, "SCREEN_SHARE_ALREADY_ACTIVE");
      assert.equal(
        error.path,
        "/workspaces/workspace-1/screen-share-sessions",
      );
      assert.equal(error.message, "Screen share is already active");
      assert.deepEqual(error.details, { session });
      return true;
    },
  );
});

test("screen share client discards unvalidated conflict details", async () => {
  const client = createScreenShareApiClient({
    accessToken: "access-token",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "SCREEN_SHARE_ALREADY_ACTIVE",
            message: "Screen share is already active",
            details: {
              session: {
                ...session,
                livekitToken: "must-not-escape",
              },
            },
          },
        }),
        { status: 409 },
      ),
  });

  await assert.rejects(
    () => client.start("workspace-1"),
    (error) => {
      assert.equal(error instanceof ScreenShareApiError, true);
      assert.equal(error.details, undefined);
      return true;
    },
  );
});
