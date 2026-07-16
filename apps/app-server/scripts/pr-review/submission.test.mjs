import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { forbidden } = require("../../dist/common/api-error.js");
const { PrReviewService } = require("../../dist/modules/pr-review/pr-review.service.js");

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
    this.transactionCount = 0;
    this.transactionAttempts = [];
    this.rolledBackTransactions = [];
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

  async transaction(callback) {
    this.transactionCount += 1;
    const pendingQueries = [];
    const transaction = {
      queryOne: async (text, values = []) => {
        pendingQueries.push({ method: "transaction.queryOne", text, values });
        const next = this.queryOneRows.shift();
        if (typeof next === "function") {
          return next(text, values);
        }

        return next ?? null;
      },
      query: async (text, values = []) => {
        pendingQueries.push({ method: "transaction.query", text, values });
        const next = this.queryRows.shift();
        if (typeof next === "function") {
          return next(text, values);
        }

        return next ?? [];
      },
      execute: async (text, values = []) => {
        pendingQueries.push({ method: "transaction.execute", text, values });
        return {
          rows: [],
          rowCount: 0
        };
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
  constructor({ appendError = null } = {}) {
    this.appendError = appendError;
    this.calls = [];
  }

  async append(transaction, input) {
    assert.notEqual(input.action, "review_submission_created");
    this.calls.push({ transaction, input });
    if (this.appendError) {
      throw this.appendError;
    }
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

class FakeGithubDependency {
  constructor({
    connected = true,
    githubLogin = "octocat",
    currentHeadSha = "head-sha-1",
    submitError = null
  } = {}) {
    this.connected = connected;
    this.githubLogin = githubLogin;
    this.currentHeadSha = currentHeadSha;
    this.submitError = submitError;
    this.calls = [];
  }

  async getCurrentUserGithubOAuthStatus(currentUserId) {
    this.calls.push({ method: "getCurrentUserGithubOAuthStatus", currentUserId });
    return {
      connected: this.connected,
      githubUserId: this.connected ? 1234 : null,
      githubLogin: this.connected ? this.githubLogin : null,
      tokenScope: null,
      githubConnectedAt: this.connected ? "2026-07-06T10:00:00.000Z" : null,
      githubRevokedAt: null
    };
  }

  async getPullRequestDetail(currentUserId, workspaceId, pullRequestId) {
    this.calls.push({
      method: "getPullRequestDetail",
      currentUserId,
      workspaceId,
      pullRequestId
    });
    return {
      id: pullRequestId,
      repositoryId: "repository-id",
      prNumber: 24,
      title: "Review me",
      body: null,
      state: "open",
      draft: false,
      mergeable: true,
      authorLogin: "author",
      authorAvatarUrl: null,
      headBranch: "feature/pr-review",
      baseBranch: "dev",
      headSha: this.currentHeadSha,
      baseSha: "base-sha",
      changedFilesCount: 2,
      additions: 10,
      deletions: 2,
      commitsCount: 1,
      htmlUrl: "https://github.com/my-team/pilo/pull/24"
    };
  }

  async submitPullRequestReview(currentUserId, workspaceId, pullRequestId, input) {
    this.calls.push({
      method: "submitPullRequestReview",
      currentUserId,
      workspaceId,
      pullRequestId,
      input
    });

    if (this.submitError) {
      throw this.submitError;
    }

    return {
      submittedByGithubLogin: this.githubLogin,
      githubReviewId: "987654",
      githubReviewUrl:
        "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
      submittedAt: "2026-07-06T12:00:00.000Z"
    };
  }
}

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const reviewSessionId = "33333333-3333-4333-8333-333333333333";
const pullRequestId = "44444444-4444-4444-8444-444444444444";
const submissionId = "55555555-5555-4555-8555-555555555555";

function createService({
  activityLogService,
  database,
  githubDependency,
  workspaceService
} = {}) {
  const resolvedWorkspaceService = workspaceService ?? new FakeWorkspaceService();
  const resolvedGithubDependency =
    githubDependency ?? new FakeGithubDependency();
  const resolvedActivityLogService =
    activityLogService ?? new FakeActivityLogService();
  const service = new PrReviewService(
    database ?? new FakeDatabase(),
    resolvedWorkspaceService,
    resolvedGithubDependency,
    {},
    {},
    resolvedActivityLogService,
    {}
  );

  return {
    service,
    workspaceService: resolvedWorkspaceService,
    githubDependency: resolvedGithubDependency,
    activityLogService: resolvedActivityLogService
  };
}

function sessionRow(overrides = {}) {
  return {
    id: reviewSessionId,
    pull_request_id: pullRequestId,
    created_by_user_id: currentUserId,
    head_sha: "head-sha-1",
    status: "ready_to_submit",
    pr_purpose: "Review changes",
    change_summary: ["Summary"],
    recommended_review_order: "Review entry points first",
    caution_points: [],
    reviewed_count: 2,
    total_file_count: 2,
    conflict_status: "clean",
    conflict_checked_at: "2026-07-06T11:00:00.000Z",
    created_at: "2026-07-06T10:00:00.000Z",
    updated_at: "2026-07-06T11:00:00.000Z",
    ...overrides
  };
}

function fileRows() {
  return [
    {
      id: "review-file-1",
      file_path: "apps/frontend/page.tsx",
      file_name: "page.tsx",
      current_status: "approved",
      comment: "Looks good.",
      reviewed_by_user_id: currentUserId,
      reviewed_at: "2026-07-06T11:10:00.000Z",
      workflow_order: 1
    },
    {
      id: "review-file-2",
      file_path: "apps/frontend/panel.tsx",
      file_name: "panel.tsx",
      current_status: "discussion_needed",
      comment: "Please check empty state.",
      reviewed_by_user_id: currentUserId,
      reviewed_at: "2026-07-06T11:20:00.000Z",
      workflow_order: 2
    }
  ];
}

function fileRowsWithUnreviewed() {
  return [
    fileRows()[0],
    {
      id: "review-file-2",
      file_path: "apps/frontend/panel.tsx",
      file_name: "panel.tsx",
      current_status: "not_reviewed",
      comment: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      workflow_order: 2
    }
  ];
}

function submissionRow(overrides = {}) {
  return {
    id: submissionId,
    session_id: reviewSessionId,
    submitted_by_user_id: currentUserId,
    submitted_by_github_login: "octocat",
    submit_type: "REQUEST_CHANGES",
    review_body: "Please check empty state.",
    review_result_summary:
      "approved 1 / discussion_needed 1 / unknown 0 / not_reviewed 0",
    file_review_results: [
      {
        fileName: "page.tsx",
        filePath: "apps/frontend/page.tsx",
        status: "approved",
        comment: "Looks good."
      }
    ],
    github_submit_status: "submitting",
    github_review_id: null,
    github_review_url: null,
    error_message: null,
    submitted_at: null,
    created_at: "2026-07-06T11:59:58.000Z",
    updated_at: "2026-07-06T11:59:58.000Z",
    ...overrides
  };
}

function hasQuery(database, pattern) {
  return database.queries.some((query) => pattern.test(query.text));
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow(),
      submissionRow(),
      submissionRow({
        github_submit_status: "submitted",
        github_review_id: "987654",
        github_review_url:
          "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
        submitted_at: "2026-07-06T12:00:00.000Z",
        updated_at: "2026-07-06T12:00:00.000Z"
      }),
      { id: reviewSessionId }
    ],
    queryRows: [fileRows()]
  });
  const {
    service,
    workspaceService,
    githubDependency,
    activityLogService
  } = createService({ database });

  const result = await service.submitReviewSession(
    currentUserId,
    workspaceId,
    reviewSessionId,
    {
      submitType: "REQUEST_CHANGES",
      reviewBody: "  Please check empty state.  "
    }
  );

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.equal(database.transactionCount, 1);
  assert.equal(result.githubSubmitStatus, "submitted");
  assert.equal(result.githubReviewId, "987654");
  assert.equal(result.reviewBody, "Please check empty state.");
  assert.deepEqual(
    githubDependency.calls.map((call) => call.method),
    [
      "getCurrentUserGithubOAuthStatus",
      "getPullRequestDetail",
      "submitPullRequestReview"
    ]
  );
  assert.deepEqual(githubDependency.calls[2].input, {
    submitType: "REQUEST_CHANGES",
    reviewBody: "Please check empty state."
  });
  assert.equal(hasQuery(database, /INSERT INTO review_submissions/i), true);
  assert.equal(hasQuery(database, /github_submit_status = 'submitted'/i), true);
  assert.equal(hasQuery(database, /SET status = 'submitted'/i), true);
  assert.equal(activityLogService.calls.length, 1);
  assert.equal(
    activityLogService.calls[0].transaction,
    database.transactionAttempts[0].transaction
  );
  assert.deepEqual(activityLogService.calls[0].input, {
    workspaceId,
    actor: { type: "user", userId: currentUserId },
    action: "review_submission_submitted",
    target: { type: "review_submission", id: submissionId },
    dedupeKey: `pr-review:review_submission_submitted:${submissionId}:submitted`,
    metadata: {
      version: 1,
      summary: "GitHub Review 제출을 완료했습니다.",
      data: { reviewSessionId }
    }
  });
  assert.doesNotMatch(
    JSON.stringify(activityLogService.calls[0].input.metadata),
    /Please check empty state|REQUEST_CHANGES|987654|github\.com/i
  );
  assert.doesNotMatch(JSON.stringify(database.queries), /accessToken|secret/i);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow({
        status: "reviewing",
        reviewed_count: 1,
        total_file_count: 2
      }),
      submissionRow(),
      submissionRow({
        github_submit_status: "submitted",
        github_review_id: "987654",
        github_review_url:
          "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
        submitted_at: "2026-07-06T12:00:00.000Z",
        updated_at: "2026-07-06T12:00:00.000Z"
      }),
      { id: reviewSessionId }
    ],
    queryRows: [fileRowsWithUnreviewed()]
  });
  const { service, githubDependency } = createService({ database });

  const result = await service.submitReviewSession(
    currentUserId,
    workspaceId,
    reviewSessionId,
    {
      submitType: "COMMENT",
      reviewBody: "Submitting before every file is reviewed."
    }
  );

  const insertQuery = database.queries.find((query) =>
    /INSERT INTO review_submissions/i.test(query.text)
  );
  const fileReviewResults = JSON.parse(insertQuery.values[6]);

  assert.equal(result.githubSubmitStatus, "submitted");
  assert.equal(
    githubDependency.calls.some((call) => call.method === "submitPullRequestReview"),
    true
  );
  assert.equal(fileReviewResults[1].status, "not_reviewed");
}

