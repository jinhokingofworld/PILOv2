import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }
}

class FakeWorkspaceService {
  constructor() {
    this.accessChecks = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.accessChecks.push({ currentUserId, workspaceId });
    return {
      id: workspaceId,
      name: "Engineering",
      ownerUserId: currentUserId,
      isOwner: true,
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z"
    };
  }
}

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";
const pullRequestId = "55555555-5555-4555-8555-555555555555";

function createService(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new GithubIntegrationService(
    database,
    {},
    {},
    {},
    {},
    workspaceService,
    {},
    {}
  );

  return {
    database,
    service,
    workspaceService
  };
}

function repositoryRow(overrides = {}) {
  return {
    id: repositoryId,
    github_repository_id: "987654321",
    github_node_id: "R_kgDOExample",
    owner_login: "my-team",
    name: "pilo",
    full_name: "my-team/pilo",
    private: true,
    archived: false,
    default_branch: "main",
    html_url: "https://github.com/my-team/pilo",
    github_created_at: "2026-06-20T03:00:00.000Z",
    github_updated_at: "2026-07-01T14:30:00.000Z",
    pushed_at: "2026-07-01T14:30:00.000Z",
    last_synced_at: "2026-07-02T05:20:00.000Z",
    ...overrides
  };
}

function issueRow(overrides = {}) {
  return {
    id: issueId,
    repository_id: repositoryId,
    github_issue_id: "2468",
    github_node_id: "I_kgDOExample",
    issue_number: 10,
    title: "Improve meeting summary",
    body: "Issue body",
    state: "open",
    state_reason: null,
    author_login: "juhyeong",
    author_avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/my-team/pilo/issues/10",
    labels: [{ name: "enhancement" }],
    assignees: [{ login: "juhyeong" }],
    milestone: { title: "MVP" },
    github_created_at: "2026-07-01T10:00:00.000Z",
    github_updated_at: "2026-07-02T05:20:00.000Z",
    github_closed_at: null,
    last_synced_at: "2026-07-02T05:21:00.000Z",
    ...overrides
  };
}

function pullRequestRow(overrides = {}) {
  return {
    id: pullRequestId,
    repository_id: repositoryId,
    github_pull_request_id: "123456789",
    github_node_id: "PR_kgDOExample",
    pr_number: 24,
    title: "Build voice meeting report mockup",
    body: "GitHub PR body",
    author_login: "juhyeong",
    author_avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    head_branch: "feature/voice-report",
    base_branch: "main",
    changed_files_count: 5,
    additions: 128,
    deletions: 32,
    commits_count: 3,
    comments_count: 1,
    review_comments_count: 0,
    html_url: "https://github.com/my-team/pilo/pull/24",
    github_created_at: "2026-07-01T10:00:00.000Z",
    github_updated_at: "2026-07-02T13:10:00.000Z",
    github_closed_at: null,
    merged_at: null,
    last_synced_at: "2026-07-02T13:11:00.000Z",
    raw: {
      state: "open",
      draft: false,
      mergeable: true,
      head: {
        sha: "abc123"
      },
      base: {
        sha: "def456"
      }
    },
    ...overrides
  };
}

