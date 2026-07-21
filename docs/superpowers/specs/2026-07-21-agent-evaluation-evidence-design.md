# Canvas 제외 Agent 평가 근거 최소화 설계

## 목적

현재 Router/Planner 평가가 실제 Tool 실행 없이 기대 Tool 이름으로 다음 단계 context를
합성하는 문제를 없애고, 동일한 평가 조건에서 baseline과 candidate의 사용자 작업 성공률과
처리 효율을 비교할 수 있는 최소 근거를 만든다.

이 설계가 생성하는 주장의 범위는 다음으로 제한한다.

> Canvas를 제외한 PILO Agent의 대표적인 조회·변경·복합·실패 처리 작업에서 사용자 작업
> 성공률과 처리 효율이 개선됐고, 평가한 어느 도메인과 작업 범주에서도 성공률이 후퇴하지 않았다.

실서비스의 모든 요청, 평가 catalog 밖의 작업, Canvas 성능은 이 평가로 주장하지 않는다.

### 평가 도메인과 균형

- `agent_workflow` catalog는 Meeting, Calendar, Board, Drive, SQLtoERD, PR Review를 포함한다.
- 각 도메인은 최소 5개 고유 scenario에 등장하도록 맞춘다.
- Meeting/Calendar, Board/Drive는 실제 두 Tool 순차 작업으로 측정한다.
- SQLtoERD와 PR Review는 해당 화면 context를 포함한 Tool 실행부터 최종 답변까지 측정한다.
- 정상 단일 Tool, 순차 multi-Tool, clarification, unsupported, confirmation 대기,
  Tool 결과 기반 답변을 함께 측정한다.
- Canvas scenario와 `delegate_canvas_agent`는 catalog에 넣지 않는다.
- 기존 Meeting `multi_tool` 결과는 Phase 4-E readiness에 유지하지만, 전체 Agent 개선 판정의
  표본에는 섞지 않아 Meeting/Calendar가 점수를 과도하게 좌우하지 않게 한다.

## 최소 구현 범위

### 1. 실제 순차 workflow 평가

- 기존 단일 Router/Planner fixture 평가는 컴포넌트 회귀 테스트로 유지한다.
- `multi_tool`과 `agent_workflow` 평가가 production `AgentRunProcessor`를 사용하는 순차 workflow 평가를 수행한다.
- 작은 in-memory repository와 Tool handoff simulator가 실제 Planner가 선택한 Tool을 실행한다.
- simulator가 만든 실제 Tool output을 다음 planning context에 추가한다.
- 기대 Tool 이름으로 다음 단계 context를 미리 만들지 않는다.
- 최종 `completed` 상태, 실제 Tool 순서, 입력, 최종 답변의 근거를 workflow 성공 조건으로 사용한다.
- clarification은 `waiting_user_input`, unsupported는 안전한 `completed`, confirmation 작업은
  Tool을 실행하지 않은 `waiting_user_input`을 기대 성공 상태로 평가한다.
- Canvas scenario와 Canvas runtime은 포함하지 않는다.

### 2. 실패 격리

- Router, Planner, Tool simulator 오류는 해당 scenario의 실패 결과로 저장한다.
- 한 scenario 실패가 나머지 평가를 중단하지 않게 한다.
- 실패 결과에는 원문 prompt나 Tool payload 대신 제한된 오류 분류만 저장한다.

### 3. 동일 평가 조건 검증

- workflow 입력은 움직이는 `main/dev` 선택지가 아니라 immutable baseline/candidate SHA를 받는다.
- 두 SHA가 같으면 평가를 거부한다.
- suite, catalog, evaluator/scorer 파일의 SHA-256을 report에 기록한다.
- baseline과 candidate의 evaluator/scorer hash가 다르면 comparison을 거부한다.
- 모델, 날짜, timezone, 반복 수, Tool registry hash도 동일해야 한다.

별도 evaluator 서비스나 Docker 이미지는 만들지 않는다. 평가 코드 hash가 동일한 revision 쌍만
비교하도록 제한해 측정 도구가 treatment와 함께 변하는 문제를 최소 변경으로 막는다.

### 4. paired 개선 판정

- scenario ID와 attempt가 같은 baseline/candidate 결과만 pair로 비교한다.
- primary metric은 workflow task success 차이다.
- 처리 효율은 end-to-end latency와 전체 provider token으로 기록한다.
- 반복 실행은 독립 표본으로 부풀리지 않고 scenario 단위로 묶는다.
- 고정 seed의 scenario-cluster bootstrap으로 성공률, latency, token 차이의 95% 신뢰구간을 계산한다.
- 성공률 차이의 신뢰구간 하한이 0보다 크고, latency 또는 token 차이의 신뢰구간 상한이
  0보다 작을 때만
  `improvementEvidence.passed=true`로 판정한다.
- `agent_workflow`가 있으면 개선 근거는 균형 잡힌 이 variant만 사용한다.
- 평가된 각 도메인의 candidate 성공률이 baseline보다 낮으면 개선 판정을 거부한다.
- 평가된 각 작업 범주의 candidate 성공률이 baseline보다 낮아도 개선 판정을 거부한다.
- 안전 위반이나 누락 pair가 있으면 개선 판정을 거부한다.

