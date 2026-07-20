# PR #1602 기반 Agent Tool 인식률 확장 검증 결과

## 1. 결론

PR #1602의 단계별 Tool 노출 로직은 다른 도메인의 다단계 Tool chain에 재사용할 수 있는 구조적 기반이다.
특히 Calendar의 `list_calendar_events -> update_calendar_event` chain은 단위 테스트로 동작을 확인했다.

하지만 현재 상태를 **다른 Tool의 실제 한국어 요청 인식률이 개선될 것이라는 근거**로 사용하면 안 된다.
로컬 계약·회귀 테스트는 통과했지만, 실제 LLM 평가에서 다음 두 blocker가 확인됐다.

1. 기존 56-case 한국어 suite는 34개 Tool 스냅샷이고 PR #1602 registry-bound catalog는 36개 Tool이라서
   2단계 Router 평가 입력 검증을 통과하지 못한다.
2. registry-bound Meeting context 평가에서는 모델이 shortlist 밖 Tool을 반환한 순간 evaluator가 해당 case를
   실패로 집계하지 않고 전체 실행을 예외로 종료한다. 따라서 정확도 report가 생성되지 않는다.

판정은 다음과 같다.

| 판단 항목 | 결과 |
| --- | --- |
| PR #1602 자체 회귀 안정성 | 통과 |
| deterministic Tool retrieval 계약 | 통과 |
| Calendar 다단계 chain 일반화 | 통과 |
| 전체 도메인 실제 LLM 인식률 비교 | 측정 불가 |
| 다른 Tool로 즉시 일괄 확장 | 보류 |
| Calendar부터 제한적 확장 | 가능, 전용 eval 추가 조건 |

### 1.1 후속 보완 상태 — 2026-07-21

이 문서의 실제 LLM 실행 실패는 PR #1602 파일럿 당시의 결과다. 후속 평가 workflow 브랜치에서는 다음을
보완했다.

- Actions의 Meeting 평가는 App Server registry에서 Tool snapshot과 capability catalog를 함께 생성한다.
  따라서 기존 34-Tool 정적 suite와 36-Tool registry를 직접 결합하지 않는다.
- Planner가 shortlist 밖 Tool을 반환해 `AgentPlannerOutputError`가 발생해도 evaluator가 전체 실행을 종료하지
  않고 해당 attempt를 `planner_output`, `tool`, `shortlist_tool` 실패로 기록한다.
- report에는 `shortlist_violation`, `planner_output_error` taxonomy와 funnel 손실이 남으므로 결과 artifact를
  생성할 수 있다.

다만 registry-bound **cross-domain** 한국어 fixture는 아직 추가되지 않았다. 현재 Actions provider 평가는
Meeting 중심이므로 Calendar·Board·SQLtoERD 등 다른 domain의 인식률 개선 근거는 별도 fixture가 추가된 뒤
판정해야 한다.

## 2. 검증 대상

- 검증일: 2026-07-20, Asia/Seoul
- 후보: PR #1602 HEAD `14107de2a94e978a3a12ab38ebd41b79573eb111`
- 기준선: PR #1602 merge-base `caa23becb249c68f2df25d5656172cd0c4022e22`
- 실제 모델: `gpt-5.4-mini`
- 실제 평가 경로: AWS CloudShell에서 Secrets Manager의 DEV OpenAI key를 주입한
  `LLM Router -> Planner` offline evaluator
- Tool 실행, SQS 전송, DB 변경: 없음

후보 코드는 현재 작업 트리를 변경하지 않기 위해 별도 임시 디렉터리와 AWS CloudShell worktree에서 검증했다.
로컬 작업 트리에 이미 존재하던 Frontend 변경은 수정하지 않았다.

## 3. 실행 결과

### 3.1 로컬 회귀 테스트

| 검증 | 결과 |
| --- | --- |
| AI Worker 전체 `pytest` | `457 passed in 2.87s` |
| App Server TypeScript build | 통과 |
| App Server 전체 `npm test` | 통과, exit code 0 |
| Prompt injection deterministic gate | 26/26 통과 |
| Tool retrieval deterministic gate | 통과 |

Tool retrieval gate의 주요 수치는 다음과 같다.

| 지표 | 결과 |
| --- | ---: |
| canonical required Tool recall@8 | 100% |
| held-out domain recall@8 | 100% |
| held-out capability recall@8 | 100% |
| privacy violation | 0건 |

이 수치는 catalog와 fixture의 deterministic 정합성을 의미한다. 실제 LLM이 한국어 문장을 정확히 분류했다는
수치는 아니다.

### 3.2 다단계 Tool chain 검증

PR #1602의 `select_pending_agent_planner_tools_for_routing()`은 선택된 capability마다 완료되지 않은 첫 Tool만
Planner에 노출한다. 후보 registry에는 다단계 capability가 20개 있다.

대표적으로 다음 chain이 포함된다.

