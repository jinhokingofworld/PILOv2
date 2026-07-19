# Agent 후속 도구 Workflow Constraint 설계

## 목표

SQL ERD 테이블 집중 보기 요청에서 `inspect_sql_erd_schema`가 완료됐다는 이유만으로 플래너가 전체 요청을 `completed`로 종료하지 못하게 한다. 검사 결과를 근거로 `focus_sql_erd_tables` 입력을 생성한 뒤 해당 도구가 실행돼야 요청이 완료된다.

## 범위

- AI Worker의 Workspace Agent planner에 작은 workflow constraint 경계를 추가한다.
- 최신 완료 도구 결과가 사용 가능한 SQL ERD inspection이고 `focus_sql_erd_tables`가 shortlist에 있을 때만 적용한다.
- 이 단계에서는 planner 응답의 `completed`와 다른 tool 이름을 JSON Schema에서 허용하지 않는다.
- 모델은 semantic 판단이 필요한 primary/related table ref와 이유만 결정한다.
- App Server API, DB schema, tool input/output 계약, Frontend 동작은 변경하지 않는다.

## 구조

`AgentPlannerWorkflowConstraint`는 현재 planner turn에 필요한 단일 후속 도구 이름을 표현한다. `_agent_planner_workflow_constraint()`는 `planningContext`의 가장 최근 tool 결과만 확인해 constraint를 만든다. 가장 최근 결과가 유효한 `inspect_sql_erd_schema` projection이고 focus tool이 제공된 경우 `focus_sql_erd_tables`를 요구한다.

Planner user payload에는 constraint를 구조화해 전달한다. 응답 JSON Schema는 constrained turn에서 status를 `tool_candidate` 또는 `needs_clarification`으로 제한하고 tool name을 `focus_sql_erd_tables` 또는 null로 제한한다. 가장 최근 tool 결과가 이미 focus이거나 inspection이 clarification 결과이면 constraint를 만들지 않는다.

## 오류 처리

- inspection projection이 없으면 기존 clarification/session-selection 흐름을 유지한다.
- focus tool이 shortlist에 없으면 constraint를 적용하지 않아 존재하지 않는 도구를 강제하지 않는다.
- 모델이 table ref를 잘못 만들면 기존 `_missing_sql_erd_focus_fields()` 검증을 그대로 사용한다.
- focus 실행 뒤 최신 tool 결과가 focus로 바뀌면 일반 planner schema로 돌아가 `completed`를 허용한다.

## 최소 검증

- 유효한 inspect 결과가 있을 때 planner payload와 schema가 focus를 강제하는 회귀 테스트
- inspect 뒤 focus 결과가 추가되면 constraint가 해제되는 테스트
- 기존 SQL ERD focus 관련 테스트만 재실행
