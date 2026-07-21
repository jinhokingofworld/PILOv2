# SQLtoERD Agent latency 관측 Runbook

## 목적

단일 `focus_sql_erd_tables` 요청의 Router, Planner, App Server 혼합 resolver와
Frontend 적용 전까지의 서버 지연을 구간별로 확인한다. 공개
`inspect_sql_erd_schema`와 inspect 이후 Router bypass는 hard cutover로 제거됐다.

## 기록 범위

AI Worker는 다음 stage를 기록한다.

- `queue_wait`: DB clock 기준 planning job 대기 시간
- `router`: capability Router 호출과 출력 검증
- `planner`: focus tool 선택과 입력 생성
- `execution_handoff`: App Server 내부 실행 handoff
- `planning_turn`: 한 planning job의 전체 Worker 처리

App Server는 다음 stage를 기록한다.

- `tool_preparation`: tool schema와 SQLtoERD context 검증
- `tool_execution`: session inspection, 혼합 resolver, FK 확장과 resource 생성
- `tool_advance`: tool 결과 저장과 상태 전이
- `tool_turn`: 준비부터 상태 전이까지의 전체 tool 처리

이벤트는 `surface=sql_erd`, `tool_name=focus_sql_erd_tables`인 경로로 제한한다.
사용자 발화, feature query, SQL source/model, provider payload, raw UUID와 token은
기록하지 않는다. 같은 run의 이벤트는 SHA-256 앞 16자리 `trace_key`로만 연결한다.

## 공통 CloudWatch parse 절

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
| parse @message /"failure_detail":"(?<failure_detail>[^"]+)"/
| parse @message /"http_status":(?<http_status>[0-9]+)/
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

단일 요청의 `max_ms`로 병목을 확정하지 않고 같은 배포에서 여러 성공 요청의 p50,
p95와 표본 수를 함께 본다. deterministic table-name 요청과 LLM fallback이 필요한
한국어 기능명 요청은 별도 표본으로 측정한다.

## Provider token과 실패 taxonomy

Router/Planner token은 기존 `provider_*_tokens` 필드로 조회한다. App Server 내부
focus resolver의 provider payload나 token 원문은 기록하지 않는다. 실패 event의
`failure_type`은 `timeout`, `provider_error`, `validation_error`,
`repository_error`, `domain_error`, `unknown` 중 하나만 허용한다.

App Server 내부 focus resolver는 `stage=focus_resolver`에서 더 구체적인
`failure_detail`을 기록한다.

- `http_error`: provider가 2xx가 아닌 HTTP 응답을 반환했다. 이때만 허용 범위의
  `http_status`를 함께 기록한다.
- `network_error`: HTTP 응답을 받기 전에 연결 또는 전송이 실패했다.
- `timeout`: 설정된 resolver 제한 시간 안에 응답이 끝나지 않았다.
- `empty_output`: HTTP 응답은 성공했지만 읽을 수 있는 output text가 없었다.
- `json_parse_error`: provider 응답 envelope 또는 output text를 JSON으로 해석하지 못했다.
- `validation_error`: JSON은 해석됐지만 table ref나 필수 필드가 resolver 계약과 맞지 않았다.

사용자 발화, feature query, SQL source/model, schema projection, provider 응답 본문과
raw UUID는 이 event에 포함하지 않는다.

## 단일 요청 순서 확인

```text
| filter trace_key = "확인할 16자리 trace key"
| sort @timestamp asc
| display @timestamp, component, stage, outcome, elapsed_ms, tool_name
```

정상 집중 보기는 한 planning turn의 Router → Planner → execution handoff 뒤 App
Server의 focus tool execution과 advance로 끝나야 한다. 같은 trace에 두 번째 Router,
Planner 또는 `inspect_sql_erd_schema` event가 나타나면 이전 Worker/배포가 남아 있는지
확인한다.

## Dev smoke

1. dev SQLtoERD session의 새 Agent 대화에서 `payments 테이블만 집중해서 보여줘`처럼
   명시적 table 요청을 실행한다.
2. `회의 관련 핵심 테이블만 집중해서 보여줘`처럼 semantic fallback 요청도 실행한다.
3. 두 요청 모두 Router/Planner/focus가 한 turn으로 끝나고 focus resource가 현재
   session에 적용되는지 확인한다.
4. 모호한 요청은 resource나 confirmation 없이 구체화 질문으로 끝나는지 확인한다.
5. 요청 도중 model 또는 resolver가 실제로 본 canonical projection evidence를 변경한 경우 stale
   focus가 적용되지 않고, layout/annotation만 변경한 경우에는 최신 revision으로 적용되는지 확인한다.
6. 표본 event에 발화, feature query, raw UUID, SQL source/model, provider payload,
   token 원문이 없는지 확인한다.

브라우저 polling 완료부터 canvas focus 적용까지는 서버 계측 범위 밖이다. 서버 구간이
짧은데 체감 대기가 크면 별도 frontend performance mark를 추가한다.

## Rollback

focus 실패율, clarification 급증, 결과 불일치 또는 provider 장애 영향이 크면 해당
환경의 `AGENT_DOMAIN_SQL_ERD_READ_ENABLED=false`로 SQLtoERD read capability를
비활성화하고 재배포한다. 이 flag는 제거된 legacy inspect 체계로 되돌리지 않는다.
기능을 즉시 복원해야 하면 직전 배포 이미지로 rollback한다. DB schema, migration,
backfill은 없다.
