# PR Review Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR Review에서 승인된 다섯 가지 사용자 변경 결과를 공통 `activity_logs`에 중복 없이 기록하고, MeetingReport가 시간·Workspace·참여자 기준으로 소비할 수 있게 한다.

**Architecture:** PR Review 전용 pure builder가 중앙 registry의 exact-key metadata와 안정적인 dedupe key를 만든다. `PrReviewService`는 실제 local 상태 변경과 같은 `DatabaseTransaction`에서 공통 `ActivityLogService.append`를 호출한다. GitHub 외부 작업은 원격 성공 후 local terminal 상태·successor revision·room 완료를 저장하는 transaction에 로그를 함께 넣고, commit SHA 기반 dedupe로 동일 결과의 재처리를 멱등화한다.

**Tech Stack:** NestJS 11, TypeScript 6, PostgreSQL/Supabase migration, Node.js `assert` 기반 App Server 테스트

## Global Constraints

- 구현 시작점은 `origin/dev` 최신 commit이어야 한다. 현재 작업 폴더의 사용자 변경을 건드리지 않도록 별도 git worktree를 사용한다.
- `apps/app-server/src/common/activity-log.service.ts`는 App Server 공통 영역이고, 새 enum action migration은 DB schema 변경이다. 실행 전 사용자 확인과 PR의 `🚨` 표시가 필요하다.
- PR Review request/response에는 `meetingId`, `recordingId`, client 발생 시각을 추가하지 않는다.
- `activity_logs`에 직접 SQL을 작성하지 않고 `ActivityLogService.append(transaction, input)`만 호출한다.
- comment, review body, resolved content, diff/patch, file 원문, GitHub URL/원문 오류, OAuth/token/provider payload를 metadata에 넣지 않는다.
- 조회, polling, sync, presence, Canvas drag/resize, AI 분석 중간 상태, no-op 저장은 기록하지 않는다.
- 기존 사용자 변경 파일 `apps/app-server/src/modules/pr-review/POST_MVP_COLLABORATIVE_REVIEW_CANVAS_CHECKLIST.md`와 untracked 산출물은 수정·삭제·stage하지 않는다.

---

## Task 1: 최신 dev 기반 격리 worktree 준비

**Files:**

- Modify: none

- [ ] **Step 1: 현재 상태를 기록한다**

Run:

```powershell
git status --short
git branch --show-current
git log --oneline --decorate -5
```

Expected: 사용자 변경과 현재 문서 commit을 확인한다. 어떤 파일도 stage하지 않는다.

- [ ] **Step 2: worktree skill로 최신 dev 기반 작업 공간을 만든다**

`superpowers:using-git-worktrees`를 사용해 repo 내부 `.worktrees/`가 ignore되는지 먼저 검증하고, 최신 `origin/dev`에서 `feat/1221-pr-review-activity-log-impl` worktree/branch를 만든다. 기존 `feat/1221-pr-review-activity-log`의 설계·계획 문서 commit만 새 branch에 cherry-pick한다.

Run 후 확인:

```powershell
git merge-base --is-ancestor origin/dev HEAD
git status --short
```

Expected: 첫 명령 exit 0, 새 worktree는 설계/계획 문서 외 깨끗한 상태다.

---

## Task 2: 중앙 action registry와 DB enum 확장

**Files:**

- Modify: `apps/app-server/src/common/activity-log.service.ts`
- Modify: `apps/app-server/scripts/common/activity-log.test.mjs`
- Create: `db/migrations/080_add_pr_review_activity_log_actions.sql`
- Modify: `db/README.md`
- Modify: `docs/ActivityLogRegistry.md`

- [ ] **Step 1: 공통 registry 실패 테스트를 먼저 작성한다**

`apps/app-server/scripts/common/activity-log.test.mjs`에 다음 두 action이 `ActivityLogService.append`에서 거절되지 않고 action 값 그대로 INSERT parameter에 전달되는 테스트를 추가한다.

```js
"pr_review_conflict_resolution_applied"
"pr_review_pull_request_merged"
```

