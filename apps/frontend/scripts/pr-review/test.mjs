import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const prReviewTypes = await readFile(
  new URL("../../src/features/pr-review/types.ts", import.meta.url),
  "utf8"
);
const prReviewNavigation = await readFile(
  new URL("../../src/features/pr-review/navigation.ts", import.meta.url),
  "utf8"
);
const prReviewPage = await readFile(
  new URL("../../src/features/pr-review/page.tsx", import.meta.url),
  "utf8"
);
const prReviewRoutePage = await readFile(
  new URL("../../src/app/(workspace)/pr-review/page.tsx", import.meta.url),
  "utf8"
);
const prReviewApiClient = await readFile(
  new URL("../../src/features/pr-review/api/client.ts", import.meta.url),
  "utf8"
);
const prReviewAnalysisStatus = await readFile(
  new URL("../../src/features/pr-review/analysis-status.ts", import.meta.url),
  "utf8"
);
const prReviewAnalysisStatusComponent = await readFile(
  new URL(
    "../../src/features/pr-review/components/pr-review-analysis-status.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewPanel = await readFile(
  new URL(
    "../../src/features/pr-review/components/pr-review-panel.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewCanvasShell = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewCanvasShell.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewCanvasSurface = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewCanvasPersistence = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-canvas-persistence.ts",
    import.meta.url
  ),
  "utf8"
);
const prReviewNodeActivation = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-node-activation.ts",
    import.meta.url
  ),
  "utf8"
);
const prReviewFileDiffDrawer = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewFileDiffDrawer.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewResolvedCodeEditor = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewResolvedCodeEditor.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewConflictResolution = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-conflict-resolution.ts",
    import.meta.url
  ),
  "utf8"
);
const prReviewResolvedCodeDiff = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-resolved-code-diff.ts",
    import.meta.url
  ),
  "utf8"
);
const prReviewConflictDrafts = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-conflict-drafts.ts",
    import.meta.url
  ),
  "utf8"
);
const prReviewSubmitReviewModal = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewSubmitReviewModal.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewFileNodeShapeUtil = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil.tsx",
    import.meta.url
  ),
  "utf8"
);
const prReviewShapeUtils = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/pr-review-shape-utils.ts",
    import.meta.url
  ),
  "utf8"
);

