import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  BoardIssueCreateOperationService
} = require("../../dist/modules/board/board-issue-create-operation.service.js");
const {
  BoardIssueCreateService
} = require("../../dist/modules/board/board-issue-create.service.js");
const { boardBadGateway } = require("../../dist/modules/board/board-api-error.js");
const { forbidden } = require("../../dist/common/api-error.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const columnId = "7";

const githubIssue = {
  id: 245,
  node_id: "I_kwDOExample",
  number: 245,
  title: "New board issue",
  body: "Issue body",
  state: "open",
  state_reason: null,
  user: {
    login: "juhyeong",
    avatar_url: "https://avatar.test/u/1"
  },
  html_url: "https://github.com/Developer-EJ/PILO/issues/245",
  labels: [],
  assignees: [],
  milestone: null,
  created_at: "2026-07-07T04:44:37Z",
  updated_at: "2026-07-07T04:44:37Z",
  closed_at: null
};

function createClaimInput(overrides = {}) {
  return {
    actorUserId: currentUserId,
    workspaceId,
    boardId,
    columnId,
    title: "New board issue",
    body: "Issue body",
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    ...overrides
  };
}

class FakeOperationQueries {
  constructor() {
    this.operation = null;
  }

  async transaction(callback) {
    return callback({});
  }

  async insertOperation(_transaction, input) {
    if (this.operation) {
      return null;
    }

    this.operation = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      board_id: input.boardId,
      column_id: input.columnId,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      request_title: input.title,
      request_body: input.body ?? null,
      status: "processing",
      completed_stage: "none",
      lease_token: input.leaseToken,
      locked_until: new Date(Date.now() + 300_000).toISOString(),
      github_issue_id: null,
      github_issue_node_id: null,
      github_issue_snapshot: null,
      github_project_item_node_id: null,
      pilo_issue_id: null,
      response_body: null,
      last_error_code: null,
      last_error_message: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return { ...this.operation };
  }

  async findOperationForUpdate(_transaction, input) {
    if (
      !this.operation ||
      this.operation.workspace_id !== input.workspaceId ||
      this.operation.actor_user_id !== input.actorUserId ||
      this.operation.idempotency_key !== input.idempotencyKey
    ) {
      return null;
    }

    return { ...this.operation };
  }

  async claimExistingOperation(_transaction, input) {
    if (!this.operation || this.operation.id !== input.operationId) {
      return null;
    }

    const leaseExpired = new Date(this.operation.locked_until).getTime() <= Date.now();
    if (this.operation.status !== "retryable" && !leaseExpired) {
      return null;
    }

    this.operation = {
      ...this.operation,
      status: "processing",
      lease_token: input.leaseToken,
      locked_until: new Date(Date.now() + 300_000).toISOString(),
      last_error_code: null,
      last_error_message: null
    };
    return { ...this.operation };
  }

  async saveGithubIssue(input) {
    return this.updateActiveAttempt(input, "none", {
      completed_stage: "github_issue_created",
      github_issue_id: input.issue.id,
      github_issue_node_id: input.issue.node_id,
      github_issue_snapshot: input.issue
    });
  }

  async saveProjectItem(input) {
    return this.updateActiveAttempt(input, "github_issue_created", {
      completed_stage: "project_item_added",
      github_project_item_node_id: input.itemNodeId
    });
  }

  async saveStatusUpdated(input) {
    return this.updateActiveAttempt(input, "project_item_added", {
      completed_stage: "status_updated"
    });
  }

  async markRetryable(input) {
    if (!this.isActiveAttempt(input)) {
      return false;
    }

    this.operation = {
      ...this.operation,
      status: "retryable",
      last_error_code: input.errorCode,
      last_error_message: input.errorMessage
    };
    return true;
  }

  async markSucceeded(_transaction, input) {
    if (!this.isActiveAttempt(input)) {
      return false;
    }

    this.operation = {
      ...this.operation,
      status: "succeeded",
      completed_stage: "cache_persisted",
      pilo_issue_id: input.piloIssueId,
      response_body: input.result,
      completed_at: new Date().toISOString()
    };
    return true;
  }

  updateActiveAttempt(input, expectedStage, changes) {
    if (!this.isActiveAttempt(input) || this.operation.completed_stage !== expectedStage) {
      return null;
    }

    this.operation = {
      ...this.operation,
      ...changes,
      locked_until: new Date(Date.now() + 300_000).toISOString()
    };
    return { ...this.operation };
  }

  isActiveAttempt(input) {
    return Boolean(
      this.operation &&
        this.operation.id === input.operationId &&
        this.operation.status === "processing" &&
        this.operation.lease_token === input.leaseToken
    );
  }
}

function createSubject() {
  const queries = new FakeOperationQueries();
  return {
    queries,
    service: new BoardIssueCreateOperationService(queries)
  };
}

{
  const { service } = createSubject();
  await assert.rejects(
    () => service.claimOperation(createClaimInput({ idempotencyKey: undefined })),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "Idempotency-Key is required");
      return true;
    }
  );
}

