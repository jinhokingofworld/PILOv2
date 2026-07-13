# PR Review Post-MVP 공유 Review Canvas 구현 체크리스트

이 문서는 Issue `#872`에서 확정한 공유 PR Review 공간을 구현하기 위한 설계와 PR 분할
기준이다. 아직 구현되지 않은 API 계약은 `docs/api/*.md`에 미리 반영하지 않는다. 각 구현
PR에서 endpoint, request, response, status code가 바뀔 때 해당 API 문서를 함께 수정한다.

## 목표

하나의 PR을 Workspace 구성원이 같은 공간에서 함께 리뷰하고, PR에 새 커밋이 추가되어도
기존 Canvas의 배치와 협업 맥락을 유지한다.

```text
GitHub Pull Request 1개
  -> 공유 Review Room 1개
      -> Review Canvas 1개
      -> head SHA별 Review Revision 여러 개
```

사용자 화면에서는 `Review Room`을 `리뷰 공간`, `Review Revision`을 `리뷰 버전`으로
표시한다.

## 확정 정책

- 같은 Workspace의 같은 PR에는 공유 리뷰 공간을 하나만 허용한다.
- PR head SHA가 바뀌어도 새 Canvas를 만들지 않는다.
- 새 head SHA는 같은 리뷰 공간 안의 새 리뷰 버전으로 분석한다.
- 새 버전 분석이 끝나기 전에는 마지막으로 성공한 버전을 계속 보여준다.
- 변경되지 않은 파일은 기존 판단을 이어받고, 변경된 파일은 `재검토 필요` 상태가 된다.
- 모든 Workspace 구성원은 입장, 파일 판단 저장, Canvas 편집과 리뷰 공간 삭제가 가능하다.
- 파일 판단 동시 저장은 optimistic concurrency를 사용한다. 먼저 반영된 변경을 보존하고
  늦은 요청에는 최신 값을 다시 확인하도록 안내한다.
- PR Review file node는 범용 `file_node`가 아닌 `pr_review_file_node` custom shape를
  사용한다.
- PR Review 의미 관계는 `pr_review_relation_edge` custom shape를 사용한다.
- 시스템 node/edge의 도메인 참조와 edge endpoint는 사용자가 변경하거나 삭제할 수 없다.
- 사용자는 node 위치·크기·그룹과 annotation, note, 사용자 arrow를 편집할 수 있다.
- PR이 merge 또는 close되면 리뷰 공간은 완료 상태와 read-only로 전환한다.
- 리뷰 공간 삭제는 soft delete 없이 즉시 영구 삭제한다.

## Source of Truth

| 데이터 | 소유 도메인 |
| --- | --- |
| 리뷰 공간, 버전, 분석 결과, Flow, 관계, file decision, Conflict | PR Review |
| node 위치·크기·그룹, annotation, 사용자 edge, viewport | Canvas |
| 접속자, cursor, shape operation 전달과 catch-up | Realtime |
| PR state, head SHA, 변경 파일 원본 | GitHub Integration |

Canvas shape에는 화면 구성에 필요한 PR Review 참조만 저장한다. 판단, 위험도, Flow,
relation의 원본을 Canvas가 소유하거나 임의로 변경하지 않는다.

## 권장 데이터 모델

### `pr_review_rooms`

PR당 하나인 장기 협업 공간이다.

- `id`
- `workspace_id`
- `pull_request_id`
- `canvas_id`
- `current_session_id`: 마지막으로 분석에 성공해 현재 표시하는 리뷰 버전
- `status`: `active`, `completed`
- `completion_reason`: `merged`, `closed`, `null`
- `created_by_user_id`
- `completed_at`
- `created_at`, `updated_at`

필수 제약:

- `UNIQUE (workspace_id, pull_request_id)`
- `UNIQUE (canvas_id)`
- `canvas.board_type = 'review'`
- `current_session_id`는 같은 room에 속한 session만 참조

### `pr_review_sessions`

기존 session row는 제거하지 않고 head SHA별 리뷰 버전으로 사용한다.

- `room_id`를 추가한다.
- 기존 `head_sha`, 분석 상태, 요약, count와 Conflict snapshot을 유지한다.
- revision의 `head_sha`는 생성 후 변경하지 않는 immutable snapshot으로 취급한다.
- 같은 `room_id`, `head_sha`에서 `failed`가 아닌 session은 하나만 허용하는 partial unique
  제약으로 중복 분석을 막는다.