또한 새 migration 원문에 두 `ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS`가 존재하는지 검증한다.

- [ ] **Step 2: 테스트가 현재 실패하는지 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/common/activity-log.test.mjs
```

Expected: 미등록 action 또는 누락 migration 때문에 실패한다.

- [ ] **Step 3: runtime action registry를 최소 변경한다**

`ACTIVITY_LOG_ACTIONS`의 PR Review action 구간에 다음을 추가한다.

```ts
"pr_review_conflict_resolution_applied",
"pr_review_pull_request_merged",
```

- [ ] **Step 4: 다음 순번 migration을 추가한다**

최신 `origin/dev`의 migration 최댓값이 `079`이므로 `db/migrations/080_add_pr_review_activity_log_actions.sql`을 다음 내용으로 만든다.

```sql
ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'pr_review_conflict_resolution_applied';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'pr_review_pull_request_merged';
```

새 테이블이나 policy는 만들지 않는다. 기존 `activity_logs` RLS와 append-only trigger를 그대로 사용한다.

- [ ] **Step 5: 중앙 문서의 exact-key 계약을 등록한다**

`docs/ActivityLogRegistry.md` 표에 다음 두 row를 추가한다.

```md
| `pr_review_conflict_resolution_applied` | `pull_request` | `{ reviewSessionId: string, resolvedFileCount: number, headShaAfter: string, commitSha: string, conflictStatusAfter: string }` |
| `pr_review_pull_request_merged` | `pull_request` | `{ reviewSessionId: string, mergeMethod: string, mergeCommitSha: string }` |
```

`db/README.md`에는 migration 079의 목적을 한 줄로 추가한다.

- [ ] **Step 6: focused test를 통과시킨다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/common/activity-log.test.mjs
```

Expected: `Common Activity Log tests passed.`

- [ ] **Step 7: commit한다**

```powershell
git add apps/app-server/src/common/activity-log.service.ts apps/app-server/scripts/common/activity-log.test.mjs db/migrations/080_add_pr_review_activity_log_actions.sql db/README.md docs/ActivityLogRegistry.md
git commit -m "feat: PR Review Activity Log action 등록 (#1221)"
```

---

## Task 3: PR Review 전용 Activity Log builder 구현

**Files:**

- Create: `apps/app-server/src/modules/pr-review/pr-review-activity-log.ts`
- Create: `apps/app-server/scripts/pr-review/activity-log.test.mjs`
- Modify: `apps/app-server/scripts/pr-review/test.mjs`

- [ ] **Step 1: 다섯 행동·여섯 terminal action builder 테스트를 작성한다**

새 테스트는 각 builder의 전체 객체를 `deepEqual`로 검증한다.

```ts
buildPrReviewSessionCreatedActivityLog
buildFileReviewDecisionCreatedActivityLog
buildReviewSubmissionTerminalActivityLog // submitted | failed
buildPrReviewConflictResolutionAppliedActivityLog
buildPrReviewPullRequestMergedActivityLog
```

검증 항목:

- actor는 `{ type: "user", userId: currentUserId }`
- metadata는 registry에 적힌 key만 포함
- summary는 한국어 과거형이고 500자 이하
- dedupe key는 session/decision/submission ID 또는 GitHub commit SHA 기반
- comment, reviewBody, resolvedContent, URL, raw error를 builder input과 output에 두지 않음

`apps/app-server/scripts/pr-review/test.mjs` 마지막에 `await import("./activity-log.test.mjs")`를 추가해 전체 App Server test에 포함한다.

- [ ] **Step 2: 테스트가 module 누락으로 실패하는지 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/activity-log.test.mjs
```

Expected: `pr-review-activity-log.js`를 찾지 못해 실패한다.

- [ ] **Step 3: pure builder를 구현한다**

각 builder는 `ActivityLogInput`을 반환하고 다음 target/dedupe 규칙을 고정한다.

```ts
session created:
  target = { type: "pr_review_session", id: reviewSessionId }
  dedupe = `pr-review:pr_review_session_created:${reviewSessionId}:created`

