# PR Review Post-MVP 계획

이 문서는 PR Review MVP 이후 고도화 방향을 정리하는 결정 기록이다.
API 계약 문서는 아니며, 구현 중 API나 DB schema가 바뀌면
`docs/api/pr-review-api.md`와 관련 도메인 API 문서를 함께 수정한다.
Conflict 구현 진행 체크리스트는 `POST_MVP_CONFLICT_IMPLEMENTATION_CHECKLIST.md`를 따른다.
Merge action 구현 진행 체크리스트는 `POST_MVP_MERGE_IMPLEMENTATION_CHECKLIST.md`를 따른다.

## Post-MVP Pillars

PR Review Post-MVP는 아래 4개 축으로 진행한다.

```text
1. AI Conflict Resolution Assistant
2. Async AI Analysis Pipeline
3. Semantic Review Graph
4. Collaborative Review Canvas
```

우선순위는 발표 임팩트와 구현 안정성을 기준으로 정한다.

```text
Conflict 해결 happy path
  -> 큰 PR도 안정적으로 처리하는 비동기 분석
  -> 리뷰 순서와 관계를 개선하는 graph 고도화
  -> 팀원이 함께 보는 협업 Canvas
```

## 1. AI Conflict Resolution Assistant

최우선 Post-MVP 목표는 conflict PR을 PR Review 안에서 이해하고 해결까지 이어지게
돕는 것이다.

완전 자동 conflict 해결 시스템이 아니라, 사용자가 확인하고 적용하는 happy path를
목표로 한다.

```text
Conflict PR 선택
  -> PR Review room 진입
  -> conflict 상태를 header/graph에 표시
  -> conflict file node 또는 conflict panel 진입
  -> 충돌 파일/구간 확인
  -> AI가 해결안 생성
  -> 사용자가 해결안을 확인/수정
  -> Apply resolution
  -> PR head와 base를 parent로 갖는 merge commit
  -> conflict 재확인
  -> Merge
```

역할 분담:

- AI: 충돌 원인 설명, 해결 방향 제안, resolved content 또는 patch 초안 생성
- 사용자: 해결안 확인, 필요 시 수정, 적용 승인, merge 최종 승인
- 서버: conflict 추출, AI 요청, 실제 Git merge 기반 conflict 해결 commit, PR 상태 재확인,
  merge API 호출

### Phase 1 PR 분할

1단계는 하나의 큰 PR로 구현하지 않는다. 각 PR은 하나의 목적과 하나의 review surface만
가진다.

1. `1-A. Scope and contract`
   - 첫 지원 범위와 API 경계를 확정한다.
   - conflict 분석 결과를 저장할지, 요청 시 계산할지 결정한다.
   - 분석 trigger를 sync로 둘지 async로 둘지 결정한다.
   - runtime 동작 변경은 포함하지 않는다.

2. `1-B. Read-only conflict analysis`
   - conflicted PR에서 파일/구간 단위 conflict 정보를 추출한다.
   - `content / line conflict`를 첫 지원 범위로 둔다.
   - PR head branch에는 쓰지 않는다.
   - merge API를 호출하지 않는다.

3. `1-C. Review room conflict UX`
   - Review room header/file node에 conflict 상태를 표시한다.
   - conflict file은 Conflict Resolution mode로 진입한다.
   - conflict가 해결되기 전에는 일반 file decision을 숨기거나 비활성화한다.

4. `1-D. AI suggestion draft`
   - 추출된 conflict hunk를 바탕으로 충돌 원인과 해결 초안을 생성한다.
   - AI output은 사용자가 확인하기 전까지 suggestion으로만 취급한다.

5. `1-E. Apply resolution write path`
   - 사용자가 확인한 resolved content만 PR head branch의 merge commit에 적용한다.
   - head SHA, blob SHA, conflict marker 검증을 통과해야 한다.
   - 초기에는 지원 가능한 content conflict file이 정확히 1개인 PR만 적용한다.
   - 임시 Git working tree에서 base를 실제 merge해 충돌 없는 base 변경도 함께 보존한다.
   - 최종 merge는 별도 명시적 사용자 action으로 둔다.

### Phase 1-A 확정 범위

초기 구현은 순차적으로 진행한다. 먼저 읽기 전용 conflict 분석 계약을 확정하고,
그 다음 Review room 표시, AI suggestion, apply write path 순서로 확장한다.

- Conflict analysis API는 review session 기준 endpoint로 둔다.
- 초기 read-only slice는 conflict 분석 결과를 DB에 저장하지 않고 요청 시 계산한다.
- 초기 read-only slice는 async job 없이 sync 요청으로 처리한다.
- GitHub Integration 공개 API는 늘리지 않고 PR Review 내부 dependency adapter를 확장한다.
- 초기 read-only slice는 `content / line conflict`만 지원한다.
- PR head branch commit, merge API 호출, AI suggestion 생성은 후속 slice에서 다룬다.