assert.match(prReviewTypes, /export type PrReviewRepository/);
assert.match(prReviewTypes, /export type PrReviewPullRequest/);
assert.match(prReviewTypes, /export type PrReviewSession/);
assert.match(prReviewTypes, /export type PrReviewAnalysisErrorCode/);
assert.match(prReviewTypes, /analysisError: PrReviewAnalysisError \| null/);
assert.match(prReviewTypes, /export type PrReviewSummary/);
assert.match(prReviewTypes, /export type PrReviewCanvas/);
assert.match(prReviewTypes, /export type PrReviewFileNodeData/);
assert.match(prReviewTypes, /export type PrReviewFileRiskLevel/);
assert.match(prReviewTypes, /export type PrReviewFile =/);
assert.match(prReviewTypes, /decisionCarriedOver: boolean/);
assert.match(prReviewTypes, /export type PrReviewFileDiff =/);
assert.match(prReviewTypes, /export type PrReviewConflictAnalysis =/);
assert.match(prReviewTypes, /export type PrReviewConflictFile =/);
assert.match(prReviewTypes, /export type PrReviewConflictSuggestion =/);
assert.match(prReviewTypes, /export type PrReviewConflictResolvedHunk =/);
assert.match(prReviewTypes, /export type ApplyPrReviewConflictsInput =/);
assert.match(prReviewTypes, /export type PrReviewConflictsApplyResult =/);
assert.match(prReviewTypes, /headContent: string/);
assert.match(prReviewTypes, /resolvedHunks: PrReviewConflictResolvedHunk\[\]/);
assert.match(prReviewTypes, /export type PrReviewUnsupportedConflictFile =/);
assert.match(prReviewTypes, /export type PrReviewConflictHunk =/);
assert.match(prReviewTypes, /export type UpdatePrReviewFileDecisionInput =/);
assert.match(prReviewTypes, /export type PrReviewSubmitType =/);
assert.match(prReviewTypes, /export type PrReviewSessionResult =/);
assert.match(prReviewTypes, /export type PrReviewSubmission =/);
assert.match(prReviewTypes, /export type SubmitPrReviewSessionInput =/);
assert.match(prReviewTypes, /export type MergePrReviewSessionInput =/);
assert.match(prReviewTypes, /export type PrReviewMergeResult =/);
assert.match(prReviewTypes, /pullRequestMergedAt/);
assert.match(prReviewNavigation, /href: "\/pr-review"/);
assert.match(prReviewNavigation, /title: "PR/);
assert.doesNotMatch(prReviewNavigation, /\/pr-review#/);
assert.match(prReviewPage, /<PrReviewPanel \/>/);
assert.match(prReviewRoutePage, /import "tldraw\/tldraw\.css"/);
assert.match(prReviewApiClient, /createPrReviewApiClient/);
assert.match(prReviewApiClient, /startGithubOAuth/);
assert.match(prReviewApiClient, /\/me\/github\/oauth\/start/);
assert.match(prReviewApiClient, /credentials: "include"/);
assert.match(prReviewApiClient, /\/api\/v1/);
assert.match(prReviewApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(prReviewApiClient, /Authorization/);
assert.match(prReviewApiClient, /cache: "no-store"/);
assert.match(prReviewApiClient, /credentials: "same-origin"/);
assert.match(prReviewApiClient, /listRepositories/);
assert.match(prReviewApiClient, /listOpenPullRequests/);
assert.match(prReviewApiClient, /state: "open"/);
assert.match(prReviewApiClient, /getPullRequest/);
assert.match(prReviewApiClient, /listPullRequestFiles/);
assert.match(prReviewApiClient, /createReviewSession/);
assert.match(prReviewApiClient, /getReviewSession/);
assert.match(prReviewApiClient, /retryReviewSession/);
assert.match(prReviewApiClient, /getReviewSessionSummary/);
assert.match(prReviewApiClient, /getReviewSessionCanvas/);
assert.match(prReviewApiClient, /getReviewRoom/);
assert.match(prReviewApiClient, /listReviewCanvasShapes/);
assert.match(prReviewApiClient, /getReviewCanvasShape/);
assert.match(prReviewApiClient, /updateReviewCanvasFileShape/);
assert.match(prReviewApiClient, /getReviewSessionConflicts/);
assert.match(prReviewApiClient, /createReviewFileConflictSuggestion/);
assert.match(prReviewApiClient, /applyReviewSessionConflictResolutions/);
assert.match(prReviewApiClient, /getReviewSessionResult/);
assert.match(prReviewApiClient, /submitReviewSession/);
assert.match(prReviewApiClient, /mergeReviewSession/);
assert.match(prReviewApiClient, /getReviewFile/);
assert.match(prReviewApiClient, /getReviewFileDiff/);
assert.match(prReviewApiClient, /updateReviewFileDecision/);
assert.match(prReviewApiClient, /\/result/);
assert.match(prReviewApiClient, /\/conflicts/);
assert.match(prReviewApiClient, /\/conflict-suggestion/);
assert.match(prReviewApiClient, /\/conflict-apply/);
assert.match(prReviewApiClient, /\/submissions/);
assert.match(prReviewApiClient, /\/merge/);
assert.match(prReviewApiClient, /method: "POST"/);
assert.match(prReviewApiClient, /\/review-files/);
assert.match(prReviewApiClient, /method: "PATCH"/);
assert.match(prReviewApiClient, /\/review-sessions/);
assert.match(prReviewApiClient, /\/retry/);
assert.doesNotMatch(prReviewApiClient, /features\/github-integration/);
assert.match(prReviewPanel, /useAuthSession/);
assert.match(prReviewPanel, /PR_PAGE_SIZE/);
assert.match(prReviewPanel, /setTimeout/);
assert.match(prReviewPanel, /300/);
assert.match(prReviewPanel, /router\.push\("\/github"\)/);
assert.match(prReviewPanel, /PrReviewCanvasShell/);
assert.match(prReviewPanel, /apiClient=\{apiClient\}/);
assert.match(prReviewPanel, /workspaceId=\{workspaceId\}/);
assert.match(prReviewPanel, /onGoToGithub=\{goToGithubPage\}/);
assert.match(prReviewPanel, /onReviewSessionCreated/);
assert.match(prReviewPanel, /activeReviewSession/);
assert.match(prReviewPanel, /PrReviewAnalysisStatus/);
assert.match(prReviewPanel, /AbortController/);
assert.match(prReviewPanel, /replaceReviewSessionRoute/);
assert.match(prReviewPanel, /retryReviewSession/);
assert.match(prReviewPanel, /window\.clearTimeout/);
assert.match(prReviewPanel, /shouldPollPrReviewAnalysis/);
assert.match(prReviewPanel, /role="dialog"/);
assert.match(prReviewPanel, /Skeleton/);
assert.match(prReviewPanel, /isStartingReview/);
assert.doesNotMatch(prReviewPanel, /features\/github-integration/);
assert.match(prReviewAnalysisStatus, /PR_REVIEW_ANALYSIS_POLL_INTERVAL_MS = 2_000/);
assert.match(prReviewAnalysisStatus, /PR_REVIEW_ANALYSIS_DELAY_NOTICE_MS = 5 \* 60 \* 1_000/);
assert.match(prReviewAnalysisStatus, /shouldPollPrReviewAnalysis/);
assert.match(prReviewAnalysisStatus, /isPrReviewAnalysisDelayed/);
assert.match(prReviewAnalysisStatusComponent, /PR 분석 중/);
assert.match(prReviewAnalysisStatusComponent, /분석 시간이 예상보다 길어지고 있습니다/);
assert.match(prReviewAnalysisStatusComponent, /pollingError/);
assert.match(prReviewAnalysisStatusComponent, /getPrReviewAnalysisRetryLabel/);
assert.match(prReviewPanel, /분석 상태를 확인하지 못했습니다/);
assert.match(prReviewCanvasShell, /getReviewSessionSummary/);
assert.match(prReviewCanvasShell, /getReviewSessionCanvas/);
assert.match(prReviewCanvasShell, /getReviewSessionConflicts/);
assert.match(prReviewCanvasShell, /ConflictAnalysisNotice/);
assert.match(prReviewCanvasShell, /ConflictAnalysisFailureState/);
assert.match(prReviewCanvasShell, /Conflict 파일 확인 중/);
assert.match(prReviewCanvasShell, /Conflict 정보가 오래되었습니다/);
assert.match(prReviewCanvasShell, /Conflict 정보 다시 불러오기/);
assert.match(prReviewCanvasShell, /PrReviewCanvasSurface/);
assert.match(prReviewCanvasShell, /setSelectedReviewFileId/);
assert.match(prReviewCanvasShell, /PrReviewFileDiffDrawer/);
assert.match(prReviewFileDiffDrawer, /file\.decisionCarriedOver/);
assert.match(prReviewFileDiffDrawer, /이전 버전에서 유지된 판단입니다/);
assert.match(prReviewCanvasShell, /applyReviewSessionConflictResolutions/);
assert.match(prReviewCanvasShell, /buildPrReviewConflictsApplyInput/);
assert.match(prReviewCanvasShell, /GitHub에 전체 적용/);
assert.match(prReviewCanvasShell, /해결 준비/);
assert.match(prReviewCanvasShell, /pilo-github-oauth-reconnect/);
assert.match(prReviewCanvasShell, /Conflict 해결안 전체 적용/);
assert.match(prReviewCanvasShell, /PrReviewSubmitReviewModal/);
assert.match(prReviewCanvasShell, /setIsSubmitReviewModalOpen/);
assert.match(prReviewCanvasShell, /createNewReviewSession/);
assert.match(prReviewCanvasShell, /onGoToGithub/);
assert.match(prReviewCanvasShell, /onReviewSessionCreated/);
assert.match(prReviewCanvasShell, /onDecisionSaved/);
assert.match(prReviewCanvasShell, /loadCanvasData\(\{ quiet: true \}\)/);
assert.match(prReviewCanvasShell, /updateReviewedCount/);
assert.match(prReviewCanvasShell, /previousReviewStatus/);
assert.match(prReviewCanvasShell, /setSummary/);
assert.match(prReviewCanvasShell, /updatedFile\.riskLevel/);
assert.match(
  prReviewCanvasShell,
  /selectedReviewFileId=\{selectedReviewFileId\}/
);
assert.match(prReviewCanvasShell, /conflictAnalysis=\{conflictAnalysis\}/);
assert.match(prReviewCanvasShell, /conflictFile=\{selectedConflictFile\}/);
assert.match(
  prReviewCanvasShell,
  /unsupportedConflictFile=\{selectedUnsupportedConflictFile\}/
);
assert.match(prReviewCanvasShell, /Review 제출/);
assert.match(prReviewCanvasShell, /Merge/);
assert.match(prReviewCanvasShell, /getMergeDisabledReason/);
assert.match(prReviewCanvasShell, /handleMergeReviewSession/);
assert.match(prReviewCanvasShell, /mergeReviewSession/);
assert.match(
  prReviewCanvasShell,
  /const nextConflictStatus = nextSummary\.conflictStatus/
);
assert.match(
  prReviewCanvasShell,
  /summary\?\.conflictStatus \?\? canvas\?\.conflictStatus/
);
assert.match(prReviewCanvasShell, /CONFLICT_STATUS_POLL_MAX_ATTEMPTS/);
assert.match(prReviewCanvasShell, /window\.setInterval/);
assert.doesNotMatch(prReviewCanvasShell, /Review all files before merge/);
assert.match(prReviewCanvasShell, /expectedHeadSha/);
assert.match(prReviewCanvasShell, /confirm: true/);
assert.match(prReviewCanvasShell, /Merge pull request\?/);
assert.match(prReviewCanvasShell, /Branch protection and required checks/);
assert.doesNotMatch(prReviewCanvasShell, /데모 PR 리뷰 데이터/);
assert.match(prReviewCanvasShell, /DETAIL_PANEL_DEFAULT_WIDTH/);
assert.match(prReviewCanvasShell, /onPointerDown/);
assert.match(prReviewCanvasShell, /canvas\.flows\.length/);
assert.doesNotMatch(prReviewCanvasShell, /features\/canvas/);
assert.match(prReviewCanvasSurface, /TldrawSurface/);
assert.match(prReviewCanvasSurface, /prReviewShapeUtils/);
assert.match(prReviewCanvasSurface, /buildPrReviewCanvasShapes/);
assert.match(prReviewCanvasSurface, /PrReviewConflictAnalysis/);
assert.match(prReviewCanvasSurface, /createConflictMetadataResolver/);
assert.match(prReviewCanvasSurface, /ready \? "ready" : "unresolved"/);
assert.match(prReviewCanvasSurface, /conflictState: "unsupported"/);
assert.match(prReviewCanvasSurface, /preparedConflictFileIds/);
assert.match(prReviewCanvasSurface, /buildPrReviewRoleLanes/);
assert.match(prReviewCanvasSurface, /buildPrReviewFileColumnMap/);
assert.match(prReviewCanvasSurface, /minimumReadableZoom/);
assert.match(prReviewCanvasSurface, /createRoleLaneShape/);
assert.match(prReviewCanvasSurface, /kind: "review_order"/);
assert.match(prReviewCanvasSurface, /kind: "semantic" as const/);
assert.match(prReviewCanvasSurface, /START_NODE_ID/);
assert.match(prReviewCanvasSurface, /END_NODE_ID/);
assert.match(prReviewCanvasSurface, /createMilestoneShape/);
assert.match(prReviewCanvasSurface, /buildFlowConnectors/);
assert.match(prReviewCanvasSurface, /createShapeId/);
assert.match(prReviewCanvasSurface, /canvas\.edges/);
assert.match(prReviewCanvasSurface, /canvas\.flows/);
assert.match(prReviewCanvasSurface, /isPrReviewFileNodeShape/);
assert.match(prReviewCanvasSurface, /selectReviewFileNode/);
assert.match(prReviewCanvasSurface, /selectedReviewFileId/);
assert.match(prReviewCanvasSurface, /PrReviewCanvasPersistenceBridge/);
assert.match(prReviewCanvasSurface, /registerReviewShapePolicy/);
assert.match(prReviewCanvasSurface, /updatePrReviewRelationGeometry/);
assert.match(prReviewCanvasSurface, /buildPrReviewFileShapeUpdateInput/);
assert.match(prReviewCanvasSurface, /riskLevel: fileNodeData\.riskLevel/);
assert.match(prReviewCanvasSurface, /conflictReason: conflictMetadata\.conflictReason/);
assert.doesNotMatch(prReviewCanvasSurface, /features\/canvas/);
assert.doesNotMatch(prReviewCanvasSurface, /PiloCanvasRuntime/);
assert.doesNotMatch(prReviewCanvasSurface, /canvas_freeform_shapes/);
assert.match(prReviewCanvasPersistence, /PR_REVIEW_CANVAS_LOAD_QUERY/);
assert.match(prReviewCanvasPersistence, /buildPrReviewFileShapeUpdateInput/);
assert.match(prReviewCanvasPersistence, /buildPrReviewRelationEdgeGeometry/);
assert.match(prReviewCanvasSurface, /PrReviewFileNodeActivationBridge/);
assert.doesNotMatch(prReviewCanvasSurface, /PrReviewSelectionBridge/);
assert.match(prReviewNodeActivation, /shouldActivatePrReviewFileNode/);
assert.doesNotMatch(prReviewCanvasPersistence, /features\/canvas/);
assert.match(prReviewFileDiffDrawer, /getReviewFileDiff/);
assert.match(prReviewFileDiffDrawer, /updateReviewFileDecision/);
assert.match(prReviewFileDiffDrawer, /Conflict 해결/);
assert.match(prReviewFileDiffDrawer, /AI 해결안 생성/);
assert.match(prReviewFileDiffDrawer, /ConflictSuggestionPreview/);
assert.match(prReviewFileDiffDrawer, /createReviewFileConflictSuggestion/);
assert.doesNotMatch(prReviewFileDiffDrawer, /<AlertDialog/);
assert.doesNotMatch(prReviewFileDiffDrawer, /applyReviewFileConflictResolution/);
assert.match(prReviewFileDiffDrawer, /onConflictDraftChange/);
assert.match(prReviewFileDiffDrawer, /이 파일은 해결 준비됨/);
assert.match(prReviewFileDiffDrawer, /상단에서 전체 적용/);
assert.match(prReviewFileDiffDrawer, /setReloadVersion\(\(version\) => version \+ 1\)/);
assert.match(prReviewFileDiffDrawer, /검증 실패/);
assert.match(prReviewFileDiffDrawer, /decisionDisabledReason/);
assert.match(prReviewFileDiffDrawer, /disabled=\{decisionDisabled\}/);
assert.match(prReviewFileDiffDrawer, /Conflict 해결 전에는 일반 판단을 저장할 수 없습니다/);
assert.match(prReviewFileDiffDrawer, /ConflictResolutionPanel/);
assert.match(prReviewFileDiffDrawer, /ConflictHunkComparison/);
assert.match(prReviewFileDiffDrawer, /ConflictUnifiedCodePane/);
assert.match(prReviewFileDiffDrawer, /ConflictWorkspaceTabs/);
assert.match(prReviewFileDiffDrawer, /ResolvedDraftWorkspace/);
assert.match(prReviewFileDiffDrawer, /AI 해결안/);
assert.match(prReviewFileDiffDrawer, /변경점 보기/);
assert.match(prReviewFileDiffDrawer, /전체 코드 편집/);
assert.match(prReviewFileDiffDrawer, /buildPrReviewResolvedCodeDiff/);
assert.doesNotMatch(
  prReviewFileDiffDrawer,
  /Conflict Resolution|AI RESOLUTION|Resolution progress|Apply resolution/
);
assert.match(prReviewFileDiffDrawer, /PR 브랜치 선택/);
assert.match(prReviewFileDiffDrawer, /대상 브랜치 선택/);
assert.match(prReviewFileDiffDrawer, /둘 다 선택/);
assert.match(prReviewFileDiffDrawer, /대상 브랜치:/);
assert.match(prReviewFileDiffDrawer, /PR 브랜치:/);
assert.match(prReviewFileDiffDrawer, /selectedConflictHunkIndex/);
assert.match(prReviewFileDiffDrawer, /isBaseComparisonOpen/);
assert.match(prReviewFileDiffDrawer, /hunk\.currentStartLine/);
assert.doesNotMatch(prReviewFileDiffDrawer, /ConflictTextBlock/);
assert.match(prReviewFileDiffDrawer, /unsupportedConflictFile/);
assert.match(prReviewFileDiffDrawer, /riskLevelLabels/);
assert.match(prReviewFileDiffDrawer, /getSaveStatusLabel/);
assert.match(prReviewFileDiffDrawer, /enqueueDecisionSave/);
assert.match(prReviewFileDiffDrawer, /setTimeout/);
assert.match(prReviewFileDiffDrawer, /onCommentBlur/);
assert.match(prReviewFileDiffDrawer, /const savedFile: PrReviewFile/);
assert.match(prReviewFileDiffDrawer, /onDecisionSaved\(savedFile, previousStatus\)/);
assert.match(prReviewFileDiffDrawer, /approved/);
assert.match(prReviewFileDiffDrawer, /discussion_needed/);
assert.match(prReviewFileDiffDrawer, /unknown/);
assert.match(prReviewFileDiffDrawer, /리뷰 캔버스로 돌아가기/);
assert.match(prReviewFileDiffDrawer, /FileDiffHeader/);
assert.match(prReviewFileDiffDrawer, /ReviewNodePanel/);
assert.match(prReviewFileDiffDrawer, /FlowMemberships/);
assert.match(prReviewFileDiffDrawer, /textarea/);
assert.match(prReviewFileDiffDrawer, /DiffView/);
assert.match(prReviewFileDiffDrawer, /reloadVersion/);
assert.doesNotMatch(prReviewFileDiffDrawer, /features\/canvas/);
assert.match(prReviewResolvedCodeEditor, /EditorView/);
assert.match(prReviewResolvedCodeEditor, /lineNumbers/);
assert.match(prReviewResolvedCodeEditor, /syntaxHighlighting/);
assert.match(prReviewResolvedCodeEditor, /Decoration\.line/);
assert.match(prReviewResolvedCodeEditor, /cm-resolvedChangedLine/);
assert.match(prReviewResolvedCodeEditor, /scrollIntoView/);
assert.doesNotMatch(prReviewResolvedCodeEditor, /features\/canvas/);
assert.match(prReviewResolvedCodeDiff, /diffLines/);
assert.match(prReviewConflictDrafts, /reconcilePrReviewConflictDrafts/);
assert.match(prReviewConflictDrafts, /buildPrReviewConflictsApplyInput/);
assert.match(prReviewResolvedCodeDiff, /changedLineNumbers/);
assert.match(prReviewResolvedCodeDiff, /changeBlocks/);
assert.match(prReviewConflictResolution, /buildConflictResolutionDraft/);
assert.match(prReviewConflictResolution, /isConflictResolutionComplete/);
assert.match(prReviewConflictResolution, /right\.startIndex - left\.startIndex/);
assert.match(prReviewSubmitReviewModal, /getReviewSessionResult/);
assert.match(prReviewSubmitReviewModal, /submitReviewSession/);
assert.match(prReviewSubmitReviewModal, /useState<PrReviewSubmitType \| null>\(null\)/);
assert.match(prReviewSubmitReviewModal, /COMMENT/);
assert.match(prReviewSubmitReviewModal, /APPROVE/);
assert.match(prReviewSubmitReviewModal, /REQUEST_CHANGES/);
assert.match(prReviewSubmitReviewModal, /textarea/);
assert.match(prReviewSubmitReviewModal, /GitHub OAuth connection is required/);
assert.match(prReviewSubmitReviewModal, /Review session head SHA is stale/);
assert.match(prReviewSubmitReviewModal, /onCreateNewReview/);
assert.match(prReviewSubmitReviewModal, /onGoToGithub/);
assert.match(prReviewSubmitReviewModal, /githubReviewUrl/);
assert.doesNotMatch(prReviewSubmitReviewModal, /Preview/);
assert.doesNotMatch(prReviewSubmitReviewModal, /features\/canvas/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FILE_NODE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /reviewFileId/);
assert.match(prReviewFileNodeShapeUtil, /workflowOrder/);
assert.match(prReviewFileNodeShapeUtil, /reviewStatus/);
assert.match(prReviewFileNodeShapeUtil, /conflictState/);
assert.match(prReviewFileNodeShapeUtil, /conflictBadgeLabels/);
assert.match(prReviewFileNodeShapeUtil, /conflictNodeClasses/);
assert.match(prReviewFileNodeShapeUtil, /riskLevel/);
assert.match(prReviewFileNodeShapeUtil, /riskNodeClasses/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_EDGE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_RELATION_EDGE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /reviewRoomId/);
assert.match(prReviewFileNodeShapeUtil, /roomFileId/);
assert.match(prReviewFileNodeShapeUtil, /currentReviewSessionId/);
assert.match(prReviewFileNodeShapeUtil, /fromRoomFileId/);
assert.match(prReviewFileNodeShapeUtil, /toRoomFileId/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_LABEL_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_ROLE_LANE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PrReviewRoleLaneShapeUtil/);
assert.match(prReviewFileNodeShapeUtil, /추천 리뷰 경로|review_order/);
assert.doesNotMatch(prReviewFileNodeShapeUtil, /features\/canvas/);
assert.match(prReviewShapeUtils, /PrReviewFileNodeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowEdgeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewRelationEdgeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowLabelShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowMilestoneShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewRoleLaneShapeUtil/);

await import("./flow-layout.test.mjs");
await import("./resolved-code-diff.test.mjs");
await import("./multi-file-conflict-draft.test.mjs");
await import("./conflict-hunk-manual.test.mjs");
await import("./multi-file-conflict-client.test.mjs");
await import("./oauth-reconnect-client.test.mjs");
await import("./canvas-shape-client.test.mjs");
await import("./canvas-shape-persistence.test.mjs");
await import("./node-activation.test.mjs");