function assertNoSecretLookup(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /token|private_key|secret/i);
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM github_repositories/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /archived = false/i);
        assert.match(text, /ILIKE/i);
        assert.deepEqual(values, [workspaceId, "%pilo%"]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.match(text, /ORDER BY full_name ASC/i);
        assert.deepEqual(values, [workspaceId, "%pilo%", 20, 0]);
        return [repositoryRow()];
      }
    ]
  });
  const { service, workspaceService } = createService(database);

  assert.equal(typeof service.listGithubRepositories, "function");

  const repositories = await service.listGithubRepositories(currentUserId, workspaceId, {
    q: " pilo ",
    includeArchived: "false",
    page: "1",
    limit: "20"
  });

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(repositories, {
    data: [
      {
        id: repositoryId,
        githubRepositoryId: 987654321,
        githubNodeId: "R_kgDOExample",
        ownerLogin: "my-team",
        name: "pilo",
        fullName: "my-team/pilo",
        private: true,
        archived: false,
        defaultBranch: "main",
        htmlUrl: "https://github.com/my-team/pilo",
        pushedAt: "2026-07-01T14:30:00.000Z",
        lastSyncedAt: "2026-07-02T05:20:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1
    }
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /id = \$2/i);
        assert.deepEqual(values, [workspaceId, repositoryId]);
        return repositoryRow();
      }
    ]
  });
  const { service } = createService(database);

  assert.equal(typeof service.getGithubRepository, "function");

  const repository = await service.getGithubRepository(
    currentUserId,
    workspaceId,
    repositoryId
  );

  assert.deepEqual(repository, {
    id: repositoryId,
    githubRepositoryId: 987654321,
    githubNodeId: "R_kgDOExample",
    ownerLogin: "my-team",
    name: "pilo",
    fullName: "my-team/pilo",
    private: true,
    archived: false,
    defaultBranch: "main",
    htmlUrl: "https://github.com/my-team/pilo",
    githubCreatedAt: "2026-06-20T03:00:00.000Z",
    githubUpdatedAt: "2026-07-01T14:30:00.000Z",
    pushedAt: "2026-07-01T14:30:00.000Z",
    lastSyncedAt: "2026-07-02T05:20:00.000Z"
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_issues/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /id = \$2/i);
        assert.deepEqual(values, [workspaceId, issueId]);
        return issueRow();
      }
    ]
  });
  const { service } = createService(database);

  assert.equal(typeof service.getGithubIssue, "function");

  const issue = await service.getGithubIssue(currentUserId, workspaceId, issueId);

  assert.deepEqual(issue, {
    id: issueId,
    repositoryId,
    githubIssueId: 2468,
    githubNodeId: "I_kgDOExample",
    issueNumber: 10,
    title: "Improve meeting summary",
    body: "Issue body",
    state: "open",
    stateReason: null,
    authorLogin: "juhyeong",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    htmlUrl: "https://github.com/my-team/pilo/issues/10",
    labels: [{ name: "enhancement" }],
    assignees: [{ login: "juhyeong" }],
    milestone: { title: "MVP" },
    githubCreatedAt: "2026-07-01T10:00:00.000Z",
    githubUpdatedAt: "2026-07-02T05:20:00.000Z",
    githubClosedAt: null,
    lastSyncedAt: "2026-07-02T05:21:00.000Z"
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /id = \$2/i);
        assert.deepEqual(values, [workspaceId, repositoryId]);
        return { id: repositoryId };
      },
      (text, values) => {
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM github_pull_requests/i);
        assert.match(text, /repository_id = \$2/i);
        assert.match(text, /raw->>'state'/i);
        assert.match(text, /ILIKE/i);
        assert.deepEqual(values, [workspaceId, repositoryId, "open", "%voice%"]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_pull_requests/i);
        assert.match(text, /ORDER BY github_updated_at DESC NULLS LAST/i);
        assert.deepEqual(values, [workspaceId, repositoryId, "open", "%voice%", 10, 0]);
        return [pullRequestRow()];
      }
    ]
  });
  const { service } = createService(database);

  assert.equal(typeof service.listGithubPullRequests, "function");

  const pullRequests = await service.listGithubPullRequests(
    currentUserId,
    workspaceId,
    repositoryId,
    {
      state: "open",
      query: " voice ",
      page: "1",
      limit: "10"
    }
  );

  assert.deepEqual(pullRequests, {
    data: [
      {
        id: pullRequestId,
        repositoryId,
        githubPullRequestId: 123456789,
        githubNodeId: "PR_kgDOExample",
        githubNumber: 24,
        title: "Build voice meeting report mockup",
        authorName: "juhyeong",
        authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        state: "open",
        draft: false,
        mergeable: true,
        createdAtGithub: "2026-07-01T10:00:00.000Z",
        updatedAtGithub: "2026-07-02T13:10:00.000Z",
        headBranch: "feature/voice-report",
        baseBranch: "main",
        headSha: "abc123",
        baseSha: "def456",
        changedFilesCount: 5,
        additions: 128,
        deletions: 32,
        commitsCount: 3,
        commentsCount: 1,
        reviewCommentsCount: 0,
        githubUrl: "https://github.com/my-team/pilo/pull/24",
        lastSyncedAt: "2026-07-02T13:11:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 10,
      total: 1
    }
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_pull_requests/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /id = \$2/i);
        assert.deepEqual(values, [workspaceId, pullRequestId]);
        return pullRequestRow({
          raw: JSON.stringify({
            state: "closed",
            draft: true,
            mergeable: false,
            head_sha: "abc123",
            base_sha: "def456"
          }),
          github_closed_at: "2026-07-03T10:00:00.000Z",
          merged_at: "2026-07-03T11:00:00.000Z"
        });
      }
    ]
  });
  const { service } = createService(database);

  assert.equal(typeof service.getGithubPullRequest, "function");

  const pullRequest = await service.getGithubPullRequest(
    currentUserId,
    workspaceId,
    pullRequestId
  );

  assert.deepEqual(pullRequest, {
    id: pullRequestId,
    repositoryId,
    githubPullRequestId: 123456789,
    githubNodeId: "PR_kgDOExample",
    githubNumber: 24,
    title: "Build voice meeting report mockup",
    description: "GitHub PR body",
    authorName: "juhyeong",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    state: "closed",
    draft: true,
    mergeable: false,
    createdAtGithub: "2026-07-01T10:00:00.000Z",
    updatedAtGithub: "2026-07-02T13:10:00.000Z",
    closedAtGithub: "2026-07-03T10:00:00.000Z",
    mergedAt: "2026-07-03T11:00:00.000Z",
    headBranch: "feature/voice-report",
    baseBranch: "main",
    headSha: "abc123",
    baseSha: "def456",
    changedFilesCount: 5,
    additions: 128,
    deletions: 32,
    commitsCount: 3,
    commentsCount: 1,
    reviewCommentsCount: 0,
    githubUrl: "https://github.com/my-team/pilo/pull/24",
    lastSyncedAt: "2026-07-02T13:11:00.000Z"
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createService(database);

  await assert.rejects(
    () => service.getGithubRepository(currentUserId, workspaceId, repositoryId),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "GitHub repository not found");
      return true;
    }
  );
}
