# 한국어 멀티턴 Private Holdout 평가 설계

## 목표와 허용 주장

Canvas를 제외한 PILO Agent가 한국어 2~4턴 후속 질의에서 이전 대화의 대상과
조건을 이어받아 올바른 Tool과 인자를 선택하고, Tool 근거에 맞는 답변을 제공하는지
측정한다.

이 평가가 허용하는 최대 주장은 다음과 같다.

> 고정된 120개 한국어 2~4턴 holdout 대화에서 PILO Agent의 멀티턴 맥락 작업
> 성공률이 baseline 대비 개선됐으며, 대화 단위 95% 신뢰구간에서도 개선이 확인됐다.

운영 트래픽 전체, 실제 Tool 가용성, RDS 영속성 또는 모든 한국어 요청의 개선을
주장하지 않는다.

## 범위

- 도메인: Meeting, Calendar, Board, Drive, SQLtoERD, PR Review
- 제외: Canvas
- 평가 단위: 120개 대화, 도메인당 20개
- 대화 길이: 2~4턴
- 반복: 대화당 5회
- 통계 단위: 실행 600회가 아니라 120개 대화
- 실행 계층: 실제 Router와 Planner, 결정적 Tool fixture replay, 고정 LLM Judge
- 측정 제외: 실제 Tool API 성공률, RDS/네트워크/외부 서비스 가용성

## 개발용과 Holdout 분리

저장소에는 schema 검증과 로컬 개발에 사용하는 소규모 한국어 개발 catalog만 둔다.
최종 120개 평가 catalog와 Judge calibration record는 저장소에 커밋하지 않는다.

CI는 기존 AWS OIDC Role을 사용해 다음 GitHub Actions repository variable이 가리키는
버전 고정 S3 객체를 내려받는다.

- `PILO_AGENT_MULTITURN_HOLDOUT_S3_URI`
- `PILO_AGENT_MULTITURN_CALIBRATION_S3_URI`

URI는 변경 가능한 공용 alias가 아니라 버전과 content SHA-256이 포함된 객체 key를
가리켜야 한다. 다운로드한 catalog와 calibration record의 SHA-256은 report metadata에
기록한다. Baseline과 Candidate 비교는 두 SHA가 하나라도 다르면 중단한다.

평가 결과 artifact에는 원문 사용자 발화, Tool 입력, fixture 본문 또는 reviewer label
원문을 포함하지 않는다.

## Holdout Catalog 계약

catalog format은 `agent-korean-multiturn-holdout:v2`다. 최상위에는 `version`,
`language`, `conversations`를 둔다. `language`는 `ko-KR`이어야 한다.

각 conversation은 다음 필드를 가진다.

- `id`: 고유 ID
- `domain`: 여섯 허용 도메인 중 하나
- `scenarioFamily`: `anaphora`, `ellipsis`, `constraint_accumulation`, `correction`,
  `topic_switch_return`, `domain_collision`, `clarification`, `negation`,
  `relative_date`, `speech_variation` 중 하나
- `contextSurface`: 기존 Tool contract가 요구하는 경우 `sql_erd` 또는 `pr_review`
- `turns`: 2~4개 turn

각 turn은 기존 `user`, `expectedTools`, `fixtures`, `expectedContext`,
`expectedOutcome`을 유지한다. 두 번째 이후 turn의 `expectedContext`에는 다음을 추가한다.

- `sourceTurn`: 참조해야 하는 이전 turn의 0-based index
- `sourceConstraints`: `sourceTurn` fixture에서 실제로 유래해야 하는 selector 부분집합
- `referenceKind`: `prior_context_ref`, `prior_result_selector`, `clarification`
- `contextRef`: context reference를 직접 전달해야 하는 경우의 정답
- `constraints`: 이전 결과에서 상속하거나 현재 발화로 추가한 Tool 인자 조건
- `forbiddenTools`: 해당 turn에서 호출하면 안 되는 Tool 목록
- `requiredClarificationFields`: `clarification`에서 사용자에게 추가로 요청해야 하는
  정보의 구조화된 필드명 목록

