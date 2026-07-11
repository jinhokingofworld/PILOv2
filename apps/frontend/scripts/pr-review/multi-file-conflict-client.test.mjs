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
          reviewSessionId: "session-id",
          pullRequestId: "pull-request-id",
          status: "applied",
          appliedByGithubLogin: "Developer-EJ",
          commitSha: "commit-sha",
          commitUrl: null,
          headShaBefore: "head-sha",
          headShaAfter: "commit-sha",
          files: [],
          conflictStatus: "clean",
          conflictCheckedAt: "2026-07-10T00:00:00.000Z",
          localStateStatus: "updated"
        }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});

const input = {
  expectedHeadSha: "head-sha",
  files: [
    {
      reviewFileId: "first-file",
      resolvedContent: "const first = true;\n",
      expectedHeadBlobSha: "first-blob"
    },
    {
      reviewFileId: "second-file",
      resolvedContent: "const second = true;\n",
      expectedHeadBlobSha: "second-blob"
    }
  ]
};

await client.applyReviewSessionConflictResolutions(
  "workspace-id",
  "session-id",
  input
);

assert.equal(requests.length, 1);
assert.equal(
  requests[0].url,
  "https://api.example.test/api/v1/workspaces/workspace-id/github/review-sessions/session-id/conflict-apply"
);
assert.equal(requests[0].init.method, "POST");
assert.deepEqual(JSON.parse(requests[0].init.body), input);
assert.equal(
  requests[0].init.headers.get("Authorization"),
  "Bearer pilo-access-token"
);

const suggestionInput = {
  currentDraft: {
    resolvedContent: "const first = true;\n",
    hunks: [
      {
        hunkId: "hunk-1",
        source: "manual",
        resolvedText: "const first = true;"
      }
    ]
  }
};
await client.createReviewFileConflictSuggestion(
  "workspace-id",
  "first-file",
  suggestionInput
);

assert.equal(requests.length, 2);
assert.equal(
  requests[1].url,
  "https://api.example.test/api/v1/workspaces/workspace-id/github/review-files/first-file/conflict-suggestion"
);
assert.equal(requests[1].init.method, "POST");
assert.deepEqual(JSON.parse(requests[1].init.body), suggestionInput);

console.log("PR Review multi-file conflict client tests passed");
