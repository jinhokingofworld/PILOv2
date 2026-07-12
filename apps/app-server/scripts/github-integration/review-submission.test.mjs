import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");
const { GithubOAuthClient } = require("../../dist/modules/github-integration/github-oauth.client.js");
const { GithubTokenEncryptionService } = require("../../dist/modules/github-integration/github-token-encryption.service.js");

class FakeDatabase {
  constructor({ oneRows = [] } = {}) {
    this.oneRows = [...oneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    const next = this.oneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.accessChecks = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.accessChecks.push({ currentUserId, workspaceId });
    return { id: workspaceId };
  }
}

class FakeGithubOAuthClient {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.reviewRequests = [];
  }

  async submitPullRequestReview(input) {
    this.reviewRequests.push(input);
    if (this.fail) {
      throw new Error("provider raw error should not leak");
    }

    return {
      githubReviewId: "987654",
      githubReviewUrl: "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654"
    };
  }
}

const fixedNow = new Date("2026-07-06T12:00:00.000Z");
const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const pullRequestId = "55555555-5555-4555-8555-555555555555";
const baseConfig = {
  tokenEncryptionKey: "test-encryption-key",
  now: () => fixedNow
};
const configService = {
  getGithubOAuthConfig() {
    return baseConfig;
  }
};
const tokenEncryption = new GithubTokenEncryptionService();
const encryptedUserToken = tokenEncryption.encryptToken(
  "decrypted-github-oauth-value",
  baseConfig
);

function connectedGithubOAuthRow(overrides = {}) {
  return {
    github_user_id: "12345678",
    github_login: "octocat",
    access_token_encrypted: encryptedUserToken,
    token_scope: "",
    connected_at: fixedNow,
    revoked_at: null,
    ...overrides
  };
}

function pullRequestTargetRow(overrides = {}) {
  return {
    pr_number: 24,
    owner_login: "my-team",
    name: "pilo",
    ...overrides
  };
}

function createService({ database, githubOAuthClient, workspaceService } = {}) {
  const resolvedWorkspaceService = workspaceService ?? new FakeWorkspaceService();
  const resolvedGithubOAuthClient =
    githubOAuthClient ?? new FakeGithubOAuthClient();
  const service = new GithubIntegrationService(
    database ?? new FakeDatabase(),
    resolvedGithubOAuthClient,
    {},
    tokenEncryption,
    configService,
    resolvedWorkspaceService,
    {},
    {}
  );

  return {
    service,
    workspaceService: resolvedWorkspaceService,
    githubOAuthClient: resolvedGithubOAuthClient
  };
}