### 지원할 Conflict 유형

초기 happy path에서는 텍스트 기반 conflict 4종을 지원한다.

1. `content / line conflict`
   - 양쪽 branch가 같은 파일의 같은 줄 근처를 다르게 수정한 경우
   - AI는 두 변경을 합친 resolved content를 제안한다.

2. `modify/delete conflict`
   - 한쪽 branch는 파일을 삭제하고, 다른 쪽 branch는 같은 파일을 수정한 경우
   - AI는 삭제 유지 또는 파일 복원 후 수정 반영 중 더 적절한 방향을 제안한다.

3. `rename/modify conflict`
   - 한쪽 branch는 파일을 rename/move하고, 다른 쪽 branch는 기존 파일을 수정한 경우
   - AI는 rename된 새 경로에 수정사항을 반영하는 방향을 제안한다.

4. `add/add conflict`
   - 양쪽 branch가 같은 경로에 새 파일을 각각 추가한 경우
   - AI는 두 내용을 병합하거나 파일명을 분리하는 방향을 제안한다.

초기 제외 또는 수동 안내 대상:

- binary conflict
- rename/rename conflict
- submodule conflict
- permission/mode conflict
- semantic conflict

### Conflict 데이터 수집

GitHub API는 PR 단위 merge 가능 여부는 제공하지만, 안정적인 파일 단위 conflict hunk를
바로 제공하지 않는다. 따라서 backend 또는 worker에서 merge simulation이 필요하다.

필요 데이터:

- base branch/ref
- head branch/ref
- base sha
- head sha
- merge base
- conflict file path
- conflict type
- base/current/incoming content
- conflict hunk

예상 normalized model:

```ts
type ConflictType =
  | "content"
  | "modify_delete"
  | "rename_modify"
  | "add_add"
  | "unsupported";

type ConflictFile = {
  path: string;
  previousPath?: string | null;
  type: ConflictType;
  headContent: string;
  hunks: ConflictHunk[];
  resolutionStatus: "unresolved" | "suggested" | "applied";
  aiSummary?: string;
  aiSuggestion?: string;
  resolvedHunks?: Array<{
    hunkId: string;
    resolvedText: string;
  }>;
  resolvedContent?: string;
};
```

### File Node UX

기존 PR Review file node는 유지한다. 다만 conflict 파일이면 일반 리뷰 모드가 아니라
Conflict Resolution 모드로 진입한다.

```text
일반 file node 클릭
  -> Review File Drawer
  -> diff / AI 분석 / decision 저장

Conflict file node 클릭
  -> Conflict Resolution Drawer
  -> 충돌 구간 / AI 해결안 / Apply resolution
```

노드 표시:

- conflict badge 또는 warning icon 표시
- conflict 상태는 risk level보다 우선 표시
- PR-level conflict만 알고 파일 단위 정보가 없으면 header에만 표시하고, conflict 분석 후 파일 badge를 반영한다.

충돌 해결 전에는 일반 file decision 저장을 숨기거나 비활성화한다.

```text
충돌 해결 후 리뷰 판단 가능
```

### Apply / Merge Guard

AI가 자동으로 수정하거나 merge하지 않는다. 모든 write action에는 사용자 확인이 필요하다.

Apply resolution 시 확인할 것:

- 현재 PR head SHA가 분석 당시 head SHA와 같은지
- 대상 파일의 최신 blob SHA가 예상과 같은지
- resolved content가 비어 있거나 conflict marker를 그대로 포함하지 않는지
- GitHub write 권한이 있는지
- PR 전체에서 지원 가능한 conflict file이 정확히 1개인지
- merge commit이 PR head와 base를 모두 parent로 포함하는지

Merge 시 확인할 것:

- conflict가 해소됐는지
- PR head SHA가 최신인지
- GitHub merge API가 허용하는 상태인지
- 사용자가 최종 merge를 클릭했는지

### 후순위 UX: Monaco Editor

초기 버전은 textarea 또는 단순 code editor로 해결안 편집을 구현한다.
Conflict resolver 핵심 파이프라인이 안정화된 뒤 Monaco editor를 도입한다.

Monaco 도입 목적:

- syntax highlighting
- line number
- diff preview
- multi-file conflict edit UX 개선
- 긴 파일 가독성 개선

Monaco는 conflict 해결 로직이 아니라 편집/가독성 개선 layer로 본다.

## 2. Async AI Analysis Pipeline

두 번째 우선순위는 큰 PR에서도 분석이 timeout 없이 안정적으로 끝나도록 AI 분석을
비동기화하는 것이다.