- 같은 room에서 `analyzing`인 session은 최대 하나만 허용한다.
- 기존 사용자별 analyzing unique 제약은 room 단위 제약으로 교체한다.
- 분석 실패 재시도는 기존 정책대로 새 session/job을 만들 수 있다. 같은 head의 failed
  session은 재시도 이력으로 남기되 사용자 버전 목록에서는 하나의 head 버전으로 묶는다.
- 기존 분석 Job, Worker handoff, Flow, file, relation FK는 session 기준을 유지한다.

### `pr_review_room_files`

버전이 달라져도 같은 파일 node의 Canvas identity를 유지하기 위한 PR Review 소유
identity다.

- `id`
- `room_id`
- `current_file_path`
- `created_at`, `updated_at`

`review_files`에는 `room_file_id`와 비교 가능한 `head_blob_sha`를 추가한다. 파일 path가
같거나 GitHub rename metadata로 이어진 파일은 같은 room file을 사용한다.

- blob SHA가 이전 버전과 같으면 기존 판단을 새 `review_file`에 carry-over한다.
- carry-over 판단은 `carried_from_decision_id` 같은 provenance를 남기고 UI에 `이전 버전에서
  유지`로 표시한다. 새 버전에서 사용자가 직접 판단한 것처럼 기록하지 않는다.
- blob SHA가 달라지면 `not_reviewed`로 시작하고 UI에 `재검토 필요`를 표시한다.
- 새 파일은 새 room file과 node를 만든다.
- 현재 PR에서 빠진 파일은 과거 버전 데이터만 유지하고 현재 graph에서는 숨긴다.

## 리뷰 공간과 버전 흐름

### 최초 리뷰 시작

```text
리뷰 시작
  -> PR 최신 head SHA 조회
  -> review room + board_type=review canvas 생성
  -> 첫 analyzing session + analysis job 생성
  -> 분석 성공
  -> graph 저장 및 Canvas shape materialize
  -> room.current_session_id 교체
```

room, Canvas, session과 analysis job 생성은 하나의 서비스 transaction 경계에서 처리한다.
SQS 발행은 기존 durable outbox 규칙을 유지한다.

### 이미 진행 중인 PR에서 리뷰 시작

- 서버가 기존 room을 반환하고 새 room이나 Canvas를 만들지 않는다.
- 두 사용자가 동시에 누르면 DB unique constraint로 한 room만 생성한다.
- 생성 경쟁에서 진 요청은 unique conflict를 사용자 오류로 노출하지 않고 기존 room을 다시
  조회해 `200 OK`로 반환한다.
- 분석 중에도 room에 입장할 수 있으며 Canvas에는 분석 상태를 표시한다.

### 새 커밋 반영

```text
현재 room head와 GitHub head 비교
  -> 같음: 현재 버전 유지
  -> 다름: "새 커밋 있음" 표시
      -> 사용자가 최신 버전 분석 시작
      -> 같은 room에 analyzing session 생성
      -> 기존 성공 버전은 계속 표시
      -> 성공 시 current_session_id 원자 교체
      -> 실패 시 기존 버전 유지 + 재시도 제공
```

새 커밋을 감지했다고 즉시 사용자의 Canvas를 바꾸지 않는다. 분석 완료와 shape
materialization이 모두 성공한 뒤에만 현재 버전을 바꾼다.

### Conflict 해결 commit 반영

PILO가 Conflict 해결안을 GitHub에 적용하면 새로운 merge commit SHA가 생긴다. 이 경우에도
기존 session의 `head_sha`를 갱신하지 않는다.

- Conflict apply 성공 이력은 기존 revision에 `headShaBefore`, `headShaAfter`로 남긴다.
- 같은 room에 `headShaAfter`를 사용하는 successor session/job을 자동 생성한다.
- successor 분석과 materialization이 끝나기 전에는 기존 current revision을 유지한다.
- 성공 후 같은 Canvas에서 새 revision으로 전환한다.
- apply 성공 뒤 successor 생성이 실패하면 GitHub commit을 되돌리지 않고 room에 `최신 버전
  분석 필요` 상태와 재시도 action을 제공한다.

### 이전 버전 조회

- 이전 session의 분석 결과, Flow, relation, file decision과 제출 이력을 read-only로 조회한다.
- 편집 가능한 Canvas는 현재 버전 하나만 사용한다.
- 이전 버전 graph를 볼 때 room file의 저장된 위치를 재사용하되 현재 annotation을 과거
  시점으로 되감는 기능은 1차 범위에서 제외한다.

## Canvas Shape 정책

### 시스템 shape

