import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PR_REVIEW_ANALYSIS_JOB_TYPE,
  PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
  PrReviewAnalysisJobService
} = require("../../dist/modules/pr-review/pr-review-analysis-job.service.js");
const {
  PrReviewAnalysisJobPublisherService
} = require("../../dist/modules/pr-review/pr-review-analysis-job-publisher.service.js");
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const payload = {
  jobType: PR_REVIEW_ANALYSIS_JOB_TYPE,
  schemaVersion: PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
  jobId: "33333333-3333-3333-3333-333333333333",
  reviewSessionId: "44444444-4444-4444-4444-444444444444",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  headSha: "abcdef123456"
};

class FakeSqsClient {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.commands = [];
    this.destroyCalls = 0;
  }

  async send(command) {
    this.commands.push(command);
    if (this.shouldFail) throw new Error("SQS unavailable");
    return { MessageId: "message-1" };
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class TestJobService extends PrReviewAnalysisJobService {
  constructor(client) {
    super();
    this.client = client;
    this.configs = [];
  }

  createSqsClient(config) {
    this.configs.push(config);
    return this.client;
  }
}

function createClaim(overrides = {}) {
  return {
    id: payload.jobId,
    review_session_id: payload.reviewSessionId,
    workspace_id: payload.workspaceId,
    head_sha: payload.headSha,
    publish_attempt_count: 1,
    publish_claim_token: "55555555-5555-5555-5555-555555555555",
    ...overrides
  };
}

class FakePublisherDatabase {
  constructor({ claim = null, dueRows = [], terminalJob = null } = {}) {
    this.claim = claim;
    this.dueRows = dueRows;
    this.terminalJob = terminalJob;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    return this.dueRows;
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "queryOne", text, values });
        if (text.includes("WITH candidate")) return this.claim;
        if (text.includes("RETURNING review_session_id")) return this.terminalJob;
        throw new Error(`Unhandled publisher query: ${text}`);
      },
      execute: async (text, values = []) => {
        this.calls.push({ method: "transaction.execute", text, values });
        return { rows: [] };
      }
    });
  }
}

class FakePublisherJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async enqueueAnalysisRequestedJob(job) {
    this.calls.push(job);
    if (this.shouldFail) throw new Error("SQS unavailable");
  }
}

class FakeReviewDatabase {
  constructor() {
    this.session = null;
    this.jobs = [];
  }

  async queryOne(text, values = []) {
    if (text.includes("SELECT id") && text.includes("FROM github_pull_requests")) {
      return { id: values[1] };
    }
    if (text.includes("review_session.status = 'analyzing'")) {
      return this.session ? { id: this.session.id } : null;
    }
    if (
      text.includes("FROM pr_review_sessions AS review_session") &&
      text.includes("review_session.id = $2")
    ) {
      return this.session;
    }
    throw new Error(`Unhandled review query: ${text}`);
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        if (text.includes("INSERT INTO pr_review_sessions")) {
          this.session = {
            id: payload.reviewSessionId,
            pull_request_id: values[0],
            created_by_user_id: values[1],
            head_sha: values[2],
            status: "analyzing",
            pr_purpose: null,
            change_summary: [],
            recommended_review_order: null,
            caution_points: [],
            reviewed_count: 0,
            total_file_count: 0,
            conflict_status: values[3],
            conflict_checked_at: values[4],
            analysis_error_code: null,
            analysis_error_message: null,
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:00:00.000Z"
          };
          return this.session;
        }
        if (text.includes("INSERT INTO pr_review_analysis_jobs")) {
          this.jobs.push({
            review_session_id: values[0],
            workspace_id: values[1],
            head_sha: values[2]
          });
          return { id: payload.jobId };
        }
        throw new Error(`Unhandled review transaction query: ${text}`);
      },
      execute: async () => ({ rows: [] })
    });
  }
}

class FakeWorkspaceService {
  async assertWorkspaceAccess() {}
}

class FakeGithubDependency {
  constructor() {
    this.detailCalls = 0;
    this.conflictCalls = 0;
  }

  async getPullRequestDetail() {
    this.detailCalls += 1;
    return {
      id: "11111111-1111-1111-1111-111111111111",
      repositoryId: "repository-1",
      prNumber: 24,
      title: "Async analysis",
      body: null,
      state: "open",
      draft: false,
      mergeable: true,
      authorLogin: "pilo",
      authorAvatarUrl: null,
      headBranch: "feature/async",
      baseBranch: "dev",
      headSha: payload.headSha,
      baseSha: "base-sha",
      changedFilesCount: 20,
      additions: 200,
      deletions: 20,
      commitsCount: 3,
      htmlUrl: "https://github.com/Developer-EJ/PILO/pull/24"
    };
  }

  async getPullRequestConflictStatus() {
    this.conflictCalls += 1;
    return { conflictStatus: "clean", checkedAt: "2026-07-11T00:00:00.000Z" };
  }

