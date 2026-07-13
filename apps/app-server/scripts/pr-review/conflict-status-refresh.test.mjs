import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const reviewSessionId = "33333333-3333-4333-8333-333333333333";
const pullRequestId = "44444444-4444-4444-8444-444444444444";
const reviewRoomId = "55555555-5555-4555-8555-555555555555";

class FakeDatabase {
  constructor(queryOneRows) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    return this.queryOneRows.shift() ?? null;
  }

  async execute(text, values = []) {
    this.queries.push({ text, values });
    return { rows: [] };
  }
}

class FakeGithubDependency {
  constructor(conflictStatuses = ["clean"]) {
    this.conflictStatuses = [...conflictStatuses];
    this.conflictStatusCalls = [];
    this.mergeCalls = [];
  }

  async getPullRequestConflictStatus(
    requestedUserId,
    requestedWorkspaceId,
    requestedPullRequestId
  ) {
    this.conflictStatusCalls.push({
      currentUserId: requestedUserId,
      workspaceId: requestedWorkspaceId,
      pullRequestId: requestedPullRequestId
    });
    const conflictStatus =
      this.conflictStatuses.shift() ?? this.conflictStatuses.at(-1) ?? "unknown";

    return {
      conflictStatus,
      checkedAt: "2026-07-10T13:00:00.000Z"
    };
  }

  async mergePullRequest(
    requestedUserId,
    requestedWorkspaceId,
    requestedPullRequestId,
    input
  ) {
    this.mergeCalls.push({
      currentUserId: requestedUserId,
      workspaceId: requestedWorkspaceId,
      pullRequestId: requestedPullRequestId,
      input
    });

    return {
      mergedByGithubLogin: "Developer-EJ",
      mergeMethod: "merge",
      mergeCommitSha: "merge-commit-sha",
      mergeCommitUrl:
        "https://github.com/Developer-EJ/PILO/commit/merge-commit-sha",
      pullRequestState: "closed",
      mergedAt: "2026-07-10T13:01:00.000Z",
      headSha: "head-sha"
    };
  }
}

function sessionRow(overrides = {}) {
  return {
    id: reviewSessionId,
    room_id: reviewRoomId,
    pull_request_id: pullRequestId,
    created_by_user_id: currentUserId,
    head_sha: "head-sha",
    status: "submitted",
    pr_purpose: "Review conflict status refresh",
    change_summary: [],
    recommended_review_order: null,
    caution_points: [],
    reviewed_count: 1,
    total_file_count: 1,
    conflict_status: "checking",
    conflict_checked_at: "2026-07-10T12:00:00.000Z",
    created_at: "2026-07-10T12:00:00.000Z",
    updated_at: "2026-07-10T12:00:00.000Z",
    ...overrides
  };
}

function summaryRow(overrides = {}) {
  return {
    ...sessionRow(overrides),
    pr_number: 561,
    title: "Resolve conflict",
    author_login: "Developer-EJ",
    author_avatar_url: null,
    github_created_at: "2026-07-10T11:00:00.000Z",
    github_updated_at: "2026-07-10T12:00:00.000Z",
    head_branch: "test/conflict-head",
    base_branch: "dev",
    changed_files_count: 1,
    additions: 10,
    deletions: 2,
    commits_count: 2,
    html_url: "https://github.com/Developer-EJ/PILO/pull/561",
    pull_request_state: "open",
    pull_request_mergeable: null,
    pull_request_merged_at: null
  };
}

function createService(database, githubDependency) {
  return new PrReviewService(
    database,
    {
      async assertWorkspaceAccess() {}
    },
    githubDependency,
    {}
  );
}

for (const staleStatus of ["checking", "unknown"]) {
  const database = new FakeDatabase([
    summaryRow({ conflict_status: staleStatus }),
    { id: reviewSessionId }
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  const service = createService(database, githubDependency);

  const result = await service.getReviewSessionSummary(
    currentUserId,
    workspaceId,
    reviewSessionId
  );

  assert.equal(result.conflictStatus, "clean");
  assert.equal(githubDependency.conflictStatusCalls.length, 1);
  assert.match(database.queries[1].text, /AND head_sha = \$2/);
  assert.deepEqual(database.queries[1].values, [
    reviewSessionId,
    "head-sha",
    "clean",
    "2026-07-10T13:00:00.000Z"
  ]);
}

{
  const database = new FakeDatabase([
    summaryRow({ conflict_status: "clean" })
  ]);
  const githubDependency = new FakeGithubDependency(["conflicted"]);
  const service = createService(database, githubDependency);

  const result = await service.getReviewSessionSummary(
    currentUserId,
    workspaceId,
    reviewSessionId
  );

  assert.equal(result.conflictStatus, "clean");
  assert.equal(githubDependency.conflictStatusCalls.length, 0);
  assert.equal(database.queries.length, 1);
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "checking" }),
    { id: reviewSessionId }
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  const service = createService(database, githubDependency);

  const result = await service.mergeReviewSession(
    currentUserId,
    workspaceId,
    reviewSessionId,
    {
      confirm: true,
      expectedHeadSha: "head-sha"
    }
  );

  assert.equal(result.status, "merged");
  assert.equal(githubDependency.conflictStatusCalls.length, 1);
  assert.deepEqual(githubDependency.mergeCalls, [
    {
      currentUserId,
      workspaceId,
      pullRequestId,
      input: { expectedHeadSha: "head-sha" }
    }
  ]);
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "clean" }),
    { id: reviewSessionId }
  ]);
  const githubDependency = new FakeGithubDependency(["conflicted"]);
  const service = createService(database, githubDependency);

  await assert.rejects(
    () =>
      service.mergeReviewSession(
        currentUserId,
        workspaceId,
        reviewSessionId,
        {
          confirm: true,
          expectedHeadSha: "head-sha"
        }
      ),
    (error) =>
      error?.response?.error?.message === "Resolve PR conflicts before merge"
  );
  assert.equal(githubDependency.conflictStatusCalls.length, 1);
  assert.equal(githubDependency.mergeCalls.length, 0);
}

console.log("PR Review conflict status refresh tests passed");
