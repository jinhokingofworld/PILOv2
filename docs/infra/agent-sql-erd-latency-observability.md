# SQLtoERD Agent latency 관측 Runbook

## 목적

SQLtoERD 집중 보기 요청에서 `inspect_sql_erd_schema`와
`focus_sql_erd_tables`가 완료되기까지의 서버 병목을 구간별로 확인한다.
계측은 동작을 바꾸지 않으며 AI Worker와 App Server의 기존 CloudWatch log
group을 사용한다.

## 기록 범위

AI Worker는 다음 stage를 기록한다.

- `queue_wait`: DB clock 기준 planning job 대기 시간
- `router`: Router 호출과 출력 검증
- `planner`: Planner 호출과 출력 검증
- `execution_handoff`: App Server 내부 실행 handoff
- `planning_turn`: 한 planning job의 전체 Worker 처리

App Server는 다음 stage를 기록한다.

- `tool_preparation`: tool 검증과 contextual preparation
- `tool_execution`: SQLtoERD domain service 실행
- `tool_advance`: tool 결과 저장과 다음 상태 전이
- `tool_turn`: 준비부터 상태 전이까지의 전체 tool 처리

이벤트는 `surface = sql_erd`이면서 `inspect_sql_erd_schema` 또는
`focus_sql_erd_tables`인 경로로 제한된다. 사용자 발화, SQL source/model,
tool/provider payload, raw UUID와 token은 기록하지 않는다. 같은 run의 이벤트는
SHA-256 결과 앞 16자리인 `trace_key`로만 연결한다.

## 공통 parse 절

NestJS와 Python logger prefix가 붙어도 조회할 수 있도록 JSON 내부의 bounded
field를 명시적으로 parse한다. 아래 절을 각 query의 앞부분으로 사용한다.

```text
fields @timestamp, @message
| parse @message /"event":"(?<latency_event>[^"]+)"/
| parse @message /"component":"(?<component>[^"]+)"/
| parse @message /"stage":"(?<stage>[^"]+)"/
| parse @message /"outcome":"(?<outcome>[^"]+)"/
| parse @message /"elapsed_ms":(?<elapsed_ms>[0-9]+)/
| parse @message /"trace_key":"(?<trace_key>[a-f0-9]+)"/
| parse @message /"surface":"(?<surface>[^"]+)"/
| parse @message /"tool_name":"(?<tool_name>[^"]+)"/
| parse @message /"retrieval_mode":"(?<retrieval_mode>[^"]+)"/
| parse @message /"failure_type":"(?<failure_type>[^"]+)"/
| filter latency_event = "agent_latency" and surface = "sql_erd"
```

## Stage별 기준선

공통 parse 절 뒤에 다음을 추가한다.

```text
| stats count(*) as samples,
        pct(elapsed_ms, 50) as p50_ms,
        pct(elapsed_ms, 95) as p95_ms,
        max(elapsed_ms) as max_ms
  by component, stage
| sort component asc, stage asc
```

최소한 성공 요청을 여러 번 수집한 뒤 p50과 p95를 함께 본다. 단일 요청의
`max_ms`만으로 병목을 확정하지 않는다.

## Inspect와 Focus tool 비교

공통 parse 절 뒤에 다음을 추가한다.

```text
| filter stage = "tool_execution" and ispresent(tool_name)
| stats count(*) as samples,
        pct(elapsed_ms, 50) as p50_ms,
        pct(elapsed_ms, 95) as p95_ms,
        max(elapsed_ms) as max_ms
  by tool_name
| sort p95_ms desc
```

`inspect_sql_erd_schema`가 크면 session/model projection과 DB 조회를,
`focus_sql_erd_tables`가 크면 fingerprint/FK 검증과 focus resource 생성 경로를
후속 profile 대상으로 삼는다.

## Router fallback과 latency

공통 parse 절 뒤에 다음을 추가한다.

```text
| filter stage = "router"
| stats count(*) as samples,
        pct(elapsed_ms, 50) as p50_ms,
        pct(elapsed_ms, 95) as p95_ms
  by retrieval_mode, outcome
| sort retrieval_mode asc, outcome asc
```

inspect 이후 두 번째 planning turn에서도 Router 비중이 크고 fallback이 낮다면
후속 Router 생략 실험의 후보가 된다. fallback 또는 clarification이 많다면
latency만 보고 Router를 제거하지 않는다.

## Inspect 이후 Router 생략 실험

`AGENT_SQL_ERD_INSPECT_FOCUS_ROUTER_BYPASS_ENABLED`는 기본값이 `false`다.
`true`로 설정해도 다음 조건을 모두 만족하는 요청만 두 번째 Router를 생략한다.

- retrieval mode가 `llm_router`이고 surface가 `sql_erd`다.
- 직전 Planner가 bounded inspect continuation을 명시했다.
- 저장된 Planner와 inspect tool step이 인접하고 현재 outbox 사유가 `tool_result`다.
- 직전 inspect 결과에 유효한 table projection이 있다.
- focus continuation이면 현재 tool snapshot에도 `focus_sql_erd_tables`가 있다.
- routed workflow의 terminal tool이 focus 하나뿐이고 다른 capability 목표가 없다.

하나라도 맞지 않으면 오류나 별도 clarification을 만들지 않고 기존 Router 경로로
돌아간다. Router만 생략하며 Planner 출력 검증, App Server 권한·revision·fingerprint
검증과 tool 실행 경로는 그대로 유지한다.

