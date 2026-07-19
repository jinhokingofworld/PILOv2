# PR Review 의미 Flow 재구성과 리뷰 순서 레이아웃 설계

## 배경

현재 PR Review 분석은 규칙 기반 관계를 모두 동등하게 연결해 Flow 후보를 만든 뒤, AI가 각 후보의 제목·설명·리뷰 순서만 보강한다. 이 구조에서는 `shared_identifier`처럼 신뢰도가 낮은 관계 하나가 서로 다른 변경 흐름을 큰 Flow 하나로 합칠 수 있고, AI는 파일을 다른 Flow로 옮기거나 Flow를 나눌 수 없다.

Canvas 최초 배치는 같은 Flow의 역할 우선순위와 모든 semantic relation을 ELK 입력으로 사용한다. 역방향 또는 순환 관계가 있으면 `workflowOrder = 1`인 파일보다 다른 파일이 왼쪽에 배치되어 Flow 제목 아래에 6번이나 9번 파일이 먼저 보일 수 있다. Frontend의 `현재 Flow 자동 정렬`도 모든 relation을 Dagre 입력으로 사용해 같은 문제가 반복될 수 있다.

## 목표

- 강한 규칙 관계는 보존하면서 AI가 변경 파일 전체를 실제 작업 흐름에 맞게 다시 묶을 수 있게 한다.
- 낮은 신뢰도의 관계가 Flow 경계를 강제로 합치지 않게 한다.
- AI relation 하나가 잘못되어도 유효한 AI Flow 분류는 유지한다.
- App Server와 AI Worker의 검증 책임을 명확히 해 같은 결과를 서로 다르게 판정하는 문제를 없앤다.
- 새 Canvas와 사용자가 요청한 Flow 자동 정렬에서 1번 파일을 시작점으로 유지하면서 semantic 관계의 branch 구조를 보여준다.
- 기존 사용자가 배치한 Canvas 좌표와 고정 노드는 자동으로 덮어쓰지 않는다.

## 비목표

- 사용자가 Flow membership을 직접 편집하는 UI는 추가하지 않는다.
- 기존 완료 revision을 다시 분석하거나 저장된 Flow를 소급 변경하지 않는다.
- DB table, column, constraint 또는 migration을 변경하지 않는다.
- 같은 Flow 안에서 유효한 semantic relation의 표시 계약은 유지한다. 서로 다른 Flow로 나뉜 hint relation의 cross-Flow 표시는 이번 범위에 포함하지 않는다.
- PR 분석 전체 prompt나 파일별 risk 분석 정책을 다시 설계하지 않는다.

## 1. Semantic Graph v2 입력 계약

App Server는 새 분석에 `pr-review-semantic-graph:v2`를 사용한다. 파일 역할 후보와 관계 후보는 유지하되 각 관계에 Flow 경계에 대한 의미를 추가한다.

```ts
type GroupingBinding = "locked" | "hint";

type RelationCandidate = {
  key: string;
  fromFilePath: string;
  toFilePath: string;
  relationType: PrReviewRelationType;
  source: "rule";
  confidence: number;
  evidence: string;
  groupingBinding: GroupingBinding;
};
```

`locked`는 두 파일을 같은 Flow에 유지해야 하는 강한 근거다.

- 테스트 파일명과 구현 파일명이 직접 대응하는 관계 (`matching_test_filename`)
- package manifest와 lockfile 관계 (`package_lock_manifest`)

`hint`는 관계 표시에 사용할 수 있지만 Flow 경계를 강제하지 않는다.

- 상대 경로 import로 확인된 관계 (`relative_import:*`)
- 파일 경로가 문자열로 언급된 관계 (`explicit_file_reference`)
- 식별자 일부가 겹친 관계 (`shared_identifier:*`)

상대 import는 강한 관계 근거지만 여러 기능이 공유 파일 하나를 import할 때 서로 다른 작업 흐름을 다시 하나로 합칠 수 있다. 또한 현재 검출은 patch 문자열 기반이므로 Flow membership을 잠그지는 않고 high-confidence hint로 사용한다.

