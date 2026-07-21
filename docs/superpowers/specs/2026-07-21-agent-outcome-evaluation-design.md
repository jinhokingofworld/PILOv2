# Agent 사용자 작업 성공률 하이브리드 평가 설계

## 목적

Canvas를 제외한 PILO Agent의 대표 작업에 대해, 고정된 답변 문구가 아니라 사용자가 실제로 원하는 결과를 얻었는지를 측정한다. 이 평가는 PR을 차단하지 않는 snapshot/compare 리포트용이다.

## 판정 구조

작업 시도는 다음 순서로 판정한다.

1. 결정적 하드 게이트가 Tool 대상, task-critical 입력, fixture 결과 상태, terminal 상태, confirmation 및 안전 정책을 검사한다.
2. 하드 게이트를 통과한 시도만 LLM Judge가 사용자 요청, 기대 사용자 결과, 구조화된 Tool 근거, 최종 답변을 판정한다.
3. `taskOutcomeSuccess`는 하드 게이트 통과와 Judge의 `pass`가 모두 참일 때만 참이다. `partial`은 별도 지표이며 성공에는 넣지 않는다.

`executionContractPass`는 planner 상태, Tool 순서와 전체 입력 구조, Router/capability, 고정 문구 일치를 별도 진단으로 유지한다. 계약 실패가 곧 사용자 작업 실패를 뜻하지는 않는다.

## Fixture와 outcome oracle

fixture는 고정 답변이 아니라 재현 가능한 작업 환경이다. Tool fixture는 task-critical 입력이 맞을 때에만 기대 결과를 돌려주고, 다른 입력에는 빈 결과나 validation 오류를 돌려준다. 따라서 잘못된 대상에 우연히 기대 fixture가 반환되는 false positive를 막는다.

각 scenario에는 다음을 둔다.

- `initialState`: 문서, 회의록, 일정, 이슈, ERD의 fixture 상태
- `taskCriticalAssertions`: 올바른 결과나 상태 전이를 식별하는 입력/대상 조건
- `safetyAssertions`: confirmation, 허용 Tool, 직접 실행 거부 조건
- `outcome`: Judge가 확인할 기대 사용자 결과와 근거 사실
- `contractAssertions`: 기존의 엄격한 planner/Tool/router 진단 조건
- `evaluationCategory`: 제품 도메인 또는 `routing_boundary`

Meeting, Calendar, Board, Drive, SQLtoERD, PR Review의 31개 기존 시나리오는 유지한다. Drive의 교차 도메인 회피 시나리오는 `routing_boundary`로만 집계하여 Drive 점수를 오염시키지 않는다.

## LLM Judge 입력과 출력

Judge는 아래의 최소 evidence bundle만 받는다.

- 사용자 요청과 scenario의 사용자 결과 설명
- Tool 실행 결과에서 추출한 허용된 구조화 사실
- 최종 답변
- terminal 상태와 safety 결과

Judge는 이 근거 밖의 사실을 추정하거나, 응답 문체와 고정 문구 일치 여부를 평가하지 않는다. 반드시 JSON schema로만 다음을 반환한다.

```json
{
  "taskFulfilled": true,
  "groundedInToolEvidence": true,
  "containsMaterialError": false,
  "verdict": "pass",
  "failureCodes": []
}
```

`verdict`는 `pass`, `partial`, `fail`, `inconclusive` 중 하나다. 근거 부족, JSON 파싱 실패, 모델 오류는 `inconclusive`이며 성공으로 집계하지 않는다. failure code와 각 boolean만 artifact에 저장하고, 원문 prompt, Tool 입력, Tool 결과, 최종 답변은 저장하지 않는다.

## 일관성과 공정성

- Agent 모델과 Judge 모델은 분리한다. Judge는 Candidate Agent보다 같거나 강한 고정 모델을 사용한다.
- Judge 모델 ID, 프롬프트 버전, temperature 0, 응답 schema, 투표 횟수는 snapshot metadata에 고정해 Baseline과 Candidate가 같은 evaluator를 쓴다.
- 각 유효 시도는 세 번 독립 판정하고 다수결로 확정한다. 3개 결과가 모두 다르면 `inconclusive`로 처리한다.
- 지원되는 경우 고정 seed를 사용하지만, seed만으로 일관성을 주장하지 않는다.
- 시나리오별 human-labeled gold set으로 Judge와 사람의 일치율, 불일치 사유, `partial` 처리의 타당성을 정기 확인한다. calibration 전에는 이 지표로 운영 전체 성능 개선을 주장하지 않는다.

## 리포트와 비교

PR과 main snapshot은 아래 지표를 나란히 표시한다.

- primary: `taskOutcomeSuccessRate`
- 보조: `partialRate`, `inconclusiveRate`, 도메인/카테고리별 결과
- 안전: safety violation 수
- 진단: `executionContractPassRate`와 router/tool/input/final-answer failure 분포
- 효율: 평균/p95 latency, token 사용량

CI는 이 지표를 생성하고 비교할 뿐 실패시키지 않는다. 개선 주장은 동일 catalog, fixture, Agent 모델 설정, Judge 설정, 반복 횟수에서 Baseline과 Candidate를 비교한 경우에만 할 수 있다.

## 범위 밖

- Canvas 평가
- 실제 운영 데이터 또는 실제 외부 서비스 호출
- Judge 결과에 따른 CI 실패 또는 PR 차단
- raw prompt, Tool 입력, Tool 결과, 답변 원문의 artifact 저장
