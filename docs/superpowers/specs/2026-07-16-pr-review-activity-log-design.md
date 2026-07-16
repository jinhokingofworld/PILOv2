# PR Review Activity Log 기록 설계

## 목적

PR Review에서 회의록에 반영할 가치가 있는 사용자 또는 Agent의 변경 결과를 공통
`activity_logs`에 append-only로 기록한다. Meeting 도메인은 녹음 구간, Workspace, 당시
참여자를 기준으로 필요한 log를 나중에 선별한다.

이 설계는 PR Review의 기록 책임만 다룬다. MeetingReport 조회와 snapshot, Agent tool 연결은
별도 구현 범위다.

## 확정 원칙

- PR Review는 `meetingId`와 `recordingId`를 조회하거나 저장하지 않는다.
- 클라이언트에 회의 context 전달을 요구하지 않는다.
- 공통 `ActivityLogService.append(transaction, input)`만 사용한다.
- 실제 PR Review DB 변경과 activity append를 같은 transaction에서 수행한다.
- 변경이 rollback되면 activity도 남지 않는다.
- activity는 append-only이며 PR Review 코드에서 UPDATE 또는 DELETE하지 않는다.
- 모든 activity에 안정적인 `dedupeKey`를 사용한다.
- `occurredAt`은 App Server와 공통 service가 기록한다.
- 사용자 입력 문자열은 최소화하고 길이를 제한한다.
- comment 원문, review body, resolved content, diff/patch, OAuth/token/provider raw payload는
  metadata에 저장하지 않는다.

## 기록할 다섯 가지 사용자 행동

다섯 가지 행동은 여섯 개의 terminal action 값으로 표현한다. GitHub Review 제출은 성공과
실패의 회의록 의미가 다르므로 두 action으로 나눈다.

1. 새 PR Review revision 시작
2. 파일 판단 변경
3. GitHub Review 제출 성공 또는 실패
4. PR conflict 해결 적용
5. PR merge 완료

조회, polling, GitHub sync, Canvas drag/resize, presence, AI 분석 중간 단계, 상태를 바꾸지 않은
멱등 요청은 기록하지 않는다.

## Actor 규칙

- 사용자가 직접 실행하면 `actor.type = "user"`, `actor.userId = currentUserId`를 사용한다.
- Agent가 사용자를 대신해 같은 도메인 service를 호출하면 `actor.type = "agent"`와 요청한
  사용자의 `userId`를 사용한다.
- 이 설계의 다섯 행동에는 `actor.userId`가 항상 존재해야 한다. 그래야 MeetingReport가 해당
  시각의 실제 참여자 여부를 판별할 수 있다.
- 분석 Worker의 완료·실패처럼 사용자 변경이 아닌 `system` 이벤트는 이번 범위에서 기록하지
  않는다.

## 공통 metadata 규칙

모든 action의 metadata는 다음 공통 원칙을 따른다.

```ts
type PrReviewActivityMetadata<TData> = {
  version: 1;
  summary: string;
  data: TData;
};
```

- `summary`는 1~500자의 한국어 사실 문장이고 실제 반영된 결과를 과거형으로 쓴다.
- actor 이름은 `actor_user_id`로 해석하므로 summary에 중복 저장하지 않는다.
- PR 제목과 comment 원문은 저장하지 않는다.
- 기존 action은 중앙 registry에 정의된 `metadata.data` key만 저장한다. 파일 경로와 PR 번호처럼
  회의록에 필요한 표현은 제한된 summary에 포함하고 임의 key로 중복 저장하지 않는다.
- summary에 넣는 file path preview는 공백을 정규화하고 최대 400자로 잘라 전체 summary가
  500자를 넘지 않게 한다.
- URL은 저장하지 않는다. 기존 resource ID 또는 외부 결과 ID로 원본을 조회한다.
- SHA는 원문 파일 내용이 아닌 결과 식별자이므로 필요한 action에서만 저장한다.

## Action 1: 새 revision 시작

기존 registry action `pr_review_session_created`를 사용한다.

```ts
type PrReviewSessionCreatedData = {
  pullRequestId: string;
};
```

- target: `{ type: "pr_review_session", id: reviewSessionId }`
- dedupeKey:
  `pr-review:pr_review_session_created:<reviewSessionId>:created`
- summary 예시: `PR #142의 새 리뷰 revision을 시작했습니다.`
- 새 session row가 실제 생성된 경우에만 기록한다.
- 기존 session을 재사용해 `200 OK`로 반환하는 멱등 경로는 기록하지 않는다.

