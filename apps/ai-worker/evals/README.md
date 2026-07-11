# Agent planner 품질 평가

`agent_planner_korean_v1.json`은 Calendar와 MeetingReport의 한국어 고정 평가셋이다. 도구 스키마는
App Server의 `CalendarAgentToolsService`와 `MeetingAgentToolsService`가 outbox에 담는 스냅샷과
동일하게 유지한다. App Server의 `scripts/agent/agent-job.test.mjs`가 실제 registry snapshot과 이 파일의
`tools`를 전체 비교하므로, schema가 달라지면 CI가 실패한다.

아래 명령은 OpenAI planner만 호출한다. SQS, DB, Agent handoff, Calendar/MeetingReport 도구 실행과
confirmation 승인은 수행하지 않는다.

```bash
cd apps/ai-worker
OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --current-date 2026-07-11 > agent-planner-evaluation.json
```

결과의 `passedCases`, `statusAccuracy`, `toolSelectionAccuracy`, `requiredInputAccuracy`,
`confirmationAccuracy`, `clarificationAccuracy`를 기준선으로 기록한다. 같은 `--current-date`와
동일한 평가셋으로 재실행해야 전후 결과를 비교할 수 있다.
