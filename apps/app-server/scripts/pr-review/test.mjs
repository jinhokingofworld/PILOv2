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
const prReviewConflictAnalyzer = await readSource(
  "../../src/modules/pr-review/pr-review-conflict-analyzer.ts"
);
const prReviewConflictResolution = await readSource(
  "../../src/modules/pr-review/pr-review-conflict-resolution.ts"
);
const prReviewSemanticGraph = await readSource(
  "../../src/modules/pr-review/pr-review-semantic-graph.ts"
);
const prReviewAnalysisService = await readSource(
  "../../src/modules/pr-review/pr-review-analysis.service.ts"
);
const prReviewAnalysisJobService = await readSource(
  "../../src/modules/pr-review/pr-review-analysis-job.service.ts"
);
const prReviewAnalysisJobPublisher = await readSource(
  "../../src/modules/pr-review/pr-review-analysis-job-publisher.service.ts"
);
const prReviewAnalysisJobRecovery = await readSource(
  "../../src/modules/pr-review/pr-review-analysis-job-recovery.service.ts"
);
const prReviewAnalysisHandoffGuard = await readSource(
  "../../src/modules/pr-review/pr-review-analysis-handoff.guard.ts"
);
const prReviewAnalysisInternalController = await readSource(
  "../../src/modules/pr-review/pr-review-analysis-internal.controller.ts"
);
const prReviewModule = await readSource(
  "../../src/modules/pr-review/pr-review.module.ts"
);
const prReviewService = await readSource(
  "../../src/modules/pr-review/pr-review.service.ts"
);
const prReviewTypes = await readSource("../../src/modules/pr-review/types/index.ts");
const prReviewApi = await readSource("../../../../docs/api/pr-review-api.md");
const prReviewAnalysisJobMigration = await readSource(
  "../../../../db/migrations/031_create_pr_review_analysis_jobs.sql"
);
const prReviewSemanticGraphMigration = await readSource(
  "../../../../db/migrations/040_create_pr_review_semantic_graph_relations.sql"
);
const sharedReviewRoomMigration = await readSource(
  "../../../../db/migrations/050_create_shared_pr_review_rooms.sql"
);
const databaseReadme = await readSource("../../../../db/README.md");

assert.match(appModule, /PrReviewModule/);
assert.match(prReviewModule, /CommonModule/);
assert.match(prReviewModule, /DatabaseModule/);
assert.match(prReviewModule, /WorkspaceModule/);
assert.match(prReviewModule, /GithubIntegrationModule/);
assert.match(prReviewModule, /PrReviewController/);
assert.match(prReviewModule, /PrReviewService/);
assert.match(prReviewModule, /PrReviewGithubDependencyService/);
assert.match(prReviewModule, /PrReviewAnalysisService/);
assert.match(prReviewModule, /PrReviewAnalysisJobService/);
assert.match(prReviewModule, /PrReviewAnalysisJobPublisherService/);
assert.match(prReviewModule, /PrReviewAnalysisJobRecoveryService/);
assert.match(prReviewModule, /PrReviewAnalysisHandoffGuard/);
assert.match(prReviewModule, /PrReviewAnalysisInternalController/);

