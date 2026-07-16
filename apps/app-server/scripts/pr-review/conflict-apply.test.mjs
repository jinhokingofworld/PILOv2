import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const reviewSessionId = "22222222-2222-4222-8222-222222222222";
const reviewFileId = "33333333-3333-4333-8333-333333333333";
const secondReviewFileId = "44444444-4444-4444-8444-444444444444";
const pullRequestId = "55555555-5555-4555-8555-555555555555";
const reviewRoomId = "66666666-6666-4666-8666-666666666666";
const successorSessionId = "77777777-7777-4777-8777-777777777777";
const conflictDedupeKeys = [];

function reviewFile(id, filePath) {
  return {
    id,
    file_path: filePath,
    previous_file_path: null,
    file_status: "modified",
    is_binary: false,
    is_large_diff: false
  };
}

class FakeDatabase {
  constructor(files) {
    this.files = files;
    this.failSessionUpdate = false;
    this.successorSession = null;
    this.transactions = [];
    this.draftClearRequests = [];
  }

  async queryOne(text, values = []) {
    if (text.includes("FROM review_files AS review_file")) {
      return {
        ...reviewFile(reviewFileId, "src/conflicted.ts"),
        session_id: reviewSessionId,
        pull_request_id: pullRequestId,
        head_sha: "head-sha",
        conflict_status: "conflicted"
      };
    }

    if (
      text.includes("review_session.head_sha = $3") &&
      text.includes("review_session.status <> 'failed'")
    ) {
      return this.successorSession;
    }

    if (text.includes("FROM pr_review_sessions AS review_session")) {
      if (values[1] === successorSessionId) {
        return this.successorSession;
      }
      return {
        id: reviewSessionId,
        room_id: reviewRoomId,
        pull_request_id: pullRequestId,
        created_by_user_id: "user-id",
        head_sha: "head-sha",
        status: "reviewing",
        conflict_status: "conflicted"
      };
    }

    return null;
  }

  async query(text, values = []) {
    if (text.includes("FROM review_files AS review_file")) {
      return this.files;
    }
    if (text.includes("DELETE FROM pr_review_conflict_drafts")) {
      this.draftClearRequests.push(values[0]);
    }

    return [];
  }

  async transaction(callback) {
    if (this.failSessionUpdate) {
      this.failSessionUpdate = false;
      throw new Error("database unavailable");
    }

    const previousSuccessorSession = this.successorSession;
    const transaction = {
      queryOne: async (text, values = []) => {
        if (text.includes("INSERT INTO pr_review_sessions")) {
          this.successorSession = {
            id: successorSessionId,
            room_id: values[0],
            pull_request_id: values[1],
            created_by_user_id: values[2],
            head_sha: values[3],
            status: "analyzing",
            conflict_status: values[4],
            conflict_checked_at: values[5]
          };
          return this.successorSession;
        }
        if (text.includes("INSERT INTO pr_review_analysis_jobs")) {
          return { id: "88888888-8888-4888-8888-888888888888" };
        }
        throw new Error(`Unhandled conflict transaction query: ${text}`);
      }
    };
    this.transactions.push(transaction);
    try {
      return await callback(transaction);
    } catch (error) {
      this.successorSession = previousSuccessorSession;
      throw error;
    }
  }
}

