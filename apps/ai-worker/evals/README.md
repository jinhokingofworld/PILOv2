# Agent Router·Planner 품질 평가

`agent_planner_korean_v1.json`은 Calendar와 MeetingReport의 한국어 고정 평가셋이다. 도구 스키마는
App Server의 `CalendarAgentToolsService`와 `MeetingAgentToolsService`가 outbox에 담는 스냅샷과
동일하게 유지한다. App Server의 `scripts/agent/agent-job.test.mjs`가 실제 registry snapshot과 이 파일의
`tools`를 전체 비교하므로, schema가 달라지면 CI가 실패한다.

아래 명령은 고정 평가셋으로 OpenAI Router와 Planner를 호출한다. SQS, DB, Agent handoff,
Calendar/MeetingReport 도구 실행과 confirmation 승인은 수행하지 않는다.

```bash
cd apps/ai-worker
OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
  --llm-routing --current-date 2026-07-08 --repetitions 5 \
  > agent-router-planner-evaluation.json
```

결과의 `passedCases`, `statusAccuracy`, `toolSelectionAccuracy`, `requiredInputAccuracy`,
`confirmationAccuracy`, `clarificationAccuracy`를 기준선으로 기록한다. 같은 `--current-date`와
동일한 평가셋으로 재실행해야 전후 결과를 비교할 수 있다.

기준선은 현재 고정 case를 각각 5회 실행한다. 결과 JSON의 `metadata`, case별 `exactRate`,
`flakyCaseIds`, `failureCategoryCandidates`와 모든 비정확 결과를 함께 검토한다. 이 평가는
Router·Planner 판단만 측정하며, 배포된 dev의 SQS·handoff·tool execution E2E는 별도 smoke에서 검증한다.

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
  --llm-routing \
  --current-date 2026-07-18 --timezone Asia/Seoul --repetitions 5 \
  > meeting-agent-canonical-baseline.json

OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --suite evals/agent_planner_korean_v1.json \
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
  --meeting-catalog evals/meeting_agent_capability_catalog_v1.json \
  --meeting-variant held_out \
  --llm-routing \
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

## 2단계 LLM Router 평가

DEV의 `LLM Router → Planner` 경로는 같은 capability catalog와 suite로 Tool 실행 없이 평가한다.

```bash
OPENAI_API_KEY=... PYTHONPATH=. .venv/bin/python scripts/evaluate_agent_planner.py \
  --suite evals/agent_planner_korean_v1.json \
  --tool-capability-catalog /tmp/app-server-tool-capability-catalog.json \
  --llm-routing --current-date 2026-07-19 --timezone Asia/Seoul \
  --repetitions 5 --seed 17 \
  > agent-llm-routing-evaluation.json
```

Router는 compact capability catalog만 받고 Planner는 Router가 선택한 domain/capability의 Tool만 받는다.
보고서의 `routingFunnel`은 `routerRouted → domainExact → capabilityExact → toolExact → requiredInputExact →
executionPolicyExact → endToEndExact` 누적 count, 조건부 정확도와 전체 대비 정확도를 기록한다.
domain/capability recall, Tool 선택·입력 정확도, routing/planner latency와 합산 provider token도 함께 확인한다.
release gate는 최소 5회 반복과 `fixture case 수 × repetitions`의 정확한 attempt 수를 요구한다.

`multi_tool` variant는 한 prompt의 서로 다른 두 작업을 두 번의 Planner 선택과 최종 `completed` 단계까지
유지한다. Router의 복수 domain/capability exact, 각 Tool·입력·정책 exact와 전체 workflow exact를 기록한다.
Tool은 실행하지 않으며 완료 단계 context에는 식별자와 payload가 없는 bounded synthetic result만 넣는다.

`Evaluate Agent Router and Planner` workflow는 `main`과 `dev`를 각각 위 방식으로 실행하고
`compare_agent_planner_evaluations.py`로 동일한 fixture·model·date·timezone·seed·repetition인지 검증한다.
비교 artifact에는 revision별 registry/tool schema SHA와 variant별·전체 funnel의 baseline, candidate, delta가
기록된다. workflow는 준비한 registry/catalog artifact를 공유하고 baseline/candidate × 5개 variant를 10개
matrix job으로 병렬 실행한 뒤, 모든 shard가 성공하면 comparison과 readiness gate를 한 번만 수행한다.

