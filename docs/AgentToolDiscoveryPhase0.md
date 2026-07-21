# Agent Tool Discovery Phase 0 계약

> 관련 Issue: [#1398](https://github.com/Developer-EJ/PILO/issues/1398),
> [#1399](https://github.com/Developer-EJ/PILO/issues/1399),
> [#1663](https://github.com/Developer-EJ/PILO/issues/1663),
> [#1662](https://github.com/Developer-EJ/PILO/issues/1662)

## 목적과 경계

Phase 0는 모든 Agent tool schema를 provider에 일괄 제공하기 전에, App Server가 권위 있는
capability catalog를 만들고 offline/shadow 환경에서 tool retrieval을 측정하는 기반이다.

이 단계는 resource 해소, 후보 선택 소비, confirmation 실행, Workspace 권한이나 domain service를
바꾸지 않는다. App Server의 registry, input validation, confirmation, 실행 직전 재검증은 계속
실행 권위 경계다.

## App Server capability catalog

App Server는 등록 tool마다 다음 descriptor를 생성한다.

- `domain`, `action`, `capabilityIds`
- capability별 `whenToUse`, `mustNotUseFor`, positive example과 negation/exclusion/correction/anaphora/domain-switch boundary example
- capability의 전체 `toolNames` chain, 명시적 `terminalToolNames`와 tool별 prerequisite/follow-up
- capability의 selector kind, terminal read/write operation, execution mode, confirmation, supported/unsupported 상태
- top-level selector field와 canonicalized full input schema SHA-256
- risk, execution mode, required surface

capability와 tool은 다대다다. 예를 들어 `meeting.action_items.transfer_and_approve`는
`find_action_items` → `update_meeting_report_action_item` →
`approve_meeting_report_action_item` chain을 사용한다. 같은 `update_meeting_report_action_item`은
단순 수정 capability와 복합 전달·승인 capability에 함께 속할 수 있다.

catalog는 등록 tool과 capability chain의 누락·중복·빈 positive/negative 경계를 runtime에서
fail-closed로 검증한다. catalog SHA는 descriptor와 full selector schema digest를 포함하므로 field의
type, format, enum, required, 중첩 구조 변경도 eval/shadow 결과의 입력 변경으로 기록된다.

`agent-tool-capabilities:v3` validator는 등록 Tool과 capability의 양방향 연결, selector allow-list와
실제 schema field, prerequisite/follow-up/terminal chain, terminal operation/execution mode/confirmation을
정확히 비교한다. invalid SHA, 중복 capability, 연결되지 않은 Tool, 알 수 없는 selector, chain drift,
confirmation 충돌은 Router/Planner로 전달하지 않는다. v1/v2 parser는 저장된 job 호환을 위해 읽기만
지원하며 App Server가 새로 발행하는 snapshot은 v3다.

deterministic retriever `agent-tool-metadata-overlap:v5`는 canonical intent-family scoring과 명시적으로
부정된 intent cue, `말고` 앞의 domain을 점수에서 제외하고, compound 표현이 아닌데
최고 점수 capability가 여러 개면
`conflicting_capabilities`로 fail-closed한다.

## Non-Canvas domain 경계

| Domain | 허용 경계 | 반드시 배제할 인접 요청 | selector/terminal 요약 |
| --- | --- | --- | --- |
| Meeting | 회의·회의록 목록/상세/요약/근거와 action item 흐름 | Drive 문서 검색, Board 이슈 검색, read 표현만 있는 mutation | meeting/report/action item selector, write terminal은 기존 confirmation 유지 |
| Calendar | 기간 목록, 새 일정 생성, 기존 일정 수정 | 회의록 조회, 삭제 요청, 조회 문장의 create/update 오선택 | date range/event selector, create/update terminal은 confirmation required |
| Board | 이슈 제목 검색·상세, 생성·상태·담당자 변경, briefing | Drive 문서 본문, Meeting transcript, read 문장의 mutation | board issue/context selector, mutation terminal은 confirmation required |
| Drive | Workspace 문서 제목·본문 query | Meeting transcript/회의록, Board 이슈, 문서 write | document query, read-only terminal |
| SQLtoERD | 현재 session table/FK 집중 보기, ERD 생성 | SQL 실행, PR Review, 조회 문장의 schema 생성 | session/table selector, generate는 contextual write |
| PR Review | 현재 immutable review session의 파일 집중 추천 | review 제출·merge, SQLtoERD/Board 요청 | PR Review session selector, read-only terminal |

명시적 새 domain 요청과 이전 target 지시어 해소는 P0 `ContextResolution`이 먼저 처리한다. catalog의
boundary example에는 실제 resource ID, raw Tool payload, credential 또는 provider data를 넣지 않는다.

## 단계 분리

### Phase 0A — #1398

App Server registry가 versioned catalog snapshot을 생성하고 결정론적 SHA와 회귀 검증을 제공한다.

### Phase 0B — #1399

outbox가 immutable catalog snapshot을 Worker에 전달한다. Worker evaluator의
`--shadow-retrieval`은 metadata retrieval과 optional semantic rerank adapter로 topK schema를 만들고,
낮은 confidence에서는 legacy all-eligible schema로 fallback한다. production planner 실행은 이 단계에서
shortlist로 전환하지 않는다.

## Capability chain dispatch

`llm_router` mode에서는 Router가 고른 capability와 현재 사용자 발화 이후 성공한 Tool 결과로
`agent-next-tool-decision:v1` frontier를 계산한다. 각 capability chain의 첫 미완료 Tool만 후보가 되며,
선행 Tool이 없는 후속 결과, 완료 Tool 재호출, chain 밖 Tool, surface 밖 Tool은 fail-closed한다.

후보가 하나이면 Planner response schema의 `toolName`은 `null`로 고정하고 Worker가 계산된 Tool을
바인딩한다. 후보가 여러 개이면 frontier 후보 schema만 노출한다. App Server는 자동 실행 직전과
confirmation 승인 직전에 같은 chain 순서를 다시 검사한다. catalog validator는 chain graph의 순환도
거부한다.

같은 사용자 prompt cycle에서 Tool 결과 뒤 이어지는 planning turn은 직전의 검증된 `toolRouting`을
재사용한다. Resolver target domain이 routed capability와 다르거나 제외 constraint와 충돌하면
frontier 계산 자체를 거부하고, 정상 target/constraint는 canonical fingerprint로 결정 입력에 포함한다.
새 사용자 발화 이후에는 완료 상태와 routing을 새 cycle로 계산한다.

## 평가와 privacy

canonical/held-out/adjacent-negative suite는 capability, tool chain, shortlist, fallback을 같은
catalog·schema SHA와 함께 기록한다. 관측에는 model/version, latency/token, confidence/fallback
taxonomy만 남기며 raw 사용자 발화, resource ID, token, raw tool payload는 저장하지 않는다.
