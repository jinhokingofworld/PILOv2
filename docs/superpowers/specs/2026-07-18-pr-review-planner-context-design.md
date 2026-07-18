# PR Review Planner Context 전달 설계

## 목적

PR Review 화면에서 생성된 Agent run이 `recommend_pr_review_focus` Tool을 실제로 선택할 수 있게 한다. 현재 App Server와 Worker job parser는 검증된 `requestContext`를 보존하지만, Worker가 Planner 요청을 만들 때 이를 전달하지 않아 Planner가 현재 PR revision이 식별되어 있다는 사실을 알 수 없다.

## 선택안

`AgentPlanningRequest`에 선택 `context_surface`를 추가하고, Worker는 검증된 job의 `request_context.surface`만 Planner에 전달한다. Planner user prompt에는 `contextSurface`로 직렬화한다.

`sessionId`, Workspace ID, raw diff, 코드 원문, comment는 Planner에 전달하지 않는다. PR Review Tool은 기존처럼 App Server의 stored request context와 실행 직전 재검증만 사용한다.

## Planner 규칙

`contextSurface`가 `pr_review`이고 snapshot에 `recommend_pr_review_focus`가 있으면, 현재 PR의 핵심 파일·검토 우선순위·위험도 질문에 해당 Tool을 선택한다. Tool input에는 session ID나 Workspace ID를 요구하거나 생성하지 않는다.

## 검증

Worker regression test는 PR Review run이 Planner에 `context_surface == "pr_review"`를 전달하고, Planner user prompt에는 `contextSurface`만 포함하며 session ID는 포함하지 않는지 확인한다. 기존 Worker test suite로 SQLtoERD와 global Tool 동작이 유지되는지도 확인한다.
