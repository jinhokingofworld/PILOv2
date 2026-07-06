# PR Review Workflow Canvas 전략

이 문서는 PR Review workflow canvas의 합의된 방향을 남기기 위한 결정 기록이다.
API 계약 문서는 아니다. 구현 중 API 계약이 바뀌면
`docs/api/pr-review-api.md`를 최신 기준으로 수정한다.

## 결정

PR Review는 MVP에서 Canvas UI 엔진 재사용 방식으로 시작한다.
MVP에서는 workflow graph를 Canvas API 또는 Canvas DB에 저장하지 않는다.

workflow의 원천 데이터는 PR Review 데이터로 유지한다.

1. `pr_review_sessions`
2. `review_flows`
3. `review_files`
4. `review_flow_files`

프론트엔드는 이 데이터를 tldraw 기반 canvas surface 위에 렌더링할 수 있다.
다만 MVP에서는 `canvas`, `canvas_freeform_shapes`를 persistence로 사용하지 않는다.

## MVP 형태

MVP 목표 구조:

```text
review_flows / review_files / review_flow_files
        |
        v
PR Review workflow view model
        |
        v
PrReviewWorkflowCanvas
        |
        v
workflow-to-tldraw-shapes adapter
        |
        v
src/shared/tldraw/TldrawSurface
```

MVP 동작:

- PR Review API 응답으로 flow, file node, review-order edge를 렌더링한다.
- tldraw surface를 사용해 canvas 느낌, zoom, pan, fit, selection을 제공한다.
- file node를 선택하면 해당 file review UI를 열거나 포커스한다.
- 파일 리뷰 상태를 node 색상이나 badge로 반영한다.
- node 위치는 자동 layout으로 계산하고 프론트에서만 유지한다.
- workflow 데이터 소유권은 PR Review 테이블에 둔다.
- workflow shape를 Canvas DB에 저장하지 않는다.
- MVP에서는 flow, node, edge 구조 편집을 허용하지 않는다.
- review workflow 생성, 조회, 삭제를 위해 Canvas API에 의존하지 않는다.

## Layout 원칙

PR Review workflow canvas는 단순한 좌->우 1열 순서도가 아니라, 리뷰 중 함께 봐야
하는 파일 관계를 보여주는 관계 지도여야 한다.

MVP layout 원칙:

- `review_flows`는 lane 또는 cluster 단위로 표현한다.
- `workflowOrder`는 리뷰 순서를 나타내는 보조 정보로 사용하고, 전체 화면을
  1열 step list로만 만들지 않는다.
- 같은 flow에 속하거나 함께 봐야 하는 파일은 가까이 배치한다.
- `edges`는 파일 간 관계를 표현하며, `reason`이 있으면 연결선 label, hover,
  선택 상태 패널 중 하나로 노출한다.
- 순서가 중요한 관계는 edge와 node badge/order number를 함께 사용해 표현한다.
- 한 파일이 여러 flow와 관련되면 MVP에서는 관련 flow badge를 우선 사용하고,
  필요한 경우 flow별 중복 node fallback을 허용한다.
- node 위치는 deterministic frontend layout으로 계산하며 저장하지 않는다.
- 사용자가 node/edge를 drag해서 review order나 graph 구조를 수정하는 동작은
  MVP 범위에서 제외한다.

## Canvas Surface 경계

현재 Canvas feature 컴포넌트는 아직 순수 공용 엔진이 아니다.
`PiloCanvasRuntime`에는 storage와 mock board 흐름이 섞여 있으므로 PR Review에서
사용하지 않는다.

합의된 방향은 `PiloTldrawSurface` 같은 얇은 tldraw 렌더링 레이어를 도입하거나
분리하는 것이다.

Canvas 담당자와의 최신 합의에서는 이 공통 렌더링 레이어를 `TldrawSurface`라고
부를 수 있다. 이 문서의 `PiloTldrawSurface`는 PILO 전용 wrapper 이름이 아니라,
저장 모델 없이 tldraw surface만 조립할 수 있는 얇은 렌더링 계층을 의미한다.
구현 경로는 `src/shared/tldraw/TldrawSurface`를 기준으로 둔다.

