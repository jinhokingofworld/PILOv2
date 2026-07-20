# Canvas 제외 Agent 평가 근거 최소화 설계

## 목적

현재 Router/Planner 평가가 실제 Tool 실행 없이 기대 Tool 이름으로 다음 단계 context를
합성하는 문제를 없애고, 동일한 평가 조건에서 baseline과 candidate의 사용자 작업 성공률과
처리 효율을 비교할 수 있는 최소 근거를 만든다.

이 설계가 생성하는 주장의 범위는 다음으로 제한한다.

> Canvas를 제외한 고정 PILO Agent 평가에서 사용자 작업 성공률과 처리 효율이 개선됐다.

실서비스 전체 성능이나 Canvas 성능은 이 평가로 주장하지 않는다.

## 최소 구현 범위

### 1. 실제 순차 workflow 평가

- 기존 단일 Router/Planner fixture 평가는 컴포넌트 회귀 테스트로 유지한다.
- `multi_tool` 평가만 production `AgentRunProcessor`를 사용하는 순차 workflow 평가로 바꾼다.
- 작은 in-memory repository와 Tool handoff simulator가 실제 Planner가 선택한 Tool을 실행한다.
- simulator가 만든 실제 Tool output을 다음 planning context에 추가한다.
- 기대 Tool 이름으로 다음 단계 context를 미리 만들지 않는다.
- 최종 `completed` 상태, 실제 Tool 순서, 입력, 최종 답변의 근거를 workflow 성공 조건으로 사용한다.
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
- 고정 seed의 scenario-cluster bootstrap으로 성공률 차이의 95% 신뢰구간을 계산한다.
- 성공률 차이의 신뢰구간 하한이 0보다 크고, latency 또는 token이 개선될 때만
  `improvementEvidence.passed=true`로 판정한다.
- 안전 위반이나 누락 pair가 있으면 개선 판정을 거부한다.

## 파일 범위

수정:

- `apps/ai-worker/app/agent_planner_evaluation.py`
  - multi-tool의 합성 context 제거
  - workflow 결과와 case-level 오류 기록
- `apps/ai-worker/app/agent_planner_comparison.py`
  - paired scenario 비교와 95% 신뢰구간
- `apps/ai-worker/scripts/evaluate_agent_planner.py`
  - evaluator hash 및 workflow 메타데이터 기록
- `.github/workflows/evaluate-agent-planner.yml`
  - immutable SHA, distinct revision, 동일 evaluator 검증, fail-fast 해제
- `apps/ai-worker/evals/meeting_agent_capability_catalog_v1.json`
  - multi-tool 단계의 결정론적 Tool output과 최종 근거 조건

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
- 위 7개 최소 테스트가 통과한다.
- workflow 결과가 실제 Tool output 기반임을 테스트로 증명한다.
- 비교 report가 distinct revision, 동일 evaluator, 완전한 pair, 95% 신뢰구간을 강제한다.
- PR 본문에 현재 catalog의 고유 workflow 수가 작아 실제 개선 주장은 별도 평가 실행과 충분한
  scenario 확보 후에만 가능하다고 명시한다.