규칙 기반 Flow 후보는 `locked` 관계만 union해 만든다. 고립된 파일은 기존처럼 fallback 후보에 모을 수 있다. 이 후보는 AI에게 참고 정보와 deterministic fallback으로 제공할 뿐 AI 출력 membership의 고정 틀이 아니다. Prompt에는 `locked` 연결 요소를 같은 Flow에 유지하고 `hint`는 분류 참고 자료로만 사용한다는 정책을 명시한다.

## 2. AI Flow 출력 계약

v2 Flow 출력은 입력 후보 key를 되돌려주지 않는다. 변경 파일이 있으면 AI는 모든 변경 파일을 대상으로 1개 이상, 최대 8개의 Flow를 반환한다. 변경 파일이 0개면 빈 Flow 배열을 허용하고 App Server가 기존 빈 PR fallback Flow를 만든다.

```ts
type SemanticFlowOutputV2 = {
  title: string;
  description: string;
  reviewOrder: string[];
};
```

App Server가 보장할 조건은 다음과 같다.

- 입력 파일이 전체 Flow의 `reviewOrder`에 정확히 한 번씩 나타난다.
- 빈 Flow, 알 수 없는 파일, 중복 파일, 누락 파일은 허용하지 않는다.
- 하나의 `locked` 연결 요소에 속한 파일은 서로 다른 Flow로 나뉘지 않는다.
- 제목과 설명은 기존 길이 제한을 유지한다.
- Flow 수는 `min(8, changed file count)`를 넘지 않는다.

검증 후 App Server는 정렬된 membership의 SHA-256 digest로 내부 `candidateKey`를 만든다. 이 key는 DB schema가 아니라 결과 저장 과정에서 Flow와 membership/relation을 연결하기 위한 내부 식별자다. 같은 membership은 재시도와 AI 출력 순서 변화에도 같은 key를 갖는다.

파일 역할 출력은 v1과 동일하게 모든 파일을 정확히 한 번 포함하며 잠긴 역할을 바꿀 수 없다. relation 출력도 기존 `candidateKey | null` 형식을 유지한다.

## 3. 검증 책임과 부분 fallback

App Server를 semantic graph의 최종 검증 권한으로 둔다. AI Worker는 strict structured output의 형태, 허용 enum, 알려진 file path처럼 전송 전에 확인 가능한 구조를 검사하지만 Flow의 최종 채택과 저장 가능 여부는 결정하지 않는다. v2 결과가 구조적으로 전달 가능하다면 locked group 분리나 relation의 cross-field 불일치만으로 Graph 전체를 제거하지 않고 App Server에 전달한다.

App Server는 아래 순서로 결과를 판정한다.

1. schema version, 파일 집합, 잠긴 역할을 검증한다.
2. Flow가 모든 파일을 정확히 한 번 포함하는지와 `locked` 연결 요소를 보존하는지 검증한다.
3. 유효한 Flow membership을 먼저 확정하고 내부 key를 만든다.
4. relation을 확정된 Flow 기준으로 검증한다.

기존 후보 relation을 보강한 출력은 `candidateKey`가 가리키는 후보와 endpoint·type이 정확히 같아야 한다. 새 AI relation은 `candidateKey = null`이어야 한다. self relation, 중복 relation, 알 수 없는 endpoint, 서로 다른 Flow를 잇는 relation은 저장하지 않는다. 서로 다른 Flow로 나뉜 hint relation은 분류 근거로만 소비하고 Canvas edge로 표시하지 않는다.

`locked` relation은 AI가 relation 배열에서 생략해도 확정된 Flow 안에 규칙 relation으로 항상 합성한다. AI가 같은 후보를 정확히 보강하면 `hybrid`로 저장한다. relation 개수 제한은 deterministic 후보 Flow key가 아니라 확정된 v2 Flow membership의 파일 수와 순서를 기준으로 계산한다.

fallback 단위는 분리한다.

- version, 파일, 역할 또는 Flow 검증 실패: deterministic graph 전체를 사용한다.
- Flow는 유효하지만 relation 검증 실패: AI Flow와 역할은 유지하고 AI relation 전체만 폐기한다. 확정된 각 Flow 안에 동시에 포함되는 deterministic relation으로 대체한다.
- Graph 자체가 없는 v1 호환 결과: 기존 deterministic fallback을 사용한다.