surface는 렌더링 관심사만 알아야 한다.

- 주입받은 `shapeUtils`
- 주입받은 `components`
- 초기 shapes
- camera 또는 viewport callback
- selection callback
- read-only 또는 semi-read-only mode
- enabled tools

surface가 알면 안 되는 것:

- Canvas API
- Canvas DB
- local mock board persistence
- `WorkspaceCanvas` 전체 화면 구성
- `PiloCanvasRuntime`의 freeform 저장 queue
- `PiloTldrawCanvas`의 Canvas 전용 조립
- `PiloFileNodeShapeUtil` placeholder
- sticky note, code block, frame, placement, smart guide, Canvas toolbar action
- PR Review 도메인 규칙
- GitHub 데이터

## 선행 의존성

PR Review frontend canvas 구현은 Canvas 담당자가 `PiloTldrawCanvas.tsx`에서
순수 tldraw 렌더링 부분을 `TldrawSurface`처럼 분리한 뒤 진행하는 것이 안전하다.

이 surface를 `src/shared/` 또는 frontend 공통 위치로 이동하는 PR은
`apps/frontend/FRONTEND_COMMON_AREAS.md` 기준으로 공통 영역 변경이며, 사이렌
변경으로 다룬다.

surface 분리 전에는 PR Review에서 임시로 `WorkspaceCanvas`나 `PiloCanvasRuntime`을
가져와 연결하지 않는다.

## Frontend 구현 위치

PR Review canvas 구현은 `features/canvas`가 아니라 `features/pr-review` 아래에 둔다.

예시:

```text
apps/frontend/src/features/pr-review/components/review-canvas/
  PrReviewCanvas.tsx
  PrReviewCanvasSurface.tsx
  pr-review-shape-utils.ts
  PrReviewFileNodeShapeUtil.tsx
```

권장 구조:

```text
PrReviewPage
  -> PrReviewCanvasSurface
  -> src/shared/tldraw/TldrawSurface
```

## PR Review Shape 규칙

MVP에서는 shape를 Canvas DB에 저장하지 않더라도, Post-MVP에서 Canvas persistence로
확장할 수 있도록 frontend shape model을 설계한다.

규칙:

- shape id는 deterministic하게 만든다.
  - file node 예시: `review-file:${reviewFileId}`
  - edge 예시: `review-edge:${fromReviewFileId}:${toReviewFileId}`
- shape metadata 또는 raw data에 PR Review 참조를 남긴다.
  - `reviewSessionId`
  - `flowId`
  - `reviewFileId`
  - `workflowOrder`
  - `fromReviewFileId`
  - `toReviewFileId`
- review file node shape props는 현재 PR Review API의 `fileNodeData`를 기준으로
  설계한다.
- incoming 초안의 Canvas `file_node`가 아니라, Review 전용 file node shape를 만든다.
- Canvas 쪽 `PiloFileNodeShapeUtil`은 아직 freeform Canvas follow-up placeholder에
  가까우므로 PR Review에서 가져와 쓰지 않는다.
- 위치는 자동 layout 결과이더라도 명시적인 `{ x, y }` 값으로 만든다.
- workflow model을 tldraw shape로 바꾸는 로직은 adapter 함수로 분리한다.
- tldraw surface가 PR Review API를 직접 호출하지 않게 한다.
- Canvas engine 코드가 PR Review 도메인 타입을 직접 import하지 않게 한다.

## Custom Review Node

review workflow의 file node는 `review_file_node` 같은 PR Review 소유 shape util로
둔다.

Canvas engine은 PR Review node 동작을 하드코딩하지 않는다. surface가 caller로부터
shape util을 주입받는 구조를 열어두고, PR Review가 custom node 렌더링과 상호작용을
소유한다.

## MVP 제외 범위

아래 항목은 MVP에서 의도적으로 제외한다.