function createGithubDependency({
  commitSha = "merge-commit-sha",
  conflictStatuses = ["clean"],
  failApply = false,
  failConflictRefresh = false,
  localCacheUpdated = true,
  multiCommitSha = "multi-merge-commit-sha",
  unsupportedPaths = []
} = {}) {
  const applyRequests = [];
  const multiApplyRequests = [];
  const conflictStatusRequests = [];

  return {
    applyRequests,
    multiApplyRequests,
    conflictStatusRequests,
    dependency: {
      async getPullRequestDetail() {
        return {
          headSha: "head-sha",
          baseSha: "base-sha"
        };
      },
      async getPullRequestConflictInputs(_userId, _workspaceId, _prId, input) {
        return {
          mergeBaseSha: "merge-base-sha",
          files: input.filePaths.map((filePath) => ({
            filePath,
            mergeBaseContent: "const value = 'original';",
            baseContent: "const value = 'target';",
            headContent: "const value = 'head';",
            headBlobSha:
              filePath === "src/conflicted.ts"
                ? "head-blob-sha"
                : "second-head-blob-sha",
            unsupportedReason: unsupportedPaths.includes(filePath)
              ? "binary conflict is not supported"
              : null
          }))
        };
      },
      async applyPullRequestFileResolution(_userId, _workspaceId, _prId, input) {
        if (failApply) {
          throw new Error("GitHub apply failed");
        }
        applyRequests.push(input);
        return {
          appliedByGithubLogin: "Developer-EJ",
          commitSha,
          commitUrl: `https://github.com/Developer-EJ/PILO/commit/${commitSha}`,
          headShaBefore: "head-sha",
          headShaAfter: commitSha,
          headBlobShaBefore: "head-blob-sha",
          headBlobShaAfter: "resolved-blob-sha",
          localCacheUpdated
        };
      },
      async applyPullRequestConflictResolutions(
        _userId,
        _workspaceId,
        _prId,
        input
      ) {
        if (failApply) {
          throw new Error("GitHub apply failed");
        }
        multiApplyRequests.push(input);
        return {
          appliedByGithubLogin: "Developer-EJ",
          commitSha: multiCommitSha,
          commitUrl: `https://github.com/Developer-EJ/PILO/commit/${multiCommitSha}`,
          headShaBefore: "head-sha",
          headShaAfter: multiCommitSha,
          files: input.files.map((file) => ({
            filePath: file.filePath,
            headBlobShaBefore: file.expectedHeadBlobSha,
            headBlobShaAfter: `${file.filePath}-resolved-blob-sha`
          })),
          localCacheUpdated
        };
      },
      async getPullRequestConflictStatus() {
        conflictStatusRequests.push({ pullRequestId });
        if (failConflictRefresh) {
          throw new Error("GitHub temporarily unavailable");
        }

        const conflictStatus =
          conflictStatuses[
            Math.min(conflictStatusRequests.length - 1, conflictStatuses.length - 1)
          ];
        return {
          conflictStatus,
          checkedAt: "2026-07-10T12:00:00.000Z"
        };
      }
    }
  };
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency, multiApplyRequests } = createGithubDependency({
    multiCommitSha: "shared-conflict-commit-sha"
  });
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  const result = await service.applyReviewSessionConflictResolutions(
    "user-id",
    workspaceId,
    reviewSessionId,
    {
      expectedHeadSha: "head-sha",
      files: [
        {
          reviewFileId,
          resolvedContent: "const value = 'resolved';",
          expectedHeadBlobSha: "head-blob-sha"
        },
        {
          reviewFileId: secondReviewFileId,
          resolvedContent: "const second = 'resolved';",
          expectedHeadBlobSha: "second-head-blob-sha"
        }
      ]
    }
  );

  assert.deepEqual(multiApplyRequests, [
    {
      expectedBaseSha: "base-sha",
      expectedHeadSha: "head-sha",
      files: [
        {
          filePath: "src/conflicted.ts",
          resolvedContent: "const value = 'resolved';",
          expectedHeadBlobSha: "head-blob-sha"
        },
        {
          filePath: "src/second-conflict.ts",
          resolvedContent: "const second = 'resolved';",
          expectedHeadBlobSha: "second-head-blob-sha"
        }
      ]
    }
  ]);
  assert.equal(result.status, "applied");
  assert.equal(result.files.length, 2);
  assert.equal(result.localStateStatus, "updated");
  assert.equal(activityLog.appends.length, 2);
  assert.equal(activityLog.appends[0].transaction, database.transactions[0]);
  assert.equal(activityLog.appends[1].transaction, database.transactions[0]);
  assert.deepEqual(activityLog.appends[1].input, {
    workspaceId,
    actor: { type: "user", userId: "user-id" },
    action: "pr_review_conflict_resolution_applied",
    target: { type: "pull_request", id: pullRequestId },
    dedupeKey:
      `pr-review:pr_review_conflict_resolution_applied:${pullRequestId}:shared-conflict-commit-sha`,
    metadata: {
      version: 1,
      summary: "PR conflict 파일 2개를 해결했습니다.",
      data: {
        reviewSessionId,
        resolvedFileCount: 2,
        headShaAfter: "shared-conflict-commit-sha",
        commitSha: "shared-conflict-commit-sha",
        conflictStatusAfter: "clean"
      }
    }
  });
  conflictDedupeKeys.push(activityLog.appends[1].input.dedupeKey);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency, multiApplyRequests } = createGithubDependency();
  const service = createService(database, dependency);

  await assert.rejects(
    () =>
      service.applyReviewSessionConflictResolutions(
        "user-id",
        workspaceId,
        reviewSessionId,
        {
          expectedHeadSha: "head-sha",
          files: [
            {
              reviewFileId,
              resolvedContent: "const value = 'resolved';",
              expectedHeadBlobSha: "head-blob-sha"
            }
          ]
        }
      ),
    (error) =>
      error?.response?.error?.message ===
      "Review session conflict file set is stale"
  );
  assert.deepEqual(multiApplyRequests, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency, multiApplyRequests } = createGithubDependency();
  const service = createService(database, dependency);

  await assert.rejects(
    () =>
      service.applyReviewSessionConflictResolutions(
        "user-id",
        workspaceId,
        reviewSessionId,
        {
          expectedHeadSha: "head-sha",
          files: [
            {
              reviewFileId,
              resolvedContent: "const value = 'resolved';",
              expectedHeadBlobSha: "stale-blob-sha"
            },
            {
              reviewFileId: secondReviewFileId,
              resolvedContent: "const second = 'resolved';",
              expectedHeadBlobSha: "second-head-blob-sha"
            }
          ]
        }
      ),
    (error) =>
      error?.response?.error?.message ===
      "Review file blob SHA is stale: src/conflicted.ts"
  );
  assert.deepEqual(multiApplyRequests, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency, multiApplyRequests } = createGithubDependency({
    unsupportedPaths: ["src/second-conflict.ts"]
  });
  const service = createService(database, dependency);

  await assert.rejects(
    () =>
      service.applyReviewSessionConflictResolutions(
        "user-id",
        workspaceId,
        reviewSessionId,
        {
          expectedHeadSha: "head-sha",
          files: [
            {
              reviewFileId,
              resolvedContent: "const value = 'resolved';",
              expectedHeadBlobSha: "head-blob-sha"
            }
          ]
        }
      ),
    (error) =>
      error?.response?.error?.message ===
      "Unsupported conflict files must be resolved outside PILO"
  );
  assert.deepEqual(multiApplyRequests, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency, multiApplyRequests } = createGithubDependency();
  const service = createService(database, dependency);

  await assert.rejects(
    () =>
      service.applyReviewSessionConflictResolutions(
        "user-id",
        workspaceId,
        reviewSessionId,
        {
          expectedHeadSha: "head-sha",
          files: [
            {
              reviewFileId,
              resolvedContent: "const value = 'first';",
              expectedHeadBlobSha: "head-blob-sha"
            },
            {
              reviewFileId,
              resolvedContent: "const value = 'second';",
              expectedHeadBlobSha: "head-blob-sha"
            }
          ]
        }
      ),
    (error) =>
      error?.response?.error?.message ===
      "files must not contain duplicate reviewFileId values"
  );
  assert.deepEqual(multiApplyRequests, []);
}

