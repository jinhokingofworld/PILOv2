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
    this.removeCalls = [];
    this.addCalls = [];
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

  async removeRepositoryIssueAssignees(input) {
    this.removeCalls.push(input);
    return githubIssue({
      assignees: [assignee("alice")]
    });
  }

  async addRepositoryIssueAssignees(input) {
    this.addCalls.push(input);
    return githubIssue({
      assignees: [assignee("alice"), assignee("carol")]
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
{
  const client = new FakeGithubAppClient({
    assignees: [assignee("alice"), assignee("carol")]
  });
  const service = createSubject(client);

  const result = await service.updateIssueAssigneesDelta({
    add: ["carol"],
    currentUserId,
    issueNumber: 609,
    owner: "Developer-EJ",
    remove: ["bob"],
    repo: "PILO"
  });

  assert.equal(result.assigneesApplied, true);
  assert.deepEqual(
    result.issue.assignees.map((item) => item.login),
    ["alice", "carol"]
  );
  assert.equal(client.listCalls.length, 1);
  assert.deepEqual(client.removeCalls[0], {
    assignees: ["bob"],
    issueNumber: 609,
    owner: "Developer-EJ",
    repo: "PILO",
    userAccessToken: "user-oauth-token"
  });
  assert.deepEqual(client.addCalls[0], {
    assignees: ["carol"],
    issueNumber: 609,
    owner: "Developer-EJ",
    repo: "PILO",
    userAccessToken: "user-oauth-token"
  });
}

{
  const events = [];
  const assigned = new Set(["alice", "bob"]);
  let failAdd = true;
  const client = {
    async listRepositoryAssignees() {
      events.push("list");
      return [assignee("alice"), assignee("carol")];
    },
    async removeRepositoryIssueAssignees(input) {
      events.push("remove");
      for (const login of input.assignees) {
        assigned.delete(login);
      }
      return githubIssue({
        assignees: [...assigned].map(assignee)
      });
    },
    async addRepositoryIssueAssignees(input) {
      events.push("add");
      if (failAdd) {
        failAdd = false;
        throw new Error("transient add failure");
      }
      for (const login of input.assignees) {
        assigned.add(login);
      }
      return githubIssue({
        assignees: [...assigned].map(assignee)
      });
    }
  };
  const service = createSubject(client);
  const input = {
    add: ["carol"],
    currentUserId,
    issueNumber: 609,
    owner: "Developer-EJ",
    remove: ["bob"],
    repo: "PILO"
  };

  await assert.rejects(() => service.updateIssueAssigneesDelta(input));
  const result = await service.updateIssueAssigneesDelta(input);

  assert.deepEqual(events, [
    "list",
    "remove",
    "add",
    "list",
    "remove",
    "add"
  ]);
  assert.equal(result.assigneesApplied, true);
  assert.deepEqual(
    result.issue.assignees.map((item) => item.login).sort(),
    ["alice", "carol"]
  );
}

{
  const client = new FakeGithubAppClient({
    assignees: [assignee("alice")]
  });
  const service = createSubject(client);

  await assert.rejects(
    () =>
      service.updateIssueAssigneesDelta({
        add: ["missing-user"],
        currentUserId,
        issueNumber: 609,
        owner: "Developer-EJ",
        remove: ["bob"],
        repo: "PILO"
      }),
    (error) => error.getStatus() === 400
  );
  assert.equal(client.removeCalls.length, 0);
  assert.equal(client.addCalls.length, 0);
}
