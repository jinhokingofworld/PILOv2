# SQLtoERD Agent 세션 선택 설계

## 목표

여러 SQLtoERD 세션이 있는 Workspace에서 메인 Agent가 후보를 실제로 보여주고, 사용자가 동일 제목 후보까지 정확한 세션으로 선택해 기존 run을 이어가도록 한다. 선택 UUID는 Agent 내부 계획에는 전달하되 사용자 메시지와 API 응답에는 노출하지 않는다.

## 범위

- `inspect_sql_erd_schema` clarification 질문에 최대 5개 후보의 번호, 정규화한 제목, 수정일을 포함한다.
- `waiting_user_input` 상태의 최신 SQLtoERD clarification 후보를 챗봇 선택 버튼으로 표시한다.
- 기존 `POST /agent/runs/:runId/inputs` 요청에 선택 정보를 선택적으로 추가한다.
- 선택 token이 최신 clarification 후보에 포함됐는지 서버 transaction 안에서 검증한다.
- 검증한 token을 AI Worker가 읽을 수 있는 내부 canonical marker로 저장한다.
- run 조회 응답은 canonical marker를 제거하고 서버가 확정한 제목 문장만 반환한다.
- 선택 후 같은 run에서 선택된 세션 inspect가 실행되는 2-turn 흐름을 회귀 테스트한다.
- 별도 선택 endpoint와 DB migration은 만들지 않는다.

## API 입력

기존 일반 입력은 그대로 유지한다.

```json
{
  "message": "오전 10시요"
}
```

SQLtoERD 후보 버튼은 다음 선택 정보를 함께 보낸다.

```json
{
  "message": "결제 ERD 세션을 선택했습니다.",
  "selection": {
    "kind": "sql_erd_session",
    "token": "77777777-7777-4777-8777-777777777777"
  }
}
```

`selection`은 선택적이며, `kind`는 현재 `sql_erd_session`만 허용한다. `token`은 UUID여야 한다. 서버는 선택 요청의 `message`를 신뢰해 저장하지 않고 최신 후보에서 읽은 제목으로 표시 문장을 다시 만든다.

## 서버 검증과 저장

`submitRunInput()`은 기존 run row lock과 같은 transaction에서 다음 순서로 처리한다.

1. run이 `waiting_user_input`인지 확인한다.
2. 선택 정보가 있으면 해당 run의 가장 최신 completed tool step을 조회한다.
3. 최신 step이 `inspect_sql_erd_schema`이고 `needs_clarification` 결과인지 확인한다.
4. 후보 배열이 5개 이하인지 확인하고, UUID·제목·수정일·table/relation count가 유효한 후보만 정규화한다.
5. 요청 token이 정규화한 후보에 정확히 한 번 포함됐는지 확인한다.
6. 후보에서 읽은 제목으로 표시 문장을 만들고, token은 내부 canonical marker에만 넣는다.
7. 기존 user message row에 canonical marker와 표시 문장을 저장하고 run/outbox를 재개한다.

Canonical 저장 형식은 다음과 같이 고정한다.

```text
[PILO_INTERNAL_SELECTION kind=sql_erd_session sessionSelectionToken=<uuid>]
<정규화된 제목> ERD 세션을 선택했습니다.
```

일반 입력은 marker 없이 기존 방식으로 저장한다. 현재 run의 최신 후보가 아니거나, 중복 token이거나, run이 이미 재개됐으면 요청을 거부한다. 이후 `getSession()`의 기존 사용자·Workspace 권한 검증은 그대로 수행한다.

## API 응답과 비노출 규칙

`AgentService`가 `agent_run_messages`를 응답 DTO로 변환할 때 canonical marker가 있으면 marker 줄 전체를 제거하고 표시 문장만 반환한다. marker가 불완전하거나 형식이 다르면 내부 선택으로 간주하지 않으며, 일반 사용자 입력 규칙을 적용한다.

따라서 다음 경로 모두 동일한 안전한 문장을 반환한다.

- 선택 직후 `submitRunInput()` 응답
- polling `getRun()` 응답
- 페이지 새로고침 후 run 재조회

