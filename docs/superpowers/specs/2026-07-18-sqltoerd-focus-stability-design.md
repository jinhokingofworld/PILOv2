# SQLtoERD 집중 보기 안정화 설계

## 목적

대형 SQLtoERD 스키마를 Agent가 조회한 뒤 집중 보기를 생성할 때 `primaryTableRefs is invalid`로 실패하는 문제를 해결한다. 동시에 SQLtoERD 캔버스의 connector port가 모바일 터치 환경에서 선택하지 않은 테이블까지 노출되는 문제를 보정한다.

집중 보기의 동시성 검증은 세션 전체 revision이 아니라 ERD 모델의 의미적 변경만 감지해야 한다. 최신 `dev`에 도입된 `modelFingerprint` 검증을 기준으로 삼고, 레이아웃 이동과 같은 비의미적 revision 증가가 집중 보기를 차단하지 않는지 회귀 테스트로 고정한다.

## 원인

### Planner 컨텍스트의 비구조적 절단

App Server의 `inspect_sql_erd_schema` 결과는 최대 약 9,000자의 compact projection을 반환할 수 있다. AI Worker는 완료된 Tool 결과를 JSON 문자열로 직렬화한 뒤 개별 결과를 3,000자에서 단순 절단하고, 전체 planning context도 앞에서부터 12,000자로 다시 절단한다.

이 방식은 다음 문제를 만든다.

- JSON 객체가 문자열 중간에서 잘려 유효하지 않게 된다.
- projection 뒤쪽의 table ref와 FK 정보가 사라진다.
- Planner가 찾으려는 테이블을 보지 못해 비어 있거나 잘못된 `primaryTableRefs`를 생성할 수 있다.
- AI Worker의 현재 정규화는 필수 필드 존재 여부만 확인하므로 잘못된 값이 App Server까지 전달되고, 최종적으로 `primaryTableRefs is invalid`가 사용자에게 노출된다.

### 모바일 hover 상태의 connector port 노출

테이블과 컬럼 connector port의 비활성 상태는 Tailwind `group-hover`에 의존한다. 터치 에뮬레이션이나 coarse pointer 환경에서는 탭 이후 CSS hover가 고정된 것처럼 유지될 수 있어 선택하지 않은 테이블의 port까지 노출될 수 있다.

콘솔의 `Unable to preventDefault inside passive event listener invocation` 경고는 tldraw 내부 touch handler가 passive listener 안에서 `preventDefault()`를 호출해 발생한다. connector port 표시 로직과 직접적인 원인은 다르며, 현재 터치 기능은 정상 동작한다. 최신 tldraw에도 같은 호출이 남아 있으므로 이번 작업에서는 공통 Canvas 동작에 영향을 줄 수 있는 의존성 패치를 하지 않는다.

## 설계

### 1. 구조 보존형 planning context

AI Worker의 완료 Tool 결과 직렬화를 Tool-aware 방식으로 변경한다.

- `inspect_sql_erd_schema` 성공 결과는 projection 전체를 유효한 JSON 단위로 보존한다.
- 결과 문자열을 임의 문자 위치에서 자르지 않는다.
- 전체 context budget을 계산할 때 최신 완료 결과와 다음 Tool 선택에 필요한 inspect 결과를 우선 보존한다.
- 일반 Tool 결과에는 기존의 작은 예산을 유지하되, 객체/배열 경계가 깨지지 않는 요약 표현을 사용한다.
- 최종 planning context가 전체 예산을 초과하면 오래된 항목부터 제외하고, 포함한 항목은 항상 완전한 JSON으로 유지한다.

이 변경은 모델 입력 컨텍스트 구성에만 적용한다. Agent step 저장 형식과 App Server Tool 결과 계약은 변경하지 않는다.

### 2. `primaryTableRefs` 방어 검증

AI Worker가 `focus_sql_erd_tables` Tool 호출을 정규화할 때 다음 조건을 검증한다.

- `primaryTableRefs`가 배열이다.
- 1개 이상이며 계약상 최대 개수를 넘지 않는다.
- 각 항목이 inspect projection의 compact ref 형식인 `tN`이다.
- 중복 값은 허용하지 않는다.

검증 실패 시 잘못된 Tool 호출을 App Server로 보내지 않는다. Planner가 확인 가능한 inspect 결과가 없으면 schema inspect를 먼저 선택하고, inspect 결과가 있는데도 입력이 유효하지 않으면 사용자에게 범위를 다시 구체화하도록 안내하는 안전한 결과로 종료한다. App Server의 기존 권한·fingerprint·compact ref 검증은 최종 보안 경계로 유지한다.

### 3. 모델 변경 기준 동시성 검증

최신 `dev`의 `modelFingerprint` 계약을 유지한다.

