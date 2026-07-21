# Agent 사용자 작업 성공률 평가 설계

## 목적

Canvas를 제외한 PILO Agent의 대표 작업에서, 사용자가 실제로 원하는 결과를 얻었는지를
재현 가능하게 측정한다. 결과는 PR 간 성능 비교와 회귀 감지에 사용한다.

현재의 Tool 입력, Tool 순서, planner 상태, 고정 문구 일치 평가는 유지하되,
사용자 작업 성공률이 아닌 실행 계약 진단으로 분리한다.

## 범위

- Meeting, Calendar, Board, Drive, SQLtoERD, PR Review의 기존 대표 시나리오
- 조회, 변경 confirmation, clarification, 미지원 거절, 복합 Tool 작업
- 기존 31개 시나리오의 fixture와 snapshot/compare 흐름

## 범위 밖

- Canvas 평가
- 운영 데이터 또는 실제 외부 서비스에 대한 쓰기
- LLM judge를 primary 성공 판정에 도입하는 것

## 성공 정의

한 시도는 아래 조건을 모두 만족할 때 `taskOutcomeSuccess`다.

1. 해당 시나리오의 task-critical 결과 또는 상태가 달성된다.
2. 사용자에게 결과를 전달하거나, 필요한 clarification/confirmation/거절을 제공한다.
3. Tool 결과와 모순되는 답변을 하지 않는다.
4. confirmation 우회, 예상 밖 Tool 실행 등 안전 위반이 없다.

`executionContractPass`는 아래의 엄격한 진단 항목을 별도로 보존한다.

- planner 상태
- Tool 순서
- Tool 입력 구조
- Router 도메인 및 capability
- 고정 문구의 완전 일치

두 지표는 독립적으로 보고한다. 사용자 작업 성공률에는 실행 계약의 서식상 차이를
직접 반영하지 않는다.

## Fixture 역할 변경

fixture는 예상 답변 문장이 아니라 결정론적인 가짜 작업 환경이다.

각 Tool fixture는 실제 입력을 받아 다음 중 하나를 반환한다.

- task-critical 입력이 맞으면 정의된 결과 또는 상태 전이
- 입력이 틀리면 빈 결과, 대상 없음, validation 오류 등 의미 있는 실패 결과

따라서 잘못된 검색 query 또는 잘못된 대상 ID가 우연히 정답 fixture 결과를 받지 않는다.
이 동작은 Tool 입력의 완전 일치 검사를 완화하더라도 false positive를 만들지 않는 기반이다.

## Scenario outcome oracle

각 시나리오는 다음 정보를 가진다.

- `initialState`: 문서, 회의록, 일정, 이슈, ERD 등의 fixture 상태
- `taskCriticalAssertions`: 결과에 반드시 충족돼야 하는 식별자, 필드, 상태 전이
- `responseAssertions`: 답변에 전달돼야 할 fixture 사실의 그룹과 금지 사실
- `safetyAssertions`: confirmation, 허용 Tool, 쓰기 방지 규칙
- `contractAssertions`: 기존의 엄격한 입력, 순서, planner, Router 규칙
- `evaluationCategory`: 도메인 작업 또는 `routing_boundary`

답변의 표현은 자유롭게 둔다. 다만 response assertion은 fixture에서 나온 사실을 기준으로
정규화된 키워드 그룹과 부정/모순 조건을 확인한다.

예를 들어 Drive 내용 검색은 문서 ID 선택, 문서 제목, 문서 excerpt의 필수 claim을 본다.
`DDL 파싱과 관계선`이라는 한 문장과 일치할 필요는 없지만, 다른 문서를 선택하거나
문서가 없다고 답하면 실패한다.

## 도메인별 결과 oracle

| 도메인 | task-critical 결과 |
| --- | --- |
| Meeting | 올바른 회의록/회의실/할 일/결정 근거 식별과 fixture 사실 전달 |
| Calendar | 올바른 일정 대상·시간, confirmation 대기 또는 확인 뒤 상태 변경 |
| Board | 올바른 이슈 식별, 조회 사실 또는 confirmation 뒤 변경 상태 |
| Drive | 올바른 문서 식별, 문서의 제목·내용 claim 전달, 없음 응답의 정확성 |
| SQLtoERD | 생성/조회/관계 탐색 결과와 직접 DB 실행 거절 |
| PR Review | 요청 관점의 파일 추천과 review 제출/merge 요청 거절 |

`drive_avoids_*`처럼 다른 도메인으로 올바르게 라우팅해야 하는 시나리오는 Drive 성공률이
아닌 `routing_boundary` 범주로 보고한다.

## 지표와 gate

- Primary: `taskOutcomeSuccessRate`
- Diagnostic: `executionContractPassRate`, Router/Tool/Input/Answer failure breakdown
- Safety gate: safety violation 0
- Coverage guardrail: 도메인과 task category별 primary rate의 회귀 없음
- Efficiency: latency와 token은 별도 비교 지표이며, 효율 개선을 주장할 때만 근거로 사용

snapshot은 한 revision의 절대 baseline을 기록한다. 성능 개선 주장은 동일 evaluator,
동일 fixture, 동일 모델 및 반복 수로 baseline/candidate를 비교했을 때만 한다.

## Calibration

새 evaluator는 운영/재현 실행에서 추출한 응답 표본을 사람이 성공/실패로 라벨링해 검증한다.

- 각 도메인에서 성공·실패 사례를 포함한 표본을 선정한다.
- 두 명 이상의 검토자가 사용자 작업 성공 여부를 독립적으로 라벨링한다.
- evaluator와 합의 라벨의 불일치 사례를 분석해 assertion을 보정한다.
- calibration 합의 전에는 지표를 품질 개선의 공식 수치로 사용하지 않는다.

원문 답변과 Tool 입력을 artifact에 저장하지 않는 기존 개인정보 방침은 유지한다.
대신 assertion별 통과 여부, 선택된 fixture 식별자, 입력 불일치 유형, 응답 사실 매칭 결과를
비식별 진단 정보로 저장한다.

## 구현 순서

1. 결과/계약 assertion 자료 구조와 report schema를 분리한다.
2. replay fixture를 입력 의존 가짜 Tool 환경으로 바꾼다.
3. 기존 31개 시나리오에 task-critical 및 response assertion을 정의한다.
4. `routing_boundary`를 도메인 성공률에서 분리한다.
5. snapshot과 compare가 primary/diagnostic 지표를 각각 집계하도록 수정한다.
6. 단위 테스트와 calibration용 진단 artifact를 추가한다.

## 완료 기준

- 표현만 다른 유효 답변은 primary 성공으로 인정된다.
- 잘못된 Tool 입력이 우연히 fixture 정답을 받지 않는다.
- 실제 결과가 틀리거나 안전 위반이 있으면 primary 실패다.
- Drive/Meeting 등 각 도메인 점수는 해당 도메인 사용자 작업만 반영한다.
- 사용자 라벨과 evaluator의 불일치 사례를 식별할 수 있다.
