# SQLtoERD Agent 집중 보기 구간별 latency 계측 설계

## 배경

SQLtoERD에서 사용자가 특정 도메인의 테이블을 집중 보기로 요청하면 `inspect_sql_erd_schema`와 `focus_sql_erd_tables`가 서로 다른 planning turn에서 실행된다. 현재 `agent_runs`, `agent_steps`, `agent_run_outbox`의 시각으로 전체 소요 시간과 일부 단계는 추정할 수 있지만, Router, Planner, tool 준비, tool 실행, 다음 planning turn 전환을 각각 분리해서 비교할 수 없다.

따라서 병목을 추측한 채 Router 생략, prerequisite 서버 소유화, SQL 파싱 또는 DB 최적화, polling 개선을 먼저 적용하면 실제 사용자 대기 시간에 미치는 효과를 객관적으로 판단하기 어렵다. 이번 작업은 동작을 바꾸지 않고 집중 보기 경로의 기준 latency를 먼저 확보한다.

## 목표

- SQLtoERD 집중 보기 요청의 서버 구간을 일관된 stage로 측정한다.
- 동일 run의 여러 이벤트를 원본 식별자 없이 연결할 수 있게 한다.
- CloudWatch Logs Insights에서 stage별 p50, p95, 실패율과 token 사용량을 조회할 수 있게 한다.
- 계측 자체의 실패가 Agent 실행 결과와 상태 전이를 바꾸지 않게 한다.
- 이후 최적화 PR 전후를 같은 정의로 비교할 수 있는 기준선을 만든다.

## 비목표

- Router 생략 또는 `inspect_sql_erd_schema` prerequisite 자동 실행을 이번 PR에서 구현하지 않는다.
- SQL 파서, DB query, frontend polling 주기를 최적화하지 않는다.
- API request/response, DB schema, migration을 변경하지 않는다.
- frontend에서 최종 focus가 화면에 적용되는 시각을 서버 로그로 추정하지 않는다.
- 사용자 발화, tool payload, provider 응답 또는 원본 UUID를 관측 데이터에 저장하지 않는다.

## 측정 경계

이번 계측은 `surface = sql_erd`인 planning turn과 다음 두 tool을 대상으로 한다.

- `inspect_sql_erd_schema`
- `focus_sql_erd_tables`

다른 도메인 Agent 실행에는 새 latency 이벤트를 남기지 않는다. 공통 실행기를 수정하더라도 SQLtoERD surface/tool 조건에서만 observer를 호출한다. 이 범위는 로그 비용과 공통 경로 회귀 위험을 제한하면서 현재 최적화 순서에 필요한 근거를 제공한다.

## 이벤트 계약

AI Worker와 App Server는 JSON structured log에 `event = agent_latency`를 공통 표지로 사용한다. 필드는 다음과 같다.

| 필드 | 설명 |
| --- | --- |
| `event` | 고정값 `agent_latency` |
| `component` | `ai_worker` 또는 `app_server` |
| `stage` | 아래에 정의한 bounded stage |
| `outcome` | `success`, `failure`, `fallback`, `clarification` 중 하나 |
| `elapsed_ms` | monotonic clock으로 계산한 0 이상의 정수 |
| `trace_key` | run ID를 SHA-256으로 해시한 뒤 앞 16 hex만 사용한 비가역 상관 키 |
| `turn_sequence` | planning turn 순번. 알 수 없으면 생략 |
| `surface` | 고정값 `sql_erd` |
| `tool_name` | tool 단계인 경우 allow-list 값만 기록 |
| `retrieval_mode` | `shortlist`, `fallback`, `all_tools` 등 기존 bounded 분류값 |
| `provider_input_tokens` | provider usage가 있을 때만 기록하는 숫자 |
| `provider_output_tokens` | provider usage가 있을 때만 기록하는 숫자 |
| `provider_total_tokens` | provider usage가 있을 때만 기록하는 숫자 |
| `failure_type` | 실패 시 allow-list taxonomy만 기록 |