## Action 2: 파일 판단 변경

기존 registry action `file_review_decision_created`를 사용한다.

```ts
type FileReviewDecisionCreatedData = {
  reviewSessionId: string;
  decision: "approved" | "discussion_needed" | "unknown";
};
```

- target: `{ type: "file_review_decision", id: decisionId }`
- dedupeKey:
  `pr-review:file_review_decision_created:<decisionId>:created`
- summary 예시: `auth.service.ts 파일을 추가 논의 필요 상태로 변경했습니다.`
- comment 원문과 comment 존재 여부는 metadata에 저장하지 않는다. 상세 확인은 target의
  `decisionId`로 기존 판단 이력을 조회한다.
- 현재 값과 요청 값이 같아 새 decision row가 생성되지 않는 멱등 경로는 기록하지 않는다.
- file 상태, decision history, session 진행률 변경과 activity append를 하나의 transaction으로
  묶는다.

## Action 3: GitHub Review 제출

성공은 기존 registry action `review_submission_submitted`, 실패는
`review_submission_failed`를 사용한다. `review_submission_created`는 중간 상태이므로
기록하지 않는다.

```ts
type ReviewSubmissionTerminalData = {
  reviewSessionId: string;
};
```

- target: `{ type: "review_submission", id: submissionId }`
- 성공 dedupeKey:
  `pr-review:review_submission_submitted:<submissionId>:submitted`
- 실패 dedupeKey:
  `pr-review:review_submission_failed:<submissionId>:failed`
- 성공 summary 예시: `PR #142에 변경 요청 Review를 제출했습니다.`
- 실패 summary 예시: `PR #142의 변경 요청 Review 제출에 실패했습니다.`
- review body, submit type, file review 결과 원문, GitHub ID/URL, provider 오류 원문은
  metadata에 저장하지 않는다. 성공·실패는 action과 summary로 구분한다.
- local submission terminal 상태 변경과 activity append를 같은 transaction으로 묶는다.

## Action 4: Conflict 해결 적용

중앙 registry에 다음 신규 action을 요청한다.

```text
제안 action: pr_review_conflict_resolution_applied
target type: pull_request
기록할 사용자 행동: 사용자가 하나 이상의 PR conflict 해결안을 GitHub head에 적용함
회의록에 필요한 이유: 누가 어떤 PR의 conflict를 해결해 head 상태를 변경했는지 기록하기 위해
dedupeKey 생성 방식: GitHub conflict resolution commit SHA
summary 예시: "PR #142의 conflict 파일 2개를 해결했습니다."
```

```ts
type PrReviewConflictResolutionAppliedData = {
  reviewSessionId: string;
  resolvedFileCount: number;
  headShaAfter: string;
  commitSha: string;
  conflictStatusAfter: "checking" | "clean" | "conflicted" | "unknown";
};
```

- target: `{ type: "pull_request", id: pullRequestId }`
- dedupeKey:
  `pr-review:pr_review_conflict_resolution_applied:<pullRequestId>:<commitSha>`
- resolved content와 file path 목록은 저장하지 않고 해결된 파일 개수만 저장한다.
- 단일 파일과 다중 파일 endpoint는 같은 action과 dedupe 규칙을 사용한다.

## Action 5: PR Merge 완료

중앙 registry에 다음 신규 action을 요청한다.

```text
제안 action: pr_review_pull_request_merged
target type: pull_request
기록할 사용자 행동: 사용자가 PR Review 화면에서 GitHub PR merge를 완료함
회의록에 필요한 이유: PR의 최종 상태와 수행자를 기록하기 위해
dedupeKey 생성 방식: GitHub merge commit SHA
summary 예시: "PR #142를 merge 방식으로 병합했습니다."
```

```ts
type PrReviewPullRequestMergedData = {
  reviewSessionId: string;
  mergeMethod: "merge";
  mergeCommitSha: string;
};
```

- target: `{ type: "pull_request", id: pullRequestId }`
- dedupeKey:
  `pr-review:pr_review_pull_request_merged:<pullRequestId>:<mergeCommitSha>`
- commit URL과 OAuth/provider 응답은 저장하지 않는다.
- GitHub merge 성공 후 local PR cache와 room 완료 상태를 저장하는 transaction에서 activity를
  append한다.

## Transaction과 외부 GitHub 작업

