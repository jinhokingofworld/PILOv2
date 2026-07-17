# PR Review Planner Context 전달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR Review Agent run의 검증된 화면 문맥을 Planner에 안전하게 전달해 핵심 파일 추천 Tool을 선택할 수 있게 한다.

**Architecture:** Worker는 `requestContext` 전체가 아니라 `surface`만 `AgentPlanningRequest`로 축소한다. Planner user/system prompt는 해당 surface의 의미와 Tool 입력 제한을 알려주며, 실제 session/Workspace 검증은 App Server execution 경계에 그대로 둔다.

**Tech Stack:** Python dataclass, pytest, OpenAI Responses Planner prompt.

## Global Constraints

- `sessionId`, Workspace ID, raw diff, 코드 원문, 사용자 comment는 Planner 입력에 포함하지 않는다.
- DB migration, App Server API, Frontend 변경은 하지 않는다.
- TDD로 Worker regression test를 먼저 실패시킨다.

---

### Task 1: Planner에 안전한 PR Review surface를 전달한다

**Files:**
- Modify: `apps/ai-worker/tests/test_agent_processor.py`
- Modify: `apps/ai-worker/app/agent_processor.py`

**Interfaces:**
- Produces: `AgentPlanningRequest.context_surface: str | None`
- Consumes: validated `AgentRunJob.request_context`

- [ ] **Step 1: 실패하는 회귀 테스트를 작성한다**

```python
assert planner_client.requests[0].context_surface == "pr_review"
assert json.loads(_agent_planner_user_prompt(planner_client.requests[0]))["contextSurface"] == "pr_review"
assert PR_REVIEW_SESSION_ID not in _agent_planner_user_prompt(planner_client.requests[0])
```

- [ ] **Step 2: focused test가 기능 누락으로 실패하는지 확인한다**

Run: `python -m pytest tests/test_agent_processor.py -q`

- [ ] **Step 3: 최소 구현을 추가한다**

`AgentPlanningRequest`에 `context_surface` 기본값을 추가하고, `_plan_run`에서 `job.request_context`의 surface를 전달한다. Planner user prompt에 `contextSurface`를 넣고, system prompt에 PR Review Tool 선택 규칙을 한 문단 추가한다.

- [ ] **Step 4: focused test를 다시 실행한다**

Run: `python -m pytest tests/test_agent_processor.py -q`

- [ ] **Step 5: 전체 검증을 수행한다**

Run: `python -m pytest`

