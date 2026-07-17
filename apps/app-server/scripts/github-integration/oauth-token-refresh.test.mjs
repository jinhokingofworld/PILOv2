import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubOAuthClient } = require(
  "../../dist/modules/github-integration/github-oauth.client.js"
);

const fixedNowEpochMs = Date.parse("2026-07-17T00:00:00.000Z");
const accessToken = "fixture-access-token";
const refreshToken = "fixture-refresh-token";
const rotatedAccessToken = "fixture-rotated-access-token";
const rotatedRefreshToken = "fixture-rotated-refresh-token";
const tokenFixtures = [
  accessToken,
  refreshToken,
  rotatedAccessToken,
  rotatedRefreshToken
];

async function withFetch(fetchImplementation, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withFixedNow(callback) {
  const originalNow = Date.now;
  Date.now = () => fixedNowEpochMs;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

async function captureRejection(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  assert.fail("Expected callback to reject");
}

function assertTokenFree(error) {
  const serialized = [
    String(error),
    error instanceof Error ? error.stack ?? "" : "",
    JSON.stringify(error)
  ].join("\n");
  for (const fixture of tokenFixtures) {
    assert.equal(
      serialized.includes(fixture),
      false,
      `Thrown value must not contain token fixture ${fixture}`
    );
  }
}

{
  const client = new GithubOAuthClient();
  await withFixedNow(() =>
    withFetch(
      async (url, init) => {
        assert.equal(url, "https://github.com/login/oauth/access_token");
        assert.equal(init?.method, "POST");
        return new Response(
          JSON.stringify({
            access_token: accessToken,
            scope: "repo",
            refresh_token: refreshToken,
            expires_in: 28800,
            refresh_token_expires_in: 15897600
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
      async () => {
        const token = await client.exchangeCodeForAccessToken({
          clientId: "client-id",
          clientSecret: "client-secret",
          code: "authorization-code",
          redirectUri: "https://api.pilo.test/api/v1/github/oauth/callback"
        });

        assert.deepEqual(token, {
          accessToken,
          scope: "repo",
          refreshToken,
          accessTokenExpiresAt: "2026-07-17T08:00:00.000Z",
          refreshTokenExpiresAt: "2027-01-17T00:00:00.000Z"
        });
      }
    )
  );
}

{
  const client = new GithubOAuthClient();
  let requestBody;
  await withFixedNow(() =>
    withFetch(
      async (url, init) => {
        assert.equal(url, "https://github.com/login/oauth/access_token");
        assert.equal(init?.method, "POST");
        requestBody = new URLSearchParams(init?.body);
        return new Response(
          JSON.stringify({
            access_token: rotatedAccessToken,
            scope: "repo",
            refresh_token: rotatedRefreshToken,
            expires_in: 28800,
            refresh_token_expires_in: 15897600
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
      async () => {
        const token = await client.refreshAccessToken({
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken
        });

        assert.equal(requestBody.get("grant_type"), "refresh_token");
        assert.equal(requestBody.get("refresh_token"), refreshToken);
        assert.deepEqual(token, {
          accessToken: rotatedAccessToken,
          scope: "repo",
          refreshToken: rotatedRefreshToken,
          accessTokenExpiresAt: "2026-07-17T08:00:00.000Z",
          refreshTokenExpiresAt: "2027-01-17T00:00:00.000Z"
        });
      }
    )
  );
}

{
  const client = new GithubOAuthClient();
  const error = await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          access_token: accessToken,
          refresh_token: refreshToken
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      ),
    () =>
      captureRejection(() =>
        client.refreshAccessToken({
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken
        })
      )
  );

  assert.equal(error?.constructor?.name, "GithubOAuthRefreshRejectedError");
  assertTokenFree(error);
}

for (const fetchImplementation of [
  async () => {
    throw new Error(`network failure ${refreshToken}`);
  },
  async () =>
    new Response(`provider failure ${accessToken}`, {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    }),
  async () =>
    new Response(
      JSON.stringify({
        access_token: rotatedAccessToken,
        scope: "repo",
        refresh_token: rotatedRefreshToken
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
]) {
  const client = new GithubOAuthClient();
  const error = await withFetch(fetchImplementation, () =>
    captureRejection(() =>
      client.refreshAccessToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken
      })
    )
  );

  assert.notEqual(error?.constructor?.name, "GithubOAuthRefreshRejectedError");
  assert.equal(
    error?.response?.error?.message,
    "GitHub OAuth token refresh failed"
  );
  assertTokenFree(error);
}

{
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandle = { name: "github-oauth-refresh-timeout" };
  let scheduledCallback;
  let scheduledDelay;
  let clearedHandle;

  globalThis.setTimeout = (callback, delay) => {
    scheduledCallback = callback;
    scheduledDelay = delay;
    return timerHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedHandle = handle;
  };

  try {
    const client = new GithubOAuthClient();
    let receivedSignal;
    const error = await withFetch(
      async (_url, init) => {
        receivedSignal = init?.signal;
        scheduledCallback();
        assert.equal(receivedSignal?.aborted, true);
        throw new DOMException("controlled timeout", "AbortError");
      },
      () =>
        captureRejection(() =>
          client.refreshAccessToken({
            clientId: "client-id",
            clientSecret: "client-secret",
            refreshToken
          })
        )
    );

    assert.equal(scheduledDelay, 10_000);
    assert.equal(clearedHandle, timerHandle);
    assert.notEqual(
      error?.constructor?.name,
      "GithubOAuthRefreshRejectedError"
    );
    assert.equal(
      error?.response?.error?.message,
      "GitHub OAuth token refresh failed"
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

{
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandle = { name: "github-oauth-response-timeout" };
  let scheduledCallback;
  let scheduledDelay;
  let clearedHandle;
  let timerClearedBeforeJson;
  let receivedSignal;

  globalThis.setTimeout = (callback, delay) => {
    scheduledCallback = callback;
    scheduledDelay = delay;
    return timerHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedHandle = handle;
  };

  try {
    const client = new GithubOAuthClient();
    const error = await withFetch(
      async (_url, init) => {
        receivedSignal = init?.signal;
        const response = new Response(null, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
        response.json = () =>
          new Promise((_resolve, reject) => {
            timerClearedBeforeJson = clearedHandle === timerHandle;
            receivedSignal.addEventListener("abort", () => {
              reject(new DOMException("stalled response body", "AbortError"));
            });
            scheduledCallback();
          });
        return response;
      },
      () =>
        captureRejection(() =>
          client.refreshAccessToken({
            clientId: "client-id",
            clientSecret: "client-secret",
            refreshToken
          })
        )
    );

    assert.equal(scheduledDelay, 10_000);
    assert.equal(timerClearedBeforeJson, false);
    assert.equal(receivedSignal?.aborted, true);
    assert.equal(clearedHandle, timerHandle);
    assert.notEqual(
      error?.constructor?.name,
      "GithubOAuthRefreshRejectedError"
    );
    assert.equal(
      error?.response?.error?.message,
      "GitHub OAuth token refresh failed"
    );
    assertTokenFree(error);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}