file decision:
  target = { type: "file_review_decision", id: decisionId }
  dedupe = `pr-review:file_review_decision_created:${decisionId}:created`

submission submitted/failed:
  target = { type: "review_submission", id: submissionId }
  dedupe = `pr-review:${action}:${submissionId}:${terminal}`

conflict applied:
  target = { type: "pull_request", id: pullRequestId }
  dedupe = `pr-review:pr_review_conflict_resolution_applied:${pullRequestId}:${commitSha}`

PR merged:
  target = { type: "pull_request", id: pullRequestId }
  dedupe = `pr-review:pr_review_pull_request_merged:${pullRequestId}:${mergeCommitSha}`
```

Summary 예시는 제목이나 본문을 저장하지 않는 고정형으로 한다.

```ts
"새 PR Review revision을 시작했습니다."
"PR Review 파일 판단을 승인 상태로 변경했습니다."
"GitHub Review 제출을 완료했습니다."
"GitHub Review 제출에 실패했습니다."
"PR conflict 파일 2개를 해결했습니다."
"PR을 merge 방식으로 병합했습니다."
```

- [ ] **Step 4: builder test를 통과시킨다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/activity-log.test.mjs
```

Expected: `PR Review Activity Log builder tests passed.`

- [ ] **Step 5: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review-activity-log.ts apps/app-server/scripts/pr-review/activity-log.test.mjs apps/app-server/scripts/pr-review/test.mjs
git commit -m "feat: PR Review Activity Log builder 추가 (#1221)"
```

---

## Task 4: revision 생성 로그를 생성 transaction에 연결

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/review-session-reuse.test.mjs`
- Modify: `apps/app-server/scripts/pr-review/async-analysis-enqueue.test.mjs`

- [ ] **Step 1: 생성·재사용·rollback 테스트를 먼저 추가한다**

테스트 fake에 `ActivityLogService`를 추가하고 다음을 검증한다.

- 새 session과 analysis job을 INSERT한 동일 fake transaction으로 `append` 1회
- 기존 analyzing/reusable session 반환 시 append 0회
- append가 throw하면 session/job transaction도 reject
- conflict apply가 만든 successor revision도 별도 `pr_review_session_created` log를 남김

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/review-session-reuse.test.mjs
node apps/app-server/scripts/pr-review/async-analysis-enqueue.test.mjs
```

Expected: append 호출이 없어 assertion 실패.

- [ ] **Step 3: service dependency를 명시적으로 주입한다**

`PrReviewService`에 `ActivityLogService`를 required dependency로 추가한다. 기존 optional realtime publisher보다 앞에 두고, service를 직접 생성하는 PR Review 테스트 helper에 fake를 같은 위치로 전달한다. production에서 optional chaining/no-op fallback은 사용하지 않는다.

- [ ] **Step 4: 두 revision 생성 transaction에 append한다**

다음 두 session INSERT 직후, job INSERT까지 성공한 같은 transaction에서 builder 결과를 append한다.

- `createReviewSession`
- `createSuccessorReviewRevisionAfterConflictApply`

재사용·unique 경쟁 loser 경로는 새 session row를 만들지 않으므로 append하지 않는다.

- [ ] **Step 5: focused tests를 통과시킨다**

Run: Step 2와 동일.

Expected: 두 스크립트 모두 pass.

- [ ] **Step 6: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/review-session-reuse.test.mjs apps/app-server/scripts/pr-review/async-analysis-enqueue.test.mjs
git commit -m "feat: PR Review revision 생성 활동 기록 (#1221)"
```

---

## Task 5: 파일 판단 변경 로그를 decision transaction에 연결

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/decision-progress.test.mjs`
- Modify: `apps/app-server/scripts/pr-review/decision-concurrency.test.mjs`

- [ ] **Step 1: changed/no-op/concurrency 테스트를 작성한다**

검증 항목:

- 실제 status/comment 변경 시 `file_review_decisions` INSERT와 같은 transaction으로 append 1회
- target id는 새 decision row id
- data는 `{ reviewSessionId, decision }`만 포함
- 동일 status/comment no-op은 decision row와 log 모두 0개
- optimistic concurrency 409 경로는 log 0개
- append 실패는 file state/history/progress transaction을 reject

- [ ] **Step 2: 현재 실패를 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/decision-progress.test.mjs
node apps/app-server/scripts/pr-review/decision-concurrency.test.mjs
```

