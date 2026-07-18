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
  --current-date 2026-07-08 --repetitions 5 > agent-planner-evaluation.json
```

결과의 `passedCases`, `statusAccuracy`, `toolSelectionAccuracy`, `requiredInputAccuracy`,
`confirmationAccuracy`, `clarificationAccuracy`를 기준선으로 기록한다. 같은 `--current-date`와
동일한 평가셋으로 재실행해야 전후 결과를 비교할 수 있다.

기준선은 30개 case를 각각 5회 실행한다. 결과 JSON의 `metadata`, case별 `exactRate`,
`flakyCaseIds`, `failureCategoryCandidates`와 모든 비정확 결과를 함께 검토한다. 이 평가는
Planner 판단만 측정하며, 배포된 dev의 SQS·handoff·tool execution E2E는 별도 #723에서 검증한다.

## Meeting Agent Phase 1 회귀 catalog

`meeting_agent_capability_catalog_v1.json`은 현재 지원하는 18개 Meeting tool별로 canonical 발화,
문맥 후속 발화, 인접 intent 반례, held-out paraphrase와 현재 planner 기대 상태를 보관한다. canonical은
각 capability의 4개 seed와 3개 prefix를 조합해 12개 발화로 확장하고, held-out은 같은 seed를 재사용하지
않는다. 현재 selector가 구현되지 않은 요청은 catalog의 `currentExpectation`에서
`needs_clarification` 또는 `unsupported`로 고정하고, `target`에는 후속 Phase의 intent·selector·tool
흐름을 기록한다.

canonical과 held-out은 같은 tool snapshot, 기준일, timezone, model, repetition으로 각각 실행한다.

```bash
cd apps/ai-worker
OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --suite evals/agent_planner_korean_v1.json \
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
  --meeting-catalog evals/meeting_agent_capability_catalog_v1.json \
  --meeting-variant canonical \
  --current-date 2026-07-18 --timezone Asia/Seoul --repetitions 5 \
  > meeting-agent-canonical-baseline.json

OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --suite evals/agent_planner_korean_v1.json \
  --meeting-catalog evals/meeting_agent_capability_catalog_v1.json \
  --meeting-variant held_out \
  --current-date 2026-07-18 --timezone Asia/Seoul --repetitions 5 \
  > meeting-agent-held-out-baseline.json
```

두 결과에는 model, current date, timezone, suite SHA, source revision과 case별 정확도가 포함된다.
실제 API key가 필요한 실행 결과는 repository에 commit하지 않고 #1371에 첨부한다.

## Tool retrieval shadow 비교

App Server가 생성한 `toolCapabilityCatalog` snapshot이 포함된 suite에서는 같은 model·기준일·timezone·
repetition으로 legacy 전체 schema와 shortlist schema를 연속 비교할 수 있다.

```bash
OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --suite evals/agent_planner_korean_v1.json \
  --current-date 2026-07-18 --timezone Asia/Seoul --repetitions 3 \
  --compare-shadow-retrieval --retrieval-top-k 8 \
  > agent-tool-retrieval-comparison.json
```

결과는 legacy와 shadow 각각의 tool 정확도, retrieval recall, adjacent-negative routing,
shortlist 크기, fallback taxonomy, planner/retrieval latency와 tool schema token 추정치를 기록한다.
원문 prompt와 input 값은 report에 포함하지 않으며 case ID·field 이름·안전한 tool 이름만 남긴다.