- Calendar: `list_calendar_events -> update_calendar_event`
- Board: `search_board_issues -> move_board_issue_status`
- Board: `get_board_briefing -> diagnose_board_freshness -> resolve_board_context`
- SQLtoERD: `inspect_sql_erd_schema -> focus_sql_erd_tables`
- Meeting: `list_meeting_reports -> search_meeting_transcript`

단위 테스트로 확인한 동작은 다음과 같다.

- Calendar 조회 결과가 현재 사용자 요청 cycle에 있으면 다음 단계인 `update_calendar_event`만 노출한다.
- 이전 사용자 요청 cycle의 조회 결과는 완료로 간주하지 않고 `list_calendar_events`부터 다시 시작한다.
- Meeting hybrid chain은 제목 조회 후 transcript 검색만 노출한다.
- chain이 끝나기 전에 Planner가 `completed`를 반환하면 완료로 승인하지 않는다.

관련 구현과 테스트는 다음 위치에 있다.

- `apps/ai-worker/app/agent_processor.py:338`
- `apps/ai-worker/app/agent_processor.py:375`
- `apps/ai-worker/app/agent_processor.py:871`
- `apps/ai-worker/tests/test_agent_processor.py:1317`
- `apps/ai-worker/tests/test_agent_processor.py:1496`

### 3.3 실제 LLM 평가 시도 1: 기존 56-case suite

실행 조건은 후보 code, 후보 registry-bound catalog, 1회 반복, 고정 seed 17이었다.

결과는 provider 호출 전 입력 검증 실패다.

```text
ValueError: Invalid toolCapabilityCatalog
```

원인은 다음 cardinality 차이다.

| 입력 | Tool 수 |
| --- | ---: |
| `agent_planner_korean_v1.json` | 34 |
| PR #1602 App Server registry | 36 |

따라서 현재 56-case suite를 그대로 사용해서 다른 도메인의 2단계 Router 인식률을 측정할 수 없다.
registry와 동일한 Tool schema로 suite를 다시 생성하고, 같은 fixture를 baseline과 candidate에 공통 적용해야 한다.

### 3.4 실제 LLM 평가 시도 2: registry-bound Meeting context

공식 `export_phase4e_evaluation_inputs.py`가 만든 36-Tool snapshot과 catalog를 사용해 Meeting context 55건,
1회 반복을 실행했다.

평가는 실제 provider 호출을 시작했지만 다음 예외로 중간 종료됐다.

```text
AgentPlannerOutputError: Agent planner selected a tool outside the shortlist
```

이 동작 자체는 Planner의 잘못된 출력을 안전하게 거부한 것이므로 runtime 방어 관점에서는 정상이다. 문제는
offline evaluator가 이 결과를 `tool_outside_shortlist` case failure로 기록하지 않고 전체 실행을 종료한다는 점이다.
그 결과 `passedCases`, funnel 정확도, 실패 case 목록이 포함된 report가 생성되지 않았다.

관련 경로는 다음과 같다.

- `apps/ai-worker/app/agent_planner_evaluation.py:467`
- `apps/ai-worker/app/agent_processor.py:3589`
- `apps/ai-worker/app/agent_processor.py:3628`

이번 실제 실행은 1회 파일럿이며 중간 종료됐으므로 인식률 수치나 baseline 대비 개선률로 사용할 수 없다.

## 4. PR #1602를 다른 Tool에 적용할 때의 제한

### 4.1 완료 상태가 Tool 이름 단위다

현재 chain 진행 상태는 `capabilityId + step + selector`가 아니라 planning context에 나타난 Tool 이름으로 판정한다.
여러 capability가 동일한 조회 Tool을 공유하거나 한 사용자 요청에서 같은 Tool을 서로 다른 selector로 두 번
호출해야 하면, 한 번의 실행이 다른 chain까지 완료시킨 것으로 오인될 수 있다.

### 4.2 조건부 0/1/N 분기는 도메인 구현이 필요하다

정적인 `A -> B -> C` 순서는 공통 로직으로 처리할 수 있다. 반면 검색 결과가 0건, 1건, 복수 후보인지에 따라
clarification·fallback·후속 Tool이 달라지는 흐름은 Meeting의 title/candidate 처리처럼 도메인별 resolver가
필요하다.

### 4.3 Planner turn 제한이 5회다

Planner turn limit은 5회다. 3단계 chain에 후보 선택이나 clarification이 추가되면 제한에 도달할 수 있으므로,
Board briefing 같은 긴 chain은 별도 context 평가가 필요하다.

### 4.4 현재 실제 평가 coverage가 Meeting 중심이다

Phase 4-E release gate는 Meeting canonical·held-out·counterexample·context에 집중한다. Calendar·Board·SQLtoERD의
다단계 흐름은 현재 동일한 규모와 기준으로 실제 모델 반복 평가되지 않는다.

## 5. 다른 Tool 인식률 갱신 전에 필요한 평가 기준

### 5.1 동일한 registry-bound 평가셋