`sourceTurn`은 현재 turn보다 작아야 한다. `prior_context_ref`와
`prior_result_selector`는 `sourceTurn`의 fixture에서 정답 근거를 찾을 수 있어야 한다.
현재 발화가 selector를 정정하거나 추가하는 경우 전체 정답 인자는 `constraints`에,
이전 결과에서 유래해야 하는 부분만 `sourceConstraints`에 기록한다.
`clarification` turn은 `expectedTools`와 `fixtures`가 비어 있어야 하고
`requiredClarificationFields`가 하나 이상이어야 한다. 다른 reference kind에서는
`requiredClarificationFields`가 비어 있어야 한다.

## 한국어 시나리오 구성 규칙

각 도메인의 20개 대화는 10개 scenario family를 각각 두 번 포함한다. 전체 120개
대화는 다음 표면형을 포함한다.

각 non-clarification turn은 정확히 하나의 Tool을 기대한다. `clarification` family는
실제 무 Tool clarification turn을, `topic_switch_return` family는 3턴 이상에서 인접하지
않은 이전 `sourceTurn`으로 돌아가는 turn을 반드시 포함한다.

- 대명사: `그거`, `그 회의`, `거기서`
- 생략: `그중 지난주 것만`, `첫 번째 거 요약해줘`
- 조건 누적: 이전 필터에 담당자, 상태, 기간 또는 순서를 추가
- 정정: `아니`, `말고`, `내가 말한 건`으로 대상이나 도메인을 교체
- 주제 전환과 복귀: 다른 도메인 요청 뒤 2턴 이상 전의 대상을 다시 참조
- 도메인 충돌: 유사 제목의 Meeting, Drive, Board 결과를 구분
- 명확화: 정답 대상을 하나로 결정할 수 없어 Tool 호출 없이 질문
- 부정: 제외 대상을 명시하고 다른 Tool을 선택
- 상대 날짜: 고정 `currentDate`와 `Asia/Seoul` 기준으로 해석
- 발화 변형: 존댓말, 반말, 구어체, 조사 생략, 경미한 오타

holdout 문항은 Agent prompt, retrieval rule 또는 Tool 선택 로직 개선에 사용하지 않는다.
문항을 본 사람이 Candidate 구현을 조정한 경우 해당 catalog version은 폐기하고 새
버전으로 baseline을 다시 수집한다.

## 대화 Replay와 운영 동등성

대화마다 Router와 Planner 인스턴스 입력 계약을 유지하는 하나의 replay session을
사용한다. `planningContext`는 운영 `meeting_report_runtime`과 동일한 형식으로 다음을
순서대로 누적한다.

1. 사용자 발화
2. Tool 이름과 fixture 결과
3. Agent 최종 답변
4. 다음 사용자 발화

운영 코드와 evaluator가 공통 context builder를 직접 공유하거나, 동일 입력에 동일한
`planningContext`를 생성한다는 contract test를 둔다. truncation marker, assistant role,
Tool resource context 형식도 parity test 대상이다.

첫 turn은 단일턴 실패가 멀티턴 지표를 오염시키지 않도록 정답 fixture와 기대 fact로
정상 setup 상태를 구성한다. Router/Planner와 Judge 평가는 두 번째 turn부터 실행한다.

## 결정적 채점

첫 turn은 대화 설정용이며 멀티턴 headline metric의 분자와 분모에서 제외한다.
두 번째 이후 turn마다 다음을 검사한다.

- 실제 Tool sequence가 `expectedTools`와 일치
- `forbiddenTools` 호출 없음
- Tool 입력의 context reference 또는 selector가 `sourceTurn` fixture에서 유래
- 현재 발화에서 추가·수정·제외된 constraint가 정확히 반영
- clarification 정답은 Tool을 호출하지 않고 `waiting_user_input`으로 종료
- 예기치 않은 Tool, 다른 turn의 ID 또는 누락된 constraint가 없음

한 대화의 모든 follow-up turn이 위 조건과 Judge 조건을 통과해야 conversation success다.

## 지표

주 지표는 하나다.

- `koreanMultiTurnContextTaskSuccessRate`: 모든 follow-up turn에서 Tool/clarification,
  source turn, Tool input constraint와 최종 근거 답변이 모두 정확한 대화 비율

다음은 원인 분석용 보조 지표다.

- `followUpToolSelectionAccuracy`: 첫 turn을 제외한 follow-up turn의 Tool 또는
  clarification 선택 정확도
- `priorContextArgumentAccuracy`: Tool을 호출한 follow-up turn에서 source turn 기반
  context reference와 constraint가 정확한 비율
- `partialRate`, `inconclusiveRate`, failure code 분포