- `pr_review_file_node`
  - 안정적인 ID: `shape:pr-review-file:{roomFileId}`
  - 참조: `roomId`, `currentSessionId`, `roomFileId`, `reviewFileId`
  - 사용자가 바꿀 수 있는 값: `x`, `y`, 크기, `parentId`/group
  - PR Review만 바꿀 수 있는 값: file path, 판단 상태, 위험도, Flow와 현재 버전 참조
- `pr_review_relation_edge`
  - 안정적인 ID는 room file pair와 relation type을 사용한다.
  - endpoint와 relation metadata는 PR Review만 변경한다.
  - 연결된 node 이동을 따라 edge geometry를 다시 계산한다.

### 사용자 shape

- draw, highlight, sticky note, text
- 사용자 arrow와 line
- group/frame

사용자 shape는 Canvas가 소유하며 현재 리뷰 공간의 모든 구성원에게 동기화한다.

### Materialization

- 분석 결과 저장과 Canvas materialization은 재시도 가능한 idempotent 단계로 둔다.
- 기존 node를 갱신할 때 사용자가 저장한 위치·크기·group을 덮어쓰지 않는다.
- 새 node만 deterministic layout의 초기 위치를 받는다.
- 없어지거나 다시 생긴 파일의 room file identity와 마지막 위치를 보존한다.
- materialization이 실패하면 `current_session_id`를 교체하지 않는다.

## 파일 판단 동시 저장

- file decision read model에 `decisionVersion`을 노출한다.
- 저장 요청은 `expectedDecisionVersion`을 포함한다.
- 서버는 compare-and-swap으로 현재 version이 일치할 때만 저장한다.
- 다른 사용자가 먼저 저장했다면 `409 REVIEW_DECISION_CHANGED`와 최신 판단을 반환한다.
- UI는 `다른 사용자가 먼저 판단을 변경했습니다`를 표시하고 최신 값을 반영한다.
- 저장 성공 후 진행률과 node badge 변경을 room realtime event로 전달한다.
- last-write-wins로 다른 사용자의 판단을 조용히 덮어쓰지 않는다.

## PR 완료와 삭제

### Merge 또는 Close

- GitHub Integration의 최신 PR state를 확인해 room을 `completed`로 전환한다.
- merge면 `completion_reason=merged`, merge 없이 close면 `closed`를 기록한다.
- 열려 있던 room은 read-only로 바뀌고 사용자에게 완료 이유를 알린다.
- 완료된 room은 Sidebar의 `리뷰 공간`에서 계속 조회한다.
- PR이 reopen되면 같은 room을 `active`로 되돌리고, head가 달라졌다면 새 버전 분석을
  시작할 수 있다.

### 영구 삭제

- 모든 현재 Workspace 구성원이 삭제할 수 있다.
- 확인 모달은 세션, 모든 버전, 판단, 제출 이력, Canvas node와 annotation이 복구 불가능하게
  삭제됨을 명시한다.
- DELETE는 room과 모든 session 하위 데이터, 연결된 review Canvas와 shape/operation/user
  state를 한 transaction에서 영구 삭제한다.
- commit 후 Realtime room을 종료하고 접속자에게 삭제 event를 전달한다.
- 일부 데이터만 삭제된 상태가 남지 않도록 FK cascade와 명시적 Canvas 삭제 순서를 검증한다.

## Sidebar와 PR 상세 UX

Sidebar의 PR Review 메뉴는 다음 두 항목을 제공한다.

1. `리뷰할 PR`
   - open PR 목록
   - room이 없으면 `리뷰 시작`
   - room이 있으면 `리뷰 공간 입장`
   - 새 head가 있으면 `새 커밋` badge 표시
2. `리뷰 공간`
   - Workspace의 active/completed room 목록
   - 분석 중, 리뷰 중, 제출됨, merge/close 완료 상태 표시
   - 현재 room 재입장, 이전 버전 조회, 영구 삭제 진입점 제공

## 제안 API

구현 시 `docs/api/pr-review-api.md`와 필요하면 `docs/api/canvas-api.md`를 함께 수정한다.