Expected: decision ID 반환/append 호출 assertion 실패.

- [ ] **Step 3: decision INSERT가 id를 반환하도록 최소 변경한다**

`insertReviewFileDecision` 반환형을 `Promise<string>`으로 바꾸고 `RETURNING id`의 값을 반환한다. `updateReviewFileDecision`의 `file.changed` 분기에서 이 id로 builder를 만든 뒤 `syncReviewSessionReviewProgress`와 같은 transaction에 append한다.

- [ ] **Step 4: focused tests를 통과시킨다**

Run: Step 2와 동일.

- [ ] **Step 5: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/decision-progress.test.mjs apps/app-server/scripts/pr-review/decision-concurrency.test.mjs
git commit -m "feat: PR Review 파일 판단 활동 기록 (#1221)"
```

---

## Task 6: GitHub Review 제출 terminal 로그 연결

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/submission.test.mjs`

- [ ] **Step 1: 성공·실패·guard 테스트를 먼저 작성한다**

검증 항목:

- 성공: `review_submissions= submitted`, session `submitted`, activity append가 한 transaction
- 실패: `review_submissions = failed`와 `review_submission_failed` append가 한 transaction
- OAuth/stale/validation guard는 submission row와 log를 만들지 않음
- `review_submission_created`는 기록하지 않음
- metadata에 review body, submit type, GitHub ID/URL, error message가 없음
- append 실패 시 terminal local update가 rollback됨

- [ ] **Step 2: 현재 실패를 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/submission.test.mjs
```

Expected: 실패 update가 transaction 밖에 있고 append가 없어 assertion 실패.

- [ ] **Step 3: failure helper를 transaction 기반으로 바꾼다**

`updateReviewSubmissionFailure(transaction, submissionId, errorMessage)`로 변경하고, GitHub submit catch에서 `database.transaction`을 열어 failure update와 `review_submission_failed` append를 함께 수행한다. 원래 `ApiError` 재throw/safe error mapping은 유지한다.

- [ ] **Step 4: success transaction에 append한다**

기존 success transaction에서 `updateReviewSubmissionSuccess`, `markReviewSessionSubmitted` 다음에 `review_submission_submitted` append를 호출한다.

- [ ] **Step 5: focused test를 통과시킨다**

Run: Step 2와 동일.

- [ ] **Step 6: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/submission.test.mjs
git commit -m "feat: GitHub Review 제출 결과 활동 기록 (#1221)"
```

---

## Task 7: conflict 적용 로그를 successor 처리 경계에 연결

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/conflict-apply.test.mjs`

- [ ] **Step 1: 단일·다중·실패·dedupe 테스트를 작성한다**

검증 항목:

- GitHub apply 성공 전에는 log 없음
- session endpoint와 file endpoint 모두 동일 action/target/dedupe 계약 사용
- `resolvedFileCount`는 각각 N과 1
- `commitSha`, `headShaAfter`, refresh된 `conflictStatusAfter`만 저장
- resolved content/file path/provider raw payload는 metadata에 없음
- 동일 commit SHA 재처리 시 같은 dedupe key
- successor revision 생성 transaction에는 revision log가 포함됨

- [ ] **Step 2: 현재 실패를 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/conflict-apply.test.mjs
```

Expected: conflict activity append가 없어 assertion 실패.

- [ ] **Step 3: 외부 성공 뒤 local persistence transaction을 명시한다**

`createSuccessorReviewRevisionAfterConflictApply`가 다음 결과를 반환하도록 좁게 refactor한다.

```ts
type SuccessorRevisionResult = {
  created: boolean;
  jobId: string | null;
};
```

