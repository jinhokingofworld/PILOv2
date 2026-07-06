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

assert.match(prReviewTypes, /export type PrReviewRepository/);
assert.match(prReviewTypes, /export type PrReviewPullRequest/);
assert.match(prReviewTypes, /export type PrReviewSession/);
assert.match(prReviewNavigation, /href: "\/pr-review"/);
assert.match(prReviewNavigation, /title: "PR 선택"/);
assert.doesNotMatch(prReviewNavigation, /\/pr-review#/);
assert.match(prReviewPage, /<PrReviewPanel \/>/);
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
assert.match(prReviewApiClient, /\/review-sessions/);
assert.doesNotMatch(prReviewApiClient, /features\/github-integration/);
assert.match(prReviewPanel, /useAuthSession/);
assert.match(prReviewPanel, /PR_PAGE_SIZE/);
assert.match(prReviewPanel, /setTimeout/);
assert.match(prReviewPanel, /300/);
assert.match(prReviewPanel, /레포지토리 연결이 안 되었습니다/);
assert.match(prReviewPanel, /router\.push\("\/github"\)/);
assert.match(prReviewPanel, /PR 번호 또는 제목 검색/);
assert.match(prReviewPanel, /리뷰할 PR을 선택하세요/);
assert.match(prReviewPanel, /리뷰 시작/);
assert.match(prReviewPanel, /PrReviewCanvasShell/);
assert.match(prReviewPanel, /activeReviewSession/);
assert.match(prReviewPanel, /role="dialog"/);
assert.match(prReviewPanel, /Skeleton/);
assert.match(prReviewPanel, /isStartingReview/);
assert.doesNotMatch(prReviewPanel, /features\/github-integration/);
assert.match(prReviewCanvasShell, /PR 선택으로 돌아가기/);
assert.match(prReviewCanvasShell, /Review 제출/);
assert.match(prReviewCanvasShell, /Merge/);
assert.match(prReviewCanvasShell, /DETAIL_PANEL_DEFAULT_WIDTH/);
assert.match(prReviewCanvasShell, /onPointerDown/);
assert.match(prReviewCanvasShell, /session\.reviewedCount/);
assert.match(prReviewCanvasShell, /session\.conflictStatus/);
assert.doesNotMatch(prReviewCanvasShell, /features\/canvas/);
