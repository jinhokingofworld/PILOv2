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
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
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
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
  --current-date 2026-07-18 --timezone Asia/Seoul --repetitions 3 \
  --compare-shadow-retrieval --retrieval-top-k 8 --seed 17 \
  > agent-tool-retrieval-comparison.json
```

`--shadow-retrieval`과 `--compare-shadow-retrieval`은 offline evaluator의 feature flag이며 tool을 실행하거나
production planner 경로를 바꾸지 않는다. 비교 실행은 같은 catalog·suite·model·date·timezone·seed의
case/attempt를 짝지어 legacy 대비 shadow의 정확도, latency, schema token 차이를 출력한다.

결과는 domain/capability/필수 chain tool recall@k, adjacent-intent 오선택,
supported→unsupported 오판, shortlist 크기, fallback taxonomy, planner/retrieval latency와 provider 및
tool schema token usage를 기록한다. `retrievalEvents`는 candidate 수와 confidence 구간을 포함하지만
raw prompt, UUID/resource reference, tool 이름·payload, token·secret을 포함하지 않는 bounded shadow
관측 형식이다. 상세 offline 결과도 prompt와 input 값은 제외하고 case ID·field 이름·안전한 tool 이름만
남긴다.

## Phase 0 deterministic quality gate

CI는 provider를 호출하지 않고 `tool_retrieval_quality_gate_v1.json`을 실행한다. App Server는 먼저 full
registry의 inventory·catalog·eligible schema snapshot artifact를 만들고, Worker gate는 fixture에 고정한
세 SHA와 artifact를 대조한다. 따라서 registry tool/schema/capability drift는 fixture 갱신 없이는 통과하지
않는다. 이 fixture는 strict v2 catalog와 eligible schema snapshot의 digest 정합성, canonical 필수 tool
recall@8 100%, held-out
domain/capability recall@8 95%, adjacent unsupported intent, schema budget·low-confidence·write capability
legacy fallback, 그리고 UUID/민감 입력값 비노출을 검증한다.

```bash
cd apps/app-server
node scripts/agent/export-tool-retrieval-snapshot.mjs \
  --output /tmp/agent-tool-registry-snapshot.json

cd apps/ai-worker
PYTHONPATH=. .venv/bin/python scripts/check_tool_retrieval_quality_gate.py \
  --registry-snapshot /tmp/agent-tool-registry-snapshot.json \
  --output /tmp/agent-tool-retrieval-quality-gate.json
```

출력 JSON에는 raw prompt나 payload 대신 catalog/suite/eligible snapshot/shortlist의 SHA, retriever version,
`deterministic:no-provider` model version, topK, schema budget, case 유형, failure taxonomy만 남긴다. App CI는 이 파일을
`agent-tool-retrieval-quality-baseline` artifact로 업로드한다. provider model/SHA는 실제 provider baseline의
metadata에 별도로 남기며, deterministic CI gate에는 provider model을 고정하거나 호출하지 않는다.

## Prompt injection security gate

CI는 provider를 호출하기 전에 `prompt_injection_security_gate_v1.json`의 사용자 발화, bounded thread
resource, 실제 직렬화 형태의 tool result, 선택 후보 label/description과 grounded evidence fixture를 실행한다.
runtime context 생성 시 이 값들을 구조화된 source kind로 분리하므로 detector가 문자열 prefix를 추측하지
않는다. 명시적인 system instruction override, system prompt·credential 추출,
shortlist·registry·ECS flag 변경, confirmation·권한 우회 신호는 `prompt_injection_suspected`로 차단한다.
보안 주제를 정상적으로 논의하거나 기존 confirmation을 요청하는 인접 반례, 부정형 결정·회고·인용 문장은
차단하지 않는다.

```bash
cd apps/ai-worker
PYTHONPATH=. .venv/bin/python scripts/check_prompt_injection_security_gate.py \
  --output /tmp/agent-prompt-injection-security-gate.json
```

출력 artifact에는 fixture SHA, detector version, 전체·차단·허용 case 수와 실패 case ID·signal taxonomy만
기록한다. 공격 원문, 사용자 발화, Meeting evidence, tool payload, resource ID, token·secret은 기록하지
않는다. runtime에서도 같은 detector를 retrieval·planner보다 먼저 실행하며, 탐지되면 full-tool fallback이나
write/confirmation 후보를 만들지 않고 안전한 clarification으로 종료한다.