baseline과 candidate에 아래 조건이 완전히 같은 fixture를 제공해야 한다.

- Tool schema와 capability catalog SHA
- 한국어 prompt와 context
- model과 router model
- current date와 timezone
- seed와 repetitions
- baseline/candidate immutable commit SHA

도메인별 fixture는 최소 다음 네 종류를 포함한다.

- canonical: 명시적이고 정상적인 대표 요청
- held-out: fixture 작성에 사용하지 않은 표현과 어순
- counterexample: 인접 Tool, unsupported, 복합 요청
- context: 조회 후 수정, 후보 선택, confirmation 대기, 새 의도 전환

### 5.2 Funnel 지표

각 attempt는 아래 단계별로 집계한다.

```text
Router routed
  -> domain exact
  -> capability exact
  -> Tool exact
  -> required input exact
  -> execution policy exact
  -> end-to-end exact
```

전체 정확도만 보지 않고 다음 위험 지표를 별도로 gate한다.

- unsupported 요청이 write Tool로 연결된 건수: 0건
- confirmation-required Tool의 confirmation 누락: 0건
- shortlist 밖 Tool 반환: 0건
- 이전 사용자 cycle의 Tool 결과를 현재 요청에 재사용한 건수: 0건
- baseline 대비 domain/capability/Tool 정확도 하락: 허용 기준 이내

### 5.3 반복 수와 판정

- 개발 파일럿: case당 1회, 실행 가능성과 failure taxonomy 확인용
- 비교 근거: case당 최소 5회
- 모든 case를 같은 반복 수로 실행
- 평균 정확도뿐 아니라 case별 exact rate와 flaky case를 공개
- 위험한 오분류는 평균과 무관하게 1건이면 실패

## 6. 선행 수정 권고

다른 Tool 인식률 확장 전에 다음 두 작업이 필요하다.

1. **Cross-domain registry-bound suite 생성**
   - 36개 실제 Tool snapshot과 동일한 schema를 사용한다.
   - Calendar, Board, SQLtoERD, Drive의 다단계 capability fixture를 추가한다.
   - baseline과 candidate가 같은 suite SHA를 사용하도록 한다.
2. **Evaluator의 case-level 실패 격리 — shortlist 이탈 보완 완료**
   - `AgentPlannerOutputError` 중 shortlist 밖 Tool 반환은 case failure로 기록한다.
   - 실패 한 건 때문에 전체 artifact가 사라지지 않게 한다.
   - `shortlist_violation`과 `planner_output_error`를 failure taxonomy에 포함한다.
   - Router schema 오류와 provider timeout 격리는 후속 범위로 남긴다.

그 다음 첫 확장 대상은 Calendar update가 적절하다. 공통 chain 로직을 이미 단위 테스트했고,
`조회 -> 수정 -> confirmation`이라는 단계가 분명해 평가 fixture와 위험 기준을 만들기 쉽다.

## 7. GitHub Actions에서의 확인 범위

이번 PR #1602 수동 평가는 AWS CloudShell에서 실행했기 때문에 GitHub Actions run으로 표시되지 않는다.
현재 workflow 입력은 baseline/candidate를 `main` 또는 `dev`로만 선택할 수 있어 PR #1602 HEAD를 직접 지정할 수 없다.

Actions에서 동일 결과를 남기려면 다음 중 하나가 필요하다.

- PR #1602를 `dev`에 반영한 뒤 `main` baseline과 `dev` candidate를 비교한다.
- workflow가 검증된 immutable PR SHA를 입력으로 받도록 변경한다.

두 경우 모두 prepare 단계에서 해석한 SHA를 모든 matrix와 compare 단계에서 그대로 사용해야 한다.

후속 workflow는 `main`/`dev` ref를 prepare 단계에서 immutable SHA로 해석하고 이후 matrix와 compare가 같은
SHA를 사용하도록 보완됐다. 다만 AWS/OpenAI secret을 사용하는 workflow code를 임의 feature branch에서
실행하지 않도록 `main` dispatch만 허용한다. 따라서 이번 evaluator 보완 push에서는 일반 PR CI로 단위·정적
검사를 먼저 확인하고, 실제 provider baseline/candidate Actions 평가는 workflow가 `main`에 반영된 뒤 실행한다.

## 8. 최종 판정

PR #1602는 **다른 Tool의 다단계 실행 순서를 제어하는 기반으로는 사용할 수 있다.** 그러나 현재 통과한
deterministic gate와 mock/단위 테스트만으로는 **다른 Tool의 실제 한국어 요청 인식률이 개선된다**고 말할 수 없다.

shortlist 이탈에 대한 evaluator failure isolation은 후속 브랜치에서 보완했다. 남은 cross-domain
registry-bound fixture와 Router/provider 오류 격리를 추가하고, 같은 평가셋으로 baseline/candidate를 각각
5회 반복한 뒤에만 다른 domain의 개선률을 근거 자료로 사용해야 한다.