AI Worker에는 저장된 원문 marker가 포함되므로 정확한 `sessionSelectionToken`을 다음 `inspect_sql_erd_schema` input에 복사할 수 있다. session token은 비밀값은 아니지만 사용자 UI에는 표시하지 않는다.

## 후보 fallback 문장

질문은 최대 5개 후보를 다음 형식으로 포함한다.

```text
사용할 SQLtoERD 세션을 선택해 주세요.
1. 결제 ERD · 수정 2026-07-17 10:30
2. 결제 ERD · 수정 2026-07-16 15:20
```

제목은 trim, 연속 공백 축약, 줄바꿈·제어문자 제거를 적용하고 길이를 제한한다. 유효하지 않은 날짜나 개수의 후보는 fallback과 버튼에서 제외한다.

## 프론트엔드 선택 버튼

프론트엔드는 run이 `waiting_user_input`일 때 completed tool step을 order 내림차순으로 확인한다. 가장 최신 completed tool step이 다음 조건을 모두 만족할 때만 버튼을 표시한다.

- `toolName === "inspect_sql_erd_schema"`
- `outputSummary.status === "needs_clarification"`
- candidates가 배열이며 길이가 1~5개

각 후보는 다음을 검증한다.

- UUID `selectionToken`
- 정규화 후 비어 있지 않고 제한 길이 이내인 제목
- 유효한 ISO 수정일
- 0 이상의 safe integer table/relation count
- 중복되지 않은 token

잘못된 후보는 무시한다. 중복 token은 선택의 모호성을 막기 위해 해당 token 후보를 모두 제외한다. 버튼에는 제목, 수정일, 테이블 수, 관계 수를 표시해 동일 제목을 구분한다.

버튼 클릭 시 사용자 bubble에는 `<제목> ERD 세션을 선택했습니다.`만 표시하고, API 요청에만 구조화된 selection을 포함한다. 요청이 시작되면 기존 busy ref를 즉시 설정해 연속 클릭을 차단한다. 이미 재개된 run에 대한 두 번째 요청은 서버의 row lock과 상태 검증으로 거부한다.

## AI Worker 평가 계약

`inspect_sql_erd_schema`는 `contextual` 도구이므로 planner 평가 fixture의 정상 결과는 `requiresConfirmation: null`이어야 한다.

## 테스트

### App Server

- 후보 질문에 정규화한 번호 목록이 포함된다.
- 선택 없는 일반 `/inputs` 입력은 기존과 동일하다.
- 선택 token이 최신 clarification 후보에 포함되지 않으면 거부한다.
- 최신 completed tool step이 다른 도구이면 이전 SQLtoERD 후보 token을 거부한다.
- 후보 token이 중복되거나 후보가 5개를 넘으면 거부한다.
- 선택 직후와 재조회 응답에서 marker와 UUID가 제거되고 제목만 표시된다.
- 첫 turn의 두 동일 제목 후보 중 두 번째 token을 선택하면 두 번째 session을 `getSession()`으로 조회한다.
- 선택된 session에도 기존 사용자·Workspace 접근 검증이 적용된다.

### Frontend

- `waiting_user_input`의 최신 inspect clarification 후보만 파싱한다.
- 동일 제목 후보를 수정일과 개수로 구분한다.
- UUID, 제목, 날짜, 개수, 최대 5개, 중복 token 검증을 고정한다.
- 버튼 클릭은 display message와 selection payload를 구분한다.
- busy 상태에서는 버튼이 비활성화된다.

### AI Worker

- `sql_erd_focus_payment_tables` fixture가 `requiresConfirmation: null`을 기대한다.

## 트레이드오프

구조화된 selection을 요청에 추가하므로 `/inputs` request 계약은 하위 호환 방식으로 확장된다. 대신 사용자가 임의의 marker를 직접 만들어 선택하는 것을 막고, 서버가 최신 후보를 transaction 안에서 검증할 수 있다.

별도 metadata column 대신 canonical marker를 기존 message content에 저장하므로 migration이 필요 없다. 그 대가로 모든 run message 응답 경로가 공통 marker 제거 함수를 사용해야 한다. 이 규칙을 조회 회귀 테스트로 고정한다.