기존 전체-sequence `multiTurnToolSelectionAccuracy`는 호환 진단값으로만 유지하고 새
장표 headline에는 사용하지 않는다.

## LLM Judge

Judge는 결정적으로 판정할 수 없는 최종 자연어 응답의 의미와 근거성만 평가한다.
Tool 선택, Tool 인자와 source turn은 Judge가 판정하지 않는다. clarification에서는
결정적 gate가 Tool 미호출과 `waiting_user_input` 상태를 확인한 뒤, Judge가 최종 질문이
`requiredClarificationFields`를 실제로 요청하는지만 판정한다.

- 고정 Judge model과 prompt version
- temperature 0
- 3회 독립 투표와 다수결
- malformed response, provider 오류, 투표 분열은 `inconclusive`
- 결정적 gate 실패는 Judge 호출 없이 실패

Judge evidence에는 전체 한국어 대화 history, 비민감 Tool trace, 최종 turn fixture facts,
expected outcome facts와 최종 답변을 전달한다. report에는 verdict와 failure code만 남긴다.

## Judge-Human Calibration

Private S3 calibration record는 120개 중 도메인당 5개, 총 30개 대화를 고정 표본으로
사용한다. 두 명의 reviewer가 baseline/candidate version을 모르는 상태에서 독립적으로
`pass`, `partial`, `fail`, `inconclusive`을 부여하고 불일치를 adjudication한다.

외부 사용을 위한 통과 조건은 다음과 같다.

- reviewer 간 raw agreement 90% 이상
- Judge와 adjudicated human label 간 raw agreement 90% 이상
- Cohen's kappa 0.8 이상
- adjudicated label에 `pass`와 non-pass가 각각 최소 5개 포함
- 30개 calibration conversation ID가 catalog에 존재하고 도메인당 5개
- calibration record의 catalog SHA가 실행 catalog SHA와 일치

하나라도 만족하지 못하면 `judgeCalibrationStatus`는 `pending`이고 주 지표는 외부
headline으로 사용할 수 없다. 모두 만족하면 evaluator가 계산한 결과로만 `passed`를
기록한다. workflow input이나 수동 문자열로 `passed`를 지정할 수 없다.

## Baseline/Candidate 비교

두 revision은 동일한 catalog SHA, calibration SHA, evaluator SHA, registry inventory,
Tool schema, Agent model, Router model, Judge model/prompt, current date, timezone,
retrieval top-k와 repetitions를 사용한다.

결과는 conversation ID로 paired comparison한다. 각 conversation의 5회 평균을 하나의
cluster로 사용해 seed 17, 2,000회 bootstrap으로 delta의 95% 신뢰구간을 계산한다.

개선 판정 조건은 다음과 같다.

- `koreanMultiTurnContextTaskSuccessRate` delta의 95% 신뢰구간 하한이 0보다 큼
- `followUpToolSelectionAccuracy`와 `priorContextArgumentAccuracy`가 음의 방향으로
  회귀하지 않음
- calibration status가 `passed`
- harness invalidity와 catalog preflight 오류가 0건

## 실패 분류

Agent 실패는 유효한 0점 관측치다. 잘못된 Tool, 잘못된 source turn, context argument
누락, 불필요한 clarification, 근거 없는 최종 답변이 포함된다.

Harness invalidity는 점수를 만들지 않고 실행을 중단한다. S3 다운로드 실패, catalog
구조/분포 위반, registry에 없는 Tool, schema에 없는 selector, fixture 근거 누락,
catalog/calibration SHA 불일치가 포함된다.

## 완료 조건

- Private S3 catalog와 calibration record를 workflow가 다운로드하고 SHA를 고정한다.
- catalog preflight가 120개, 도메인당 20개, 2~4턴, 한국어, scenario family 분포를
  검증한다.
- `sourceTurn`, clarification, forbidden Tool과 3턴 이상 복귀 문맥을 결정적으로 채점한다.
- evaluator context assembly가 운영 context assembly와 parity test를 통과한다.
- 새 주 지표와 두 보조 지표가 report, snapshot, comparison에 일관되게 기록된다.
- calibration 통과 여부를 evaluator가 계산하며 수동으로 우회할 수 없다.
- baseline/candidate 비교가 고정 입력 불일치를 거부하고 conversation-clustered 95%
  신뢰구간을 제공한다.
- focused test, 전체 AI Worker test, Black, Ruff와 workflow contract test가 통과한다.