| Method | Endpoint | 목적 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room` | PR의 공유 room과 head 상태 조회 |
| `POST` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room` | room 생성 또는 기존 room 합류 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms` | Sidebar 리뷰 공간 목록 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}` | room과 현재/분석 중 버전 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}/revisions` | 버전 이력 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}/revisions` | 최신 head 분석 시작 또는 기존 버전 반환 |
| `DELETE` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}` | 공유 room 영구 삭제 |

기존 `review-sessions/{reviewSessionId}` 하위 API는 리뷰 버전의 분석, file, diff, Conflict,
submission 기능을 담당하도록 유지한다. 호환 endpoint의 변경과 폐기는 별도 migration 계획을
세운다.

같은 head의 failed session 재시도는 기존처럼 새 session/job을 생성한다. room API는 실패한
attempt들을 별도 리뷰 버전으로 나열하지 않고 같은 head의 분석 이력으로 묶으며, 성공하거나
진행 중인 canonical session ID를 반환한다.

## 권장 구현 분할

### 4-A Room/Revision DB와 API 계약

- [x] `pr_review_rooms`와 room file identity migration 설계
- [x] 기존 테스트 session 전량 초기화 후 최종 revision schema 적용 정책 확정
- [x] room/current revision 상태와 제안 API 계약 반영
- [x] 동시 room/버전 생성 unique constraint 반영

### 4-B 공유 Room 생성·조회·삭제 Backend

- [x] idempotent 시작/합류 서비스 구현
- [x] room 목록과 상세 API 구현
- [x] 모든 Workspace 구성원 권한 검증
- [x] 영구 삭제와 cascade 구현

### 4-C Review Canvas와 Custom Shape 기반

- [x] room 생성 transaction에서 `board_type=review` Canvas 생성·연결
- [x] Review Canvas 조회·operation 접근 허용
- [x] `pr_review_file_node`, `pr_review_relation_edge` 등록
- [x] 시스템 shape 필드별 수정 권한 검증
- [x] Canvas 담당자 review 반영

### 4-D 새 버전 분석과 Shape Materialization

- [x] 같은 room의 head SHA별 session/job 생성
- [x] 성공 전 기존 current session 유지
- [x] stable room file identity와 decision carry-over 구현
- [x] Conflict apply 후 immutable head를 유지하며 successor revision 자동 생성
- [x] node geometry 보존과 새 node 초기 layout 구현
- [x] 성공 시 current session 원자 교체
- [x] Review Canvas 진입 시 저장된 시스템 Shape 우선 로드와 기존 graph fallback 구현
- [x] File node 이동 geometry debounce 저장과 stale revision 복구 구현

### 4-E Realtime 협업과 동시 판단

- [ ] review Canvas room join/access check 추가
- [ ] presence, cursor, operation broadcast/catch-up 검증
- [ ] decision optimistic concurrency와 409 처리
- [ ] progress/node badge realtime 갱신

### 4-F Sidebar와 Room Lifecycle UX

- [ ] `리뷰할 PR` / `리뷰 공간` 하위 메뉴 구현
- [ ] 시작, 합류, 분석 중, 새 커밋, 이전 버전 CTA 구현
- [ ] merge/close read-only 전환과 reopen 처리
- [ ] 영구 삭제 확인과 접속자 퇴장 UX 구현

### 4-G 관계 Edge UX

- [ ] 후속 Issue `#854`의 relation style과 reason interaction 구현
- [ ] 시스템 relation edge와 사용자 arrow를 명확히 구분
- [ ] node 이동·group 시 edge binding 검증

## 검증 시나리오

- [ ] 두 사용자가 처음 `리뷰 시작`을 동시에 눌러도 room, Canvas와 첫 revision이 각각 하나다.
- [ ] 분석 중 다른 사용자가 입장해 같은 room 상태를 본다.
- [ ] 새 커밋 분석 중에도 기존 성공 버전과 Canvas를 사용할 수 있다.
- [x] 새 분석 성공 후 변경되지 않은 node 위치와 판단이 유지된다.
- [x] 변경된 파일만 `재검토 필요`가 되고 새 파일 node만 초기 배치된다.
- [ ] Conflict apply commit이 기존 revision head를 바꾸지 않고 같은 room의 successor가 된다.
- [x] materialization 실패 시 current version이 바뀌지 않는다.
- [ ] 동시 decision 저장에서 늦은 요청이 409를 받고 다른 사용자의 값을 덮어쓰지 않는다.
- [ ] node 이동, annotation과 사용자 arrow가 다른 사용자에게 실시간 반영된다.
- [ ] merge/close 후 모든 접속자가 read-only 상태를 본다.
- [ ] 어느 Workspace 구성원이 삭제해도 관련 PR Review/Canvas 데이터가 모두 영구 삭제된다.
- [ ] 기존 단일 session API, Conflict, Review 제출과 Merge 기능이 회귀하지 않는다.

## 담당 확인

- PR Review / DB Schema: 은재
- Canvas: 동현
- Infra/Realtime: 진호
- GitHub Integration: PR state/head 조회 계약이 바뀌는 경우 주형
- Auth: 새 사용자 read model이 필요한 경우 동현
