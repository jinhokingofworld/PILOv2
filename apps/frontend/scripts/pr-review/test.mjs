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
  new URL("../../src/app/pr-review/page.tsx", import.meta.url),
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
assert.match(prReviewNavigation, /href: "\/pr-review"/);
assert.match(prReviewNavigation, /title: "PR/);
assert.doesNotMatch(prReviewNavigation, /\/pr-review#/);
assert.match(prReviewPage, /<PrReviewPanel \/>/);
assert.match(prReviewRoutePage, /import "tldraw\/tldraw\.css"/);
assert.match(prReviewApiClient, /createPrReviewApiClient/);
assert.match(prReviewApiClient, /\/api\/v1/);
assert.match(prReviewApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(prReviewApiClient, /Authorization/);
assert.match(prReviewApiClient, /credentials: "same-origin"/);
assert.match(prReviewApiClient, /listRepositories/);
assert.match(prReviewApiClient, /listOpenPullRequests/);
assert.match(prReviewApiClient, /state: "open"/);
assert.match(prReviewApiClient, /getPullRequest/);
assert.match(prReviewApiClient, /listPullRequestFiles/);
assert.match(prReviewApiClient, /createReviewSession/);
assert.match(prReviewApiClient, /getReviewSessionSummary/);
assert.match(prReviewApiClient, /getReviewSessionCanvas/);
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
assert.match(prReviewPanel, /activeReviewSession/);
assert.match(prReviewPanel, /role="dialog"/);
assert.match(prReviewPanel, /Skeleton/);
assert.match(prReviewPanel, /isStartingReview/);
assert.doesNotMatch(prReviewPanel, /features\/github-integration/);
assert.match(prReviewCanvasShell, /getReviewSessionSummary/);
assert.match(prReviewCanvasShell, /getReviewSessionCanvas/);
assert.match(prReviewCanvasShell, /PrReviewCanvasSurface/);
assert.match(prReviewCanvasShell, /setSelectedReviewFileId/);
assert.match(prReviewCanvasShell, /Review 제출/);
assert.match(prReviewCanvasShell, /Merge/);
assert.match(prReviewCanvasShell, /DETAIL_PANEL_DEFAULT_WIDTH/);
assert.match(prReviewCanvasShell, /onPointerDown/);
assert.match(prReviewCanvasShell, /canvas\.flows\.length/);
assert.doesNotMatch(prReviewCanvasShell, /features\/canvas/);
assert.match(prReviewCanvasSurface, /TldrawSurface/);
assert.match(prReviewCanvasSurface, /prReviewShapeUtils/);
assert.match(prReviewCanvasSurface, /buildPrReviewCanvasShapes/);
assert.match(prReviewCanvasSurface, /createShapeId/);
assert.match(prReviewCanvasSurface, /canvas\.edges/);
assert.match(prReviewCanvasSurface, /canvas\.flows/);
assert.match(prReviewCanvasSurface, /isPrReviewFileNodeShape/);
assert.doesNotMatch(prReviewCanvasSurface, /features\/canvas/);
assert.doesNotMatch(prReviewCanvasSurface, /PiloCanvasRuntime/);
assert.doesNotMatch(prReviewCanvasSurface, /canvas_freeform_shapes/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FILE_NODE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /reviewFileId/);
assert.match(prReviewFileNodeShapeUtil, /workflowOrder/);
assert.match(prReviewFileNodeShapeUtil, /reviewStatus/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_EDGE_SHAPE_TYPE/);
assert.match(prReviewFileNodeShapeUtil, /PR_REVIEW_FLOW_LABEL_SHAPE_TYPE/);
assert.doesNotMatch(prReviewFileNodeShapeUtil, /features\/canvas/);
assert.match(prReviewShapeUtils, /PrReviewFileNodeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowEdgeShapeUtil/);
assert.match(prReviewShapeUtils, /PrReviewFlowLabelShapeUtil/);