revision 시작과 파일 판단은 전체 변경을 하나의 DB transaction으로 묶을 수 있다.
GitHub Review 제출, conflict 적용, PR merge는 외부 GitHub 변경 후 local 결과를 저장하므로
GitHub 자체를 DB transaction으로 rollback할 수 없다.

이 세 작업에서는 다음 경계를 적용한다.

1. GitHub 호출 전에는 terminal activity를 기록하지 않는다.
2. GitHub 결과를 받은 뒤 local terminal 상태 또는 cache를 저장하는 transaction에서 activity를
   함께 append한다.
3. local 저장이 rollback되면 activity도 남지 않는다.
4. 이미 성공한 외부 결과를 복구·재동기화할 때 동일한 GitHub 결과 식별자를 dedupeKey에 사용해
   activity를 한 번만 append한다.
5. 현재 conflict/merge 코드의 best-effort local update는 이 계약을 만족하도록 transaction과
   복구 경계를 구현 계획에서 별도로 다룬다.

## 중앙 Foundation 선행 조건

공통 foundation은 최신 `dev`의 `apps/app-server/src/common/activity-log.service.ts`,
`docs/ActivityLogRegistry.md`, `db/migrations/070_create_activity_log_foundation_constraints.sql`에
존재한다. 구현 브랜치는 이 foundation이 포함된 최신 `dev`를 기준으로 해야 한다.

PR Review 구현은 다음을 직접 만들지 않는다.

- `activity_logs` INSERT SQL
- activity 공통 module/service
- `dedupe_key`와 append-only DB trigger
- 임의 action migration

Foundation에는 다음 두 신규 action과 data 타입을 요청한다.

- `pr_review_conflict_resolution_applied`
- `pr_review_pull_request_merged`

## 오류 처리

- `ActivityLogService.append`가 실패하면 같은 transaction의 PR Review local 변경도 실패한다.
- unique dedupe 충돌은 동일 작업의 재시도로 처리하며 중복 row를 만들지 않는다.
- metadata 검증 실패는 개발 오류로 처리하고 PR Review 변경을 commit하지 않는다.
- 외부 GitHub 성공 후 local transaction 실패는 기존 GitHub 식별자로 복구할 수 있어야 한다.
- 사용자에게 provider raw 오류를 노출하거나 metadata에 저장하지 않는다.

## 테스트 설계

### 공통 검증

- 각 행동이 실제 상태 변경과 activity row를 함께 commit한다.
- domain transaction이 rollback되면 activity row가 없다.
- 같은 dedupeKey 재시도는 activity row가 하나다.
- summary가 존재하고 500자를 넘지 않는다.
- 금지된 원문과 token/provider payload가 metadata에 없다.

### 행동별 검증

- 새 revision 생성은 기록하고 기존 revision 재사용은 기록하지 않는다.
- 새 file decision과 증가한 decision version을 기록한다.
- 동일 decision 멱등 저장은 기록하지 않는다.
- Review 제출 성공과 실패를 서로 다른 terminal action으로 기록한다.
- conflict 단일/다중 endpoint가 같은 action 계약을 사용한다.
- conflict 재처리는 commit SHA dedupe로 중복되지 않는다.
- merge 성공은 merge commit SHA 기반으로 한 번만 기록한다.
- 조회, polling, sync, Canvas interaction과 AI 분석 중간 상태는 기록하지 않는다.

### Actor 검증

- 직접 실행은 user actor와 current user ID를 기록한다.
- Agent 실행은 agent actor와 요청 사용자 ID를 기록한다.
- 다른 Workspace의 user/resource 조합은 기존 도메인 권한 검증에서 차단된다.

## 완료 기준

- 다섯 가지 사용자 행동이 중앙 registry에 정의된 action만 사용한다.
- 신규 action 두 개가 foundation registry와 metadata 문서에 등록된다.
- 모든 append가 공통 service와 domain transaction을 사용한다.
- Meeting 전용 ID와 context가 PR Review 요청·DB·metadata에 추가되지 않는다.
- actor와 summary가 회의록에 필요한 수행자, 변경 결과와 PR 상태를 설명하고,
  `metadata.data`는 중앙 registry의 exact-key 계약을 지킨다.
- 중복, rollback, 민감 데이터 금지와 외부 GitHub 복구 시나리오를 테스트한다.

## 별도 후속 범위

- MeetingReport의 시간·Workspace·participant 기반 activity snapshot
- activity를 기존 MeetingReport AI 입력과 evidence로 연결하는 작업
- PR Review Agent tool adapter와 Agent planner/runtime 등록
- PR Review 외 도메인의 activity 기록