`trace_key`는 운영 상관관계 확인용이지 보안 식별자가 아니다. raw run ID, workspace ID, user ID, SQLtoERD session ID, candidate/context token을 같이 기록하지 않는다.

## Stage 정의

### AI Worker

- `queue_wait`: App Server가 planning job을 점유한 시각부터 AI Worker가 처리하기 시작한 시각까지. 서로 다른 프로세스 clock 차이를 피하기 위해 저장소 query에서 DB clock으로 계산한 값만 사용한다.
- `router`: Router provider 호출과 응답 검증이 끝날 때까지.
- `planner`: Planner provider 호출과 응답 검증이 끝날 때까지.
- `execution_handoff`: Planner가 tool call을 선택한 뒤 App Server execution queue에 전달할 상태를 영속화하기까지.
- `planning_turn`: Worker가 한 planning job을 처리하기 시작한 시점부터 최종 상태를 영속화할 때까지.

Router가 fallback되면 `router` 이벤트는 `outcome = fallback`으로 남긴다. Planner가 clarification으로 종료하면 `planner`와 `planning_turn`의 outcome을 `clarification`으로 남긴다. 예외는 bounded `failure_type`으로 분류한 뒤 기존 예외 흐름을 그대로 유지한다.

### App Server

- `tool_preparation`: tool step을 읽고 capability/prerequisite/권한 검증과 실행 입력 준비를 마칠 때까지.
- `tool_execution`: 기존 SQLtoERD domain service 호출 시간.
- `tool_advance`: tool 결과를 저장하고 다음 planning turn을 enqueue하거나 run을 완료할 때까지.
- `tool_turn`: execution job을 처리하기 시작한 시점부터 최종 상태 전이가 끝날 때까지.

App Server 계측은 기존 transaction과 상태 전이 바깥에서 별도 DB 쓰기를 만들지 않는다. timer와 structured logger만 사용하며, 로그 출력 실패는 catch하여 정상 결과를 훼손하지 않는다.

## 구현 구조

AI Worker에는 monotonic clock, trace key 생성, 허용 필드 필터링을 담당하는 작은 observer를 둔다. Router/Planner client의 반환 usage를 observer에 전달하되 provider payload 자체는 전달하지 않는다. queue wait는 repository가 DB에서 계산한 숫자만 context에 포함한다.

App Server에는 같은 이벤트 계약을 만드는 observer를 Agent module 내부에 둔다. execution processor는 기존 단계 경계를 감싸서 elapsed time만 전달한다. SQLtoERD tool allow-list 밖에서는 즉시 반환한다.

두 구현은 언어가 다르므로 formatter 코드를 공유하지 않는다. 대신 동일한 fixture와 privacy assertion을 각 테스트에 두어 필드 계약을 고정한다. 공통 package를 새로 만드는 것보다 중복되는 소량의 formatter가 배포 단위와 실패 경계를 명확하게 유지한다.

## 개인정보와 보안

다음 값은 정상·실패 로그 모두에서 금지한다.

- 사용자 원문 발화와 system/planner prompt
- SQL source, schema model, tool input/output payload
- user/workspace/session/run/step의 raw UUID
- access token, selection token, context token
- provider response body와 exception message

실패 원인은 `timeout`, `provider_error`, `validation_error`, `repository_error`, `domain_error`, `unknown`처럼 고정된 taxonomy로만 남긴다. 테스트는 금지 필드 이름뿐 아니라 fixture에 넣은 sentinel 값이 serialized event에 포함되지 않는지도 확인한다.

## 실패 처리

- observer는 로그 직렬화 또는 logger 호출 실패를 외부로 전파하지 않는다.
- timer는 wall clock이 아니라 monotonic clock을 사용한다.
- 부분 실패 시 이미 끝난 stage 이벤트는 유지하고 실패한 stage는 `failure`로 남긴다.
- retry가 발생하면 같은 `trace_key`와 각 planning turn의 `turn_sequence`로 구분한다.
- 계측을 제거하거나 되돌려도 Agent DB 상태와 API 계약에는 영향이 없다.