### 5. main 절대 성능 snapshot

- workflow는 `snapshot`과 `compare` mode를 분리한다.
- `snapshot`은 실행 시점의 current `main` SHA만 받으며 입력을 생략하면 dispatch SHA를 사용한다.
- 비용을 최소화하기 위해 Canvas 제외 31개 `agent_workflow` scenario만 실행한다.
- 고유 scenario를 동일 가중치로 집계해 task success rate, 평균 end-to-end latency,
  평균 provider token, 도메인별·작업 범주별 성공률, 안전 위반 건수를 기록한다.
- report에 workflow summary와 정확히 31개 고유 scenario의 전체 반복 결과가 없으면 snapshot 생성을 거부한다.
- snapshot은 절대 현황 기록이므로 `passed`나 개선 판정을 생성하지 않는다.
- snapshot artifact는 원본 evaluation report와 집계 JSON을 함께 30일 보관한다.
- 저장된 snapshot은 추세 참고용이며, PR 개선 판정은 baseline/candidate를 같은 실행에서 다시 평가한
  paired comparison으로만 수행한다.

## 파일 범위

수정:

- `apps/ai-worker/app/agent_planner_evaluation.py`
  - multi-tool의 합성 context 제거
  - workflow 결과와 case-level 오류 기록
- `apps/ai-worker/app/agent_planner_comparison.py`
  - paired scenario 비교, 95% 신뢰구간, 단일 revision 절대 성능 집계
- `apps/ai-worker/scripts/snapshot_agent_planner_evaluations.py`
  - 단일 `agent_workflow` report를 pass/fail gate 없는 snapshot JSON으로 변환
- `apps/ai-worker/scripts/evaluate_agent_planner.py`
  - evaluator hash 및 workflow 메타데이터 기록
- `.github/workflows/evaluate-agent-planner.yml`
  - `snapshot`/`compare` mode, immutable SHA, distinct revision, 동일 evaluator 검증, fail-fast 해제
- `apps/ai-worker/evals/meeting_agent_capability_catalog_v1.json`
  - multi-tool 단계의 결정론적 Tool output과 최종 근거 조건
- `apps/ai-worker/evals/agent_workflow_catalog_v1.json`
  - 6개 비-Canvas 도메인을 각각 최소 5개로 대표하는 31개 고유 workflow

필요할 때만 신규 추가:

- `apps/ai-worker/app/agent_workflow_evaluation.py`
  - production processor용 in-memory repository와 Tool simulator를 기존 파일에 작게 넣기 어려울 때만 분리

테스트:

- `apps/ai-worker/tests/test_agent_planner_evaluation.py`
- `apps/ai-worker/tests/test_agent_planner_comparison.py`
- `apps/ai-worker/tests/test_agent_planner_workflow.py`
- 신규 workflow module을 만들 때만 `apps/ai-worker/tests/test_agent_workflow_evaluation.py`

## 꼭 필요한 테스트

1. 첫 Tool의 실제 output이 두 번째 planning request context에 포함된다.
2. 기대 Tool을 선택해도 실제 output 또는 최종 상태가 틀리면 workflow가 실패한다.
3. Router/Planner 오류 한 건이 나머지 scenario 실행을 중단하지 않는다.
4. baseline/candidate revision이 같거나 evaluator hash가 다르면 comparison이 거부된다.
5. 반복 횟수가 아니라 고유 scenario 단위로 성공률 신뢰구간을 계산한다.
6. task success 신뢰구간 하한이 0 이하이면 단순 delta가 양수여도 개선으로 판정하지 않는다.
7. latency/token 개선과 안전 위반 여부가 최종 개선 판정에 반영된다.
8. `agent_workflow`가 있으면 기존 Meeting workflow를 개선 표본에 중복 산입하지 않는다.
9. 평가된 도메인 하나라도 성공률이 후퇴하면 최종 개선 판정을 거부한다.
10. snapshot이 단일 revision의 31개 scenario를 절대 지표로 집계하고 `passed`를 만들지 않는다.
11. snapshot workflow는 `agent_workflow`만 실행하고 compare gate에 진입하지 않는다.

이 목록 외의 조합 테스트, UI 테스트, Canvas 테스트, 운영 대시보드 테스트는 추가하지 않는다.

## 제외 범위

- Canvas 평가와 Canvas 코드 변경
- production online A/B 또는 shadow traffic
- staging 환경 자동 생성
- 대규모 비공개 dataset 구축
- LLM judge 및 사람 평가 시스템
- 새 통계 라이브러리 도입
- 기존 Phase 4-E readiness 전면 개편
- API 계약, DB schema, Frontend 변경

## 성공 기준

- 기존 관련 AI Worker 테스트가 통과한다.
- 위 최소 테스트가 통과한다.
- workflow 결과가 실제 Tool output 기반임을 테스트로 증명한다.
- 비교 report가 distinct revision, 동일 evaluator, 완전한 pair, 95% 신뢰구간을 강제한다.
- snapshot report가 단일 main revision의 절대 지표와 source SHA를 기록하고 개선 판정을 만들지 않는다.
- PR 본문에 6개 도메인 31개 고유 workflow의 대표 표본이라는 한계와 실제 provider 평가 실행 전에는
  개선을 주장할 수 없음을 명시한다.
