import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GithubIssueWriteService
} = require("../../dist/modules/github-integration/github-issue-write.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";

class FakeDatabase {
  async queryOne() {
    return {
      github_login: "juhyeong",
      github_user_id: "12345678",
      access_token_encrypted: "encrypted-token",
      token_scope: "",
      connected_at: "2026-07-10T00:00:00.000Z",
      revoked_at: null
    };
  }
}

class FakeGithubAppClient {
  constructor({ assignees = [], updatedAssignees = null } = {}) {
    this.assignees = assignees;
    this.updatedAssignees = updatedAssignees;
    this.listCalls = [];
    this.updateCalls = [];
  }

  async listRepositoryAssignees(input) {
    this.listCalls.push(input);
    return this.assignees;
  }

  async updateRepositoryIssue(input) {
    this.updateCalls.push(input);
    return githubIssue({
      assignees: (this.updatedAssignees ?? input.assignees ?? []).map((login) => ({
        login,
        avatar_url: `https://avatar.test/${login}`
      })),
      title: input.title ?? "Board issue assignee update"
    });
  }
}

class FakeTokenEncryptionService {
  decryptToken(value) {
    assert.equal(value, "encrypted-token");
    return "user-oauth-token";
  }
}

class FakeConfigService {
  getGithubOAuthConfig() {
    return {};
  }
}

function assignee(login) {
  return {
    login,
    avatar_url: `https://avatar.test/${login}`
  };
}

function githubIssue(overrides = {}) {
  return {
    id: 9999,
    node_id: "I_kwDOExample",
    number: 609,
    title: "Board issue 담당자 변경",
    body: "본문",
    state: "open",
    html_url: "https://github.com/Developer-EJ/PILO/issues/609",
    labels: [],
    assignees: [],
    milestone: null,
    ...overrides
  };
}

function createSubject(client) {
  return new GithubIssueWriteService(
    new FakeDatabase(),
    client,
    new FakeTokenEncryptionService(),
    new FakeConfigService()
  );
}

{
  const client = new FakeGithubAppClient({
    assignees: [assignee("alice"), assignee("bob")]
  });
  const service = createSubject(client);

  const result = await service.listAssignableUsers({
    currentUserId,
    owner: "Developer-EJ",
    repo: "PILO"
  });

  assert.deepEqual(result, [assignee("alice"), assignee("bob")]);
  assert.deepEqual(client.listCalls, [
    {
      owner: "Developer-EJ",
      repo: "PILO",
      userAccessToken: "user-oauth-token"
    }
  ]);
}

{
  const client = new FakeGithubAppClient({
    assignees: [assignee("alice"), assignee("bob")],
    updatedAssignees: ["BOB", "Alice"]
  });
  const service = createSubject(client);

  const result = await service.updateIssue({
    assignees: ["alice", "bob"],
    currentUserId,
    issueNumber: 609,
    owner: "Developer-EJ",
    repo: "PILO"
  });

  assert.equal(result.assigneesApplied, true);
  assert.deepEqual(
    result.issue.assignees.map((item) => item.login),
    ["BOB", "Alice"]
  );
  assert.equal(client.updateCalls.length, 1);
  assert.deepEqual(client.updateCalls[0].assignees, ["alice", "bob"]);
}

{
  const client = new FakeGithubAppClient({ assignees: [assignee("alice")] });
  const service = createSubject(client);

  await assert.rejects(
    () =>
      service.updateIssue({
        assignees: ["missing-user"],
        currentUserId,
        issueNumber: 609,
        owner: "Developer-EJ",
        repo: "PILO"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        error.getResponse().error.message,
        "One or more assignees cannot be assigned to this repository"
      );
      return true;
    }
  );
  assert.equal(client.updateCalls.length, 0);
}

{
  const client = new FakeGithubAppClient({
    assignees: [assignee("alice")],
    updatedAssignees: []
  });
  const service = createSubject(client);

  const result = await service.updateIssue({
    assignees: ["alice"],
    currentUserId,
    issueNumber: 609,
    owner: "Developer-EJ",
    repo: "PILO",
    title: "Provider applied this title"
  });

  assert.equal(result.assigneesApplied, false);
  assert.equal(result.issue.title, "Provider applied this title");
  assert.deepEqual(result.issue.assignees, []);
}
