import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");
const { GithubPullRequestRemoteService } = require(
  "../../dist/modules/github-integration/github-pull-request-remote.service.js"
);

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
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
    return [];
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

class FakeGithubAppClient {
  constructor({ files = [], pullRequests = [], failPullRequest = false } = {}) {
    this.files = [...files];
    this.pullRequests = [...pullRequests];
    this.failPullRequest = failPullRequest;
    this.fileRequests = [];
    this.pullRequestRequests = [];
  }

  async listPullRequestFiles(input) {
    this.fileRequests.push(input);
    return this.files;
  }

  async getPullRequest(input) {
    this.pullRequestRequests.push(input);
    if (this.failPullRequest) {
      throw new Error("provider raw error with token secret");
    }

    return this.pullRequests.shift() ?? { mergeable: null };
  }
}

const fixedNow = new Date("2026-07-04T12:00:00.000Z");
const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const pullRequestId = "55555555-5555-4555-8555-555555555555";

const githubAppConfig = {
  appId: "12345",
  appSlug: "pilo-github-app",
  privateKey: "test-private-key",
  apiPublicOrigin: "https://api.pilo.test",
  apiBasePath: "/api/v1",
  stateSecret: "test-state-secret",
  stateTtlSeconds: 600,
  now: () => fixedNow
};

function createService(database, githubAppClient = new FakeGithubAppClient()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new GithubIntegrationService(
    database,
    {},
    {},
    {},
    {
      getGithubAppConfig() {
        return githubAppConfig;
      }
    },
    workspaceService,
    {},
    githubAppClient
  );

  return {
    service,
    workspaceService,
    githubAppClient
  };
}

function pullRequestRemoteContextRow(overrides = {}) {
  return {
    id: pullRequestId,
    repository_id: repositoryId,
    pr_number: 24,
    changed_files_count: 5,
    html_url: "https://github.com/my-team/pilo/pull/24",
    owner_login: "my-team",
    name: "pilo",
    full_name: "my-team/pilo",
    github_installation_id: "998877",
    ...overrides
  };
}

function assertNoPrFileCacheQuery(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /github_pull_request_files/i);
    assert.doesNotMatch(query.text, /patch/i);
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_pull_requests/i);
        assert.match(text, /JOIN github_repositories/i);
        assert.match(text, /JOIN github_installations/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /pr\.id = \$2/i);
        assert.deepEqual(values, [workspaceId, pullRequestId]);
        return pullRequestRemoteContextRow();
      }
    ]
  });
  const githubAppClient = new FakeGithubAppClient({
    files: [
      {
        filename: "apps/frontend/page.tsx",
        previous_filename: null,
        status: "modified",
        additions: 84,
        deletions: 12,
        changes: 96,
        blob_url: "https://github.com/my-team/pilo/blob/abc123/apps/frontend/page.tsx",
        raw_url: "https://github.com/my-team/pilo/raw/abc123/apps/frontend/page.tsx",
        contents_url: "https://api.github.com/repos/my-team/pilo/contents/apps/frontend/page.tsx",
        sha: "abc123",
        patch: "@@ -10,6 +10,18 @@\n+const status = 'ready';"
      },
      {
        filename: "assets/report-preview.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 0,
        blob_url: "https://github.com/my-team/pilo/blob/abc123/assets/report-preview.png",
        raw_url: "https://github.com/my-team/pilo/raw/abc123/assets/report-preview.png",
        contents_url: "https://api.github.com/repos/my-team/pilo/contents/assets/report-preview.png",
        sha: "def456"
      },
      {
        filename: "src/generated.ts",
        status: "modified",
        additions: 1200,
        deletions: 0,
        changes: 1200,
        blob_url: "https://github.com/my-team/pilo/blob/abc123/src/generated.ts",
        raw_url: "https://github.com/my-team/pilo/raw/abc123/src/generated.ts",
        contents_url: "https://api.github.com/repos/my-team/pilo/contents/src/generated.ts",
        sha: "ghi789"
      }
    ]
  });
  const { service, workspaceService } = createService(database, githubAppClient);

  assert.equal(typeof service.listGithubPullRequestFiles, "function");

  const files = await service.listGithubPullRequestFiles(
    currentUserId,
    workspaceId,
    pullRequestId,
    { page: "2", limit: "3" }
  );

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(githubAppClient.fileRequests, [
    {
      installationId: 998877,
      appId: "12345",
      privateKey: "test-private-key",
      owner: "my-team",
      repo: "pilo",
      pullNumber: 24,
      page: 2,
      perPage: 3,
      now: githubAppConfig.now
    }
  ]);
  assert.deepEqual(files.meta, {
    page: 2,
    limit: 3,
    total: 5
  });
  assert.deepEqual(files.data, [
    {
      filePath: "apps/frontend/page.tsx",
      previousFilePath: null,
      fileName: "page.tsx",
      headBlobSha: "abc123",
      fileStatus: "modified",
      additions: 84,
      deletions: 12,
      changes: 96,
      isBinary: false,
      isLargeDiff: false,
      blobUrl: "https://github.com/my-team/pilo/blob/abc123/apps/frontend/page.tsx",
      rawUrl: "https://github.com/my-team/pilo/raw/abc123/apps/frontend/page.tsx",
      contentsUrl: "https://api.github.com/repos/my-team/pilo/contents/apps/frontend/page.tsx",
      githubFileUrl: "https://github.com/my-team/pilo/pull/24/files#diff-abc123",
      patch: "@@ -10,6 +10,18 @@\n+const status = 'ready';"
    },
    {
      filePath: "assets/report-preview.png",
      previousFilePath: null,
      fileName: "report-preview.png",
      headBlobSha: "def456",
      fileStatus: "modified",
      additions: 0,
      deletions: 0,
      changes: 0,
      isBinary: true,
      isLargeDiff: false,
      blobUrl: "https://github.com/my-team/pilo/blob/abc123/assets/report-preview.png",
      rawUrl: "https://github.com/my-team/pilo/raw/abc123/assets/report-preview.png",
      contentsUrl: "https://api.github.com/repos/my-team/pilo/contents/assets/report-preview.png",
      githubFileUrl: "https://github.com/my-team/pilo/pull/24/files#diff-def456",
      patch: null
    },
    {
      filePath: "src/generated.ts",
      previousFilePath: null,
      fileName: "generated.ts",
      headBlobSha: "ghi789",
      fileStatus: "modified",
      additions: 1200,
      deletions: 0,
      changes: 1200,
      isBinary: false,
      isLargeDiff: true,
      blobUrl: "https://github.com/my-team/pilo/blob/abc123/src/generated.ts",
      rawUrl: "https://github.com/my-team/pilo/raw/abc123/src/generated.ts",
      contentsUrl: "https://api.github.com/repos/my-team/pilo/contents/src/generated.ts",
      githubFileUrl: "https://github.com/my-team/pilo/pull/24/files#diff-ghi789",
      patch: null
    }
  ]);
  assertNoPrFileCacheQuery(database);
}

