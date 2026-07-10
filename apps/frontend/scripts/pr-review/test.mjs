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
const prReviewFileDiffDrawer = await readFile(
  new URL(
    "../../src/features/pr-review/components/review-canvas/PrReviewFileDiffDrawer.tsx",
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
assert.match(prReviewTypes, /export type PrReviewSummary/);
assert.match(prReviewTypes, /export type PrReviewCanvas/);
assert.match(prReviewTypes, /export type PrReviewFileNodeData/);
assert.match(prReviewTypes, /export type PrReviewFileRiskLevel/);
assert.match(prReviewTypes, /export type PrReviewFile =/);
assert.match(prReviewTypes, /export type PrReviewFileDiff =/);
assert.match(prReviewTypes, /export type PrReviewConflictAnalysis =/);
assert.match(prReviewTypes, /export type PrReviewConflictFile =/);
assert.match(prReviewTypes, /export type PrReviewConflictSuggestion =/);
assert.match(prReviewTypes, /export type PrReviewUnsupportedConflictFile =/);
assert.match(prReviewTypes, /export type PrReviewConflictHunk =/);
assert.match(prReviewTypes, /export type UpdatePrReviewFileDecisionInput =/);
assert.match(prReviewTypes, /export type PrReviewSubmitType =/);
assert.match(prReviewTypes, /export type PrReviewSessionResult =/);
assert.match(prReviewTypes, /export type PrReviewSubmission =/);
assert.match(prReviewTypes, /export type SubmitPrReviewSessionInput =/);
assert.match(prReviewNavigation, /href: "\/pr-review"/);
assert.match(prReviewNavigation, /title: "PR/);
assert.doesNotMatch(prReviewNavigation, /\/pr-review#/);
assert.match(prReviewPage, /<PrReviewPanel \/>/);
assert.match(prReviewRoutePage, /import "tldraw\/tldraw\.css"/);
assert.match(prReviewApiClient, /createPrReviewApiClient/);
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
assert.match(prReviewApiClient, /getReviewSessionSummary/);
assert.match(prReviewApiClient, /getReviewSessionCanvas/);
assert.match(prReviewApiClient, /getReviewSessionConflicts/);
assert.match(prReviewApiClient, /createReviewFileConflictSuggestion/);
assert.match(prReviewApiClient, /getReviewSessionResult/);
assert.match(prReviewApiClient, /submitReviewSession/);
assert.match(prReviewApiClient, /getReviewFile/);
assert.match(prReviewApiClient, /getReviewFileDiff/);
assert.match(prReviewApiClient, /updateReviewFileDecision/);
assert.match(prReviewApiClient, /\/result/);
assert.match(prReviewApiClient, /\/conflicts/);
assert.match(prReviewApiClient, /\/conflict-suggestion/);
assert.match(prReviewApiClient, /\/submissions/);
assert.match(prReviewApiClient, /method: "POST"/);
assert.match(prReviewApiClient, /\/review-files/);
assert.match(prReviewApiClient, /method: "PATCH"/);
assert.match(prReviewApiClient, /\/review-sessions/);
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
assert.match(prReviewPanel, /role="dialog"/);
assert.match(prReviewPanel, /Skeleton/);
assert.match(prReviewPanel, /isStartingReview/);
assert.doesNotMatch(prReviewPanel, /features\/github-integration/);
assert.match(prReviewCanvasShell, /getReviewSessionSummary/);
assert.match(prReviewCanvasShell, /getReviewSessionCanvas/);
assert.match(prReviewCanvasShell, /getReviewSessionConflicts/);
assert.match(prReviewCanvasShell, /ConflictAnalysisNotice/);
assert.match(prReviewCanvasShell, /Conflict 파일 확인 중/);
assert.match(prReviewCanvasShell, /Conflict 정보가 오래되었습니다/);
assert.match(prReviewCanvasShell, /PrReviewCanvasSurface/);
assert.match(prReviewCanvasShell, /setSelectedReviewFileId/);
assert.match(prReviewCanvasShell, /PrReviewFileDiffDrawer/);
assert.match(prReviewCanvasShell, /PrReviewSubmitReviewModal/);
assert.match(prReviewCanvasShell, /setIsSubmitReviewModalOpen/);
assert.match(prReviewCanvasShell, /createNewReviewSession/);
assert.match(prReviewCanvasShell, /onGoToGithub/);
assert.match(prReviewCanvasShell, /onReviewSessionCreated/);
assert.match(prReviewCanvasShell, /onDecisionSaved/);
assert.match(prReviewCanvasShell, /loadCanvasData\(\{ quiet: true \}\)/);
assert.match(prReviewCanvasShell, /updateReviewedCount/);
assert.match(prReviewCanvasShell, /findReviewFileStatus/);
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
assert.match(prReviewCanvasShell, /현재 버전에서는 GitHub에서 merge를 진행해주세요\./);
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
assert.match(prReviewCanvasSurface, /conflictState: "unresolved"/);
assert.match(prReviewCanvasSurface, /conflictState: "unsupported"/);
assert.match(prReviewCanvasSurface, /buildReviewLayers/);
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
assert.match(prReviewCanvasSurface, /riskLevel: fileNodeData\.riskLevel/);
assert.match(prReviewCanvasSurface, /conflictReason: conflictMetadata\.conflictReason/);
assert.doesNotMatch(prReviewCanvasSurface, /features\/canvas/);
assert.doesNotMatch(prReviewCanvasSurface, /PiloCanvasRuntime/);
assert.doesNotMatch(prReviewCanvasSurface, /canvas_freeform_shapes/);
assert.match(prReviewFileDiffDrawer, /getReviewFileDiff/);
assert.match(prReviewFileDiffDrawer, /updateReviewFileDecision/);
assert.match(prReviewFileDiffDrawer, /Conflict Resolution/);
assert.match(prReviewFileDiffDrawer, /AI 해결안 생성/);
assert.match(prReviewFileDiffDrawer, /ConflictSuggestionPreview/);
assert.match(prReviewFileDiffDrawer, /createReviewFileConflictSuggestion/);
assert.match(prReviewFileDiffDrawer, /검증 실패/);
assert.match(prReviewFileDiffDrawer, /decisionDisabledReason/);
assert.match(prReviewFileDiffDrawer, /disabled=\{decisionDisabled\}/);
assert.match(prReviewFileDiffDrawer, /Conflict 해결 전에는 일반 판단을 저장할 수 없습니다/);
assert.match(prReviewFileDiffDrawer, /ConflictResolutionPanel/);
assert.match(prReviewFileDiffDrawer, /ConflictTextBlock/);
assert.match(prReviewFileDiffDrawer, /unsupportedConflictFile/);
assert.match(prReviewFileDiffDrawer, /riskLevelLabels/);
assert.match(prReviewFileDiffDrawer, /getSaveStatusLabel/);
assert.match(prReviewFileDiffDrawer, /enqueueDecisionSave/);
assert.match(prReviewFileDiffDrawer, /setTimeout/);
assert.match(prReviewFileDiffDrawer, /onCommentBlur/);
assert.match(prReviewFileDiffDrawer, /const savedFile: PrReviewFile/);
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
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_LABEL_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE/);
assert.doesNotMatch(prReviewFileNodeShapeUtil, /features\/canvas/);
assert.match(prReviewShapeUtils, /PrReviewFileNodeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowEdgeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowLabelShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowMilestoneShapeUtil/);
