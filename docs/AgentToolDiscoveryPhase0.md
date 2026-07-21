# Agent Tool Discovery Phase 0 계약

> 관련 Issue: [#1398](https://github.com/Developer-EJ/PILO/issues/1398),
> [#1399](https://github.com/Developer-EJ/PILO/issues/1399)

## 목적과 경계

Phase 0는 모든 Agent tool schema를 provider에 일괄 제공하기 전에, App Server가 권위 있는
capability catalog를 만들고 offline/shadow 환경에서 tool retrieval을 측정하는 기반이다.

이 단계는 resource 해소, 후보 선택 소비, confirmation 실행, Workspace 권한이나 domain service를
바꾸지 않는다. App Server의 registry, input validation, confirmation, 실행 직전 재검증은 계속
실행 권위 경계다.

## App Server capability catalog

App Server는 등록 tool마다 다음 descriptor를 생성한다.

- `domain`, `action`, `capabilityIds`
- capability별 `whenToUse`, `mustNotUseFor`, positive example
- capability의 전체 `toolNames` chain과 tool별 prerequisite/follow-up
- top-level selector field와 canonicalized full input schema SHA-256
- risk, execution mode, required surface

capability와 tool은 다대다다. 예를 들어 `meeting.action_items.transfer_and_approve`는
`find_action_items` → `update_meeting_report_action_item` →
`approve_meeting_report_action_item` chain을 사용한다. 같은 `update_meeting_report_action_item`은
단순 수정 capability와 복합 전달·승인 capability에 함께 속할 수 있다.

catalog는 등록 tool과 capability chain의 누락·중복·빈 positive/negative 경계를 runtime에서
fail-closed로 검증한다. catalog SHA는 descriptor와 full selector schema digest를 포함하므로 field의
type, format, enum, required, 중첩 구조 변경도 eval/shadow 결과의 입력 변경으로 기록된다.

## 단계 분리

### Phase 0A — #1398

App Server registry가 versioned catalog snapshot을 생성하고 결정론적 SHA와 회귀 검증을 제공한다.

### Phase 0B — #1399

outbox가 immutable catalog snapshot을 Worker에 전달한다. Worker evaluator의
`--shadow-retrieval`은 metadata retrieval과 optional semantic rerank adapter로 topK schema를 만들고,
낮은 confidence에서는 legacy all-eligible schema로 fallback한다. production planner 실행은 이 단계에서
shortlist로 전환하지 않는다.

## 평가와 privacy

canonical/held-out/adjacent-negative suite는 capability, tool chain, shortlist, fallback을 같은
catalog·schema SHA와 함께 기록한다. 관측에는 model/version, latency/token, confidence/fallback
taxonomy만 남기며 raw 사용자 발화, resource ID, token, raw tool payload는 저장하지 않는다.