function createService(
  database,
  githubDependency,
  activityLogService = { async append() {} }
) {
  return new PrReviewService(
    database,
    {
      async assertWorkspaceAccess() {}
    },
    githubDependency,
    {},
    {
      async publishCreatedJob() {}
    },
    activityLogService
  );
}

function createActivityLogRecorder({ failConflictAppend = false } = {}) {
  const appends = [];
  return {
    appends,
    service: {
      async append(transaction, input) {
        if (
          failConflictAppend &&
          input.action === "pr_review_conflict_resolution_applied"
        ) {
          throw new Error("activity log unavailable");
        }
        appends.push({ transaction, input });
      }
    }
  };
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency, applyRequests } = createGithubDependency({
    commitSha: "shared-conflict-commit-sha"
  });
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.deepEqual(applyRequests, [
    {
      filePath: "src/conflicted.ts",
      resolvedContent: "const value = 'resolved';",
      expectedBaseSha: "base-sha",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  ]);
  assert.equal(result.status, "applied");
  assert.equal(result.localStateStatus, "updated");
  assert.equal(activityLog.appends.length, 2);
  assert.equal(activityLog.appends[0].transaction, database.transactions[0]);
  assert.equal(activityLog.appends[1].transaction, database.transactions[0]);
  assert.deepEqual(activityLog.appends[1].input, {
    workspaceId,
    actor: { type: "user", userId: "user-id" },
    action: "pr_review_conflict_resolution_applied",
    target: { type: "pull_request", id: pullRequestId },
    dedupeKey:
      `pr-review:pr_review_conflict_resolution_applied:${pullRequestId}:shared-conflict-commit-sha`,
    metadata: {
      version: 1,
      summary: "PR conflict 파일 1개를 해결했습니다.",
      data: {
        reviewSessionId,
        resolvedFileCount: 1,
        headShaAfter: "shared-conflict-commit-sha",
        commitSha: "shared-conflict-commit-sha",
        conflictStatusAfter: "clean"
      }
    }
  });
  conflictDedupeKeys.push(activityLog.appends[1].input.dedupeKey);
  assert.equal(conflictDedupeKeys[0], conflictDedupeKeys[1]);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency, conflictStatusRequests } = createGithubDependency({
    conflictStatuses: ["checking", "clean"]
  });
  const service = createService(database, dependency);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.equal(conflictStatusRequests.length, 2);
  assert.equal(result.conflictStatus, "clean");
  assert.equal(result.localStateStatus, "updated");
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency, applyRequests } = createGithubDependency();
  const service = createService(database, dependency);

  await assert.rejects(
    () =>
      service.applyReviewFileConflictResolution(
        "user-id",
        workspaceId,
        reviewFileId,
        {
          resolvedContent: "const value = 'resolved';",
          expectedHeadSha: "head-sha",
          expectedHeadBlobSha: "head-blob-sha"
        }
      ),
    (error) =>
      error?.response?.error?.message ===
      "Single supported content conflict file is required"
  );
  assert.deepEqual(applyRequests, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency } = createGithubDependency({ localCacheUpdated: false });
  const service = createService(database, dependency);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.equal(result.status, "applied");
  assert.equal(result.localStateStatus, "sync_required");
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency } = createGithubDependency({
    failConflictRefresh: true
  });
  const service = createService(database, dependency);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.equal(result.status, "applied");
  assert.equal(result.conflictStatus, "unknown");
  assert.equal(result.conflictCheckedAt, null);
  assert.equal(result.localStateStatus, "sync_required");
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  database.failSessionUpdate = true;
  const { dependency } = createGithubDependency();
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.equal(result.status, "applied");
  assert.equal(result.localStateStatus, "sync_required");
  assert.equal(activityLog.appends.length, 1);
  assert.equal(
    activityLog.appends[0].input.action,
    "pr_review_conflict_resolution_applied"
  );
  assert.equal(activityLog.appends[0].transaction, database.transactions[0]);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  database.successorSession = {
    id: successorSessionId,
    room_id: reviewRoomId,
    pull_request_id: pullRequestId,
    created_by_user_id: "user-id",
    head_sha: "merge-commit-sha",
    status: "analyzing",
    conflict_status: "clean"
  };
  const { dependency } = createGithubDependency();
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  const result = await service.applyReviewFileConflictResolution(
    "user-id",
    workspaceId,
    reviewFileId,
    {
      resolvedContent: "const value = 'resolved';",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.equal(result.localStateStatus, "updated");
  assert.equal(database.transactions.length, 1);
  assert.equal(activityLog.appends.length, 1);
  assert.equal(activityLog.appends[0].transaction, database.transactions[0]);
  assert.equal(
    activityLog.appends[0].input.action,
    "pr_review_conflict_resolution_applied"
  );
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency } = createGithubDependency({ failApply: true });
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  await assert.rejects(
    () =>
      service.applyReviewFileConflictResolution(
        "user-id",
        workspaceId,
        reviewFileId,
        {
          resolvedContent: "const value = 'resolved';",
          expectedHeadSha: "head-sha",
          expectedHeadBlobSha: "head-blob-sha"
        }
      ),
    /GitHub apply failed/
  );
  assert.deepEqual(activityLog.appends, []);
  assert.deepEqual(database.transactions, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts"),
    reviewFile(secondReviewFileId, "src/second-conflict.ts")
  ]);
  const { dependency } = createGithubDependency({ failApply: true });
  const activityLog = createActivityLogRecorder();
  const service = createService(database, dependency, activityLog.service);

  await assert.rejects(
    () =>
      service.applyReviewSessionConflictResolutions(
        "user-id",
        workspaceId,
        reviewSessionId,
        {
          expectedHeadSha: "head-sha",
          files: [
            {
              reviewFileId,
              resolvedContent: "const value = 'resolved';",
              expectedHeadBlobSha: "head-blob-sha"
            },
            {
              reviewFileId: secondReviewFileId,
              resolvedContent: "const second = 'resolved';",
              expectedHeadBlobSha: "second-head-blob-sha"
            }
          ]
        }
      ),
    /GitHub apply failed/
  );
  assert.deepEqual(activityLog.appends, []);
  assert.deepEqual(database.transactions, []);
}

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  database.successorSession = {
    id: successorSessionId,
    room_id: reviewRoomId,
    pull_request_id: pullRequestId,
    created_by_user_id: "user-id",
    head_sha: "merge-commit-sha",
    status: "analyzing",
    conflict_status: "clean"
  };
  const { dependency } = createGithubDependency();
  const activityLog = createActivityLogRecorder({ failConflictAppend: true });
  const service = createService(database, dependency, activityLog.service);

  await assert.rejects(
    () =>
      service.applyReviewFileConflictResolution(
        "user-id",
        workspaceId,
        reviewFileId,
        {
          resolvedContent: "const value = 'resolved';",
          expectedHeadSha: "head-sha",
          expectedHeadBlobSha: "head-blob-sha"
        }
      ),
    /activity log unavailable/
  );
  assert.deepEqual(database.draftClearRequests, [[reviewFileId]]);
}

console.log("PR Review conflict apply tests passed");