- review workflow graph를 `canvas`에 저장
- review workflow shape를 `canvas_freeform_shapes`에 저장
- `pr_review_sessions`에 `canvas_id` 추가
- `review_flow_files`에 `canvas_shape_id`를 붙여 review node를 추적
- Canvas API를 review workflow의 source of truth로 사용
- node drag 위치를 여러 기기에서 복원되도록 저장
- node 또는 edge drag로 review order 수정
- canvas에서 flow, node, edge 구조 편집
- draw, memo, freeform annotation을 공유 데이터로 저장
- PR Review canvas annotation을 여러 사용자에게 공유

## Post-MVP 방향

MVP 이후 제품 요구가 생기면 PR Review는 Canvas API/DB persistence로 확장할 수 있다.
예를 들어 저장되는 canvas annotation, 저장되는 node 위치, 편집 가능한 workflow graph,
공유 review canvas state가 필요해지는 경우다.

Post-MVP 목표 구조:

```text
review_flows / review_files / review_flow_files
        |
        v
PR Review workflow model
        |
        v
workflow-to-canvas-shapes adapter
        |
        v
canvas / canvas_freeform_shapes
        |
        v
src/shared/tldraw/TldrawSurface
```

Post-MVP 구현 전에 결정해야 할 내용:

- `pr_review_sessions`와 `canvas`를 어떻게 연결할지
  - 선택지 A: `pr_review_sessions`에 `canvas_id` 추가
  - 선택지 B: 별도 join table 추가
- review session마다 새 review canvas를 만들지 여부
- review session 삭제 시 연결된 review canvas도 삭제할지 여부
- Canvas API가 `board_type = review`를 지원해야 하는지 여부
- Canvas 권한과 PR Review workspace 권한을 어떻게 매핑할지
- shape 변경을 PR Review status 또는 workflow order와 어떻게 동기화할지
- 사용자가 edge를 수정하면 review order가 바뀐 것으로 볼지
- memo/draw annotation을 local scratch, 팀 공유 데이터, GitHub review output 중
  무엇으로 볼지
- PR head SHA가 stale 상태가 되었을 때 저장된 canvas annotation을 어떻게 처리할지

## 전환을 위한 가드레일

MVP 구현을 Post-MVP 확장과 호환되게 유지하기 위해 아래 규칙을 지킨다.

- PR Review workflow API는 tldraw 세부 구현과 독립적으로 둔다.
- tldraw shape 생성은 adapter에 둔다.
- 처음부터 deterministic shape id를 사용한다.
- shape metadata에 review 참조를 남긴다.
- layout 결과는 좌표로 직렬화 가능하게 만든다.
- read-only workflow graph와 선택적 annotation tool을 분리한다.
- Canvas DB persistence는 Canvas owner review가 필요한 별도 이슈로 다룬다.

## 이슈 분리 가이드

#47 backend 작업은 Canvas API 또는 Canvas DB 변경 없이 계속 진행할 수 있다.

추천 별도 frontend 이슈는 두 단계로 나눈다.

1. `[canvas] TldrawSurface 공통 렌더링 레이어 분리`

이 이슈는 Canvas 담당자가 먼저 진행한다. `PiloTldrawCanvas.tsx`의 순수 렌더링 부분을
storage, queue, Canvas API와 분리하고, `shapeUtils`, `components`, tool 제한,
camera/selection callback을 외부에서 주입할 수 있게 한다. 공통 위치로 이동하면
frontend 공통 영역 사이렌 변경으로 다룬다.
결과물은 `src/shared/tldraw/TldrawSurface`를 기준으로 한다.

2. `[은재][pr-review] PR Review workflow canvas surface 연동`

이 이슈의 범위:

- 선행 `TldrawSurface` 분리 결과를 사용
- `PrReviewWorkflowCanvas` 구현
- PR Review canvas view model을 tldraw shapes로 변환
- PR Review 소유 `review_file_node` shape util 추가
- zoom, pan, fit, file-node selection 지원
- MVP에서는 Canvas persistence 제외
- `WorkspaceCanvas`, `PiloCanvasRuntime`, `PiloTldrawCanvas`, `PiloFileNodeShapeUtil`,
  freeform 저장 queue 재사용 제외