{
  const database = new FakeDatabase({
    queryOneRows: [sessionRow()],
    queryRows: [fileRows()]
  });
  const githubDependency = new FakeGithubDependency({ currentHeadSha: "head-sha-2" });
  const { service, activityLogService } = createService({
    database,
    githubDependency
  });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "COMMENT",
        reviewBody: "Looks good."
      }),
    (error) =>
      error?.response?.error?.message === "Review session head SHA is stale"
  );
  assert.equal(hasQuery(database, /INSERT INTO review_submissions/i), false);
  assert.equal(
    githubDependency.calls.some((call) => call.method === "submitPullRequestReview"),
    false
  );
  assert.equal(activityLogService.calls.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [sessionRow()],
    queryRows: [fileRows()]
  });
  const githubDependency = new FakeGithubDependency({ connected: false });
  const { service, activityLogService } = createService({
    database,
    githubDependency
  });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "COMMENT",
        reviewBody: "Looks good."
      }),
    (error) =>
      error?.response?.error?.message === "GitHub OAuth connection is required"
  );
  assert.equal(hasQuery(database, /INSERT INTO review_submissions/i), false);
  assert.equal(activityLogService.calls.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [sessionRow()]
  });
  const { service, activityLogService } = createService({ database });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "INVALID",
        reviewBody: "Looks good."
      }),
    (error) =>
      error?.response?.error?.message ===
      "submitType must be COMMENT, APPROVE, or REQUEST_CHANGES"
  );
  assert.equal(hasQuery(database, /INSERT INTO review_submissions/i), false);
  assert.equal(activityLogService.calls.length, 0);
}

