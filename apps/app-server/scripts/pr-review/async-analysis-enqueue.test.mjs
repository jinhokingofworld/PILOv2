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
  constructor(
    pullRequest = {
      state: "open",
      github_closed_at: null,
      merged_at: null
    },
    { concurrentSession = null, failSessionInsertWithUnique = false } = {}
  ) {
    this.session = null;
    this.room = null;
    this.jobs = [];
    this.pullRequest = pullRequest;
    this.concurrentSession = concurrentSession;
    this.failSessionInsertWithUnique = failSessionInsertWithUnique;
    this.reusableLookupCount = 0;
    this.transactions = [];
  }

  async queryOne(text, values = []) {
    if (text.includes("FROM github_pull_requests")) {
      return { id: values[1], ...this.pullRequest };
    }
    if (text.includes("review_session.status = 'analyzing'")) {
      const activeSession =
        this.session ?? (this.transactions.length > 0 ? this.concurrentSession : null);
      return activeSession ? { id: activeSession.id } : null;
    }
    if (
      text.includes("review_session.head_sha = $3") &&
      text.includes("review_session.status <> 'failed'")
    ) {
      this.reusableLookupCount += 1;
      if (this.reusableLookupCount > 1 && this.concurrentSession) {
        return { id: this.concurrentSession.id };
      }
      return null;
    }
    if (
      text.includes("FROM pr_review_sessions AS review_session") &&
      text.includes("review_session.id = $2")
    ) {
      return this.session ?? this.concurrentSession;
    }
    throw new Error(`Unhandled review query: ${text}`);
  }

  async query(text) {
    if (text.includes("UPDATE pr_review_rooms AS review_room")) {
      return [];
    }
    throw new Error(`Unhandled review query list: ${text}`);
  }

  async transaction(callback) {
    const snapshot = {
      session: this.session,
      room: this.room,
      jobs: [...this.jobs]
    };
    const transaction = {
      events: [],
      queryOne: async (text, values = []) => {
        if (text.includes("FROM github_pull_requests")) {
          return { id: values[1], ...this.pullRequest };
        }
        if (text.includes("FROM pr_review_rooms")) {
          return this.room;
        }
        if (text.includes("INSERT INTO canvas")) {
          return { id: "77777777-7777-4777-8777-777777777777" };
        }
        if (text.includes("INSERT INTO pr_review_rooms")) {
          this.room = {
            id: "88888888-8888-4888-8888-888888888888",
            workspace_id: values[0],
            pull_request_id: values[1],
            canvas_id: values[2]
          };
          return this.room;
        }
        if (text.includes("INSERT INTO pr_review_sessions")) {
          transaction.events.push("session");
          if (this.failSessionInsertWithUnique) {
            const error = new Error("duplicate review revision");
            error.code = "23505";
            error.constraint = "idx_pr_review_sessions_room_head_active";
            throw error;
          }
          this.session = {
            id: payload.reviewSessionId,
            room_id: values[0],
            pull_request_id: values[1],
            created_by_user_id: values[2],
            head_sha: values[3],
            status: "analyzing",
            pr_purpose: null,
            change_summary: [],
            recommended_review_order: null,
            caution_points: [],
            reviewed_count: 0,
            total_file_count: 0,
            conflict_status: values[4],
            conflict_checked_at: values[5],
            analysis_error_code: null,
            analysis_error_message: null,
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:00:00.000Z"
          };
          return this.session;
        }
        if (text.includes("INSERT INTO pr_review_analysis_jobs")) {
          transaction.events.push("job");
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
    };
    this.transactions.push(transaction);

    try {
      return await callback(transaction);
    } catch (error) {
      this.session = snapshot.session;
      this.room = snapshot.room;
      this.jobs = snapshot.jobs;
      throw error;
    }
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

class FakeActivityLogService {
  constructor({ error = null, shouldFail = false } = {}) {
    this.error = error ?? (shouldFail ? new Error("activity append failed") : null);
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ transaction, input });
    transaction.events.push("activity");
    if (this.error) throw this.error;
  }
}

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  SQS_PR_REVIEW_ANALYSIS_QUEUE_URL:
    process.env.SQS_PR_REVIEW_ANALYSIS_QUEUE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT
};
const appendUniqueViolationResults = [];

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
    const activityLog = new FakeActivityLogService();
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      github,
      new FakeAnalysisService(),
      publisher,
      activityLog
    );
    const pullRequestId = "66666666-6666-6666-6666-666666666666";
    const userId = "11111111-1111-1111-1111-111111111111";

    const first = await service.createReviewSession(userId, payload.workspaceId, pullRequestId);
    assert.equal(first.created, true);
    assert.equal(first.session.status, "analyzing");
    assert.equal(first.session.reviewRoomId, database.room.id);
    assert.equal(first.roomCreated, true);
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
    assert.equal(activityLog.calls.length, 1);
    assert.strictEqual(activityLog.calls[0].transaction, database.transactions[0]);
    assert.deepEqual(database.transactions[0].events, ["session", "job", "activity"]);
    assert.deepEqual(activityLog.calls[0].input, {
      workspaceId: payload.workspaceId,
      actor: { type: "user", userId },
      action: "pr_review_session_created",
      target: { type: "pr_review_session", id: payload.reviewSessionId },
      dedupeKey: `pr-review:pr_review_session_created:${payload.reviewSessionId}:created`,
      metadata: {
        version: 1,
        summary: "새 PR Review revision을 시작했습니다.",
        data: { pullRequestId }
      }
    });

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
    assert.equal(activityLog.calls.length, 1);
  }

  {
    const database = new FakeReviewDatabase();
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService({ shouldFail: true });
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      new FakeGithubDependency(),
      new FakeAnalysisService(),
      publisher,
      activityLog
    );

    await assert.rejects(
      service.createReviewSession(
        "11111111-1111-1111-1111-111111111111",
        payload.workspaceId,
        "66666666-6666-6666-6666-666666666666"
      ),
      /activity append failed/
    );
    assert.equal(database.session, null);
    assert.equal(database.room, null);
    assert.deepEqual(database.jobs, []);
    assert.deepEqual(publisher.calls, []);
  }

  {
    const appendError = new Error("activity append unique violation");
    appendError.code = "23505";
    appendError.constraint = "activity_logs_workspace_dedupe_key_key";
    const concurrentSession = {
      id: "99999999-9999-4999-8999-999999999999",
      room_id: "88888888-8888-4888-8888-888888888888"
    };
    const database = new FakeReviewDatabase(undefined, { concurrentSession });
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService({ error: appendError });
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      new FakeGithubDependency(),
      new FakeAnalysisService(),
      publisher,
      activityLog
    );

    let rejectedError = null;
    try {
      await service.createReviewSession(
        "11111111-1111-1111-1111-111111111111",
        payload.workspaceId,
        "66666666-6666-6666-6666-666666666666"
      );
    } catch (error) {
      rejectedError = error;
    }
    appendUniqueViolationResults.push({
      case: "initial",
      rejectedOriginalError: rejectedError === appendError
    });
    assert.deepEqual(publisher.calls, []);
  }

  {
    const database = new FakeReviewDatabase();
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService();
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      new FakeGithubDependency(),
      new FakeAnalysisService(),
      publisher,
      activityLog
    );
    const pullRequestId = "66666666-6666-6666-6666-666666666666";
    const userId = "11111111-1111-1111-1111-111111111111";

    const conflictActivityLog = {
      workspaceId: payload.workspaceId,
      actor: { type: "user", userId },
      action: "pr_review_conflict_resolution_applied",
      target: { type: "pull_request", id: pullRequestId },
      dedupeKey:
        `pr-review:pr_review_conflict_resolution_applied:${pullRequestId}:conflict-commit-sha`,
      metadata: {
        version: 1,
        summary: "PR conflict 파일 1개를 해결했습니다.",
        data: {
          reviewSessionId: "99999999-9999-4999-8999-999999999999",
          resolvedFileCount: 1,
          headShaAfter: payload.headSha,
          commitSha: "conflict-commit-sha",
          conflictStatusAfter: "clean"
        }
      }
    };
    const result = await service.createSuccessorReviewRevisionAfterConflictApply({
      currentUserId: userId,
      workspaceId: payload.workspaceId,
      previousSession: {
        room_id: "88888888-8888-4888-8888-888888888888",
        pull_request_id: pullRequestId,
        head_sha: "previous-head-sha"
      },
      headShaAfter: payload.headSha,
      conflictStatus: "clean",
      conflictCheckedAt: "2026-07-11T00:00:00.000Z",
      conflictActivityLog
    });

    assert.deepEqual(result, { created: true, jobId: payload.jobId });
    assert.deepEqual(database.transactions[0].events, [
      "session",
      "job",
      "activity",
      "activity"
    ]);
    assert.equal(activityLog.calls.length, 2);
    assert.equal(activityLog.calls[0].input.action, "pr_review_session_created");
    assert.deepEqual(activityLog.calls[0].input.metadata.data, { pullRequestId });
    assert.equal(
      activityLog.calls[1].input.action,
      "pr_review_conflict_resolution_applied"
    );
    assert.strictEqual(activityLog.calls[1].input, conflictActivityLog);
    assert.deepEqual(publisher.calls, []);
  }

  {
    const concurrentSession = {
      id: payload.reviewSessionId,
      room_id: "88888888-8888-4888-8888-888888888888"
    };
    const database = new FakeReviewDatabase(
      undefined,
      { concurrentSession, failSessionInsertWithUnique: true }
    );
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService();
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      new FakeGithubDependency(),
      new FakeAnalysisService(),
      publisher,
      activityLog
    );

    await service.createSuccessorReviewRevisionAfterConflictApply({
      currentUserId: "11111111-1111-1111-1111-111111111111",
      workspaceId: payload.workspaceId,
      previousSession: {
        room_id: concurrentSession.room_id,
        pull_request_id: "66666666-6666-6666-6666-666666666666",
        head_sha: "previous-head-sha"
      },
      headShaAfter: payload.headSha,
      conflictStatus: "clean",
      conflictCheckedAt: null
    });

    assert.deepEqual(activityLog.calls, []);
    assert.deepEqual(publisher.calls, []);
  }

  {
    const appendError = new Error("successor activity append unique violation");
    appendError.code = "23505";
    appendError.constraint = "activity_logs_workspace_dedupe_key_key";
    const concurrentSession = {
      id: "99999999-9999-4999-8999-999999999999",
      room_id: "88888888-8888-4888-8888-888888888888"
    };
    const database = new FakeReviewDatabase(undefined, { concurrentSession });
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService({ error: appendError });
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      new FakeGithubDependency(),
      new FakeAnalysisService(),
      publisher,
      activityLog
    );

    let rejectedError = null;
    try {
      await service.createSuccessorReviewRevisionAfterConflictApply({
        currentUserId: "11111111-1111-1111-1111-111111111111",
        workspaceId: payload.workspaceId,
        previousSession: {
          room_id: concurrentSession.room_id,
          pull_request_id: "66666666-6666-6666-6666-666666666666",
          head_sha: "previous-head-sha"
        },
        headShaAfter: payload.headSha,
        conflictStatus: "clean",
        conflictCheckedAt: null
      });
    } catch (error) {
      rejectedError = error;
    }
    appendUniqueViolationResults.push({
      case: "successor",
      rejectedOriginalError: rejectedError === appendError
    });
    assert.deepEqual(publisher.calls, []);
  }

  assert.deepEqual(appendUniqueViolationResults, [
    { case: "initial", rejectedOriginalError: true },
    { case: "successor", rejectedOriginalError: true }
  ]);

  {
    const database = new FakeReviewDatabase({
      state: "closed",
      github_closed_at: "2026-07-11T00:00:00.000Z",
      merged_at: "2026-07-11T00:00:00.000Z"
    });
    const github = new FakeGithubDependency();
    const publisher = new FakeReviewPublisher();
    const activityLog = new FakeActivityLogService();
    const service = new PrReviewService(
      database,
      new FakeWorkspaceService(),
      github,
      new FakeAnalysisService(),
      publisher,
      activityLog
    );

    await assert.rejects(
      () =>
        service.createReviewSession(
          "11111111-1111-1111-1111-111111111111",
          payload.workspaceId,
          "66666666-6666-6666-6666-666666666666"
        ),
      (error) =>
        error.getStatus() === 409 &&
        error.getResponse().error.message === "Pull request is closed or merged"
    );
    assert.equal(github.detailCalls, 0);
    assert.equal(github.conflictCalls, 0);
    assert.deepEqual(publisher.calls, []);
    assert.deepEqual(activityLog.calls, []);
  }
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
