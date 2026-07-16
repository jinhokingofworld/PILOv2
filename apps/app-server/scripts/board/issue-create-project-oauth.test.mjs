import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GithubIssueWriteService
} = require("../../dist/modules/github-integration/github-issue-write.service.js");

const createdIssue = {
  id: 123,
  node_id: "I_kwDOExample",
  number: 42,
  title: "title",
  body: "body",
  html_url: "https://github.com/owner/private-repo/issues/42",
  state: "open",
  labels: [],
  assignees: [],
  milestone: null,
  updated_at: "2026-07-16T00:00:00.000Z"
};

function createService({ tokenScope = "project,repo" } = {}) {
  const connectionCalls = [];
  const githubInputs = [];
  const connectionService = {
    async getActiveConnection(userId, purpose) {
      connectionCalls.push({ userId, purpose });
      return {
        accessToken:
          purpose === "project_v2" ? "project-token" : "app-user-token",
        githubLogin: "owner",
        githubUserId: 123,
        tokenScope,
        connectedAt: "2026-07-16T00:00:00.000Z"
      };
    }
  };
  const githubAppClient = {
    async createRepositoryIssue(input) {
      githubInputs.push(input);
      return createdIssue;
    }
  };

  return {
    connectionCalls,
    githubInputs,
    service: new GithubIssueWriteService(
      {},
      githubAppClient,
      {},
      {},
      connectionService
    )
  };
}

{
  const { connectionCalls, githubInputs, service } = createService();

  const result = await service.createIssueWithProjectOAuth({
    currentUserId: "user-1",
    owner: "owner",
    repo: "private-repo",
    title: "title",
    body: "body"
  });

  assert.equal(result, createdIssue);
  assert.deepEqual(connectionCalls, [
    { userId: "user-1", purpose: "project_v2" }
  ]);
  assert.deepEqual(githubInputs, [
    {
      body: "body",
      owner: "owner",
      repo: "private-repo",
      title: "title",
      userAccessToken: "project-token"
    }
  ]);
}

{
  const { githubInputs, service } = createService({ tokenScope: "project" });

  await assert.rejects(
    () =>
      service.createIssueWithProjectOAuth({
        currentUserId: "user-1",
        owner: "owner",
        repo: "private-repo",
        title: "title",
        body: "body"
      }),
    (error) =>
      error.getResponse().error.message ===
      "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes"
  );
  assert.deepEqual(githubInputs, []);
}

{
  const { connectionCalls, githubInputs, service } = createService();

  await service.createIssue({
    currentUserId: "user-1",
    owner: "owner",
    repo: "private-repo",
    title: "title",
    body: "body"
  });

  assert.deepEqual(connectionCalls, [
    { userId: "user-1", purpose: "app_user" }
  ]);
  assert.equal(githubInputs[0].userAccessToken, "app-user-token");
}

console.log("Board issue ProjectV2 OAuth credential tests passed");
