import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const appModule = await readSource("../../src/app.module.ts");
const databaseService = await readSource("../../src/database/database.service.ts");
const prReviewController = await readSource(
  "../../src/modules/pr-review/pr-review.controller.ts"
);
const prReviewGithubDependencyService = await readSource(
  "../../src/modules/pr-review/pr-review-github-dependency.service.ts"
);
const prReviewModule = await readSource(
  "../../src/modules/pr-review/pr-review.module.ts"
);
const prReviewService = await readSource(
  "../../src/modules/pr-review/pr-review.service.ts"
);
const prReviewTypes = await readSource("../../src/modules/pr-review/types/index.ts");
const prReviewApi = await readSource("../../../../docs/api/pr-review-api.md");

assert.match(appModule, /PrReviewModule/);
assert.match(prReviewModule, /CommonModule/);
assert.match(prReviewModule, /DatabaseModule/);
assert.match(prReviewModule, /WorkspaceModule/);
assert.match(prReviewModule, /GithubIntegrationModule/);
assert.match(prReviewModule, /PrReviewController/);
assert.match(prReviewModule, /PrReviewService/);
assert.match(prReviewModule, /PrReviewGithubDependencyService/);

assert.match(prReviewController, /@Controller\("workspaces\/:workspaceId\/github"\)/);
assert.match(prReviewController, /@UseGuards\(AuthGuard\)/);
assert.match(
  prReviewController,
  /@Post\("pull-requests\/:pullRequestId\/review-sessions"\)/
);
assert.match(prReviewController, /@Get\("review-sessions\/:reviewSessionId"\)/);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/summary"\)/
);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/result"\)/
);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/canvas"\)/
);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/flows"\)/
);
assert.match(prReviewController, /@Get\("review-flows\/:flowId\/files"\)/);
assert.match(prReviewController, /@Get\("review-files\/:reviewFileId"\)/);
assert.match(prReviewController, /@Patch\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /@Delete\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /apiResponse/);

assert.match(prReviewGithubDependencyService, /GithubIntegrationService/);
assert.match(prReviewGithubDependencyService, /getCurrentUserGithubOAuthStatus/);
assert.match(prReviewGithubDependencyService, /getPullRequestDetail/);
assert.match(prReviewGithubDependencyService, /getPullRequestChangedFiles/);
assert.match(prReviewGithubDependencyService, /getPullRequestConflictStatus/);
assert.match(prReviewGithubDependencyService, /Deterministic PR Review stub/);
assert.match(prReviewGithubDependencyService, /createStubChangedFile/);
assert.match(
  prReviewGithubDependencyService,
  /checkedAt: "1970-01-01T00:00:00.000Z"/
);

assert.match(prReviewService, /apiContract: "docs\/api\/pr-review-api.md"/);
assert.match(prReviewService, /assertWorkspaceAccess/);
assert.match(prReviewService, /github_pull_requests/);
assert.match(prReviewService, /pr_review_sessions/);
assert.match(prReviewService, /review_files/);
assert.match(prReviewService, /review_flows/);
assert.match(prReviewService, /review_flow_files/);
assert.match(prReviewService, /inFlightSessionCreations/);
assert.match(prReviewService, /transaction/);
assert.match(prReviewService, /Pull request not found in workspace/);
assert.match(prReviewService, /PR 변경 파일 리뷰/);
assert.match(prReviewService, /getReviewSessionSummary/);
assert.match(prReviewService, /getReviewSessionResult/);
assert.match(prReviewService, /getReviewSessionCanvas/);
assert.match(prReviewService, /listReviewFlows/);
assert.match(prReviewService, /listReviewFlowFiles/);
assert.match(prReviewService, /getReviewFile/);
assert.match(prReviewService, /findReviewSessionSummary/);
assert.match(prReviewService, /listReviewFlowsForSession/);
assert.match(prReviewService, /listReviewFlowFilesForSession/);
assert.match(prReviewService, /listReviewFileFlowMemberships/);
assert.match(prReviewService, /github_created_at/);
assert.match(prReviewService, /changed_files_count/);
assert.match(prReviewService, /file_review_decisions/);
assert.match(prReviewService, /readyToSubmit/);
assert.match(prReviewService, /fileNodeData/);
assert.match(prReviewService, /리뷰 순서/);
assert.doesNotMatch(prReviewService, /canvas_freeform_shapes/);
assert.doesNotMatch(prReviewService, /canvas_shape_id/);
assert.match(prReviewTypes, /PrReviewFileReviewStatus/);
assert.match(prReviewApi, /PR 요약 패널 조회/);
assert.match(prReviewApi, /전체 리뷰 결과 조회/);
assert.match(prReviewApi, /Flow 파일 노드 목록 조회/);
assert.match(prReviewApi, /Review File 상세 조회/);
assert.match(prReviewApi, /githubCreatedAt/);
assert.match(prReviewApi, /fileNodeData/);

assert.match(databaseService, /DatabaseTransaction/);
assert.match(databaseService, /async transaction/);
assert.match(databaseService, /BEGIN/);
assert.match(databaseService, /COMMIT/);
assert.match(databaseService, /ROLLBACK/);