{
  const { service } = createSubject();
  const first = await service.claimOperation(createClaimInput());
  assert.equal(first.kind, "execute");
  assert.equal(first.attempt.completedStage, "none");

  await assert.rejects(
    () => service.claimOperation(createClaimInput()),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(error.getResponse().error.code, "CONFLICT");
      assert.equal(
        error.getResponse().error.message,
        "Board issue creation is already processing"
      );
      return true;
    }
  );

  await assert.rejects(
    () => service.claimOperation(createClaimInput({ title: "Different request" })),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(error.getResponse().error.code, "CONFLICT");
      assert.equal(
        error.getResponse().error.message,
        "Idempotency-Key was already used for a different Board issue request"
      );
      return true;
    }
  );
}

{
  const { queries, service } = createSubject();
  const claim = await service.claimOperation(createClaimInput());
  const issueAttempt = await service.saveGithubIssue(claim.attempt, githubIssue);
  assert.equal(issueAttempt.completedStage, "github_issue_created");
  assert.equal(issueAttempt.githubIssue.node_id, githubIssue.node_id);

  await service.markRetryableSafely(issueAttempt, new Error("raw provider failure"));
  assert.equal(queries.operation.status, "retryable");
  assert.equal(queries.operation.last_error_code, "INTERNAL_SERVER_ERROR");
  assert.equal(queries.operation.last_error_message, "Board issue creation failed");

  const retry = await service.claimOperation(createClaimInput());
  assert.equal(retry.kind, "execute");
  assert.equal(retry.attempt.completedStage, "github_issue_created");
  assert.equal(retry.attempt.githubIssue.node_id, githubIssue.node_id);

  const itemAttempt = await service.saveProjectItem(
    retry.attempt,
    "PVTI_lADOExample"
  );
  const statusAttempt = await service.saveStatusUpdated(itemAttempt);
  const result = {
    issue: {
      id: "1001",
      title: githubIssue.title
    }
  };
  await service.markSucceeded({}, {
    attempt: statusAttempt,
    piloIssueId: "1001",
    result
  });

  const replay = await service.claimOperation(createClaimInput());
  assert.deepEqual(replay, { kind: "replay", result });
}

{
  const { queries, service } = createSubject();
  const claim = await service.claimOperation(createClaimInput());
  await service.markRetryableSafely(
    claim.attempt,
    boardBadGateway("GitHub ProjectV2 item add failed")
  );
  assert.equal(queries.operation.last_error_code, "BAD_GATEWAY");
  assert.equal(
    queries.operation.last_error_message,
    "GitHub ProjectV2 item add failed"
  );
}

{
  const { queries, service } = createSubject();
  const first = await service.claimOperation(createClaimInput());
  const staleAttempt = first.attempt;
  queries.operation.locked_until = new Date(Date.now() - 1_000).toISOString();

  const reclaimed = await service.claimOperation(createClaimInput());
  assert.equal(reclaimed.kind, "execute");
  assert.notEqual(reclaimed.attempt.leaseToken, staleAttempt.leaseToken);

  await assert.rejects(
    () => service.saveGithubIssue(staleAttempt, githubIssue),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(
        error.getResponse().error.message,
        "Board issue creation attempt is no longer active"
      );
      return true;
    }
  );
}

