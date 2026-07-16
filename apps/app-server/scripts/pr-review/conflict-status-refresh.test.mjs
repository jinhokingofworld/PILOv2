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
    this.transactionCount = 0;
    this.transactionAttempts = [];
    this.rolledBackTransactions = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    return this.queryOneRows.shift() ?? null;
  }

  async execute(text, values = []) {
    this.queries.push({ text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    this.transactionCount += 1;
    const pendingQueries = [];
    const transaction = {
      queryOne: async (text, values = []) => {
        pendingQueries.push({ text, values });
        return this.queryOneRows.shift() ?? null;
      },
      async query() {
        return [];
      },
      async execute() {
        return { rows: [] };
      }
    };
    this.transactionAttempts.push({ transaction, queries: pendingQueries });

    try {
      const result = await callback(transaction);
      this.queries.push(...pendingQueries);
      return result;
    } catch (error) {
      this.rolledBackTransactions.push([...pendingQueries]);
      throw error;
    }
  }
}

class FakeActivityLogService {
  constructor(appendError = null) {
    this.appendError = appendError;
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ transaction, input });
    if (this.appendError) {
      throw this.appendError;
    }
  }
}

class FakeGithubDependency {
  constructor(conflictStatuses = ["clean"]) {
    this.conflictStatuses = [...conflictStatuses];
    this.conflictStatusCalls = [];
    this.mergeCalls = [];
    this.mergeError = null;
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

    if (this.mergeError) {
      throw this.mergeError;
    }

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

function createService(
  database,
  githubDependency,
  activityLogService = new FakeActivityLogService()
) {
  return new PrReviewService(
    database,
    {
      async assertWorkspaceAccess() {}
    },
    githubDependency,
    {},
    {},
    activityLogService,
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
    { id: reviewSessionId },
    { id: reviewRoomId }
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(
    database,
    githubDependency,
    activityLogService
  );

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
  assert.equal(database.transactionCount, 1);
  assert.equal(database.transactionAttempts[0].queries.length, 1);
  assert.match(
    database.transactionAttempts[0].queries[0].text,
    /UPDATE pr_review_rooms[\s\S]*RETURNING id/
  );
  assert.deepEqual(database.transactionAttempts[0].queries[0].values, [
    reviewRoomId,
    "2026-07-10T13:01:00.000Z"
  ]);
  assert.equal(activityLogService.calls.length, 1);
  assert.equal(
    activityLogService.calls[0].transaction,
    database.transactionAttempts[0].transaction
  );
  assert.deepEqual(activityLogService.calls[0].input, {
    workspaceId,
    actor: { type: "user", userId: currentUserId },
    action: "pr_review_pull_request_merged",
    target: { type: "pull_request", id: pullRequestId },
    dedupeKey:
      "pr-review:pr_review_pull_request_merged:44444444-4444-4444-8444-444444444444:merge-commit-sha",
    metadata: {
      version: 1,
      summary: "PR을 merge 방식으로 병합했습니다.",
      data: {
        reviewSessionId,
        mergeMethod: "merge",
        mergeCommitSha: "merge-commit-sha"
      }
    }
  });
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "clean" }),
    { id: reviewSessionId }
  ]);
  const githubDependency = new FakeGithubDependency(["conflicted"]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(
    database,
    githubDependency,
    activityLogService
  );

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
  assert.equal(database.transactionCount, 0);
  assert.equal(activityLogService.calls.length, 0);
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "clean" }),
    { id: reviewSessionId }
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  githubDependency.mergeError = new Error("GitHub merge failed");
  const activityLogService = new FakeActivityLogService();
  const service = createService(
    database,
    githubDependency,
    activityLogService
  );

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
    /GitHub merge failed/
  );
  assert.equal(database.transactionCount, 0);
  assert.equal(activityLogService.calls.length, 0);
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "clean" }),
    { id: reviewSessionId },
    null
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(
    database,
    githubDependency,
    activityLogService
  );

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
      error?.response?.error?.message ===
      "PR Review room is no longer active"
  );
  assert.equal(database.rolledBackTransactions.length, 1);
  assert.equal(activityLogService.calls.length, 0);
}

{
  const database = new FakeDatabase([
    sessionRow({ conflict_status: "clean" }),
    { id: reviewSessionId },
    { id: reviewRoomId }
  ]);
  const githubDependency = new FakeGithubDependency(["clean"]);
  const appendError = new Error("Activity append failed");
  const activityLogService = new FakeActivityLogService(appendError);
  const service = createService(
    database,
    githubDependency,
    activityLogService
  );

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
    (error) => error === appendError
  );
  assert.equal(database.transactionCount, 1);
  assert.equal(database.rolledBackTransactions.length, 1);
  assert.match(
    database.rolledBackTransactions[0][0].text,
    /UPDATE pr_review_rooms[\s\S]*RETURNING id/
  );
  assert.equal(
    database.queries.some(({ text }) => /UPDATE pr_review_rooms/.test(text)),
    false
  );
}

console.log("PR Review conflict status refresh tests passed");