현재 MVP 분석은 App Server에서 review session 생성 흐름 안에서 수행될 수 있다.
대용량 PR에서는 timeout 또는 deterministic fallback이 발생할 수 있으므로, 분석을
비동기 job으로 분리한다.

목표:

- App Server는 review session 생성 후 AI 분석 job을 enqueue한다.
- AI Worker가 PR diff와 metadata를 읽어 분석한다.
- 분석 결과를 `pr_review_sessions`, `review_flows`, `review_files`,
  `review_flow_files`에 반영한다.
- Frontend는 `analyzing`, `reviewing`, `failed` 상태를 polling 또는 realtime으로 갱신한다.
- 큰 PR에서도 사용자가 request timeout을 만나지 않게 한다.

기본 흐름:

```text
Review session 생성
  -> 분석 job enqueue
  -> AI Worker 분석
  -> 분석 결과 저장
  -> session 상태 갱신
  -> Frontend가 결과 반영
```

검토 항목:

- job idempotency
- retry와 dead-letter 처리
- 분석 중 PR head SHA 변경 감지
- fallback 분석 결과와 AI 분석 결과의 교체 정책
- 사용자에게 보여줄 analyzing/failed/retry 상태
- AI Worker와 App Server 사이의 payload schema

## 3. Semantic Review Graph

세 번째 우선순위는 PR Review graph가 단순 파일 목록이 아니라 리뷰어가 따라갈 수 있는
의미 있는 관계 지도가 되도록 고도화하는 것이다.

Graph 고도화는 LLM 하나에게 전체 판단을 맡기는 방식으로 진행하지 않는다.
좋은 리뷰 그래프를 만들기 위해 deterministic 분석, LLM 보강, 서버 검증을 함께 사용한다.

목표:

- 파일 역할을 더 안정적으로 추론한다.
- 파일 간 관계 후보를 만든다.
- LLM은 관계의 의미, flow 제목, review intent, edge reason을 보강한다.
- 서버는 말이 안 되는 edge, 중복 edge, 과도한 edge를 제거한다.
- Frontend는 lane/cluster layout으로 리뷰하기 좋은 흐름을 보여준다.
- conflict file은 graph에서 warning node 또는 badge로 드러낸다.

권장 구조:

```text
Backend rule engine
  -> 파일 역할 / 관계 후보 생성

LLM
  -> 변경 의도 / 관계 이유 / flow 설명 보강

Backend validator
  -> 없는 파일 edge 제거
  -> 중복 edge 제거
  -> edge 수 제한
  -> confidence 낮은 관계 제거

Frontend layout
  -> lane / cluster / edge routing 시각화
```

Backend에서 처리할 수 있는 것:

- file role inference
  - entry
  - core logic
  - api/dto
  - state/ui
  - test/docs
  - config/support
- relation inference
  - import 관계
  - test 대상 관계
  - DTO/API 변경과 UI 사용처 관계
  - 설정/문서 변경과 기능 변경의 보조 관계
- risk scoring
- flow grouping
- edge reason 후보 생성

LLM이 담당할 것:

- PR 목적 요약
- flow 제목과 설명 생성
- 관계 이유를 리뷰어가 이해할 수 있는 문장으로 변환
- 리뷰 순서 추천
- 위험도 판단 보조

LLM에게 맡기지 않을 것:

- 실제 파일 존재 여부 검증
- 모든 edge의 최종 승인
- import 관계의 사실 판단 전체
- edge 개수와 순환 제어
- 저장 schema 결정

Frontend에서 처리할 것:

- lane 배치
- node 위치 계산
- edge routing
- 겹침 방지
- edge reason 표시
- 위험도와 review status 시각화
- conflict badge 또는 warning node 표시

우선순위:

1. Backend rule engine으로 후보 관계 생성
2. LLM이 후보 관계의 설명과 flow 의미를 보강
3. Backend validator로 graph 품질 통제
4. Frontend lane/cluster layout 개선
5. 필요 시 사용자 수동 정렬과 저장된 layout 도입

## 4. Collaborative Review Canvas

네 번째 우선순위는 PR Review room 위에 협업 가능한 Canvas annotation layer를 추가하는
것이다.

PR Review room은 현재 Canvas 전체를 재사용하지 않고, `TldrawSurface`를 사용해
PR Review 전용 workflow graph를 렌더링한다. Post-MVP에서는 이 위에 협업 가능한
Canvas annotation layer를 추가한다.

핵심 원칙:

```text
리뷰 데이터는 PR Review가 소유한다.
사용자가 캔버스에 그리는 annotation은 Canvas가 소유한다.
```

