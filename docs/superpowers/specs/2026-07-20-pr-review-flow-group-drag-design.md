# PR Review Flow 전체 이동 설계

## 배경

PR Review Canvas에서 파일 카드는 사용자가 이동할 수 있지만 Flow 제목은 system shape 정책에 의해 고정되어 있다. 여러 Flow의 위치를 정리하려면 Flow 안의 파일을 하나씩 옮겨야 하고, 파일 사이의 상대 배치를 유지하기 어렵다.

사용자는 Flow 제목을 이동 핸들처럼 드래그하여 해당 Flow의 그래프 전체를 한 번에 옮길 수 있어야 한다.

## 목표

- Flow 제목을 드래그하면 같은 Flow의 파일 카드 전체를 동일한 거리만큼 이동한다.
- pinned 파일도 Flow 전체 이동에는 포함한다.
- 파일 사이의 상대 좌표와 pinned 상태를 유지한다.
- 관계선은 이동 중인 파일 위치에 맞춰 다시 계산한다.
- 이동 결과는 기존 파일 위치 저장 API와 Canvas operation으로 저장·동기화한다.
- 다른 Flow와 개별 파일 이동, 자동 정렬 동작은 변경하지 않는다.

## 비목표

- Flow 제목을 파일 그래프와 독립적으로 이동하거나 별도로 저장하지 않는다.
- Flow 전용 DB shape, API endpoint 또는 migration을 추가하지 않는다.
- Flow 크기 조절, Flow 간 파일 이동, Flow 순서 변경을 지원하지 않는다.
- 여러 Flow를 한 번에 그룹 이동하는 기능은 추가하지 않는다.

## 사용자 동작

1. 사용자가 Flow 제목 영역을 누른다.
2. Canvas는 제목 shape와 같은 `flowId`를 가진 파일 카드 전체를 하나의 다중 선택으로 만든다.
3. 사용자가 제목을 드래그하면 선택된 제목과 파일 카드가 같은 `dx`, `dy`로 이동한다.
4. 파일 관계선은 이동된 카드의 anchor를 기준으로 즉시 다시 계산한다.
5. 드래그가 끝나면 기존 debounce 저장이 변경된 파일 카드 위치를 저장한다.
6. 다른 사용자는 기존 Canvas operation 동기화를 통해 각 파일 카드의 새 위치를 받는다.

개별 파일 카드를 직접 드래그하면 기존처럼 해당 파일만 이동한다. 읽기 전용 상태, 자동 정렬 미리보기, 저장 가능한 파일 shape가 아직 준비되지 않은 fallback 화면에서는 Flow 전체 이동을 시작할 수 없다.

## 구현 구조

### Flow 제목을 다중 선택 핸들로 사용

`PrReviewFlowLabel`의 pointer down 시 현재 editor에서 아래 shape id를 수집한다.

- 선택한 `pr_review_flow_label`
- 같은 `flowId`의 모든 `pr_review_file_node`

수집한 shape를 tldraw 다중 선택으로 전환한 뒤 기본 translate 동작을 계속 사용한다. 별도 pointer move 루프나 좌표 계산기를 만들지 않는다. 이 방식은 tldraw가 동일한 delta를 모든 선택 shape에 적용하므로 내부 배치를 보존한다.

관계선은 선택하거나 직접 이동하지 않는다. 파일 위치 변경 뒤 기존 `updatePrReviewRelationGeometry`가 새 anchor와 route를 계산한다.

### system shape 변경 정책

현재 정책은 파일 노드를 제외한 모든 PR Review system shape 변경을 원래 값으로 되돌린다. Flow 제목에 대해서만 다음 변경을 허용한다.

- `x`, `y` translation
- 읽기 전용이 아닌 사용자 이동

Flow 제목의 `props`, 크기, 회전, 부모, z-order 변경은 계속 차단한다. 관계선, milestone, role lane 등 다른 system shape 정책도 유지한다.

### 저장과 새로고침

Flow 제목은 DB에 저장하지 않는다. 같은 Flow의 파일 카드가 모두 동일한 delta로 저장되므로 새로고침 시 `buildStoredFlowLabelShapes`가 파일 bounds 위에 제목을 다시 생성하면 이동된 위치가 복원된다.

파일 위치 저장은 기존 `updateReviewCanvasFileShape` 호출, revision 충돌 처리, debounce, operation id 계약을 그대로 사용한다. 따라서 App Server API와 DB schema 변경은 없다.

### 실시간 동기화

파일 카드마다 기존 update operation이 발생한다. 원격 사용자는 파일 위치를 반영한 뒤 기존 관계선 재계산 경로를 사용한다. Flow 제목은 원격 파일 bounds에서 파생되므로 별도 realtime payload를 추가하지 않는다.

## 예외와 오류 처리

- Flow에 파일 카드가 없으면 제목만 선택하되 이동 결과를 영속화하지 않는다. 일반 분석 결과에서는 파일 없는 Flow가 생성되지 않는다.
- 저장된 파일 shape를 불러오지 못해 fallback 화면을 표시할 때는 Canvas 이동을 읽기 전용으로 두어 제목만 이동하는 불완전한 상태를 만들지 않는다.
- 저장 중 revision 충돌이 발생하면 기존 동작대로 최신 파일 위치를 다시 반영하고 안내한다.
- 일부 파일 저장에 실패하면 기존 오류 안내를 표시한다. 성공한 파일과 실패한 파일을 자동 rollback하는 새 transaction은 만들지 않는다.
- 자동 정렬 미리보기 중에는 Flow 전체 이동을 시작하지 않는다. 미리보기 적용 또는 취소 후 이동할 수 있다.

## 검증

- Flow 제목 translation만 system shape 정책에서 허용되는지 단위 테스트한다.
- Flow 제목 선택 시 같은 Flow 파일만 수집되고 pinned 파일도 포함되는지 단위 테스트한다.
- 다른 Flow 파일과 관계선은 선택 대상에서 제외되는지 확인한다.
- 동일한 delta 적용 후 파일 간 상대 좌표가 유지되는지 확인한다.
- 기존 Canvas shape persistence 테스트로 이동된 파일 위치가 저장 입력에 포함되는지 확인한다.
- 기존 PR Review focused script로 개별 파일 이동, 자동 정렬, relation geometry 회귀를 확인한다.

## 영향 범위

- Frontend PR Review 도메인 내부 변경이다.
- Frontend 공통 영역, App Server, AI Worker, DB schema, migration, 공개 API 계약 변경은 없다.