assert.match(prReviewController, /@Controller\("workspaces\/:workspaceId\/github"\)/);
assert.match(prReviewController, /@UseGuards\(AuthGuard\)/);
assert.match(
  prReviewController,
  /@Post\("pull-requests\/:pullRequestId\/review-sessions"\)/
);
assert.match(prReviewController, /@Res\(\{ passthrough: true \}\)/);
assert.match(
  prReviewController,
  /@Post\("pull-requests\/:pullRequestId\/review-room"\)/
);
assert.match(prReviewController, /@Get\("review-rooms"\)/);
assert.match(prReviewController, /@Get\("review-rooms\/:reviewRoomId"\)/);
assert.match(
  prReviewController,
  /@Get\("review-rooms\/:reviewRoomId\/revisions"\)/
);
assert.match(
  prReviewController,
  /@Post\("review-rooms\/:reviewRoomId\/revisions"\)/
);
assert.match(prReviewController, /@Delete\("review-rooms\/:reviewRoomId"\)/);
assert.match(prReviewController, /reply\.status\(result\.created \? 201 : 200\)/);
assert.match(
  prReviewController,
  /@Post\("review-sessions\/:reviewSessionId\/retry"\)/
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
  /@Get\("review-sessions\/:reviewSessionId\/conflicts"\)/
);
assert.match(
  prReviewController,
  /@Post\("review-sessions\/:reviewSessionId\/conflict-apply"\)/
);
assert.match(
  prReviewController,
  /@Post\("review-files\/:reviewFileId\/conflict-suggestion"\)/
);
assert.match(prReviewController, /@Body\(\) body: unknown/);
assert.match(
  prReviewController,
  /@Post\("review-files\/:reviewFileId\/conflict-apply"\)/
);
assert.match(
  prReviewController,
  /@Post\("review-sessions\/:reviewSessionId\/submissions"\)/
);
assert.match(prReviewController, /@Post\("review-sessions\/:reviewSessionId\/merge"\)/);
assert.match(
  prReviewController,
  /@Get\("review-sessions\/:reviewSessionId\/submissions"\)/
);
assert.match(prReviewController, /@Get\("review-submissions\/:submissionId"\)/);
assert.match(prReviewController, /@Patch\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /@Delete\("review-sessions\/:reviewSessionId"\)/);
assert.match(prReviewController, /apiResponse/);
assert.match(
  prReviewAnalysisInternalController,
  /@Controller\("internal\/pr-review"\)/
);
assert.match(
  prReviewAnalysisInternalController,
  /@Get\("analysis-jobs\/:jobId\/input"\)/
);
assert.match(
  prReviewAnalysisInternalController,
  /@Post\("analysis-jobs\/:jobId\/result"\)/
);
assert.match(
  prReviewAnalysisInternalController,
  /@Post\("analysis-jobs\/:jobId\/failure"\)/
);
assert.match(prReviewAnalysisInternalController, /PrReviewAnalysisHandoffGuard/);
assert.match(
  prReviewAnalysisHandoffGuard,
  /x-pr-review-analysis-worker-token/
);
assert.match(prReviewAnalysisHandoffGuard, /PR_REVIEW_ANALYSIS_WORKER_TOKEN/);

