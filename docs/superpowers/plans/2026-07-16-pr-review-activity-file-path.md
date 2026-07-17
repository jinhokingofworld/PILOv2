# PR Review Activity File Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 file decision Activity Log의 summary와 metadata에서 repo-relative 파일 경로를 식별할 수 있게 한다.

**Architecture:** 기존 `file_review_decision_created` builder의 입력 계약을 확장하고, PR Review service가 이미 조회한 review file 경로를 같은 transaction의 append 입력에 전달한다. MeetingReport와 UI는 summary를 그대로 소비하므로 변경하지 않는다.

**Tech Stack:** TypeScript, Node.js assertion scripts, NestJS App Server, PostgreSQL JSON metadata

## Global Constraints

- 기존 action, target type, dedupe key, API request/response를 변경하지 않는다.
- file path는 whitespace를 한 줄로 정규화하고 최대 400자로 제한하며 긴 값은 suffix를 보존한다.
- DB migration을 추가하지 않는다.
- 기존 Activity Log와 MeetingReport를 backfill하지 않는다.

---

### Task 1: Activity Log builder 계약 확장

**Files:**
- Modify: `apps/app-server/scripts/pr-review/activity-log.test.mjs`
- Modify: `apps/app-server/src/modules/pr-review/pr-review-activity-log.ts`

**Interfaces:**
- Consumes: `buildFileReviewDecisionCreatedActivityLog({ currentUserId, workspaceId, decisionId, reviewSessionId, reviewFileId, filePath, decision })`
- Produces: summary의 bounded file path와 `metadata.data.{reviewSessionId,reviewFileId,filePath,decision}`

- [ ] **Step 1: 파일 경로 계약과 긴 경로 제한 실패 테스트를 작성한다**

```js
const filePath = "apps/app-server/src/modules/pr-review/pr-review.service.ts";
const actual = buildFileReviewDecisionCreatedActivityLog({
  currentUserId,
  workspaceId,
  decisionId,
  reviewSessionId,
  reviewFileId,
  filePath,
  decision: "approved"
});
assert.equal(actual.metadata.summary, `${filePath} 파일의 PR Review 판단을 승인 상태로 변경했습니다.`);
assert.deepEqual(actual.metadata.data, {
  reviewSessionId,
  reviewFileId,
  filePath,
  decision: "approved"
});
```

- [ ] **Step 2: focused test를 실행해 기존 generic summary 때문에 실패하는지 확인한다**

Run: `npm.cmd run build`

Run: `node scripts/pr-review/activity-log.test.mjs`

Expected: builder 결과에 `reviewFileId`와 `filePath`가 없고 summary에 path가 없어 assertion FAIL.

- [ ] **Step 3: bounded file path를 만드는 최소 구현을 추가한다**

```ts
const ACTIVITY_FILE_PATH_MAX_LENGTH = 400;

function normalizeActivityFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\s+/g, " ");
  if (normalized.length <= ACTIVITY_FILE_PATH_MAX_LENGTH) return normalized;
  return `…${normalized.slice(-(ACTIVITY_FILE_PATH_MAX_LENGTH - 1))}`;
}
```

Builder는 정규화된 path를 summary와 data 양쪽에 동일하게 사용한다.

- [ ] **Step 4: focused test를 다시 실행해 통과하는지 확인한다**

Run: `npm.cmd run build`

Run: `node scripts/pr-review/activity-log.test.mjs`

Expected: `PR Review Activity Log builder tests passed.`

- [ ] **Step 5: builder 계약을 commit한다**

```powershell
git add apps/app-server/scripts/pr-review/activity-log.test.mjs apps/app-server/src/modules/pr-review/pr-review-activity-log.ts
git commit -m "fix: PR Review 활동에 파일 경로 추가 (#1221)"
```

### Task 2: PR Review service 전달 경계

**Files:**
- Modify: `apps/app-server/scripts/pr-review/decision-progress.test.mjs`
- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`

**Interfaces:**
- Consumes: `targetFile.file_path`, `reviewFileUuid`
- Produces: Task 1의 builder에 전달되는 `filePath`, `reviewFileId`

- [ ] **Step 1: transaction 테스트의 기대 Activity Log에 파일 경로와 review file ID를 추가한다**

```js
data: {
  reviewSessionId,
  reviewFileId,
  filePath: "apps/app-server/src/modules/pr-review/pr-review.service.ts",
  decision: "approved"
}
```

- [ ] **Step 2: focused test를 실행해 service 전달 누락으로 실패하는지 확인한다**

Run: `npm.cmd run build`

Run: `node scripts/pr-review/decision-progress.test.mjs`

Expected: append input에 `filePath`와 `reviewFileId`가 없어 assertion FAIL.

- [ ] **Step 3: service의 builder 호출에 기존 조회 결과를 전달한다**

```ts
filePath: targetFile.file_path,
reviewFileId: reviewFileUuid,
```

- [ ] **Step 4: focused test를 다시 실행해 transaction 경계와 payload가 통과하는지 확인한다**

Run: `npm.cmd run build`

Run: `node scripts/pr-review/decision-progress.test.mjs`

Expected: exit 0.

- [ ] **Step 5: service 전달 변경을 commit한다**

```powershell
git add apps/app-server/scripts/pr-review/decision-progress.test.mjs apps/app-server/src/modules/pr-review/pr-review.service.ts
git commit -m "fix: 파일 판단 활동에 review file 정보를 전달 (#1221)"
```

### Task 3: 중앙 계약 문서와 전체 검증

**Files:**
- Modify: `docs/ActivityLogRegistry.md`
- Modify: `docs/api/pr-review-api.md`

**Interfaces:**
- Consumes: Task 1과 Task 2의 최종 metadata 계약
- Produces: 중앙 registry와 PR Review 내부 Activity Log 규칙의 동일한 설명

- [ ] **Step 1: registry data 타입을 갱신한다**

```md
`{ reviewSessionId: string, reviewFileId: string, filePath: string, decision: string }`
```

- [ ] **Step 2: API 문서에 bounded repo-relative path와 기존 데이터 비소급 조건을 기록한다**

- [ ] **Step 3: 전체 검증을 실행한다**

Run: `npm.cmd run format:check`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Run: `npm.cmd test`

Expected: 모두 exit 0.

- [ ] **Step 4: diff와 금지 데이터 저장 여부를 확인한다**

Run: `git diff --check`

Run: `rg -n "comment|reviewBody|resolvedContent|rawError" apps/app-server/src/modules/pr-review/pr-review-activity-log.ts`

Expected: diff 오류 없음. builder metadata에 금지 원문 필드 없음.

- [ ] **Step 5: 계약 문서를 commit한다**

```powershell
git add docs/ActivityLogRegistry.md docs/api/pr-review-api.md
git commit -m "docs: 파일 판단 활동 경로 계약 반영 (#1221)"
```