- inspect 결과에 당시 모델 fingerprint를 포함한다.
- focus 실행 직전에 현재 session 모델 fingerprint와 비교한다.
- table/column/relation 의미가 바뀐 경우에만 stale 결과로 거부한다.
- table 위치 이동처럼 layout만 바뀌어 revision이 증가한 경우에는 현재 revision으로 focus metadata를 생성한다.

stale 오류 문구는 실제 판정 기준과 맞게 “session revision changed”가 아니라 ERD 모델이 변경되었음을 설명한다.

### 4. pointer 특성별 connector port 정책

port 표시 정책을 입력 장치에 맞게 명시적으로 분리한다.

- fine pointer와 hover 지원 환경: 기존처럼 해당 테이블 또는 컬럼 hover, keyboard focus, 명시적 선택 시 표시한다.
- coarse pointer 또는 hover 미지원 환경: CSS hover만으로 표시하지 않고 현재 선택한 테이블 또는 컬럼의 port만 표시한다.
- 선택하지 않은 테이블의 port는 `pointer-events: none`과 `opacity: 0`을 유지한다.
- focus view에서 dim 처리된 table/column은 기존처럼 상호작용할 수 없다.

표시 조건은 SQLtoERD feature 컴포넌트 내부에 둔다. 공통 tldraw CSS, 공통 Canvas 설정, 의존성 lockfile은 변경하지 않는다.

## 데이터 흐름

1. Planner가 `inspect_sql_erd_schema`를 호출한다.
2. App Server가 compact refs, FK graph, `modelFingerprint`를 포함한 projection을 반환한다.
3. AI Worker가 결과를 완전한 JSON으로 planning context에 보존한다.
4. Planner가 projection에 존재하는 refs로 `focus_sql_erd_tables`를 구성한다.
5. AI Worker가 `primaryTableRefs` 형식과 개수를 방어 검증한다.
6. App Server가 workspace 접근 권한, 현재 `modelFingerprint`, refs와 FK 연결을 다시 검증한다.
7. Frontend가 resource metadata를 받아 집중 보기를 표시한다.

## 오류 처리

- inspect 결과 없음: focus를 시도하지 않고 inspect 단계로 유도한다.
- 비어 있거나 잘못된 primary refs: App Server 400을 그대로 노출하지 않고 사용자가 범위를 구체화할 수 있는 안내로 종료한다.
- 실제 ERD 모델 변경: stale focus 생성을 거부하고 schema를 다시 확인하도록 안내한다.
- layout-only revision 변경: focus를 허용하며 최신 session revision을 metadata에 사용한다.
- malformed focus metadata: Frontend는 기존처럼 payload를 폐기하고 일반 session 화면을 유지한다.

## 테스트

### AI Worker

- 9,000자에 가까운 inspect projection이 유효한 JSON으로 다음 Planner turn에 전달되는지 검증한다.
- 뒤쪽 table ref를 대상으로 `inspect → focus`가 성공하는지 검증한다.
- 빈 배열, 문자열, 중복, 잘못된 compact ref의 `primaryTableRefs`가 App Server 호출로 전달되지 않는지 검증한다.
- 일반 Tool 결과의 context budget이 무제한으로 증가하지 않는지 검증한다.

### App Server

- inspect 이후 layout revision만 증가해도 focus가 성공하고 최신 revision을 반환하는지 검증한다.
- table/column/relation 의미가 바뀌어 fingerprint가 달라지면 focus가 거부되는지 검증한다.
- stale 오류 문구가 모델 변경 기준과 일치하는지 검증한다.

### Frontend

- fine pointer 환경에서 hover 및 선택 시 connector port가 표시되는지 검증한다.
- coarse pointer 환경에서 선택하지 않은 테이블과 컬럼의 port가 숨겨지는지 검증한다.
- coarse pointer 환경에서 선택한 테이블 또는 컬럼의 port는 사용할 수 있는지 검증한다.
- focus view의 dimmed 요소가 connector target이 되지 않는 기존 동작을 회귀 검증한다.

## 문서 영향

- `docs/api/agent-api.md`: inspect 결과의 `modelFingerprint`, focus의 stale 판정 기준, 잘못된 primary ref의 방어 처리 설명을 현재 구현과 일치시킨다.
- `docs/api/sqltoerd-api.md`: 집중 보기가 layout revision과 독립적인 일시적 view라는 점을 확인하고 필요한 경우 문구를 보정한다.
- API endpoint, request/response 필드, status code는 변경하지 않는다.
- DB schema와 migration은 변경하지 않는다.

## 비범위

- tldraw 패키지 소스 패치 또는 버전 업그레이드
- 기능 장애가 없는 passive listener 콘솔 경고의 강제 억제
- connector port 디자인 변경
- focus 상태의 DB 저장 또는 URL 공유
- 2단계 이상 FK 자동 확장