{
  const permissionError = forbidden(
    "GitHub App Pull requests write permission is required"
  );
  const database = new FakeDatabase({
    queryOneRows: [sessionRow(), submissionRow(), { id: submissionId }],
    queryRows: [fileRows()]
  });
  const githubDependency = new FakeGithubDependency({
    submitError: permissionError
  });
  const { service, activityLogService } = createService({
    database,
    githubDependency
  });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "APPROVE",
        reviewBody: "Approved."
      }),
    (error) =>
      error?.response?.error?.message ===
      "GitHub App Pull requests write permission is required"
  );
  assert.equal(database.transactionCount, 1);
  assert.equal(hasQuery(database, /INSERT INTO review_submissions/i), true);
  assert.equal(hasQuery(database, /github_submit_status = 'failed'/i), true);
  assert.deepEqual(database.queries.at(-1).values, [
    submissionId,
    "GitHub App Pull requests write permission is required"
  ]);
  assert.equal(activityLogService.calls.length, 1);
  assert.equal(
    activityLogService.calls[0].transaction,
    database.transactionAttempts[0].transaction
  );
  assert.deepEqual(activityLogService.calls[0].input, {
    workspaceId,
    actor: { type: "user", userId: currentUserId },
    action: "review_submission_failed",
    target: { type: "review_submission", id: submissionId },
    dedupeKey: `pr-review:review_submission_failed:${submissionId}:failed`,
    metadata: {
      version: 1,
      summary: "GitHub Review 제출에 실패했습니다.",
      data: { reviewSessionId }
    }
  });
  assert.doesNotMatch(
    JSON.stringify(activityLogService.calls[0].input.metadata),
    /Approved|APPROVE|permission|required|failed$/i
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [sessionRow(), submissionRow(), { id: submissionId }],
    queryRows: [fileRows()]
  });
  const githubDependency = new FakeGithubDependency({
    submitError: new Error("provider token leaked")
  });
  const { service, activityLogService } = createService({
    database,
    githubDependency
  });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "COMMENT",
        reviewBody: "Provider detail must stay private."
      }),
    (error) =>
      error?.response?.error?.message === "GitHub Review submission failed"
  );
  assert.deepEqual(database.queries.at(-1).values, [
    submissionId,
    "GitHub Review submission failed"
  ]);
  assert.equal(activityLogService.calls[0].input.action, "review_submission_failed");
  assert.deepEqual(activityLogService.calls[0].input.metadata.data, {
    reviewSessionId
  });
  assert.doesNotMatch(
    JSON.stringify(activityLogService.calls[0].input.metadata),
    /provider token leaked|GitHub Review submission failed|Provider detail/i
  );
}