assert.match(prReviewGithubDependencyService, /GithubIntegrationService/);
assert.match(
  prReviewGithubDependencyService,
  /applyGithubPullRequestConflictResolutions/
);
assert.match(prReviewService, /applyReviewSessionConflictResolutions/);
assert.match(prReviewService, /Review session conflict file set is stale/);
assert.match(
  prReviewApi,
  /review-sessions\/\{reviewSessionId\}\/conflict-apply/
);
assert.match(prReviewGithubDependencyService, /getCurrentUserGithubOAuthStatus/);
assert.match(prReviewGithubDependencyService, /getPullRequestDetail/);
assert.match(prReviewGithubDependencyService, /getPullRequestChangedFiles/);
assert.match(prReviewGithubDependencyService, /getPullRequestConflictStatus/);
assert.match(prReviewGithubDependencyService, /getPullRequestConflictInputs/);
assert.match(prReviewGithubDependencyService, /submitPullRequestReview/);
assert.match(prReviewGithubDependencyService, /mergePullRequest/);
assert.match(prReviewGithubDependencyService, /getGithubPullRequest/);
assert.match(prReviewGithubDependencyService, /listGithubPullRequestFiles/);
assert.match(prReviewGithubDependencyService, /getGithubPullRequestConflictStatus/);
assert.match(prReviewGithubDependencyService, /getGithubPullRequestConflictInputs/);
assert.match(prReviewGithubDependencyService, /submitGithubPullRequestReview/);
assert.match(prReviewGithubDependencyService, /mergeGithubPullRequest/);
assert.match(prReviewGithubDependencyService, /mapPullRequestDetail/);
assert.match(prReviewGithubDependencyService, /mapConflictInputs/);
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
assert.match(prReviewService, /pr_review_rooms/);
assert.match(prReviewService, /pr_review_room_files/);
assert.match(prReviewService, /createSuccessorReviewRevisionAfterConflictApply/);
assert.match(prReviewService, /review_files/);
assert.match(prReviewService, /review_flows/);
assert.match(prReviewService, /review_flow_files/);
assert.match(prReviewService, /review_flow_relations/);
assert.match(prReviewService, /transaction/);
assert.match(prReviewService, /Pull request not found in workspace/);
assert.doesNotMatch(prReviewService, /analysisService\.analyzePullRequest/);
assert.match(prReviewService, /insertAnalyzingReviewSession/);
assert.match(prReviewService, /insertReviewAnalysisJob/);
assert.match(prReviewService, /findActiveAnalyzingReviewSession/);
assert.match(prReviewService, /analysisJobPublisher\.publishCreatedJob/);
assert.match(prReviewService, /analysisError/);
assert.match(prReviewService, /getAnalysisJobInput/);
assert.match(prReviewService, /storeAnalysisJobResult/);
assert.match(prReviewService, /storeAnalysisJobFailure/);
assert.match(prReviewService, /PR_HEAD_CHANGED/);
assert.match(prReviewService, /FOR UPDATE OF job, review_session/);
assert.match(prReviewService, /markAnalysisJobSucceeded/);
assert.match(prReviewService, /failAnalysisJobInTransaction/);
assert.match(prReviewService, /isAnalysisJobInputAvailable/);
assert.match(prReviewAnalysisJobService, /SQS_PR_REVIEW_ANALYSIS_QUEUE_URL/);
assert.match(prReviewAnalysisJobService, /pr_review_analysis_requested/);
assert.match(prReviewAnalysisJobService, /pr-review-analysis:v1/);
assert.match(prReviewAnalysisJobPublisher, /FOR UPDATE OF job SKIP LOCKED/);
assert.match(prReviewAnalysisJobPublisher, /ANALYSIS_ENQUEUE_FAILED/);
assert.match(prReviewAnalysisJobPublisher, /publishDueJobs/);
assert.match(prReviewAnalysisJobRecovery, /PROCESSING_STALE_TIMEOUT_SECONDS/);
assert.match(prReviewAnalysisJobRecovery, /QUEUED_STALE_TIMEOUT_SECONDS/);
assert.match(prReviewAnalysisJobRecovery, /recoverStaleJobs/);
assert.match(prReviewAnalysisJobRecovery, /logStatusCounts/);
assert.match(
  prReviewAnalysisJobPublisher,
  /publishDueJobs\(\)\.catch\(\(error: unknown\) => \{\s*this\.logger\.error\("PR Review analysis publish recovery sweep failed", error\);/
);
assert.match(
  prReviewAnalysisJobPublisher,
  /publishDueJobs\(\)\.catch\(\(error: unknown\) => \{\s*this\.logger\.error\("Initial PR Review analysis publish recovery sweep failed", error\);/
);
assert.match(
  prReviewAnalysisJobPublisher,
  /catch \(error: unknown\) \{\s*this\.logger\.error\(`Immediate PR Review analysis publish failed job_id=\$\{jobId\}`, error\);/
);
assert.match(
  prReviewAnalysisJobPublisher,
  /catch \(error: unknown\) \{\s*this\.logger\.error\(\s*`PR Review analysis publish enqueue failed job_id=\$\{claim\.id\} session_id=\$\{claim\.review_session_id\}`,\s*error\s*\);\s*await this\.markPublishFailure\(claim\);/
);
assert.match(prReviewAnalysisJobMigration, /CREATE TABLE public\.pr_review_analysis_jobs/);
assert.match(prReviewAnalysisJobMigration, /UNIQUE \(review_session_id\)/);
assert.match(
  prReviewAnalysisJobMigration,
  /idx_pr_review_sessions_active_creator_pull_request/
);
assert.match(prReviewAnalysisJobMigration, /FOR EACH ROW/);
assert.match(prReviewAnalysisJobMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(databaseReadme, /031_create_pr_review_analysis_jobs\.sql/);
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
assert.match(prReviewService, /getReviewSessionConflicts/);
assert.match(prReviewService, /createReviewFileConflictSuggestion/);
assert.match(prReviewService, /mergeReviewSession/);
assert.match(prReviewService, /assertReviewSessionMergeable/);
assert.match(prReviewService, /refreshPendingReviewSessionConflictStatus/);
assert.match(prReviewService, /getSettledPullRequestConflictStatus/);
assert.match(prReviewService, /updateReviewSessionConflictStatus/);
assert.match(prReviewService, /normalizeReviewSessionMerge/);
assert.match(prReviewService, /submitReviewSession/);
assert.match(prReviewService, /listReviewSubmissions/);
assert.match(prReviewService, /getReviewSubmission/);
assert.match(prReviewService, /parseUnifiedDiffPatch/);
assert.match(prReviewService, /LARGE_DIFF_LINE_THRESHOLD = 1000/);
assert.match(prReviewService, /LARGE_DIFF_PATCH_BYTES = 200 \* 1024/);
assert.match(prReviewService, /REVIEW_DECISION_STATUSES/);
assert.match(prReviewService, /findReviewSessionSummary/);
assert.match(prReviewService, /pull_request\.raw->>'state'/);
assert.match(prReviewService, /pull_request\.github_closed_at IS NOT NULL/);
assert.match(prReviewService, /pull_request\.raw \? 'mergeable'/);
assert.doesNotMatch(prReviewService, /pull_request\.state::text/);
assert.doesNotMatch(prReviewService, /pull_request\.mergeable/);
assert.match(prReviewService, /listReviewFlowsForSession/);
assert.match(prReviewService, /listReviewFlowFilesForSession/);
assert.match(prReviewService, /listReviewFilesForCanvasFallback/);
assert.match(prReviewService, /buildFallbackReviewSessionCanvas/);
assert.match(prReviewService, /shouldUseCanvasFallback/);
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
assert.match(prReviewService, /conflictError\("Review session head SHA is stale"\)/);
assert.match(prReviewService, /stored: false/);
assert.match(prReviewService, /supportedTypes: \["content"\]/);
assert.match(prReviewService, /extractContentConflictHunks/);
assert.match(prReviewService, /getPullRequestConflictInputs/);
assert.match(prReviewService, /analysisService\.suggestConflictResolution/);
assert.match(prReviewService, /normalizeConflictSuggestionCurrentDraft/);
assert.match(prReviewService, /CONFLICT_SUGGESTION_DRAFT_SOURCES/);
assert.match(prReviewService, /findReviewFileConflictSuggestionTarget/);
assert.match(prReviewService, /mapConflictSuggestion/);
assert.match(prReviewService, /binary conflict is not supported/);
assert.match(prReviewService, /large diff conflict is not supported/);
assert.match(prReviewService, /GitHub OAuth connection is required/);
assert.match(prReviewService, /current_status = \$3/);
assert.match(prReviewService, /reviewed_by_user_id = \$5/);
assert.match(prReviewService, /review_file\.session_id = review_session\.id/);
assert.match(prReviewService, /risk_level/);
assert.match(prReviewService, /status must be approved, discussion_needed, or unknown/);
assert.match(prReviewService, /readyToSubmit/);
assert.match(prReviewService, /ready_to_submit/);
assert.match(prReviewService, /fileNodeData/);
assert.match(prReviewService, /리뷰 순서/);
assert.match(prReviewService, /relation\.confidence >= 60/);
assert.match(prReviewService, /relationType: "review_order"/);
assert.match(prReviewService, /source: "fallback"/);
assert.match(prReviewService, /리뷰 흐름 연결 정보를 사용할 수 없어/);
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
assert.match(prReviewAnalysisService, /PR_REVIEW_CONFLICT_SUGGESTION_SCHEMA/);
assert.match(prReviewAnalysisService, /pr_review_conflict_suggestion/);
assert.match(prReviewAnalysisService, /suggestConflictResolution/);
assert.match(prReviewAnalysisService, /buildDeterministicConflictSuggestion/);
assert.match(prReviewAnalysisService, /resolvedHunks/);
assert.match(prReviewAnalysisService, /currentDraft/);
assert.match(prReviewAnalysisService, /Treat currentDraft as user work/);
assert.match(prReviewAnalysisService, /buildResolvedFileContent/);
assert.match(prReviewAnalysisService, /CONFLICT_MARKER_PATTERN/);
assert.match(prReviewAnalysisService, /riskLevel/);
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
assert.match(prReviewConflictAnalyzer, /node-diff3/);
assert.match(prReviewConflictAnalyzer, /diff3Merge/);
assert.match(prReviewConflictAnalyzer, /extractContentConflictHunks/);
assert.match(prReviewConflictAnalyzer, /excludeFalseConflicts: true/);
assert.match(prReviewConflictAnalyzer, /baseText/);
assert.match(prReviewConflictAnalyzer, /currentText/);
assert.match(prReviewConflictAnalyzer, /incomingText/);
assert.match(prReviewConflictResolution, /buildResolvedFileContent/);
assert.match(prReviewConflictResolution, /resolvedTextByHunkId/);
assert.match(prReviewSemanticGraph, /buildDeterministicSemanticGraphCandidates/);
assert.match(prReviewSemanticGraph, /relative_import/);
assert.match(prReviewService, /headContent/);
assert.match(prReviewService, /resolvedHunks/);
assert.match(prReviewTypes, /PrReviewFileReviewStatus/);
assert.match(prReviewTypes, /PrReviewGithubConflictInputsPayload/);
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
assert.match(prReviewApi, /Conflict Analysis/);
assert.match(prReviewApi, /AI Conflict Suggestion Draft/);
assert.match(prReviewApi, /conflict-suggestion/);
assert.match(prReviewApi, /conflictSuggestion\.status/);
assert.match(prReviewApi, /"headContent"/);
assert.match(prReviewApi, /"resolvedHunks"/);
assert.match(prReviewApi, /"currentDraft"/);
assert.match(prReviewApi, /"manual"/);
assert.match(prReviewApi, /stored": false/);
assert.match(prReviewApi, /githubCreatedAt/);
assert.match(prReviewApi, /fileNodeData/);
assert.match(prReviewApi, /riskLevel/);
assert.match(prReviewApi, /roleType/);
assert.match(prReviewApi, /depends_on/);
assert.match(prReviewApi, /confidence >= 60/);

assert.match(
  prReviewSemanticGraphMigration,
  /CREATE TABLE public\.review_flow_relations/
);
assert.match(
  prReviewSemanticGraphMigration,
  /CHECK \(from_review_flow_file_id <> to_review_flow_file_id\)/
);
assert.match(
  prReviewSemanticGraphMigration,
  /UNIQUE \(\s*flow_id,\s*from_review_flow_file_id,\s*to_review_flow_file_id,\s*relation_type\s*\)/
);
assert.match(prReviewSemanticGraphMigration, /confidence BETWEEN 0 AND 100/);
assert.match(prReviewSemanticGraphMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(
  databaseReadme,
  /040_create_pr_review_semantic_graph_relations\.sql/
);
assert.match(sharedReviewRoomMigration, /DELETE FROM public\.pr_review_sessions/);
assert.match(sharedReviewRoomMigration, /CREATE TABLE public\.pr_review_rooms/);
assert.match(
  sharedReviewRoomMigration,
  /CREATE TABLE public\.pr_review_room_files/
);
assert.match(sharedReviewRoomMigration, /idx_pr_review_sessions_room_head_active/);
assert.match(sharedReviewRoomMigration, /idx_pr_review_sessions_room_analyzing/);
assert.match(sharedReviewRoomMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(sharedReviewRoomMigration, /validate_pr_review_room_canvas/);
assert.match(databaseReadme, /050_create_shared_pr_review_rooms\.sql/);
assert.match(prReviewApi, /공유 Review Room/);
assert.match(prReviewApi, /review-rooms\/\{reviewRoomId\}\/revisions/);

assert.match(databaseService, /DatabaseTransaction/);
assert.match(databaseService, /async transaction/);
assert.match(databaseService, /BEGIN/);
assert.match(databaseService, /COMMIT/);
assert.match(databaseService, /ROLLBACK/);

await import("./diff-parser.test.mjs");
await import("./conflict-analyzer.test.mjs");
await import("./conflict-resolution.test.mjs");
await import("./conflict-suggestion-context.test.mjs");
await import("./conflict-apply.test.mjs");
await import("./conflict-status-refresh.test.mjs");
await import("./decision-progress.test.mjs");
await import("./submission.test.mjs");
await import("./async-analysis-enqueue.test.mjs");
await import("./analysis-input-handoff.test.mjs");
await import("./analysis-result-handoff.test.mjs");
await import("./analysis-job-recovery.test.mjs");
await import("./analysis-retry.test.mjs");
await import("./github-file-pagination.test.mjs");
await import("./semantic-graph-contract.test.mjs");
await import("./semantic-graph-candidates.test.mjs");
await import("./semantic-graph-validator.test.mjs");
