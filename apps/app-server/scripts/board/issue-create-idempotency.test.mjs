import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  BoardIssueCreateOperationService
} = require("../../dist/modules/board/board-issue-create-operation.service.js");
const { boardBadGateway } = require("../../dist/modules/board/board-api-error.js");

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