const operationQueriesSource = await readFile(
  new URL(
    "../../src/modules/board/queries/board-issue-create-operation.queries.ts",
    import.meta.url
  ),
  "utf8"
);
assert.match(operationQueriesSource, /FOR UPDATE/);
assert.match(operationQueriesSource, /lease_token =/);
assert.match(operationQueriesSource, /locked_until <= now\(\)/);
assert.match(operationQueriesSource, /completed_stage = 'cache_persisted'/);

const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueUuid = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const statusFieldId = "66666666-6666-4666-8666-666666666666";

function createTargetRow() {
  return {
    board_id: boardId,
    repository_id: repositoryId,
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO",
    project_v2_id: "77777777-7777-4777-8777-777777777777",
    github_project_node_id: "PVT_kwDOExample",
    status_field_id: statusFieldId,
    github_field_node_id: "PVTSSF_lADOExample",
    status_field_name: "Status",
    target_column_id: columnId,
    target_status_option_id: "88888888-8888-4888-8888-888888888888",
    target_status_option_github_id: "option-todo",
    target_status_name: "Todo",
    target_status_normalized_name: "todo"
  };
}

function createdIssueRow() {
  return {
    id: "1001",
    board_id: boardId,
    column_id: columnId,
    repository_id: repositoryId,
    github_issue_id: githubIssueUuid,
    project_item_id: projectItemId,
    github_issue_node_id: githubIssue.node_id,
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: githubIssue.number,
    issue_number: `#${githubIssue.number}`,
    title: githubIssue.title,
    html_url: githubIssue.html_url,
    state: githubIssue.state,
    labels: githubIssue.labels,
    assignees: githubIssue.assignees,
    position: 0,
    github_updated_at: githubIssue.updated_at,
    last_synced_at: "2026-07-07T04:44:40.000Z",
    created_at: "2026-07-07T04:44:40.000Z",
    updated_at: "2026-07-07T04:44:40.000Z"
  };
}

class FakeCreateQueries {
  constructor({ cacheFailures = 0 } = {}) {
    this.cacheFailures = cacheFailures;
    this.cacheTransactions = 0;
  }

  async findIssueCreateTarget() {
    return createTargetRow();
  }

  async transaction(callback) {
    this.cacheTransactions += 1;
    if (this.cacheFailures > 0) {
      this.cacheFailures -= 1;
      throw new Error("local cache failure");
    }

    return callback({});
  }

  async upsertGithubIssueCache() {
    return githubIssueUuid;
  }

  async upsertProjectItemCache() {
    return projectItemId;
  }

  async upsertProjectItemStatusFieldValue() {}

  async clearProjectItemStatusFieldValue() {}

  async insertPiloIssueCache() {
    return "1001";
  }

  async updatePiloIssueProjectItemNodeId() {}

  async findCreatedIssueCard(...args) {
    assert.ok(args.length === 3 || args.length === 4);
    return createdIssueRow();
  }
}

class FakeWorkspaceService {
  async assertWorkspaceAccess() {}
}

class FakeGithubIssueWriteService {
  constructor() {
    this.calls = [];
  }

  async createIssue(input) {
    this.calls.push(input);
    return { ...githubIssue };
  }
}

class FakeGithubProjectV2WriteService {
  constructor({ addError = null, addFailures = 0, statusFailures = 0 } = {}) {
    this.addError = addError;
    this.addFailures = addFailures;
    this.statusFailures = statusFailures;
    this.accessChecks = [];
    this.addCalls = [];
    this.statusCalls = [];
  }

  async assertProjectV2WriteAccess(userId) {
    this.accessChecks.push(userId);
  }

  async addProjectV2ItemByContentId(input) {
    this.addCalls.push(input);
    if (this.addError) {
      throw this.addError;
    }

    if (this.addFailures > 0) {
      this.addFailures -= 1;
      throw new Error("raw provider failure");
    }

    return { itemNodeId: "PVTI_lADOExample" };
  }

  async updateProjectV2ItemStatus(input) {
    this.statusCalls.push(input);
    if (this.statusFailures > 0) {
      this.statusFailures -= 1;
      throw new Error("raw provider failure");
    }
  }
}