운영 로그에는 파일 경로, patch, AI 원문을 남기지 않는다. `version`, `role_policy`, `file_membership`, `locked_group`, `flow`, `relation` 같은 안전한 category와 reason code만 기록한다. App Server fallback 로그는 전체 fallback인지 relation-only fallback인지 구분한다.

## 4. Worker/App Server 배포 호환성

AI Worker와 App Server parser는 v1과 v2를 모두 읽을 수 있게 유지한다. v1은 롤백 호환을 위해 기존 후보 생성기와 검증 규칙을 별도 경로로 보존한다. v2만 AI regrouping을 허용한다. Worker는 요청에서 받은 version을 분석 객체에 보존하고, v1 입력에는 v1 schema와 v1 결과를, v2 입력에는 v2 schema와 v2 결과를 반환한다.

안전한 배포 순서는 다음과 같다.

1. 배포 시작 전에 새 PR Review 분석 요청을 받지 않고 queue에 진행 중인 Job이 없는지 확인한다.
2. v1/v2를 모두 수용하는 AI Worker를 먼저 배포한다.
3. v1/v2 결과를 수용하고 새 입력에 v2를 보내는 App Server를 배포한다.
4. 두 runtime의 health와 대상 테스트를 확인한 뒤 PR Review 사용을 재개한다.

이번 배포 동안 PR Review를 사용하지 않는 운영 전제를 적용하므로 별도 capability negotiation이나 feature flag는 추가하지 않는다. 새 App Server를 구 Worker보다 먼저 배포하지 않는다. 별도 DB migration은 없으며 Frontend 배포 순서 의존성도 없다.

App Server와 Worker에는 동일한 v1/v2 conformance fixture를 각각 실행하는 테스트를 둔다. fixture는 입력 version 보존, 파일 전체 포함, locked group 분리 금지, candidate relation exact match, relation-only fallback과 문자열 길이·UTF-8 byte 제한을 검증한다.

## 5. 최초 Canvas 레이아웃

`workflowOrder`와 semantic relation의 역할을 분리한다.

- Flow 내부 파일을 `workflowOrder`, file path, stable ID 순으로 정렬하고 1번 파일을 layout start로 둔다.
- `review_order` relation은 추천 읽기 경로로만 표시하며 ELK rank에는 사용하지 않는다.
- semantic endpoint pair는 낮은 `workflowOrder`에서 높은 순서로 정규화해 ELK에 전달한다. 실제 relation 방향과 저장 값은 바꾸지 않는다.
- semantic incoming edge가 없는 root는 1번 start의 synthetic anchor로 연결한다.
- 1번 node에만 FIRST constraint를 적용하고 역할 우선순위는 rank에 사용하지 않는다.
- semantic relation이 없는 Flow만 1→2→3 review-order spine을 fallback으로 사용한다.
- 배치가 끝난 뒤 semantic relation은 node 아래쪽의 orthogonal lane으로 표시한다. 겹치지 않는 x 구간은 같은 lane을 재사용하고 lane 수를 제한하며, 사용한 route 높이를 다음 Flow의 시작 간격에 반영한다.
- 인접 `review_order` relation은 target이 오른쪽의 같은 행에 있을 때만 짧은 route를 사용하고, branch의 다른 행은 하단 lane을 사용한다.

따라서 역방향·순환 semantic relation이 있어도 1번 파일은 Flow의 가장 왼쪽에 남고, 2번 이후 파일은 semantic 관계의 branch와 depth에 따라 같은 rank에서 위아래로 나뉠 수 있다. 번호는 추천 읽기 순서이며 x 좌표의 강제 순서를 뜻하지 않는다.

이 레이아웃은 저장된 file node geometry가 없는 새 Review Canvas의 최초 materialization에만 자동 적용한다. 새 revision이 기존 room geometry를 재사용하는 정책은 바꾸지 않는다.

## 6. 기존 Canvas의 Flow 자동 정렬