DEV에서 긴급 rollback이 필요하면 `infra/envs/dev/main.tf`의 `ai-worker`와 `agent-worker`
`AGENT_TOOL_RETRIEVAL_MODE`를 모두 `shadow`로 되돌린 뒤 새 ECS task definition을 배포한다. `shadow`는
Router를 우회하고 기존 eligible 전체 Tool schema를 Planner에 전달하며, 원인 분석 후 `llm_router`로 다시
배포할 수 있다.

## Phase 0 deterministic quality gate

CI는 provider를 호출하지 않고 `tool_retrieval_quality_gate_v1.json`을 실행한다. App Server는 먼저 full
registry의 inventory·catalog·eligible schema snapshot artifact를 만들고, Worker gate는 fixture에 고정한
세 SHA와 artifact를 대조한다. 따라서 registry tool/schema/capability drift는 fixture 갱신 없이는 통과하지
않는다. 이 fixture는 strict v3 catalog와 eligible schema snapshot의 digest 정합성, canonical 필수 tool
recall@8 100%, held-out
domain/capability recall@8 95%, adjacent unsupported intent, schema budget·low-confidence·write capability
legacy fallback, 6개 non-Canvas domain의 negation/domain-switch 반례, dangerous write false-positive 0건,
그리고 UUID/민감 입력값 비노출을 검증한다.

```bash
cd apps/app-server
node scripts/agent/export-tool-retrieval-snapshot.mjs \
  --output /tmp/agent-tool-registry-snapshot.json

cd apps/ai-worker
node scripts/sync_tool_retrieval_quality_fixture.mjs \
  --fixture evals/tool_retrieval_quality_gate_v1.json \
  --registry-snapshot /tmp/agent-tool-registry-snapshot.json
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

## Phase 4-E dev 공개 gate

App CI는 registry snapshot, deterministic retrieval/security 결과와 실제 App Server Meeting write runtime
suite를 preflight로 검증한다. fixture inventory만으로 dev 공개 readiness를 통과시키지 않는다. 최종 gate는
`Evaluate Agent Router and Planner` workflow가 고정 Meeting canonical·held-out·counterexample·context·multi-tool로
`main` baseline과 `dev` candidate의 실제 `LLM Router → Planner` 경로를 각각 반복 평가한 뒤 실행한다.

```bash
cd apps/ai-worker
PYTHONPATH=. .venv/bin/python scripts/check_phase4e_dev_readiness.py \
  --registry-snapshot /tmp/agent-tool-registry-snapshot.json \
  --tool-retrieval-report /tmp/agent-tool-retrieval-quality-gate.json \
  --prompt-security-report /tmp/agent-prompt-injection-security-gate.json \
  --app-server-report /tmp/phase4e-meeting-runtime-readiness.json \
  --meeting-evaluation-report /tmp/meeting-canonical-evaluation.json \
  --meeting-evaluation-report /tmp/meeting-held_out-evaluation.json \
  --meeting-evaluation-report /tmp/meeting-counterexample-evaluation.json \
  --meeting-evaluation-report /tmp/meeting-context-evaluation.json \
  --meeting-evaluation-report /tmp/meeting-multi_tool-evaluation.json \
  --dev-terraform ../../infra/envs/dev/main.tf \
  --rollout-runbook ../../docs/infra/agent-tool-retrieval-dev-rollout.md \
  --output /tmp/phase4e-dev-readiness.json
```

`phase4e-dev-readiness` artifact에는 registry·catalog·fixture SHA, Router domain·Planner Tool·입력·정책·
end-to-end funnel, attempt 수·정확도, recall metric, bounded check ID만
포함한다. 사용자 발화, raw resource reference, tool input, UUID, credential은 포함하지 않는다. capability에서
생성하는 canonical 216건, held-out 54건, counterexample 72건, multi-turn 54건에 `qualityCases`를 더한 실제
평가 case는 각각 217/55/74/55건이고 multi-tool은 6개 workflow의 18개 stage다. readiness는 catalog에서 전체 case와 Tool 선택 대상 case를 별도로
계산하며 둘 중 하나라도 빠지면 fail-closed한다. canonical은 exact 100%, held-out/counterexample Tool 선택은
95%, context exact와 multi-tool workflow exact는 95%를 요구하며 Router domain/capability exact와 recall, Router Tool 집합 이탈
여부도 함께 검사한다.