## CloudWatch 조회

운영 문서에는 최소한 다음 Logs Insights 조회를 제공한다.

1. `surface = sql_erd`의 stage별 count, p50, p95, max latency
2. `inspect_sql_erd_schema`와 `focus_sql_erd_tables`의 tool 실행 p50/p95 비교
3. Router/Planner의 retrieval mode별 latency와 fallback 비율
4. planning turn별 provider token 합계와 p95
5. failure type별 건수

로그 그룹과 배포 환경은 기존 ECS/App Runner 로그 구성을 재사용한다. 새로운 외부 모니터링 서비스나 영속 테이블은 추가하지 않는다.

## 검증

### 자동 테스트

- fake monotonic clock으로 stage elapsed time을 결정적으로 검증한다.
- 같은 raw run ID가 같은 `trace_key`, 다른 ID가 다른 key를 만드는지 검증한다.
- raw UUID, prompt, token, payload sentinel이 serialized event에 없는지 검증한다.
- Router success/fallback/failure와 Planner success/clarification/failure를 검증한다.
- inspect/focus tool의 preparation/execution/advance 이벤트를 검증한다.
- 다른 surface와 다른 tool에서는 latency 이벤트가 생성되지 않는지 검증한다.
- logger가 예외를 던져도 기존 Agent 결과와 상태 전이가 유지되는지 검증한다.
- 기존 AI Worker와 App Server Agent 회귀 테스트를 실행한다.

### dev smoke

1. dev SQLtoERD session에서 새 Agent run으로 집중 보기 요청을 실행한다.
2. CloudWatch에서 같은 `trace_key`의 `router → planner → tool_preparation → tool_execution → tool_advance` 순서를 확인한다.
3. inspect 뒤 다음 planning turn과 focus 실행까지 이어지는지 확인한다.
4. stage별 `elapsed_ms`가 0 이상이고 token 수가 provider usage와 일치하는지 확인한다.
5. 로그에 raw 발화, UUID, SQL source, tool payload가 없는지 표본 검사한다.
6. 사용자 결과, tool resource ref, run 상태가 계측 전과 동일한지 확인한다.

브라우저 polling부터 canvas focus 적용까지의 client latency는 이번 서버 계측으로 확정할 수 없다. 이 구간은 dev smoke에서 별도로 기록하고, 후속 polling 개선 전에 frontend telemetry 또는 performance mark 도입 여부를 결정한다.

## 공통 영역과 운영 영향

실행 processor에 timer hook이 들어가므로 Agent 공통 실행 경로에 닿을 수 있다. 그러나 이벤트 생성 조건은 SQLtoERD surface/tool로 제한하고 API, 권한, confirmation, idempotency, transaction 순서는 변경하지 않는다. PR에서 App Server 공통 영역 여부를 다시 확인하고 Agent/SQLtoERD owner 검토 대상으로 표시한다.

운영 비용은 SQLtoERD 집중 보기 한 요청당 bounded JSON log 여러 건이다. cardinality가 높은 raw ID 대신 길이가 고정된 `trace_key`만 사용한다. 문제가 생기면 observer 호출을 되돌리는 것으로 rollback하며 DB/API 복구 작업은 필요 없다.

## 후속 작업의 판단 기준

최소한 dev에서 여러 성공 요청과 fallback/clarification 표본을 수집한 뒤 다음 순서를 결정한다.

1. inspect 이후 Router가 유의미한 비중이면 Router 생략을 검토한다.
2. 두 planning turn과 queue wait가 큰 비중이면 server-owned inspect prerequisite를 검토한다.
3. tool execution이 큰 비중이면 SQL 파싱/DB query profile을 세분화한다.
4. 서버 완료 뒤 UI 적용 대기가 크면 polling 개선을 검토한다.

각 후속 PR은 이 이벤트 계약의 동일 stage p50/p95를 전후 비교하며, 표본 수와 측정 환경을 함께 기록한다.
