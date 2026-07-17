import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BoardIssueAssigneeQueries
} = require("../../dist/modules/board/queries/board-issue-assignee.queries.js");
const {
  BoardIssueAssigneeService
} = require("../../dist/modules/board/board-issue-assignee.service.js");
const { badRequest } = require("../../dist/common/api-error.js");
const {
  GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE
} = require("../../dist/modules/github-integration/github-oauth-refresh.error.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const issueId = "1001";

class FakeDatabase {
  constructor(row) {
    this.row = row;
    this.queries = [];
  }

  async queryOne(text, values) {
    this.queries.push({ text, values });
    return this.row;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
  }
}

class FakeGithubIssueWriteService {
  constructor({ assignees, error } = {}) {
    this.calls = [];
    this.assignees = assignees ?? [
      { login: "bob", avatar_url: "https://avatar.test/bob" },
      { login: "Alice", avatar_url: "https://avatar.test/alice" }
    ];
    this.error = error;
  }

  async listAssignableUsers(input) {
    this.calls.push(input);
    if (this.error) {
      throw this.error;
    }

    return this.assignees;
  }
}

function createSubject(row, githubOptions) {
  const database = new FakeDatabase(row);
  const workspaceService = new FakeWorkspaceService();
  const githubIssueWriteService = new FakeGithubIssueWriteService(githubOptions);
  const service = new BoardIssueAssigneeService(
    new BoardIssueAssigneeQueries(database),
    workspaceService,
    githubIssueWriteService
  );

  return { database, githubIssueWriteService, service, workspaceService };
}

{
  const { database, githubIssueWriteService, service, workspaceService } = createSubject({
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO"
  });

  const result = await service.listAssigneeOptions(
    currentUserId,
    workspaceId,
    boardId,
    issueId
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.match(database.queries[0].text, /FROM pilo_issues pi/i);
  assert.match(database.queries[0].text, /JOIN boards b/i);
  assert.match(database.queries[0].text, /JOIN github_repositories gr/i);
  assert.deepEqual(database.queries[0].values, [workspaceId, boardId, issueId]);
  assert.deepEqual(githubIssueWriteService.calls, [
    {
      currentUserId,
      owner: "Developer-EJ",
      repo: "PILO"
    }
  ]);
  assert.deepEqual(result, [
    { login: "Alice", avatarUrl: "https://avatar.test/alice" },
    { login: "bob", avatarUrl: "https://avatar.test/bob" }
  ]);
}

{
  const { service } = createSubject(null);

  await assert.rejects(
    () => service.listAssigneeOptions(currentUserId, workspaceId, boardId, issueId),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.message, "Board issue not found");
      return true;
    }
  );
}

for (const [invalidBoardId, invalidIssueId, expectedField] of [
  ["not-a-number", issueId, "boardId"],
  [boardId, "0", "issueId"]
]) {
  const { database, service, workspaceService } = createSubject({
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO"
  });

  await assert.rejects(
    () =>
      service.listAssigneeOptions(
        currentUserId,
        workspaceId,
        invalidBoardId,
        invalidIssueId
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        error.getResponse().error.message,
        `${expectedField} must be a positive integer`
      );
      return true;
    }
  );
  assert.deepEqual(workspaceService.calls, []);
  assert.deepEqual(database.queries, []);
}

{
  const { githubIssueWriteService, service } = createSubject({
    repository_owner_login: null,
    repository_name: null
  });

  await assert.rejects(
    () => service.listAssigneeOptions(currentUserId, workspaceId, boardId, issueId),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        error.getResponse().error.message,
        "Board issue is missing GitHub repository metadata"
      );
      return true;
    }
  );
  assert.deepEqual(githubIssueWriteService.calls, []);
}

{
  const { service } = createSubject(
    {
      repository_owner_login: "Developer-EJ",
      repository_name: "PILO"
    },
    {
      assignees: [
        { login: "without-avatar", avatar_url: null },
        { login: "undefined-avatar" }
      ]
    }
  );

  const result = await service.listAssigneeOptions(
    currentUserId,
    workspaceId,
    boardId,
    issueId
  );

  assert.deepEqual(result, [
    { login: "undefined-avatar", avatarUrl: null },
    { login: "without-avatar", avatarUrl: null }
  ]);
}

{
  const { service } = createSubject(
    {
      repository_owner_login: "Developer-EJ",
      repository_name: "PILO"
    },
    { error: new Error("raw provider failure") }
  );

  await assert.rejects(
    () => service.listAssigneeOptions(currentUserId, workspaceId, boardId, issueId),
    (error) => {
      assert.equal(error.getStatus(), 502);
      assert.equal(error.getResponse().error.code, "BAD_GATEWAY");
      assert.equal(
        error.getResponse().error.message,
        "GitHub issue assignee lookup failed"
      );
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /raw provider/);
      return true;
    }
  );
}

{
  const { service } = createSubject(
    {
      repository_owner_login: "Developer-EJ",
      repository_name: "PILO"
    },
    {
      error: badRequest(GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE)
    }
  );

  await assert.rejects(
    () =>
      service.listAssigneeOptions(
        currentUserId,
        workspaceId,
        boardId,
        issueId
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(
        error.getResponse().error.message,
        GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE
      );
      return true;
    }
  );
}