새 successor를 만드는 경우 session/job/revision-created log와 conflict-applied log를 한 transaction으로 commit한다. 이미 successor가 있어 새 local row를 만들지 않는 경우에만 conflict-applied log를 짧은 `database.transaction`에서 append한다. successor 생성이 `sync_required`가 되어도 GitHub commit 자체는 완료됐으므로 stable commit SHA log를 append한다. append 실패는 숨기지 말고 throw하여 “성공했지만 기록되지 않은 정상 응답”을 만들지 않는다.

분산 transaction의 한계는 유지된다. GitHub 원격 commit은 DB rollback 대상이 아니며, 동일 commit 결과를 회수하는 재처리 경로는 동일 dedupe key로 안전하게 append해야 한다.

- [ ] **Step 4: focused test를 통과시킨다**

Run: Step 2와 동일.

- [ ] **Step 5: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/conflict-apply.test.mjs
git commit -m "feat: PR conflict 해결 활동 기록 (#1221)"
```

---

## Task 8: PR merge 로그를 room 완료 transaction에 연결

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/conflict-status-refresh.test.mjs`

- [ ] **Step 1: merge 성공·실패·rollback 테스트를 작성한다**

검증 항목:

- GitHub merge 성공 후 room `completed/merged` update와 activity append가 같은 transaction
- action target은 pull request, data는 `{ reviewSessionId, mergeMethod, mergeCommitSha }`
- dedupe는 merge commit SHA 기반
- GitHub merge guard/provider failure에는 log 없음
- append 실패 시 room 완료 update가 rollback되고 오류를 숨기지 않음

- [ ] **Step 2: 현재 실패를 확인한다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/conflict-status-refresh.test.mjs
```

Expected: room update가 transaction 밖이고 append가 없어 assertion 실패.

- [ ] **Step 3: best-effort room update를 required transaction으로 바꾼다**

`mergeReviewSession`의 GitHub 성공 뒤 `database.transaction`에서 다음을 순서대로 수행한다.

1. `pr_review_rooms`를 `completed/merged`로 update하고 row 존재 확인
2. `pr_review_pull_request_merged` activity append

현재 `try/catch`로 local failure를 경고만 하고 성공 응답하는 동작은 제거한다. 외부 merge가 이미 완료된 뒤 local transaction이 실패할 수 있다는 경계를 API 문서에 명시하고, merge commit SHA dedupe를 복구 키로 사용한다.

- [ ] **Step 4: focused test를 통과시킨다**

Run: Step 2와 동일.

- [ ] **Step 5: commit한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/conflict-status-refresh.test.mjs
git commit -m "feat: PR merge 완료 활동 기록 (#1221)"
```

---

## Task 9: PR Review API 문서와 계약 검증 보강

**Files:**

- Modify: `docs/api/pr-review-api.md`
- Modify: `apps/app-server/scripts/pr-review/test.mjs`

- [ ] **Step 1: 문서 assertion을 먼저 추가한다**

`pr-review/test.mjs`가 API 문서와 service에서 다음을 확인하도록 한다.

- `meetingId`, `recordingId`를 요청하거나 metadata에 저장하지 않음
- 다섯 행동과 여섯 action 이름
- `ActivityLogService.append`
- direct `INSERT INTO activity_logs` 없음

- [ ] **Step 2: API 문서에 server-side Activity Log 규칙을 추가한다**

`docs/api/pr-review-api.md`의 데이터 규칙 뒤에 다음 내용을 추가한다.

- 외부 request/response shape 변경 없음
- 새 revision만 기록하고 합류/재사용은 기록하지 않음
- 실제 file decision 변경만 기록
- submission 성공/실패 terminal 결과만 기록
- conflict apply와 merge 성공 결과 기록
- Meeting 식별자는 PR Review가 소유하지 않음
- 민감/원문 payload 금지 및 stable dedupe 기준

- [ ] **Step 3: focused domain suite를 통과시킨다**

Run:

```powershell
npm --prefix apps/app-server run build
node apps/app-server/scripts/pr-review/test.mjs
```

