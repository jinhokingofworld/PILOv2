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
  }

  async queryOne(text) {
    if (text.includes("FROM review_files AS review_file")) {
      return {
        ...reviewFile(reviewFileId, "src/conflicted.ts"),
        session_id: reviewSessionId,
        pull_request_id: pullRequestId,
        head_sha: "head-sha",
        conflict_status: "conflicted"
      };
    }

    if (text.includes("FROM pr_review_sessions AS review_session")) {
      return {
        id: reviewSessionId,
        pull_request_id: pullRequestId,
        head_sha: "head-sha",
        conflict_status: "conflicted"
      };
    }

    if (text.includes("UPDATE pr_review_sessions")) {
      if (this.failSessionUpdate) {
        throw new Error("database unavailable");
      }

      return { id: reviewSessionId };
    }

    return null;
  }

  async query(text) {
    if (text.includes("FROM review_files AS review_file")) {
      return this.files;
    }

    return [];
  }
}

function createGithubDependency({
  conflictStatuses = ["clean"],
  failConflictRefresh = false,
  localCacheUpdated = true
} = {}) {
  const applyRequests = [];
  const conflictStatusRequests = [];

  return {
    applyRequests,
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
            unsupportedReason: null
          }))
        };
      },
      async applyPullRequestFileResolution(_userId, _workspaceId, _prId, input) {
        applyRequests.push(input);
        return {
          appliedByGithubLogin: "Developer-EJ",
          commitSha: "merge-commit-sha",
          commitUrl:
            "https://github.com/Developer-EJ/PILO/commit/merge-commit-sha",
          headShaBefore: "head-sha",
          headShaAfter: "merge-commit-sha",
          headBlobShaBefore: "head-blob-sha",
          headBlobShaAfter: "resolved-blob-sha",
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

{
  const database = new FakeDatabase([
    reviewFile(reviewFileId, "src/conflicted.ts")
  ]);
  const { dependency, applyRequests } = createGithubDependency();
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

console.log("PR Review conflict apply tests passed");
