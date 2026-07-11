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

function resultBody(overrides = {}) {
  return {
    jobId: JOB_ID,
    reviewSessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    headSha: HEAD_SHA,
    analysis: {
      prPurpose: "PR Review 분석을 비동기로 처리합니다.",
      changeSummary: ["Worker 결과를 저장합니다."],
      recommendedReviewOrder: "App Server 결과 저장부터 확인합니다.",
      cautionPoints: ["head SHA를 다시 확인합니다."],
      flowTitle: "PR 변경 파일 리뷰",
      flowDescription: "분석 결과를 원자적으로 저장합니다.",
      files: [
        {
          filePath: "apps/app-server/src/pr-review.ts",
          fileRole: "서버 로직",
          riskLevel: "medium",
          changeReason: "비동기 결과를 저장합니다.",
          changeSummary: "결과 handoff",
          reviewPoints: ["중복 결과를 확인합니다."]
        }
      ]
    },
    ...overrides
  };
}

class FakeTransaction {
  constructor(job, { throwOnReviewFile = false } = {}) {
    this.job = job;
    this.throwOnReviewFile = throwOnReviewFile;
    this.calls = [];
    this.reviewFileCount = 0;
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM pr_review_analysis_jobs")) return this.job;
    if (text.includes("INSERT INTO review_flows")) return { id: "flow-id" };
    if (text.includes("INSERT INTO review_files")) {
      this.reviewFileCount += 1;
      if (this.throwOnReviewFile) throw new Error("review file insert failed");
      return { id: `file-${this.reviewFileCount}` };
    }
    if (text.includes("INSERT INTO review_flow_files")) return { id: "flow-file-id" };
    if (text.includes("SET status = 'succeeded'")) return { id: JOB_ID };
    if (text.includes("SET status = 'failed'")) return { id: JOB_ID };
    if (text.includes("SET status = 'reviewing'")) return { id: SESSION_ID };
    if (text.includes("analysis_error_code")) return { id: SESSION_ID };
    throw new Error(`Unhandled query: ${text}`);
  }

  async execute(text, values = []) {
    this.calls.push({ text, values });
    return { rows: [] };
  }
}

class FakeDatabase {
  constructor(job, options = {}) {
    this.job = job;
    this.options = options;
    this.calls = [];
    this.transactionCalls = 0;
    this.rolledBack = false;
    this.transactionState = null;
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM pr_review_analysis_jobs")) return this.job;
    throw new Error(`Unhandled query: ${text}`);
  }

  async transaction(callback) {
    this.transactionCalls += 1;
    this.transactionState = new FakeTransaction(this.job, this.options);
    try {
      return await callback(this.transactionState);
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
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
      body: null,
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
  return new PrReviewService(database, {}, github, {}, {});
}

{
  const database = new FakeDatabase(jobRow());
  const github = new FakeGithubDependency();
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "reviewing",
    persisted: true
  });
  assert.equal(github.detailCalls.length, 1);
  assert.equal(github.fileCalls.length, 1);
  const calls = database.transactionState.calls.map((call) => call.text);
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_flows")));
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_files")));
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_flow_files")));
  assert.ok(calls.some((text) => text.includes("SET status = 'succeeded'")));
  assert.ok(calls.some((text) => text.includes("SET status = 'reviewing'")));
  assert.ok(
    calls.findIndex((text) => text.includes("SET status = 'succeeded'")) <
      calls.findIndex((text) => text.includes("SET status = 'reviewing'"))
  );
}

{
  const database = new FakeDatabase(
    jobRow({ status: "succeeded", session_status: "reviewing" })
  );
  const github = new FakeGithubDependency();
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.equal(result.persisted, false);
  assert.equal(result.status, "reviewing");
  assert.equal(database.transactionCalls, 0);
  assert.deepEqual(github.detailCalls, []);
}

{
  const database = new FakeDatabase(jobRow());
  const github = new FakeGithubDependency({ headSha: "different-head" });
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "failed",
    persisted: true
  });
  const calls = database.transactionState.calls;
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO review_flows")), false);
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO review_files")), false);
  assert.equal(calls.some((call) => call.values.includes("PR_HEAD_CHANGED")), true);
}

{
  const database = new FakeDatabase(jobRow({ session_head_sha: "different-head" }));
  const result = await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobResult(JOB_ID, resultBody());

  assert.equal(result.status, "failed");
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("INSERT INTO review_flows")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow(), { throwOnReviewFile: true });
  await assert.rejects(
    () =>
      createService(database, new FakeGithubDependency()).storeAnalysisJobResult(
        JOB_ID,
        resultBody()
      ),
    /review file insert failed/
  );
  assert.equal(database.rolledBack, true);
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET status = 'reviewing'")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow());
  const result = await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobFailure(JOB_ID, {
    jobId: JOB_ID,
    reviewSessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    headSha: HEAD_SHA,
    code: "ANALYSIS_PROVIDER_FAILED",
    message: "raw provider exception must not reach the session"
  });

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "failed",
    persisted: true
  });
  const sessionFailure = database.transactionState.calls.find((call) =>
    call.text.includes("analysis_error_code")
  );
  assert.equal(
    sessionFailure.values.includes("raw provider exception must not reach the session"),
    false
  );
}

await assert.rejects(
  () =>
    createService(new FakeDatabase(jobRow()), new FakeGithubDependency()).storeAnalysisJobResult(
      JOB_ID,
      resultBody({ headSha: "different-head" })
    ),
  (error) => error?.getStatus?.() === 400
);
