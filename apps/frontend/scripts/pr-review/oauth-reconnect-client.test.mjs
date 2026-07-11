import assert from "node:assert/strict";

const { createPrReviewApiClient } = await import(
  "../../src/features/pr-review/api/client.ts"
);

const requests = [];
const client = createPrReviewApiClient({
  accessToken: "pilo-access-token",
  baseUrl: "https://api.example.test/api/v1",
  fetcher: async (url, init) => {
    requests.push({ url, init });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          authorizeUrl: "https://github.com/login/oauth/authorize?state=test",
          state: "signed-state"
        }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});

const result = await client.startGithubOAuth("/github");

assert.equal(
  result.authorizeUrl,
  "https://github.com/login/oauth/authorize?state=test"
);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://api.example.test/api/v1/me/github/oauth/start");
assert.equal(requests[0].init.method, "POST");
assert.equal(requests[0].init.credentials, "include");
assert.deepEqual(JSON.parse(requests[0].init.body), { returnUrl: "/github" });
assert.equal(
  requests[0].init.headers.get("Authorization"),
  "Bearer pilo-access-token"
);

console.log("PR Review OAuth reconnect client tests passed");