{
  const database = new FakeDatabase({
    oneRows: [connectedGithubOAuthRow(), pullRequestTargetRow()]
  });
  const githubOAuthClient = new FakeGithubOAuthClient();
  const { service, workspaceService } = createService({
    database,
    githubOAuthClient
  });

  assert.equal(typeof service.submitGithubPullRequestReview, "function");

  const result = await service.submitGithubPullRequestReview(
    currentUserId,
    workspaceId,
    pullRequestId,
    {
      submitType: "REQUEST_CHANGES",
      reviewBody: "Please check the stale state guard."
    }
  );

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.match(database.queries[0].text, /FROM github_oauth_connections/i);
  assert.match(database.queries[0].text, /access_token_encrypted/i);
  assert.deepEqual(database.queries[0].values, [currentUserId, "app_user"]);
  assert.match(database.queries[1].text, /FROM github_pull_requests/i);
  assert.match(database.queries[1].text, /JOIN github_repositories/i);
  assert.deepEqual(database.queries[1].values, [workspaceId, pullRequestId]);
  assert.doesNotMatch(JSON.stringify(database.queries), /decrypted-github-oauth-value/);
  assert.deepEqual(githubOAuthClient.reviewRequests, [
    {
      accessToken: "decrypted-github-oauth-value",
      owner: "my-team",
      repo: "pilo",
      pullNumber: 24,
      event: "REQUEST_CHANGES",
      body: "Please check the stale state guard."
    }
  ]);
  assert.deepEqual(result, {
    submittedByGithubLogin: "octocat",
    githubReviewId: "987654",
    githubReviewUrl: "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
    submittedAt: "2026-07-06T12:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(result), /decrypted-github-oauth-value/);
}

{
  const githubOAuthClient = new FakeGithubOAuthClient();
  const { service } = createService({
    database: new FakeDatabase({
      oneRows: [
        connectedGithubOAuthRow({
          access_token_encrypted: null,
          connected_at: null
        })
      ]
    }),
    githubOAuthClient
  });

  await assert.rejects(
    () =>
      service.submitGithubPullRequestReview(
        currentUserId,
        workspaceId,
        pullRequestId,
        {
          submitType: "COMMENT",
          reviewBody: "Looks good."
        }
      ),
    (error) =>
      error?.response?.error?.message === "GitHub OAuth connection is required"
  );
  assert.deepEqual(githubOAuthClient.reviewRequests, []);
}

{
  const { service } = createService({
    database: new FakeDatabase({
      oneRows: [connectedGithubOAuthRow(), null]
    })
  });

  await assert.rejects(
    () =>
      service.submitGithubPullRequestReview(
        currentUserId,
        workspaceId,
        pullRequestId,
        {
          submitType: "COMMENT",
          reviewBody: "Looks good."
        }
      ),
    (error) =>
      error?.response?.error?.message === "GitHub pull request not found"
  );
}

{
  const { service } = createService({
    database: new FakeDatabase({
      oneRows: [connectedGithubOAuthRow(), pullRequestTargetRow()]
    }),
    githubOAuthClient: new FakeGithubOAuthClient({ fail: true })
  });

  await assert.rejects(
    () =>
      service.submitGithubPullRequestReview(
        currentUserId,
        workspaceId,
        pullRequestId,
        {
          submitType: "APPROVE",
          reviewBody: "Approved."
        }
      ),
    (error) =>
      error?.response?.error?.message === "GitHub Review submission failed"
  );
}

{
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = {};
  let requestBody = "";
  globalThis.fetch = async (url, options) => {
    requestUrl = url.toString();
    requestHeaders = options?.headers ?? {};
    requestBody = String(options?.body ?? "");

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 123456,
          html_url:
            "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456"
        };
      }
    };
  };

  try {
    const result = await new GithubOAuthClient().submitPullRequestReview({
      accessToken: "oauth-access-value",
      owner: "my-team",
      repo: "pilo",
      pullNumber: 24,
      event: "COMMENT",
      body: "LGTM"
    });

    assert.equal(
      requestUrl,
      "https://api.github.com/repos/my-team/pilo/pulls/24/reviews"
    );
    assert.equal(requestHeaders.Authorization, "Bearer oauth-access-value");
    assert.equal(requestHeaders["X-GitHub-Api-Version"], "2026-03-10");
    assert.deepEqual(JSON.parse(requestBody), {
      event: "COMMENT",
      body: "LGTM"
    });
    assert.doesNotMatch(requestBody, /comments/);
    assert.deepEqual(result, {
      githubReviewId: "123456",
      githubReviewUrl:
        "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return {
        message: "provider raw error should not leak"
      };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubOAuthClient().submitPullRequestReview({
          accessToken: "oauth-access-value",
          owner: "my-team",
          repo: "pilo",
          pullNumber: 24,
          event: "COMMENT",
          body: "LGTM"
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub OAuth connection is invalid"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return {
        message: "provider permission details should not leak"
      };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubOAuthClient().submitPullRequestReview({
          accessToken: "oauth-access-value",
          owner: "my-team",
          repo: "pilo",
          pullNumber: 24,
          event: "COMMENT",
          body: "LGTM"
        }),
      (error) =>
        error?.response?.error?.message ===
          "GitHub App Pull requests write permission is required" &&
        error?.getStatus?.() === 403
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
