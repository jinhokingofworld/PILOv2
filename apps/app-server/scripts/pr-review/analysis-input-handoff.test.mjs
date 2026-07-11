import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const JOB_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const WORKSPACE_ID = "33333333-3333-3333-3333-333333333333";
const PULL_REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const HEAD_SHA = "abcdef123456";

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    review_session_id: SESSION_ID,
    workspace_id: WORKSPACE_ID,
    head_sha: HEAD_SHA,
    status: "queued",
    pull_request_id: PULL_REQUEST_ID,
    created_by_user_id: USER_ID,
    session_head_sha: HEAD_SHA,
    session_status: "analyzing",
    ...overrides
  };
}

class FakeDatabase {
  constructor(row) {
    this.row = row;
    this.calls = [];
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM pr_review_analysis_jobs")) return this.row;
    throw new Error(`Unhandled query: ${text}`);
  }
}

class FakeGithubDependency {
  constructor({ headSha = HEAD_SHA } = {}) {
    this.headSha = headSha;
    this.detailCalls = [];
    this.fileCalls = [];
  }

  async getPullRequestDetail(...args) {
    this.detailCalls.push(args);
    return {
      id: PULL_REQUEST_ID,
      repositoryId: "repository-id",
      prNumber: 24,
      title: "Async PR analysis",
      body: "Move PR review analysis to the worker.",
      state: "open",
      draft: false,
      mergeable: true,
      authorLogin: "pilo",
      authorAvatarUrl: null,
      headBranch: "feature/async-pr-review",
      baseBranch: "dev",
      headSha: this.headSha,
      baseSha: "base-sha",
      changedFilesCount: 1,
      additions: 12,
      deletions: 3,
      commitsCount: 2,
      htmlUrl: "https://github.com/Developer-EJ/PILO/pull/24"
    };
  }

  async getPullRequestChangedFiles(...args) {
    this.fileCalls.push(args);
    return [
      {
        filePath: "apps/app-server/src/pr-review.ts",
        previousFilePath: null,
        fileName: "pr-review.ts",
        fileStatus: "modified",
        additions: 12,
        deletions: 3,
        isBinary: false,
        isLargeDiff: false,
        githubFileUrl: "https://github.com/Developer-EJ/PILO",
        patch: "+export const asyncReview = true;",
        patchSizeBytes: 34
      }
    ];
  }
}

function createService(database, github) {
  return new PrReviewService(
    database,
    {},
    github,
    {},
    {}
  );
}

{
  const database = new FakeDatabase(jobRow());
  const github = new FakeGithubDependency();
  const input = await createService(database, github).getAnalysisJobInput(JOB_ID);

  assert.equal(input.jobId, JOB_ID);
  assert.equal(input.reviewSessionId, SESSION_ID);
  assert.equal(input.workspaceId, WORKSPACE_ID);
  assert.equal(input.headSha, HEAD_SHA);
  assert.equal(input.pullRequest.prNumber, 24);
  assert.deepEqual(input.files, [
    {
      filePath: "apps/app-server/src/pr-review.ts",
      previousFilePath: null,
      fileName: "pr-review.ts",
      fileStatus: "modified",
      additions: 12,
      deletions: 3,
      isBinary: false,
      isLargeDiff: false,
      patch: "+export const asyncReview = true;"
    }
  ]);
  assert.deepEqual(github.detailCalls, [[USER_ID, WORKSPACE_ID, PULL_REQUEST_ID]]);
  assert.deepEqual(github.fileCalls, [[USER_ID, WORKSPACE_ID, PULL_REQUEST_ID]]);
  assert.match(database.calls[0].text, /pr_review_analysis_jobs/);
}

for (const row of [
  jobRow({ session_status: "reviewing" }),
  jobRow({ status: "failed" }),
  jobRow({ session_head_sha: "different-head" })
]) {
  const github = new FakeGithubDependency();
  await assert.rejects(
    () => createService(new FakeDatabase(row), github).getAnalysisJobInput(JOB_ID),
    (error) => error?.getStatus?.() === 409
  );
  assert.deepEqual(github.detailCalls, []);
  assert.deepEqual(github.fileCalls, []);
}

{
  const github = new FakeGithubDependency({ headSha: "different-head" });
  await assert.rejects(
    () => createService(new FakeDatabase(jobRow()), github).getAnalysisJobInput(JOB_ID),
    (error) => error?.getStatus?.() === 409
  );
}

await assert.rejects(
  () => createService(new FakeDatabase(null), new FakeGithubDependency()).getAnalysisJobInput(JOB_ID),
  (error) => error?.getStatus?.() === 404
);