Frontend의 `현재 Flow 자동 정렬`도 같은 원칙을 사용한다.

- graph node에 `workflowOrder`를 포함한다.
- pin되지 않은 node 사이의 semantic endpoint pair를 낮은 `workflowOrder`에서 높은 순서로 정규화해 Dagre에 전달한다.
- semantic root는 이동 가능한 첫 node의 synthetic start anchor로 연결한다.
- semantic relation이 없는 Flow만 movable node의 review-order spine을 fallback으로 사용한다.
- pin된 node는 이동하지 않는다.
- 사용자가 자동 정렬을 실행했을 때만 pin되지 않은 node 위치를 저장한다.

pin된 node가 리뷰 순서와 다른 위치에 있으면 pin 상태가 우선한다. 이 예외 때문에 기존 Canvas를 로드하는 것만으로 좌표를 자동 수정하지 않는다. semantic 관계가 있는 일반 Flow는 첫 movable node에서 시작해 branch 구조로 배치된다.

## 7. API 문서와 데이터 저장

공개 PR Review Canvas response shape와 DB schema는 바뀌지 않는다. 다음 문서 내용만 현재 계약에 맞게 갱신한다.

- internal handoff의 `graphSchemaVersion`과 v2 relation/Flow 형식
- App Server 최종 검증과 relation-only fallback
- Worker-first 배포 순서
- 최초 materialization과 Flow 자동 정렬의 relation-driven layout 및 review-order fallback 규칙

Flow 저장은 현재 `review_flows`, `review_flow_files`, `review_flow_relations`를 그대로 사용한다. DB에는 `review_file_id` 단독 unique constraint가 없으므로 파일당 하나의 Flow membership은 App Server의 전체 포함·중복 금지 검증과 단일 transaction 삽입이 보장한다.

## 8. 검증 범위

전체 monorepo 테스트는 실행하지 않는다. 아래 관련 테스트만 수행한다.

- App Server semantic candidate/validator/handoff 테스트
- AI Worker semantic graph parser·schema·processor 테스트
- App Server Canvas layout/materializer 테스트
- Frontend PR Review graph exploration 테스트
- 변경된 패키지의 최소 typecheck 또는 build 검증

핵심 회귀 사례는 다음과 같다.

- `shared_identifier` 관계가 있어도 AI가 두 Flow로 분리할 수 있다.
- 상대 import 또는 test/implementation 쌍은 서로 다른 Flow로 나눌 수 없다.
- AI relation만 잘못되면 AI가 만든 Flow는 유지된다.
- Worker가 수용한 v2 결과를 App Server가 validator 차이 때문에 전체 폐기하지 않는다.
- v1 입력은 새 Worker에서도 v1 schema와 v1 결과로 유지된다.
- membership hash key를 쓰는 v2 Flow에서도 유효한 relation이 개수 제한 과정에서 제거되지 않는다.
- 역방향·순환 semantic relation이 있어도 1번 파일이 시작점에 남고 semantic sibling이 같은 depth로 분기된다.
- semantic relation이 없는 Flow는 최초 배치와 자동 정렬에서 1→2→3 fallback을 유지한다.
- relation이 많은 Flow에서도 semantic route가 Flow 제목이나 다음 Flow와 겹치지 않는다.
- 고정 node는 자동 정렬에서 이동하지 않는다.

## 위험과 대응

- AI가 지나치게 많은 Flow를 만들 수 있다: 최대 8개와 파일 전체 포함 검증으로 제한한다.
- 강한 관계 규칙이 잘못 연결될 수 있다: `locked`는 명시적 test 대응과 manifest/lockfile처럼 보수적인 allowlist에만 적용하고 상대 import는 hint로 둔다.
- Worker/App Server 배포 순서가 뒤집힐 수 있다: 문서와 PR 배포 영향에 Worker-first 순서를 명시하고 두 runtime 모두 v1 parser를 유지한다.
- 기존 사용자의 배치가 달라질 수 있다: 저장 좌표는 자동 변경하지 않고 새 Canvas 또는 명시적 자동 정렬에만 적용한다.
