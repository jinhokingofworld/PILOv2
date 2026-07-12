import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewGithubDependencyService } = require(
  "../../dist/modules/pr-review/pr-review-github-dependency.service.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const pullRequestId = "33333333-3333-4333-8333-333333333333";

function file(index) {
  return {
    filePath: `src/file-${index}.ts`,
    previousFilePath: null,
    fileName: `file-${index}.ts`,
    fileStatus: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    isBinary: false,
    isLargeDiff: false,
    blobUrl: null,
    rawUrl: null,
    contentsUrl: null,
    githubFileUrl: `https://github.com/Developer-EJ/PILO/blob/main/src/file-${index}.ts`,
    patch: null
  };
}

class FakeGithubIntegrationService {
  constructor() {
    this.requests = [];
  }

  async listGithubPullRequestFiles(
    requestedUserId,
    requestedWorkspaceId,
    requestedPullRequestId,
    query
  ) {
    this.requests.push({
      currentUserId: requestedUserId,
      workspaceId: requestedWorkspaceId,
      pullRequestId: requestedPullRequestId,
      query
    });

    if (query.page === 1) {
      return {
        data: Array.from({ length: 100 }, (_, index) => file(index + 1)),
        meta: { page: 1, limit: 100, total: 1 }
      };
    }

    return {
      data: [file(101)],
      meta: { page: 2, limit: 100, total: 1 }
    };
  }
}

const githubIntegrationService = new FakeGithubIntegrationService();
const service = new PrReviewGithubDependencyService(githubIntegrationService);

const files = await service.getPullRequestChangedFiles(
  currentUserId,
  workspaceId,
  pullRequestId
);

assert.equal(files.length, 101);
assert.equal(files.at(-1)?.filePath, "src/file-101.ts");
assert.deepEqual(githubIntegrationService.requests, [
  {
    currentUserId,
    workspaceId,
    pullRequestId,
    query: { page: 1, limit: 100 }
  },
  {
    currentUserId,
    workspaceId,
    pullRequestId,
    query: { page: 2, limit: 100 }
  }
]);
