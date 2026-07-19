# PR Review 관계 기반 레이아웃 보완 설계

## 목적과 적용 범위

현재 Review Canvas는 `workflowOrder` 전체를 1→2→3 spine으로 연결하므로 파일마다 별도 rank가 생기고 모든 Flow가 한 줄로 배치된다. 번호 시작점은 안정적이지만 파일 관계의 분기 구조를 시각적으로 드러내지 못한다.

이 보완 설계는 아래 두 동작만 변경한다.

- 저장된 file node가 없는 새 Review Canvas의 최초 배치
- 사용자가 실행하는 `현재 Flow 자동 정렬`

semantic graph 생성, Flow membership, DB schema, 공개 API response, 기존 저장 geometry의 자동 복원 정책은 변경하지 않는다. 이 문서의 레이아웃 규칙은 `2026-07-19-pr-review-semantic-flow-layout-design.md`의 5장과 6장을 대체한다.

## 핵심 모델

`workflowOrder`와 파일 관계의 역할을 분리한다.

- `workflowOrder`: 리뷰 시작점과 동일 rank 안의 안정적인 정렬 기준
- semantic relation: node의 계층과 분기 구조를 결정하는 배치 근거
- `review_order` relation: 화면에 표시할 추천 읽기 경로이며 node rank를 강제하지 않음

따라서 1번 파일은 시작점으로 유지하지만, 2번 이후 파일은 실제 관계 깊이에 따라 같은 rank에서 위아래로 분기할 수 있다. 번호는 추천 읽기 순서를 나타내며 x 좌표가 항상 1→2→3으로 증가한다는 의미로 사용하지 않는다.

## 관계 기반 layout graph

Flow 파일은 `workflowOrder`, file path, stable ID 순으로 안정 정렬한다. 가장 앞선 파일을 `start`로 선택한다.

1. `review_order` relation은 layout edge에서 제외한다.
2. 같은 Flow의 semantic relation만 layout edge 후보로 사용한다.
3. layout 전용 방향은 endpoint 중 `workflowOrder`가 낮은 파일에서 높은 파일로 정규화한다. 동일 순서는 file path와 stable ID로 결정한다.
4. 같은 endpoint pair의 layout edge는 하나로 dedupe한다.
5. 정규화된 semantic edge에 incoming edge가 없는 root마다 `start → root` synthetic anchor를 추가한다. `start` 자신은 제외한다.
6. App Server ELK에서는 `start` node에만 `FIRST` layer constraint를 적용한다.
7. semantic relation이 하나도 없는 Flow는 기존 review-order spine을 fallback으로 사용한다.

이 방식은 역방향·순환 relation이 1번 파일을 뒤로 보내는 문제를 피하면서, semantic 관계가 있는 Flow는 여러 branch와 depth를 갖도록 한다. synthetic anchor와 fallback spine은 layout 전용이며 relation shape나 DB에 저장하지 않는다.

## 최초 Canvas와 명시적 자동 정렬

App Server 최초 materialization은 위 layout graph를 ELK에 전달한다. 현재의 semantic relation 하단 lane, 다음 Flow 간격 계산, layout 실패 시 deterministic fallback은 유지한다.

Frontend의 `현재 Flow 자동 정렬`도 같은 규칙을 Dagre에 적용한다.

- pin되지 않은 현재 Flow node만 재배치한다.
- pin된 node는 layout graph에서 제외하고 기존 위치를 유지한다.
- 이동 가능한 node 중 가장 이른 `workflowOrder`를 frontend start로 사용한다.
- semantic relation의 양 endpoint가 모두 이동 가능한 경우에만 layout edge로 사용한다.
- 사용자가 자동 정렬을 실행한 경우에만 새 geometry를 저장한다.

pin된 1번 파일이 오른쪽에 있어도 위치를 강제로 바꾸지 않는다. 기존 정책처럼 pin 상태가 자동 정렬보다 우선한다.

## Route와 저장 정책

이번 보완에서는 relation route 정책을 다시 설계하지 않는다.

- 실제 semantic relation은 현재의 node 아래 orthogonal lane을 사용한다.
- 인접 `review_order` relation의 짧은 route와 lane 간격 계산을 유지한다.
- synthetic layout edge는 route 결과에 포함하지 않는다.
- 기존 file node geometry와 저장된 relation route는 Canvas를 불러오거나 새 revision을 materialize하는 것만으로 덮어쓰지 않는다.

## 검증 기준

- semantic branch `1→2`, `1→3`, `2→4`, `3→5`에서 2와 3이 같은 depth의 별도 node로 배치된다.
- 원본 relation이 `4→1`이어도 layout 전용 방향 정규화로 1번이 가장 왼쪽에 남는다.
- 연속 `review_order` relation은 semantic branch의 rank를 한 줄로 펴지 않는다.
- semantic relation이 없는 Flow는 review-order fallback으로 1→2→3 순서를 유지한다.
- synthetic anchor와 fallback edge는 Canvas relation으로 저장되지 않는다.
- 최초 Canvas의 Flow 간격과 semantic 하단 lane 회귀가 없다.
- Frontend 자동 정렬에서 pin된 node는 이동 결과에 포함되지 않는다.
- App Server 최초 배치와 Frontend 자동 정렬이 같은 branch 구조 원칙을 사용한다.

검증은 App Server Canvas materializer focused test와 Frontend graph exploration focused test로 제한한다. 전체 monorepo 테스트는 실행하지 않는다.

## 배포와 호환성

DB migration과 runtime 간 새 handoff가 없으므로 Worker/App Server 호환 배포 순서는 추가되지 않는다. 기존 Canvas는 자동으로 재배치되지 않는다. 새 Canvas 또는 사용자가 명시적으로 자동 정렬한 Flow에서만 새 관계 기반 배치가 나타난다.