  async getPullRequestChangedFiles() {
    throw new Error("createReviewSession must not fetch changed files");
  }
}

class FakeAnalysisService {
  async analyzePullRequest() {
    throw new Error("createReviewSession must not call OpenAI analysis");
  }
}

class FakeReviewPublisher {
  constructor() {
    this.calls = [];
  }

  async publishCreatedJob(jobId) {
    this.calls.push(jobId);
  }
}

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  SQS_PR_REVIEW_ANALYSIS_QUEUE_URL:
    process.env.SQS_PR_REVIEW_ANALYSIS_QUEUE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT
};

try {
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.SQS_PR_REVIEW_ANALYSIS_QUEUE_URL =
    "http://localhost:4566/000000000000/pilo-dev-pr-review-analysis";
  process.env.SQS_ENDPOINT = "http://localhost:4566";

  {
    const client = new FakeSqsClient();
    const service = new TestJobService(client);
    await service.enqueueAnalysisRequestedJob(payload);

    assert.deepEqual(service.configs, [
      {
        awsRegion: "ap-northeast-2",
        queueUrl:
          "http://localhost:4566/000000000000/pilo-dev-pr-review-analysis",
        endpoint: "http://localhost:4566"
      }
    ]);
    assert.equal(client.commands.length, 1);
    assert.deepEqual(JSON.parse(client.commands[0].input.MessageBody), payload);
    service.onModuleDestroy();
    assert.equal(client.destroyCalls, 1);
  }

  {
    const database = new FakePublisherDatabase({
      claim: createClaim(),
      dueRows: [{ id: payload.jobId }]
    });
    const jobService = new FakePublisherJobService();
    const publisher = new PrReviewAnalysisJobPublisherService(database, jobService);
    await publisher.publishDueJobs();

    assert.deepEqual(jobService.calls, [payload]);
    assert.match(
      database.calls.find((call) => call.method === "queryOne").text,
      /FOR UPDATE OF job SKIP LOCKED/
    );
    const queued = database.calls.find(
      (call) => call.method === "execute" && call.text.includes("published_at = now()")
    );
    assert.match(queued.text, /SET status = 'queued'/);
  }

  {
    const database = new FakePublisherDatabase({ claim: createClaim() });
    const publisher = new PrReviewAnalysisJobPublisherService(
      database,
      new FakePublisherJobService({ shouldFail: true })
    );
    await publisher.publishCreatedJob(payload.jobId);

    const retry = database.calls.find(
      (call) =>
        call.method === "execute" &&
        call.text.includes("next_publish_attempt_at = $2")
    );
    assert.equal(retry.values[2], "ANALYSIS_ENQUEUE_FAILED");
    assert.ok(retry.values[1] instanceof Date);
  }

  {
    const database = new FakePublisherDatabase({
      claim: createClaim({ publish_attempt_count: 6 }),
      terminalJob: { review_session_id: payload.reviewSessionId }
    });
    const publisher = new PrReviewAnalysisJobPublisherService(
      database,
      new FakePublisherJobService({ shouldFail: true })
    );
    await publisher.publishCreatedJob(payload.jobId);

    assert.match(
      database.calls.find(
        (call) =>
          call.method === "queryOne" &&
          call.text.includes("RETURNING review_session_id")
      ).text,
      /SET status = 'failed'/
    );
    assert.match(
      database.calls.find((call) => call.method === "transaction.execute").text,
      /analysis_error_code/
    );
  }

  {
    const database = new FakeReviewDatabase();
    const github = new FakeGithubDependency();
    const publisher = new FakeReviewPublisher();
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      github,
      new FakeAnalysisService(),
      publisher
    );
    const pullRequestId = "66666666-6666-6666-6666-666666666666";
    const userId = "11111111-1111-1111-1111-111111111111";

    const first = await service.createReviewSession(userId, payload.workspaceId, pullRequestId);
    assert.equal(first.created, true);
    assert.equal(first.session.status, "analyzing");
    assert.equal(first.session.prPurpose, null);
    assert.deepEqual(first.session.changeSummary, []);
    assert.equal(first.session.totalFileCount, 0);
    assert.equal(first.session.analysisError, null);
    assert.deepEqual(database.jobs, [
      {
        review_session_id: payload.reviewSessionId,
        workspace_id: payload.workspaceId,
        head_sha: payload.headSha
      }
    ]);
    assert.deepEqual(publisher.calls, [payload.jobId]);
    assert.equal(github.detailCalls, 1);

    const duplicate = await service.createReviewSession(
      userId,
      payload.workspaceId,
      pullRequestId
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.session.id, payload.reviewSessionId);
    assert.deepEqual(publisher.calls, [payload.jobId]);
    assert.equal(github.detailCalls, 1);
    assert.equal(github.conflictCalls, 1);
  }
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