for (const { mergeable, conflictStatus, message } of [
  {
    mergeable: true,
    conflictStatus: "clean",
    message: "Conflict가 없는 상태입니다."
  },
  {
    mergeable: false,
    conflictStatus: "conflicted",
    message: "Conflict가 있는 상태입니다."
  },
  {
    mergeable: null,
    conflictStatus: "checking",
    message: "Conflict 상태를 확인 중입니다."
  }
]) {
  const database = new FakeDatabase({
    queryOneRows: [pullRequestRemoteContextRow()]
  });
  const githubAppClient = new FakeGithubAppClient({
    pullRequests: [{ mergeable }]
  });
  const { service } = createService(database, githubAppClient);

  assert.equal(typeof service.getGithubPullRequestConflictStatus, "function");

  const result = await service.getGithubPullRequestConflictStatus(
    currentUserId,
    workspaceId,
    pullRequestId
  );

  assert.deepEqual(githubAppClient.pullRequestRequests, [
    {
      installationId: 998877,
      appId: "12345",
      privateKey: "test-private-key",
      owner: "my-team",
      repo: "pilo",
      pullNumber: 24,
      now: githubAppConfig.now
    }
  ]);
  assert.deepEqual(result, {
    conflictStatus,
    conflictCheckedAt: "2026-07-04T12:00:00.000Z",
    message
  });
}

{
  const database = new FakeDatabase({
    queryOneRows: [pullRequestRemoteContextRow()]
  });
  const workspaceService = new FakeWorkspaceService();
  const tokenRequests = [];
  const mergeBaseRequests = [];
  const contentRequests = [];
  const githubAppClient = {
    async createInstallationAccessToken(input) {
      tokenRequests.push(input);
      return {
        token: "shared-installation-token",
        expiresAt: "2026-07-04T13:00:00.000Z"
      };
    },
    async getRepositoryMergeBase(input) {
      mergeBaseRequests.push(input);
      return { mergeBaseSha: "merge-base-sha" };
    },
    async getRepositoryFileContent(input) {
      contentRequests.push(input);
      return {
        path: input.path,
        sha: `${input.ref}-blob-sha`,
        size: 20,
        content: `${input.ref}-content`
      };
    }
  };
  const service = new GithubPullRequestRemoteService(
    database,
    githubAppClient,
    {
      getGithubAppConfig() {
        return githubAppConfig;
      }
    },
    workspaceService
  );

  const result = await service.getGithubPullRequestConflictInputs(
    currentUserId,
    workspaceId,
    pullRequestId,
    {
      baseSha: "base-sha",
      headSha: "head-sha",
      filePaths: ["src/conflicted.ts"]
    }
  );

  assert.equal(tokenRequests.length, 1);
  assert.equal(mergeBaseRequests[0].installationAccessToken, "shared-installation-token");
  assert.equal(contentRequests.length, 3);
  assert.ok(
    contentRequests.every(
      (request) =>
        request.installationAccessToken === "shared-installation-token"
    )
  );
  assert.deepEqual(result, {
    mergeBaseSha: "merge-base-sha",
    files: [
      {
        filePath: "src/conflicted.ts",
        mergeBaseContent: "merge-base-sha-content",
        baseContent: "base-sha-content",
        headContent: "head-sha-content",
        headBlobSha: "head-sha-blob-sha",
        unsupportedReason: null
      }
    ]
  });
}

{
  const database = new FakeDatabase({
    queryOneRows: [pullRequestRemoteContextRow()]
  });
  const githubAppClient = new FakeGithubAppClient({ failPullRequest: true });
  const { service } = createService(database, githubAppClient);

  const result = await service.getGithubPullRequestConflictStatus(
    currentUserId,
    workspaceId,
    pullRequestId
  );

  assert.deepEqual(result, {
    conflictStatus: "unknown",
    conflictCheckedAt: "2026-07-04T12:00:00.000Z",
    message: "Conflict 상태를 확인할 수 없습니다."
  });
}
