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
const prReviewDiffParser = await readSource(
  "../../src/modules/pr-review/pr-review-diff-parser.ts"
);
const prReviewAnalysisService = await readSource(
  "../../src/modules/pr-review/pr-review-analysis.service.ts"
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
assert.match(prReviewModule, /PrReviewAnalysisService/);

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
assert.match(prReviewController, /@Patch\("review-files\/:reviewFileId\/review"\)/);
assert.match(
  prReviewController,
  /@Get\("review-files\/:reviewFileId\/decisions"\)/
);
assert.match(prReviewController, /@Get\("review-files\/:reviewFileId\/diff"\)/);
assert.match(
  prReviewController,
  /@Post\("review-sessions\/:reviewSessionId\/submissions"\)/
);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/submissions"\)/
);
assert.match(prReviewController, /@Get\("review-submissions\/:submissionId"\)/);
assert.match(prReviewController, /@Patch\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /@Delete\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /apiResponse/);

assert.match(prReviewGithubDependencyService, /GithubIntegrationService/);
assert.match(prReviewGithubDependencyService, /getCurrentUserGithubOAuthStatus/);
assert.match(prReviewGithubDependencyService, /getPullRequestDetail/);
assert.match(prReviewGithubDependencyService, /getPullRequestChangedFiles/);
assert.match(prReviewGithubDependencyService, /getPullRequestConflictStatus/);
assert.match(prReviewGithubDependencyService, /submitPullRequestReview/);
assert.match(prReviewGithubDependencyService, /getGithubPullRequest/);
assert.match(prReviewGithubDependencyService, /listGithubPullRequestFiles/);
assert.match(prReviewGithubDependencyService, /getGithubPullRequestConflictStatus/);
assert.match(prReviewGithubDependencyService, /submitGithubPullRequestReview/);
assert.match(prReviewGithubDependencyService, /mapPullRequestDetail/);
assert.match(prReviewGithubDependencyService, /mapChangedFile/);
assert.match(prReviewGithubDependencyService, /normalizeFileStatus/);
assert.match(prReviewGithubDependencyService, /case "removed"/);
assert.match(prReviewGithubDependencyService, /return "deleted"/);
assert.match(prReviewGithubDependencyService, /conflict\.conflictCheckedAt/);
assert.match(prReviewGithubDependencyService, /Buffer\.byteLength/);
assert.match(prReviewGithubDependencyService, /GitHub pull request head SHA is not synced/);
assert.doesNotMatch(prReviewGithubDependencyService, /Deterministic PR Review stub/);
assert.doesNotMatch(prReviewGithubDependencyService, /createStubChangedFile/);
assert.doesNotMatch(prReviewGithubDependencyService, /1970-01-01T00:00:00.000Z/);

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
assert.match(prReviewService, /analysisService\.analyzePullRequest/);
assert.match(prReviewAnalysisService, /PR 변경 파일 리뷰/);
assert.match(prReviewService, /getReviewSessionSummary/);
assert.match(prReviewService, /getReviewSessionResult/);
assert.match(prReviewService, /getReviewSessionCanvas/);
assert.match(prReviewService, /listReviewFlows/);
assert.match(prReviewService, /listReviewFlowFiles/);
assert.match(prReviewService, /getReviewFile/);
assert.match(prReviewService, /updateReviewFileDecision/);
assert.match(prReviewService, /listReviewFileDecisions/);
assert.match(prReviewService, /getReviewFileDiff/);
assert.match(prReviewService, /submitReviewSession/);
assert.match(prReviewService, /listReviewSubmissions/);
assert.match(prReviewService, /getReviewSubmission/);
assert.match(prReviewService, /parseUnifiedDiffPatch/);
assert.match(prReviewService, /LARGE_DIFF_LINE_THRESHOLD = 1000/);
assert.match(prReviewService, /LARGE_DIFF_PATCH_BYTES = 200 \* 1024/);
assert.match(prReviewService, /REVIEW_DECISION_STATUSES/);
assert.match(prReviewService, /findReviewSessionSummary/);
assert.match(prReviewService, /listReviewFlowsForSession/);
assert.match(prReviewService, /listReviewFlowFilesForSession/);
assert.match(prReviewService, /listReviewFileFlowMemberships/);
assert.match(prReviewService, /listReviewFileDecisionRows/);
assert.match(prReviewService, /updateReviewFileDecisionState/);
assert.match(prReviewService, /insertReviewFileDecision/);
assert.match(prReviewService, /syncReviewSessionReviewProgress/);
assert.match(prReviewService, /github_created_at/);
assert.match(prReviewService, /changed_files_count/);
assert.match(prReviewService, /file_review_decisions/);
assert.match(prReviewService, /review_submissions/);
assert.match(prReviewService, /reviewed_count/);
assert.match(prReviewService, /total_file_count/);
assert.match(prReviewService, /github_submit_status = 'submitted'/);
assert.match(prReviewService, /github_submit_status = 'failed'/);
assert.match(prReviewService, /Review session head SHA is stale/);
assert.match(prReviewService, /GitHub OAuth connection is required/);
assert.match(prReviewService, /current_status = \$3/);
assert.match(prReviewService, /reviewed_by_user_id = \$5/);
assert.match(prReviewService, /review_file\.session_id IN/);
assert.match(prReviewService, /status must be approved, discussion_needed, or unknown/);
assert.match(prReviewService, /readyToSubmit/);
assert.match(prReviewService, /ready_to_submit/);
assert.match(prReviewService, /fileNodeData/);
assert.match(prReviewService, /리뷰 순서/);
assert.match(prReviewService, /mode: "side_by_side"/);
assert.match(prReviewService, /mode === "binary"/);
assert.match(prReviewService, /mode === "large"/);
assert.doesNotMatch(prReviewService, /canvas_freeform_shapes/);
assert.doesNotMatch(prReviewService, /canvas_shape_id/);
assert.match(prReviewAnalysisService, /PrReviewAnalysisService/);
assert.match(prReviewAnalysisService, /OPENAI_API_KEY/);
assert.match(prReviewAnalysisService, /OPENAI_PR_REVIEW_MODEL/);
assert.match(prReviewAnalysisService, /OPENAI_PR_REVIEW_TIMEOUT_MS/);
assert.match(prReviewAnalysisService, /https:\/\/api\.openai\.com\/v1\/responses/);
assert.match(prReviewAnalysisService, /json_schema/);
assert.match(prReviewAnalysisService, /strict: true/);
assert.match(prReviewAnalysisService, /output_text/);
assert.match(prReviewAnalysisService, /buildPromptInput/);
assert.match(prReviewAnalysisService, /patchSnippet/);
assert.match(prReviewAnalysisService, /normalizeAnalysisResult/);
assert.match(prReviewAnalysisService, /buildDeterministicAnalysis/);
assert.match(prReviewAnalysisService, /fallback used/);
assert.match(prReviewAnalysisService, /filePath/);
assert.match(prReviewDiffParser, /parseUnifiedDiffPatch/);
assert.match(prReviewDiffParser, /HUNK_HEADER_PATTERN/);
assert.match(prReviewDiffParser, /oldLineNumber/);
assert.match(prReviewDiffParser, /newLineNumber/);
assert.match(prReviewDiffParser, /type: "unchanged"/);
assert.match(prReviewDiffParser, /type: "deleted"/);
assert.match(prReviewDiffParser, /type: "added"/);
assert.match(prReviewTypes, /PrReviewFileReviewStatus/);
assert.match(prReviewTypes, /PrReviewGithubReviewSubmitType/);
assert.match(prReviewTypes, /PrReviewGithubReviewSubmissionPayload/);
assert.match(prReviewApi, /Pull requests: write/);
assert.match(prReviewApi, /PR 요약 패널 조회/);
assert.match(prReviewApi, /전체 리뷰 결과 조회/);
assert.match(prReviewApi, /Flow 파일 노드 목록 조회/);
assert.match(prReviewApi, /Review File 상세 조회/);
assert.match(prReviewApi, /Diff View Model/);
assert.match(prReviewApi, /파일별 review decision 저장/);
assert.match(prReviewApi, /파일별 decision history 조회/);
assert.match(prReviewApi, /Decision history response/);
assert.match(prReviewApi, /githubCreatedAt/);
assert.match(prReviewApi, /fileNodeData/);

assert.match(databaseService, /DatabaseTransaction/);
assert.match(databaseService, /async transaction/);
assert.match(databaseService, /BEGIN/);
assert.match(databaseService, /COMMIT/);
assert.match(databaseService, /ROLLBACK/);

await import("./diff-parser.test.mjs");
await import("./submission.test.mjs");
