import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildPiloIssueCreatedActivityLog,
  buildPiloIssueMovedActivityLog,
  buildPiloIssueUpdatedActivityLog
} = require("../../dist/modules/board/board-activity-log.js");

const actorUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const issueId = "1001";
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const beforeUpdatedAt = "2026-07-06T13:18:40.000Z";

{
  const first = buildPiloIssueCreatedActivityLog({
    actorUserId,
    boardId,
    issueId,
    operationId,
    workspaceId
  });
  const retry = buildPiloIssueCreatedActivityLog({
    actorUserId,
    boardId,
    issueId,
    operationId,
    workspaceId
  });

  assert.deepEqual(first, retry);
  assert.equal(first.action, "pilo_issue_created");
  assert.deepEqual(first.actor, { type: "user", userId: actorUserId });
  assert.deepEqual(first.target, { type: "pilo_issue", id: issueId });
  assert.equal(
    first.dedupeKey,
    `board:pilo_issue_created:${issueId}:${operationId}`
  );
  assert.deepEqual(first.metadata, {
    version: 1,
    summary: "Board 이슈를 생성했습니다.",
    data: { boardId }
  });
}

{
  const input = {
    actorUserId,
    after: {
      title: "회의록에 저장하면 안 되는 새 제목",
      body: "회의록에 저장하면 안 되는 새 본문",
      state: "closed",
      assignees: [{ login: "Juhyeong" }],
      updated_at: "2026-07-06T13:56:37.000Z"
    },
    before: {
      title: "이전 제목",
      body: "이전 본문",
      state: "open",
      assignees: [],
      updatedAt: beforeUpdatedAt
    },
    boardId,
    issueId,
    requestedChanges: {
      title: "회의록에 저장하면 안 되는 새 제목",
      body: "회의록에 저장하면 안 되는 새 본문",
      state: "closed",
      assignees: ["Juhyeong"]
    },
    workspaceId
  };
  const first = buildPiloIssueUpdatedActivityLog(input);
  const retry = buildPiloIssueUpdatedActivityLog({
    ...input,
    after: {
      ...input.after,
      updated_at: "2026-07-06T14:00:00.000Z"
    }
  });

  assert.ok(first);
  assert.deepEqual(first, retry);
  assert.equal(first.action, "pilo_issue_updated");
  assert.deepEqual(first.metadata, {
    version: 1,
    summary: "Board 이슈의 제목, 본문, 상태, 담당자를 수정했습니다.",
    data: {
      boardId,
      changedFields: ["title", "body", "state", "assignees"]
    }
  });
  assert.match(
    first.dedupeKey,
    new RegExp(`^board:pilo_issue_updated:${issueId}:[a-f0-9]{64}$`)
  );
  assert.doesNotMatch(JSON.stringify(first), /저장하면 안 되는|이전 제목|이전 본문/);
}

{
  const noOp = buildPiloIssueUpdatedActivityLog({
    actorUserId,
    after: {
      title: "Same title",
      body: null,
      state: "open",
      assignees: [{ login: "Alice" }]
    },
    before: {
      title: "Same title",
      body: null,
      state: "open",
      assignees: [{ login: "alice" }],
      updatedAt: beforeUpdatedAt
    },
    boardId,
    issueId,
    requestedChanges: {
      title: "Same title",
      assignees: ["Alice"]
    },
    workspaceId
  });

  assert.equal(noOp, null);
}

{
  const unrequestedProviderDifference = buildPiloIssueUpdatedActivityLog({
    actorUserId,
    after: {
      title: "Provider-side title drift",
      body: "Same body",
      state: "open",
      assignees: []
    },
    before: {
      title: "Cached title",
      body: "Same body",
      state: "open",
      assignees: [],
      updatedAt: beforeUpdatedAt
    },
    boardId,
    issueId,
    requestedChanges: { state: "open" },
    workspaceId
  });

  assert.equal(unrequestedProviderDifference, null);
}

{
  const first = buildPiloIssueMovedActivityLog({
    actorUserId,
    beforeUpdatedAt,
    boardId,
    from: "10",
    issueId,
    to: "20",
    workspaceId
  });
  const retry = buildPiloIssueMovedActivityLog({
    actorUserId,
    beforeUpdatedAt: new Date(beforeUpdatedAt),
    boardId,
    from: "10",
    issueId,
    to: "20",
    workspaceId
  });

  assert.ok(first);
  assert.deepEqual(first, retry);
  assert.equal(first.action, "pilo_issue_moved");
  assert.deepEqual(first.metadata, {
    version: 1,
    summary: "Board 이슈를 이동했습니다.",
    data: { boardId, from: "10", to: "20" }
  });
  assert.match(
    first.dedupeKey,
    new RegExp(`^board:pilo_issue_moved:${issueId}:[a-f0-9]{64}$`)
  );
}

{
  const noOp = buildPiloIssueMovedActivityLog({
    actorUserId,
    beforeUpdatedAt,
    boardId,
    from: "10",
    issueId,
    to: "10",
    workspaceId
  });

  assert.equal(noOp, null);
}