Expected: PR Review static contract와 imported activity test 모두 pass.

- [ ] **Step 4: commit한다**

```powershell
git add docs/api/pr-review-api.md apps/app-server/scripts/pr-review/test.mjs
git commit -m "docs: PR Review Activity Log 계약 반영 (#1221)"
```

---

## Task 10: 전체 검증과 self-review

**Files:**

- Modify: only files needed to fix discovered failures

- [ ] **Step 1: format, type, build, 전체 App Server test를 실행한다**

Run:

```powershell
npm --prefix apps/app-server run format:check
npm --prefix apps/app-server run lint
npm --prefix apps/app-server run build
npm --prefix apps/app-server test
```

Expected: 모두 exit 0.

- [ ] **Step 2: migration을 실제 PostgreSQL/Supabase에서 검증한다**

실행 가능한 local DB가 있으면 CLI 명령을 `--help`로 먼저 확인한 뒤 migration을 clean schema에 적용한다. local Supabase 환경이 없다면 repo의 기존 DB 검증 절차로 SQL parse/apply를 수행하고, 불가능한 경우 PR 테스트 항목에 정확한 미수행 사유를 남긴다.

최소 확인 query:

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'activity_log_action'
  AND enumlabel IN (
    'pr_review_conflict_resolution_applied',
    'pr_review_pull_request_merged'
  )
ORDER BY enumlabel;
```

Expected: 2 rows.

- [ ] **Step 3: 금지 데이터와 직접 SQL을 검색한다**

Run:

```powershell
rg -n "INSERT INTO activity_logs|meetingId|recordingId|reviewBody|resolvedContent|accessToken|provider" apps/app-server/src/modules/pr-review/pr-review-activity-log.ts apps/app-server/src/modules/pr-review/pr-review.service.ts
```

Expected: builder에 direct insert/Meeting ID/민감 metadata 없음. service의 기존 정상 입력 처리 외 새 metadata 유출 없음.

- [ ] **Step 4: 변경 범위와 commit을 self-review한다**

Run:

```powershell
git status --short
git diff --check origin/dev...HEAD
git diff --stat origin/dev...HEAD
git log --oneline origin/dev..HEAD
```

Expected: Issue #1221 범위 파일만 포함되고 whitespace error 없음. 사용자 소유 파일/산출물 없음.

- [ ] **Step 5: 완료 직전 verification skill을 적용한다**

`superpowers:verification-before-completion`으로 위 명령의 최신 출력을 다시 확인한다. 테스트를 실행하지 않았거나 실패한 상태에서 완료라고 보고하지 않는다.

- [ ] **Step 6: 필요한 경우 마지막 수정 commit을 만든다**

검증 중 실제 수정이 있었다면 관련 task commit에 amend하지 않는다. `git status --short`로 확인한 검증 관련 파일 경로만 명시적으로 stage한 뒤 `git commit -m "fix: PR Review Activity Log 검증 오류 수정 (#1221)"`로 별도 commit을 만든다.

---

## Task 11: 리뷰 준비

**Files:**

- Modify: none unless review findings require fixes

- [ ] **Step 1: code review skill을 실행한다**

`superpowers:requesting-code-review`로 다음을 중점 검토한다.

- 모든 local 변경과 append의 transaction 동일성
- no-op/guard/rollback 경로
- stable dedupe와 exact-key metadata
- GitHub 외부 성공 뒤 local failure 경계
- common area와 DB migration 영향

- [ ] **Step 2: branch 마무리 선택지를 제시한다**

모든 검증과 review 수정이 끝난 뒤 `superpowers:finishing-a-development-branch`를 사용한다. PR 생성 시 제목은 migration/common 변경 때문에 다음처럼 `🚨`를 붙인다.

```text
🚨 feat(pr-review,activity-log,app-server-common,db): PR Review 활동 기록 연동
```

PR 본문에는 `Closes #1221`, DB enum migration, App Server 공통 registry 변경, 테스트 결과, GitHub 외부 작업의 transaction 경계를 명시한다.