class FakeActivityLogService {
  constructor() {
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ input, transaction });
  }
}

function createOrchestrator({
  addError = null,
  addFailures = 0,
  statusFailures = 0,
  cacheFailures = 0
} = {}) {
  const createQueries = new FakeCreateQueries({ cacheFailures });
  const operationQueries = new FakeOperationQueries();
  const operationService = new BoardIssueCreateOperationService(operationQueries);
  const githubIssueWriteService = new FakeGithubIssueWriteService();
  const githubProjectV2WriteService = new FakeGithubProjectV2WriteService({
    addError,
    addFailures,
    statusFailures
  });
  const activityLogService = new FakeActivityLogService();
  const service = new BoardIssueCreateService(
    createQueries,
    new FakeWorkspaceService(),
    githubIssueWriteService,
    githubProjectV2WriteService,
    operationService,
    activityLogService
  );

  return {
    activityLogService,
    createQueries,
    githubIssueWriteService,
    githubProjectV2WriteService,
    operationQueries,
    service
  };
}

async function createIssue(service, idempotencyKey = "board-create-retry-key") {
  return service.createBoardIssue(
    currentUserId,
    workspaceId,
    boardId,
    {
      body: githubIssue.body,
      columnId,
      title: githubIssue.title
    },
    idempotencyKey
  );
}

function isBoardError(error, status, message) {
  return Boolean(
    error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === status &&
      error.getResponse()?.error?.message === message
  );
}

{
  const subject = createOrchestrator({ addFailures: 1 });
  await assert.rejects(
    () => createIssue(subject.service),
    (error) => isBoardError(error, 502, "GitHub ProjectV2 item add failed")
  );
  const result = await createIssue(subject.service);

  assert.equal(subject.githubIssueWriteService.calls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.addCalls.length, 2);
  assert.equal(subject.githubProjectV2WriteService.statusCalls.length, 1);
  assert.equal(subject.createQueries.cacheTransactions, 1);
  assert.equal(result.issue.id, "1001");
}

{
  const subject = createOrchestrator({ statusFailures: 1 });
  await assert.rejects(
    () => createIssue(subject.service),
    (error) => isBoardError(error, 502, "GitHub ProjectV2 status update failed")
  );
  await createIssue(subject.service);

  assert.equal(subject.githubIssueWriteService.calls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.addCalls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.statusCalls.length, 2);
  assert.equal(subject.createQueries.cacheTransactions, 1);
}

{
  const permissionMessage = "GitHub ProjectV2 write permission is required";
  const subject = createOrchestrator({
    addError: forbidden(permissionMessage)
  });

  await assert.rejects(
    () => createIssue(subject.service, "board-create-permission-key"),
    (error) => isBoardError(error, 403, permissionMessage)
  );

  assert.equal(subject.operationQueries.operation.last_error_code, "FORBIDDEN");
  assert.equal(
    subject.operationQueries.operation.last_error_message,
    permissionMessage
  );
  assert.doesNotMatch(
    subject.operationQueries.operation.last_error_message,
    /raw provider/
  );
}

{
  const subject = createOrchestrator({ cacheFailures: 1 });
  await assert.rejects(() => createIssue(subject.service), /local cache failure/);
  const result = await createIssue(subject.service);

  assert.equal(subject.githubIssueWriteService.calls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.addCalls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.statusCalls.length, 1);
  assert.equal(subject.createQueries.cacheTransactions, 2);
  assert.equal(result.issue.id, "1001");
  assert.equal(subject.activityLogService.calls.length, 1);
  assert.equal(
    subject.activityLogService.calls[0].input.dedupeKey,
    `board:pilo_issue_created:1001:${subject.operationQueries.operation.id}`
  );

  const replay = await createIssue(subject.service);
  assert.deepEqual(replay, result);
  assert.equal(subject.githubIssueWriteService.calls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.addCalls.length, 1);
  assert.equal(subject.githubProjectV2WriteService.statusCalls.length, 1);
  assert.equal(subject.createQueries.cacheTransactions, 2);
  assert.equal(subject.activityLogService.calls.length, 1);
}