{
  const appendError = new Error("activity append failed");
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow(),
      submissionRow(),
      submissionRow({
        github_submit_status: "submitted",
        github_review_id: "987654",
        github_review_url:
          "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
        submitted_at: "2026-07-06T12:00:00.000Z"
      }),
      { id: reviewSessionId }
    ],
    queryRows: [fileRows()]
  });
  const activityLogService = new FakeActivityLogService({ appendError });
  const { service } = createService({ database, activityLogService });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "APPROVE",
        reviewBody: "Approved."
      }),
    (error) => error === appendError
  );
  assert.equal(hasQuery(database, /github_submit_status = 'submitted'/i), false);
  assert.equal(hasQuery(database, /SET status = 'submitted'/i), false);
  assert.equal(database.rolledBackTransactions.length, 1);
  assert.equal(
    database.rolledBackTransactions[0].some((query) =>
      /github_submit_status = 'submitted'/i.test(query.text)
    ),
    true
  );
  assert.equal(
    database.rolledBackTransactions[0].some((query) =>
      /SET status = 'submitted'/i.test(query.text)
    ),
    true
  );
}

{
  const appendError = new Error("activity append failed");
  const database = new FakeDatabase({
    queryOneRows: [sessionRow(), submissionRow(), { id: submissionId }],
    queryRows: [fileRows()]
  });
  const githubDependency = new FakeGithubDependency({
    submitError: forbidden("GitHub permission denied")
  });
  const activityLogService = new FakeActivityLogService({ appendError });
  const { service } = createService({
    database,
    githubDependency,
    activityLogService
  });

  await assert.rejects(
    () =>
      service.submitReviewSession(currentUserId, workspaceId, reviewSessionId, {
        submitType: "APPROVE",
        reviewBody: "Approved."
      }),
    (error) => error === appendError
  );
  assert.equal(hasQuery(database, /github_submit_status = 'failed'/i), false);
  assert.equal(database.rolledBackTransactions.length, 1);
  assert.equal(
    database.rolledBackTransactions[0].some((query) =>
      /github_submit_status = 'failed'/i.test(query.text)
    ),
    true
  );
  assert.equal(
    activityLogService.calls[0].input.action,
    "review_submission_failed"
  );
}

{
  const submitted = submissionRow({
    github_submit_status: "submitted",
    github_review_id: "987654",
    github_review_url:
      "https://github.com/my-team/pilo/pull/24#pullrequestreview-987654",
    submitted_at: "2026-07-06T12:00:00.000Z"
  });
  const failed = submissionRow({
    id: "66666666-6666-4666-8666-666666666666",
    github_submit_status: "failed",
    error_message: "GitHub Review submission failed"
  });
  const database = new FakeDatabase({
    queryOneRows: [sessionRow(), submitted],
    queryRows: [[submitted, failed]]
  });
  const { service } = createService({ database });

  const list = await service.listReviewSubmissions(
    currentUserId,
    workspaceId,
    reviewSessionId
  );
  assert.equal(list.reviewSessionId, reviewSessionId);
  assert.equal(list.submissions.length, 2);
  assert.equal("reviewBody" in list.submissions[0], false);
  assert.equal(list.submissions[1].githubSubmitStatus, "failed");

  const detail = await service.getReviewSubmission(
    currentUserId,
    workspaceId,
    submissionId
  );
  assert.equal(detail.reviewBody, "Please check empty state.");
  assert.deepEqual(detail.fileReviewResults, [
    {
      fileName: "page.tsx",
      filePath: "apps/frontend/page.tsx",
      status: "approved",
      comment: "Looks good."
    }
  ]);
}