배포할 때는 SQLtoERD Agent planning job을 처리하는 모든 AI Worker 인스턴스에 같은
값을 설정한다. 일부 인스턴스에만 켜면 요청마다 trace 모양과 latency가 달라져 비교
표본이 오염된다. 기본 disabled 상태로 배포한 뒤 dev smoke를 통과한 경우에만 Infra/
Realtime 담당자 확인을 받아 dev에서 활성화한다.

## Provider token 사용량

AI Worker log group에서 다음 query를 사용한다.

```text
fields @timestamp, @message
| parse @message /"event":"(?<latency_event>[^"]+)"/
| parse @message /"surface":"(?<surface>[^"]+)"/
| parse @message /"stage":"(?<stage>[^"]+)"/
| parse @message /"provider_input_tokens":(?<input_tokens>[0-9]+)/
| parse @message /"provider_output_tokens":(?<output_tokens>[0-9]+)/
| parse @message /"provider_total_tokens":(?<total_tokens>[0-9]+)/
| filter latency_event = "agent_latency"
    and surface = "sql_erd"
    and stage in ["router", "planner"]
| stats count(*) as samples,
        sum(input_tokens) as input_tokens,
        sum(output_tokens) as output_tokens,
        pct(total_tokens, 95) as p95_total_tokens
  by stage
```

token 수는 provider가 usage를 반환한 이벤트에만 존재한다. `samples`가 실제
요청 수와 다른 경우 누락을 0 token으로 해석하지 않는다.

## 실패 taxonomy

공통 parse 절 뒤에 다음을 추가한다.

```text
| filter outcome = "failure"
| stats count(*) as failures by component, stage, failure_type
| sort failures desc
```

`failure_type`은 `timeout`, `provider_error`, `validation_error`,
`repository_error`, `domain_error`, `unknown` 중 하나다. exception message나
provider response는 저장하지 않으므로 상세 원인 확인은 같은 배포 시각의 기존
운영 log와 코드 상태를 함께 본다.

## 단일 요청 순서 확인

최근 시간 범위에서 공통 parse 절 뒤에 다음을 추가해 trace 후보를 찾는다.

```text
| sort @timestamp desc
| limit 100
```

확인할 `trace_key`를 정한 뒤 다음 조건을 추가한다.

```text
| filter trace_key = "확인할 16자리 trace key"
| sort @timestamp asc
| display @timestamp, component, stage, outcome, elapsed_ms, tool_name
```

flag가 꺼진 정상 집중 보기 요청은 첫 planning turn의 Router/Planner/inspect tool과
다음 planning turn의 Router/Planner/focus tool이 같은 `trace_key`로 이어진다. flag가
켜지고 continuation 검증에 성공하면 두 번째 planning turn에는 Router stage가 없고
Planner/focus tool만 이어진다. fallback 요청에는 기존처럼 두 번째 Router stage가
남아 있어야 한다. retry는 AI Worker 이벤트의 `turn_sequence`로 구분한다.

## Dev smoke

1. flag를 끈 상태에서 dev SQLtoERD session의 새 채팅으로 특정 기능 테이블 집중
   보기를 요청하고 기존 두 Router trace를 기준선으로 남긴다.
2. 모든 AI Worker 인스턴스에서 flag를 켠 뒤 같은 유형의 새 요청을 수행한다.
3. AI Worker와 App Server log group의 최근 5분 범위에서 `agent_latency`를 찾는다.
4. 같은 `trace_key`에서 첫 Router/Planner/inspect 뒤 두 번째 Router 없이
   Planner/focus가 이어지는지 확인한다.
5. inspect projection이 유효하지 않은 요청 등 fallback 표본에서는 두 번째 Router가
   남아 있는지 확인한다.
6. 모든 `elapsed_ms`가 0 이상이고 Router/Planner의 token 수가 provider usage가
   있는 경우에만 기록되는지 확인한다.
7. 표본 event에 사용자 발화, raw UUID, SQL source/model, tool/provider payload,
   token 원문이 없는지 확인한다.
8. 사용자에게 표시되는 답변, focus resource link와 run terminal 상태가 flag OFF와
   동일한지 확인한다.

브라우저 polling 완료부터 canvas focus 적용까지는 이번 서버 계측 범위 밖이다.
이 구간은 polling 개선 착수 전에 browser performance mark 또는 별도 frontend
telemetry의 필요성을 결정한다.

## 해석과 후속 순서

1. inspect 이후 Router 비중이 크면 Router 생략을 검토한다.
2. queue와 두 planning turn 비중이 크면 server-owned inspect prerequisite를
   검토한다.
3. tool execution 비중이 크면 SQL 파싱과 DB query를 내부 stage로 세분화한다.
4. 서버 구간이 짧은데 체감 대기가 크면 polling과 UI 적용 구간을 측정한다.

최적화 PR은 동일 stage 정의와 같은 dev 조건에서 변경 전후 p50/p95, 표본 수를
함께 기록한다. 표본이 적거나 배포 부하 조건이 다르면 성능 개선으로 단정하지
않는다.

## Rollback

집중 보기 실패율, fallback 증가, Planner validation 오류 또는 결과 불일치가 보이면
모든 AI Worker 인스턴스에서
`AGENT_SQL_ERD_INSPECT_FOCUS_ROUTER_BYPASS_ENABLED=false`로 되돌리고 재배포한다.
다음 요청부터 기존 Router → Planner → inspect → Router → Planner → focus 경로를
사용한다. 이 기능은 API, DB schema나 별도 continuation 저장소를 추가하지 않으므로
데이터 복구와 backfill은 필요 없다. flag rollback 뒤에도 문제가 남을 때만 PR revert를
검토한다.
