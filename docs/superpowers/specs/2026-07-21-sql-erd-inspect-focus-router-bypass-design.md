# SQLtoERD inspect 이후 Router 생략 설계

## 목적

SQLtoERD 집중 보기의 정상 흐름에서 `inspect_sql_erd_schema`가 성공한 뒤
`focus_sql_erd_tables`를 계획하는 두 번째 turn의 LLM Router 호출을 생략한다.
첫 Router가 측정상 p50 약 1.4초, p95 약 3.9초이므로, 안전 경계를 유지하면서
요청당 Router 호출을 두 번에서 한 번으로 줄이는 것이 목표다.

## 현재 문제

현재 `sql_erd.inspect` capability는 inspect와 focus를 하나의 chain으로 제공한다.
따라서 두 번째 turn도 Router가 원래 요청을 다시 분류한 다음 Planner에 focus만
전달한다. 단순히 최신 tool 이름이 inspect라는 이유로 Router를 생략하면, 사용자가
스키마 설명만 요청한 경우에도 focus를 실행할 수 있다.

## 선택한 설계

첫 Planner가 inspect를 선택할 때 provider schema의 bounded
`continuationKind`로 다음 목적을 명시한다.

- `sql_erd_inspect_focus`: 정상 projection 뒤 focus를 실행한다.
- `sql_erd_inspect_complete`: 정상 projection을 사용해 답변만 완료한다.
- `null`: continuation을 저장하지 않고 기존 Router 경로를 사용한다.

이 필드는 전용 feature flag가 켜진 SQLtoERD inspect 계획에만 provider schema와
prompt에 추가한다. flag가 꺼지면 기존 provider request, 저장 결과와 Router 호출
흐름을 그대로 유지한다.

정규화된 Planner step에는 다음 bounded internal continuation만 저장한다.

```json
{
  "kind": "sql_erd_inspect_focus",
  "prerequisiteToolName": "inspect_sql_erd_schema",
  "nextToolName": "focus_sql_erd_tables"
}
```

사용자 발화, SQL, projection, session ID는 continuation에 넣지 않는다.

## 재개 검증

AI Worker repository는 새 table 없이 기존 `agent_steps`와
`agent_run_outbox`에서 최신 completed Planner/tool step의 bounded metadata를
읽는다. Router bypass는 다음 조건을 모두 만족할 때만 허용한다.

1. `AGENT_SQL_ERD_INSPECT_FOCUS_ROUTER_BYPASS_ENABLED=true`
2. retrieval mode가 `llm_router`
3. request context surface가 `sql_erd`
4. 최신 Planner output의 continuation kind와 tool 이름이 허용 목록과 일치
5. 최신 completed tool이 inspect이고 Planner 바로 다음 step
6. 현재 outbox reason이 `tool_result`
7. planning context의 최신 inspect output이 clarification이 아닌 정상
   `projection.tables` 결과
8. focus continuation이면 현재 eligible tool에 focus가 존재
9. routed workflow의 terminal tool이 focus 하나뿐이며 다른 capability 목표가 없음

하나라도 실패하면 기존 Router 흐름으로 돌아간다. continuation은 prompt 문자열이나
tool 이름 하나만으로 복원하지 않는다.

## Bypass 이후 Planner 입력

- focus continuation: Planner tool set을 `focus_sql_erd_tables` 하나로 제한하고
  기존 workflow constraint로 focus만 선택하게 한다.
- inspect-complete continuation: tool set을 비우고 완료된 inspect 결과를 근거로
  최종 답변만 생성하게 한다.

두 경우 모두 Planner output validation과 turn limit은 유지한다. focus 실행은 기존
App Server handoff를 그대로 사용하므로 compact ref, projection evidence, revision,
model fingerprint, Workspace membership과 권한 재검증을 우회하지 않는다.

## Feature flag와 rollback

`AGENT_SQL_ERD_INSPECT_FOCUS_ROUTER_BYPASS_ENABLED`의 기본값은 `false`다.
코드 배포만으로 동작은 바뀌지 않는다. dev 활성화는 Infra owner가 AI Worker와
Agent Worker 환경값을 함께 반영한 뒤 task를 rollout한다. 문제가 생기면 flag를
`false`로 되돌려 기존 두 번 Router 흐름으로 복구한다. DB/API cleanup은 없다.

## 관측과 검증

정상 focus 요청은 첫 turn에만 `router` stage가 있고, 두 번째 turn에는
`planner`, `execution_handoff`, `planning_turn`만 있어야 한다. 같은 조건에서
최소 10회 실행해 Router 호출 수, 전체 planning turn p50/p95, focus 성공률,
clarification/conflict 비율을 변경 전과 비교한다.

자동 회귀는 정상 focus bypass, inspect-only completion, flag OFF, invalid
continuation/projection, intervening state, focus 부재를 포함한다. App Server의 기존
focus validation 테스트는 변경하지 않고 계속 통과시킨다.

## 범위 밖

- server-owned inspect 실행
- SQL projection 파싱 또는 DB query 최적화
- Frontend polling과 canvas 적용 시간 계측
- public API 또는 DB schema 변경