PR Review workflow graph를 Canvas로 옮기는 것이 아니다.
PR Review room 위에 협업 가능한 Canvas annotation layer를 추가한다.

Layer 구분:

```text
PR Review Room
├─ Workflow Layer: PR Review 도메인 소유
│  ├─ review file node
│  ├─ review flow edge
│  ├─ workflow order
│  └─ file decision status
└─ Annotation Layer: Canvas 도메인 기능 재사용
   ├─ draw
   ├─ arrow / line
   ├─ sticky note
   ├─ highlight
   ├─ remote cursor / presence
   └─ realtime shape sync
```

PR Review가 계속 소유하는 데이터:

- `pr_review_sessions`
- `review_flows`
- `review_files`
- `review_flow_files`
- `file_review_decisions`
- `review_submissions`

Canvas가 annotation layer로 소유하는 데이터:

- `canvas`
- `canvas_freeform_shapes`
- `canvas_shape_operations`
- `canvas_user_states`

PR Review file node, flow edge, workflow order, file decision은
`canvas_freeform_shapes`에 저장하지 않는다.

## Review Board 사용

PR Review session마다 annotation용 review canvas를 연결한다.

```text
pr_review_sessions.canvas_id -> canvas.id
canvas.board_type = 'review'
```

`board_type = 'review'` canvas는 PR Review workflow graph 저장소가 아니라
사용자가 그린 annotation 저장소로만 사용한다.

우선 허용할 annotation tool:

- select
- draw
- arrow / line
- sticky note
- highlight

초기 범위에서는 PR Review file node와 flow edge를 Canvas editable shape로 바꾸지
않는다. 두 요소는 PR Review API 응답을 기반으로 read-only layer에 렌더링한다.

## Canvas 연동 범위

재사용하고 싶은 Canvas 기능:

- shape 저장과 batch sync
- operation log와 catch-up
- realtime presence
- remote cursor
- draw/arrow/sticky/highlight tool 동작
- viewport 또는 camera persistence

가져오지 않을 것:

- `WorkspaceCanvas` 전체 화면
- Canvas board 선택/생성 UI
- PR Review workflow의 source of truth를 Canvas로 이전하는 흐름
- PR Review file decision을 Canvas shape 변경으로 처리하는 흐름

`PiloCanvasRuntime`을 그대로 붙일 수 있는지는 실제 구현 전 확인한다.
freeform Canvas 화면 조립이 강하게 섞여 있다면 annotation runtime으로 쓸 수 있게
분리하거나 PR Review 전용 wrapper를 둔다.

## 협업 Canvas 구현 단계

1. Review canvas 연결 모델 확정
   - `pr_review_sessions.canvas_id` 사용 여부 확인
   - session 생성 시 `board_type = 'review'` canvas 생성 또는 재사용 정책 결정
   - session 삭제 시 annotation canvas 삭제 또는 보존 정책 결정

2. Canvas API와 realtime의 review board 지원 확인
   - shape list/create/update/delete/batch/operations API가 `review` board에서 동작해야 한다.
   - realtime room join/access check가 `review` board를 허용해야 한다.
   - operation broadcast와 catch-up이 `review` board에서도 동작해야 한다.

3. Frontend layer 조립
   - PR Review workflow layer는 기존 `TldrawSurface` 기반 read-only 렌더링을 유지한다.
   - annotation layer에는 Canvas shape runtime을 붙인다.
   - workflow node/edge와 annotation shape의 selection, z-index, pointer event 정책을 분리한다.

4. 협업 경험 추가
   - 같은 review session에 들어온 사용자 presence 표시
   - remote cursor 표시
   - 다른 사용자의 annotation shape 변경 realtime 반영
   - file node 선택이나 diff drawer 열람 상태 공유는 별도 presence payload로 검토한다.

5. 저장과 stale 정책
   - PR head SHA가 바뀐 경우 기존 review session annotation을 어떻게 취급할지 결정한다.
   - 기본 방향은 기존 annotation을 바로 삭제하지 않고, 새 review session 생성을 유도한다.

## 제외 또는 후순위

- GitHub inline review comment 작성
- PR merge/close 완전 자동화
- ProjectV2 write API 연동
- 모든 conflict 유형 완전 지원
- CI/checks 자동 복구
- PR Review workflow node/edge를 Canvas editable shape로 완전 이전
- 여러 사용자가 workflow graph 구조 자체를 공동 편집하는 기능
- annotation을 GitHub review body로 자동 변환하는 기능

## 관련 문서

- `docs/api/pr-review-api.md`
- `docs/api/canvas-api.md`
- `apps/app-server/src/modules/pr-review/WORKFLOW_CANVAS_STRATEGY.md`
- `apps/app-server/src/modules/pr-review/IMPLEMENTATION_CHECKLIST.md`
