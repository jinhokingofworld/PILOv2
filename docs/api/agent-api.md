# Agent API

## 범위

Agent API는 Workspace 안에서 자연어 요청을 Agent run으로 생성하고, AI Worker의
계획/답변 생성 결과와 App Server의 tool 실행 상태를 조회하는 API다.

1차 Agent MVP는 위험한 쓰기만 확인하는 업무 Agent다. 한 run 안에서는 tool 결과를
이어서 계획하고, 부족한 정보만 사용자에게 질문한다.

- 자연어 채팅 입력
- 현재 active Workspace 문맥 사용
- Calendar 일정 조회, 생성, 수정
- MeetingReport 목록/상세 조회와 요약
- Board 문맥 확인, issue 검색·상세 문맥, briefing·최신성 진단
- Board issue 생성, Status 이동, 담당자 추가·제거
- Canvas 요청을 별도 Canvas Agent run으로 위임하고 그 결과를 그대로 전달
- write tool 실행 전 confirmation
- Agent run, step, confirmation 조회
- 실패 사유와 실행 결과 요약 조회

Agent API는 Calendar, Board, Meeting의 도메인 규칙을 재정의하지 않는다. 실제
Workspace 상태 변경은 기존 도메인 service/API 계약을 따른다.

## 소유와 영향 범위

- `AGENTS.md`에는 아직 Agent 도메인 owner가 정의되어 있지 않다.
- Agent API의 1차 소유 범위는 run 생성, planning 상태 조회, confirmation 승인/거절,
  Agent tool adapter 계약이다.
- Calendar, Board, Meeting 기능을 tool로 호출하더라도 해당 도메인의 API 계약과 권한
  규칙은 각 도메인 문서와 owner 기준을 따른다.
- 기존 Calendar, Board, Meeting API의 endpoint, request, response, status code, auth
  rule을 바꾸면 Agent 작업이 아니라 해당 도메인의 API 계약 변경으로 취급한다.
- `agent_runs`, `agent_steps`, `agent_confirmations`, `agent_logs` 같은 신규 테이블이
  필요하므로 구현 전 DB Schema owner 확인이 필요하다.

## 공통 규칙

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <pilo_access_token>`
- 모든 endpoint는 `/workspaces/{workspaceId}` 아래에 있다.
- `workspaceId`, `userId`, `createdBy`, `requestedByUserId`는 request body로 받지 않는다.
- 현재 사용자는 공통 인증 layer가 식별한 사용자다.
- 현재 사용자는 path의 `workspaceId`에 접근할 수 있어야 한다.
- Workspace 접근 권한이 없으면 `403 FORBIDDEN`을 반환한다.
- Agent 응답과 저장 데이터에는 provider raw response, token, secret, 복호화된 credential을 포함하지 않는다.
- Agent run 보존 기간은 생성 시점부터 30일이다. 목록·상세 조회는 현재 사용자와
  Workspace 범위에서 만료된 run을 최대 100건씩 삭제한다.
- Agent thread는 request body로 받지 않는 서버 소유 값이다. 첫 요청에서 생성하며, 같은
  Workspace·사용자의 마지막 활동이 1시간 이내면 다음 run을 자동으로 같은 thread에 연결한다.
  1시간이 지나면 다음 요청은 새 thread에서 시작한다. 이 판단은 브라우저 시간이 아니라 서버의
  `agent_threads.last_activity_at`만 사용한다.
- pending confirmation이 있는 thread는 1시간 경과만으로 새 thread로 바꾸지 않는다. 승인·거절 또는
  기존 confirmation 만료 처리 전까지 해당 thread와 run은 보존한다.
- 1차는 streaming 없이 polling으로 run 상태를 조회한다.
- `clientRequestId`는 선택값이며, 같은 Workspace와 요청자 안에서 run 생성 재시도 idempotency key로 사용한다.
- `requestContext`는 선택값이며, `null`, 서버가 현재 Workspace의 활성 session으로 재검증한
  `{ "surface": "sql_erd", "sessionId": "uuid" }`, `{ "surface": "pr_review", "sessionId": "uuid" }`,
  또는 현재 Canvas 화면이 만든 `{ "surface": "canvas", "canvasId": "uuid", "canvasContext": object }`를
  허용한다. SQLtoERD/PR Review context는 2 KiB 이내이며 Canvas context는 선택 장면을 포함해 192 KiB 이내다.

## 처리 구조

Agent run 생성 transaction은 run과 planning-job outbox intent를 함께 저장한다. App Server는
저장 직후 publisher를 깨워 SQS AI job 발행을 시도하고, 60초 recovery sweep으로 미발행 intent와
stale publisher claim을 재시도한다. AI Worker는 LLM을 호출해 intent, tool plan, 최종 답변 생성을
담당한다.

`agent_run_requested` SQS payload는 `runId`, `workspaceId`, `requestedByUserId`, immutable
`requestContext`, `toolSchemaVersion`, tool schema snapshot을 포함한다. `requestContext`는 클라이언트의
원본 자기신고가 아니라 App Server가 검증해 `agent_runs.request_context_json`에 저장한 값이다.
Canvas의 큰 `canvasContext`는 App Server의 위임 Tool에서만 사용하고 AI Worker에는
`{ "surface": "canvas", "canvasId": "uuid" }`만 전달한다.
planning job은 새 turn마다 별도 outbox row를 만들지 않는다. 기존 run당 한 행인
`agent_run_outbox`를 pending으로 rearm하면서 `turn_sequence`를 증가시키고, `reason`을
`run_created`, `user_input`, `tool_result` 중 하나로 기록한다. SQS payload에도 같은
`turnSequence`를 넣으며, AI Worker는 현재 outbox generation과 일치하지 않는 지연 job을 실행하지
않는다.

domain tool 실행은 read-only tool과 write tool 모두 App Server가 담당한다. AI Worker는
Calendar, Board, Meeting 도메인 service를 직접 호출하거나 도메인 DB를 직접 수정하지 않는다.
write tool은 App Server가 저장된 confirmation plan을 검증한 뒤 기존 domain service를 호출한다.

```text
Frontend
  -> App Server Agent API
    -> Agent run + outbox intent 저장 (same transaction)
    -> 즉시 publisher wake / 60초 recovery sweep
    -> SQS AI job enqueue (at-least-once)
      -> AI Worker LLM planning/answer generation
      -> App Server internal execution handoff
    -> App Server domain tool execution
      -> CalendarService / BoardService / MeetingService
      -> CanvasAgentService (delegated child run)
```

AI Worker가 `tool_candidate` planner 결과를 저장하면 인증된 내부 handoff로 App Server에 실행을
요청한다. handoff는 at-least-once 전달될 수 있으며, App Server는 이미 생성된 tool step 또는
confirmation을 중복 생성하지 않는다. 이 내부 endpoint는 public API가 아니며 사용자 bearer token을
받지 않는다.

`delegate_canvas_agent`가 실행되면 일반 Agent run은 `running`을 유지하고 Canvas Agent child run의
terminal 상태를 기다린다. App Server는 사용자의 최신 원문 prompt를 수정하거나 요약하지 않고 child run에
전달하며 `source=general_agent_delegate`, `parentAgentRunId=일반 Agent run id`로 연결한다. child run이
완료되면 Canvas Agent의 `resultSummary`를 두 번째 LLM 호출 없이 일반 Agent의 `finalAnswer`에 그대로
복사한다. 실패·취소도 child 상태에 맞춰 일반 Agent run을 terminal 상태로 정리한다.

일반 Agent run 조회는 연결된 Canvas Agent child run이 `executing`이면 해당 run의 대기 중 action을
명시적으로 진행한 뒤 terminal 결과를 즉시 정산한다. 주기적인 완료 감시는 유실·재시작 복구용으로
계속 유지하지만, PILO AI의 응답 완료가 새로운 Canvas AI 요청에 의존해서는 안 된다.

`search_meeting_transcript`는 read-only tool이지만 일반 formatter로 즉시 완료하지 않는다. App Server가
현재 사용자 권한으로 query embedding과 pgvector 검색을 수행한다. 검색 대상은 current transcript chunk와
`meeting_report_activity_evidence`의 안전한 snapshot(`occurredAt`, `action`, `summary`) chunk다. raw
`activity_logs.metadata`, 원본 도메인 객체, transcript 전문은 RAG table·outbox·SQS·Agent run/step/log에
저장하지 않는다. App Server는 namespaced source ID(`transcript:<uuid>`, `activity:<uuid>`)만 가진
`agent_grounded_answer_outbox`를 저장한다. AI Worker는 내부 인증 endpoint에서만 bounded evidence excerpt를
일회성으로 받아 두 번째 LLM 호출을 수행한다. 직접 decision/action item에 연결된 Activity evidence에는 제한된
relevance boost만 적용한다. 두 source type이 모두 있으면 transcript와 Activity를 각각 최소 한 건씩 보존하고,
후보 chunk 사이 cosine distance가 0.12 이하인 경우에는 의미 중복 group 안에서 source type별 최상위 후보만
남긴다. 따라서 직접 연결된 Activity가 많아도 transcript가 전부 밀려나지 않으며, 같은 근거를 여러 chunk가
차지하지 않는다. final citation은 outbox source ID의 부분집합만 허용하며, answer step에는 source type과 안전한
시간/summary metadata만 저장해 UI가 구분 표시한다.

## 실행 모델

- 하나의 `agent_run` 안에서는 사용자 추가 입력, assistant 질문, bounded tool 결과를 발생 시각·순서가
  보존된 하나의 timeline으로 기억한다. 같은 서버 소유 thread의 새 run에는 최근 완료 run의 사용자 prompt,
  사용자에게 표시된 final answer, 안전한 resource ref만 bounded context로 추가한다. raw tool input/output,
  transcript, Activity Log metadata, provider payload·token·secret은 thread context에 넣지 않는다.
- thread는 UI 목록이나 “새 대화” 버튼으로 선택하지 않는다. 첫 요청에서 만들고 서버 `last_activity_at`
  기준 1시간 안의 다음 요청·새로고침 후 요청만 자동 복구한다. 1시간 후에는 새 thread를 자동 생성한다.
- 한 번의 사용자 입력으로 시작한 요청 구간에서 planner turn과 tool 실행은 각각 최대 5회다.
  한도를 넘기면 실패시키지 않고 다음 요청을 받기 위해 `waiting_user_input`으로 전환한다.
  사용자가 `POST .../inputs`로 보완 입력을 제출하면 다음 요청 구간의 두 budget은 0부터 다시 시작한다.
- planner의 `needs_clarification` 결과는 terminal 완료가 아니다. assistant 질문을 저장하고 run을
  `waiting_user_input`으로 전환한다.
- `waiting_user_input`은 24시간 뒤 `cancelled` 처리한다. 사용자는 새 요청으로 재개한다.
- read-only 요청은 confirmation 없이 자동 실행할 수 있다.
- tool `executionMode`는 `auto`, `confirmation_required`, `contextual` 중 하나다.
- `contextual` tool은 저장된 `requestContext`를 기준으로 App Server의 `prepareExecution`이 즉시 실행,
  confirmation, clarification 중 하나를 결정한다. AI Worker는 이 모드의 `requiresConfirmation`을
  `null`로 기록한다.
- `search_meeting_transcript`는 `query`와 선택 `reportId`만 받고, Workspace 전체의 owner 또는 해당
  회의의 현재·과거 참여자가 접근 가능한 current transcript chunk와 Activity evidence chunk를 합쳐 최대 5개
  검색한다. 두 source type이 모두 있으면 최소 한 건씩 포함하며, 의미 중복 chunk는 source type별 대표만
  포함한다. 결과가 없으면 LLM answer phase를 호출하지 않는다.
- write 요청은 `waiting_confirmation` 상태의 run과 pending confirmation을 만든다.
- 사용자가 승인하면 서버는 confirmation에 저장된 plan만 실행한다.
- 승인 transaction은 `running` tool step을 execution claim으로 함께 만든다. 승인 직후 process가
  중단돼도 tool step이 없는 `running` run을 남기지 않는다.
- AI Worker는 60초마다 2분 이상 stale인 승인 execution을 확인한다. `running` tool step이 남아 있으면
  domain tool을 재실행하지 않고 safe failure로 terminal 상태를 만든다.
- 같은 recovery 호출은 5분 lease가 만료된 Meeting action-item delivery도 `DELIVERY_FAILED`로
  되돌린다. Board delivery 재시도는 최초 요청자, 저장된 draft, idempotency key를 재사용한다.
- 사용자가 거절하거나 confirmation이 만료되면 write tool은 실행하지 않는다.
- confirmation 만료 시간은 생성 시점 기준 15분이다.
- 목록·상세 조회 전에 서버는 만료된 pending confirmation을 `expired`로 전환하고,
  해당 `waiting_confirmation` run을 `cancelled`로 전환한다.
- 별도 일일 cleanup 작업은 두지 않는다. 목록·상세 조회에서 30일이 지난 run을
  최대 100건씩 삭제하며, run 삭제의 FK cascade로 step, confirmation, log도 함께 삭제된다.
- 상대 날짜 해석 기준은 사용자 timezone이다.
- 요청에 timezone이 없으면 `Asia/Seoul`을 사용한다.

## 저장 규칙

| 항목 | 저장 여부 | 규칙 |
| --- | --- | --- |
| prompt 원문 | 저장 | 사용자가 입력한 요청 원문을 저장한다. |
| final answer | 저장 | 사용자에게 보여준 최종 답변을 저장한다. |
| tool input | 제한 저장 | 실행에 필요한 최소 JSON만 저장한다. |
| tool output | 제한 저장 | 요약, resource id, 상태만 저장한다. |
| confirmation plan JSON | 저장 | 승인 시 그대로 실행해야 하므로 저장한다. 단, 실행에 필요한 값만 포함한다. |
| agent log metadata | 제한 저장 | Agent 전용 문제 추적 로그에는 bounded metadata, resource id, 상태만 저장한다. |
| 긴 원문/전문/transcript | 저장 금지 | MeetingReport transcript 전문, 긴 문서 전문 등은 저장하지 않는다. |
| provider raw response | 저장 금지 | OpenAI/GitHub 등 provider raw payload는 저장하지 않는다. |
| token/secret/credential | 저장 금지 | OAuth token, installation token, secret, encrypted token 원문은 저장하지 않는다. |

## 상태값

### AgentRun status

| 값 | 의미 |
| --- | --- |
| `planning` | run이 생성됐고 AI Worker가 요청을 해석하거나 tool plan을 만드는 중 |
| `waiting_user_input` | 추가 정보 또는 최대 실행 횟수 이후의 다음 요청을 기다리는 중 |
| `waiting_confirmation` | write tool 실행 전 사용자 확인을 기다리는 중 |
| `running` | 승인된 tool 실행 또는 최종 답변 생성 중 |
| `completed` | read-only 답변 또는 write 실행 결과가 완료됨 |
| `failed` | 실행 중 복구 불가능한 실패가 발생함 |
| `cancelled` | 사용자가 confirmation을 거절했거나 confirmation 만료로 실행이 취소됨 |

`planning`은 outbox publisher가 SQS 발행을 재시도하는 상태와, SQS enqueue 이후 AI Worker가 아직
처리하지 않은 queued 상태를 포함한다.

### AgentStep status

| 값 | 의미 |
| --- | --- |
| `pending` | 아직 실행 전 |
| `running` | 실행 중 |
| `completed` | 성공 |
| `failed` | 실패 |
| `skipped` | 선행 실패, 사용자 거절, 만료 때문에 실행하지 않음 |

### AgentConfirmation status

| 값 | 의미 |
| --- | --- |
| `pending` | 승인 대기 |
| `approved` | 승인됨 |
| `rejected` | 거절됨 |
| `expired` | 만료됨 |

### Risk level

| 값 | 의미 | 정책 |
| --- | --- | --- |
| `low` | 조회, 요약, 문맥 수집 | 자동 실행 가능 |
| `medium` | Calendar 생성/수정, Board issue 생성·status 이동·담당자 변경 | confirmation 필요 |
| `high` | 삭제, PR Review 제출, 승인되지 않은 외부 GitHub metadata 변경 | 1차 Agent API에서 실행하지 않음 |

## Payload

### AgentRun

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | Agent run id |
| `workspaceId` | string | Workspace id |
| `requestedByUserId` | string | 요청 사용자 id |
| `clientRequestId` | string \| null | run 생성 재시도 방지용 idempotency key |
| `requestContext` | object \| null | 서버 검증을 거쳐 저장된 화면 context snapshot |
| `status` | AgentRun status | run 상태 |
| `riskLevel` | Risk level \| null | run에서 확인된 최고 위험도 |
| `prompt` | string | 사용자 입력 원문 |
| `timezone` | string | 상대 날짜 해석 기준 timezone |
| `message` | string \| null | 현재 상태를 설명하는 짧은 메시지 |
| `finalAnswer` | string \| null | 최종 답변. 완료 전이면 null |
| `errorMessage` | string \| null | 사용자에게 보여줄 안전한 실패 메시지 |
| `expiresAt` | string | ISO datetime. 생성 후 30일 |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |
| `completedAt` | string \| null | ISO datetime |
| `steps` | AgentStep[] | 상세 조회에서 포함 |
| `confirmation` | AgentConfirmation \| null | pending 또는 최신 confirmation |

### AgentStep

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | step id |
| `runId` | string | Agent run id |
| `order` | number | run 안의 실행 순서 |
| `type` | `planner` \| `tool` \| `answer` | step 유형 |
| `status` | AgentStep status | step 상태 |
| `toolName` | string \| null | tool step이면 tool 이름 |
| `riskLevel` | Risk level \| null | step 위험도 |
| `inputSummary` | object \| null | 저장 가능한 최소 입력 요약 |
| `outputSummary` | object \| null | 저장 가능한 출력 요약 |
| `resourceRefs` | array | 생성/수정/조회한 resource id와 표시 정보 |
| `errorMessage` | string \| null | 안전한 실패 메시지 |
| `startedAt` | string \| null | ISO datetime |
| `completedAt` | string \| null | ISO datetime |

`inputSummary`와 `outputSummary`에는 긴 원문, transcript, provider raw, token, secret을
포함하지 않는다.

### AgentResourceRef

tool step의 `resourceRefs`는 다음 bounded object 배열이다.

| Field | Type | 설명 |
| --- | --- | --- |
| `domain` | string | resource 소유 도메인 |
| `resourceType` | string | 도메인 안의 resource 종류 |
| `resourceId` | string | 서버가 검증한 resource 식별자 |
| `label` | string \| undefined | 사용자 표시용 짧은 이름 |
| `url` | string \| undefined | 앱 내부에서 검증 후 사용할 상대 경로 |
| `status` | string \| undefined | 생성·수정 등 bounded 결과 상태 |
| `metadata` | object \| undefined | 화면 표시에 필요한 bounded metadata |

클라이언트는 `url`을 그대로 신뢰하지 않는다. SQLtoERD session 링크는 run과 tool step이
모두 `completed`일 때만 표시하고, `/sql-erd/session?sessionId={resourceId}`와 정확히
일치하는 same-origin 상대 경로만 허용한다. 외부 origin, protocol-relative URL, 추가
query/hash, 중복·불일치 session ID는 거부한다. 링크 표시는 자동 navigation을 발생시키지 않는다.
`status=focused`인 SQLtoERD ref의 `metadata`는 아래 `table_focus` 계약을 추가로 검증한다.
검증된 값은 URL에 넣지 않고 일회성 `sessionStorage`와 동일 페이지 event로만 전달하며,
SQLtoERD 화면에서 소비한 즉시 제거한다.

### AgentConfirmation

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | confirmation id |
| `runId` | string | Agent run id |
| `status` | AgentConfirmation status | confirmation 상태 |
| `riskLevel` | Risk level | confirmation 대상 작업 위험도 |
| `plan` | AgentConfirmationPlan | 승인 시 실행할 plan |
| `expiresAt` | string | ISO datetime. 생성 후 15분 |
| `approvedAt` | string \| null | ISO datetime |
| `rejectedAt` | string \| null | ISO datetime |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |
| `selectedChoiceId` | string \| null | choice plan 승인 시 원자적으로 저장된 선택 ID |

### AgentConfirmationPlan

기존 approval plan과 choice plan의 union이다. `kind`가 없으면 기존 approval plan으로 해석한다.

| Field | Type | 설명 |
| --- | --- | --- |
| `toolName` | string | 실행할 Agent tool 이름 |
| `summary` | string | 사용자가 확인할 실행 요약 |
| `target` | object | 변경 대상 domain/resource 정보 |
| `before` | object \| null | 현재 값 요약. 생성 작업이면 null 가능 |
| `after` | object | 변경 예정 값 |
| `call` | object | 내부 실행에 필요한 method/path 또는 service action 요약 |

choice plan은 다음 필드를 사용한다.

| Field | Type | 설명 |
| --- | --- | --- |
| `kind` | `choice` | 선택형 confirmation discriminator |
| `toolName` | string | 실행할 Agent tool 이름 |
| `summary` | string | 사용자에게 보여줄 선택 요청 요약 |
| `target` | object | 대상 domain/resource 요약 |
| `call` | object | 선택 후 내부 실행 action 요약 |
| `choices` | array | 1~10개 선택지. 각 항목은 고유한 `id`, `label`, 실행용 `input`을 가진다. |

`plan`은 승인 시 서버가 그대로 실행하는 기준이다. 클라이언트는 approve 요청에서 실행
값을 다시 보내지 않는다.

예:

```json
{
  "toolName": "create_calendar_event",
  "summary": "2026-07-08 15:00-16:00에 주간 회의 일정을 생성합니다.",
  "target": {
    "domain": "calendar",
    "resourceType": "event"
  },
  "before": null,
  "after": {
    "title": "주간 회의",
    "description": null,
    "isAllDay": false,
    "startDate": "2026-07-08",
    "endDate": "2026-07-08",
    "startTime": "15:00",
    "endTime": "16:00",
    "color": "#3B82F6"
  },
  "call": {
    "method": "POST",
    "path": "/api/v1/workspaces/{workspaceId}/calendar/events"
  }
}
```

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/agent/runs` | 자연어 prompt로 Agent run 생성 |
| `GET` | `/workspaces/{workspaceId}/agent/runs` | 현재 Workspace의 Agent run 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/agent/runs/{runId}` | Agent run 상세 조회 |
| `POST` | `/workspaces/{workspaceId}/agent/runs/{runId}/inputs` | `waiting_user_input` run에 추가 입력 전달 |
| `POST` | `/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/approve` | confirmation 승인 후 저장된 plan 실행 |
| `POST` | `/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/reject` | confirmation 거절 |

## Run 생성

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs
```

Request:

```json
{
  "prompt": "내일 오후 3시에 주간 회의 일정 만들어줘.",
  "timezone": "Asia/Seoul",
  "clientRequestId": "agent-run-20260707-0001",
  "requestContext": {
    "surface": "sql_erd",
    "sessionId": "sql_erd_session_uuid"
  }
}
```

| Field | Required | 설명 |
| --- | --- | --- |
| `prompt` | Yes | 사용자 자연어 요청. 빈 문자열 불가 |
| `timezone` | No | IANA timezone. 없으면 `Asia/Seoul` |
| `clientRequestId` | No | 클라이언트가 재시도 방지를 위해 보내는 idempotency key. 최대 128 bytes |
| `requestContext` | No | `null`, SQLtoERD/PR Review context 또는 Canvas context. Canvas는 최대 192 KiB, 그 외는 최대 2 KiB |

서버 규칙:

- request body의 `workspaceId`, `userId`, `createdBy`, `requestedByUserId`는 무시하지 않고 받지 않는다.
- `prompt`는 trim 후 저장한다.
- `timezone`이 없으면 `Asia/Seoul`을 저장한다.
- `clientRequestId`가 있으면 같은 Workspace와 요청자가 같은 key로 만든 run을 중복 생성하지 않는다.
- 클라이언트는 `threadId`를 보내거나 선택할 수 없다. App Server가 현재 Workspace·요청 사용자와 pending
  confirmation 여부를 재검증해 thread를 선택하거나 새로 만든다.
- `requestContext.surface`는 `sql_erd`, `pr_review`, `canvas`만 허용한다. SQLtoERD/PR Review는 UUID
  `sessionId`만, Canvas는 UUID `canvasId`와 plain-object `canvasContext`만 허용한다.
- App Server는 SQLtoERD session, PR Review session 또는 freeform Canvas가 현재 Workspace에 속하고
  유효한지 재검증한다.
- 같은 `clientRequestId`, `prompt`, `timezone`, `requestContext`로 재시도하면 기존 run을 반환하고 새 outbox intent를 만들지 않는다.
- 같은 `clientRequestId`로 다른 `prompt`, `timezone` 또는 `requestContext`를 보내면 `409 CLIENT_REQUEST_ID_CONFLICT`를 반환한다.
- 새 run은 `planning` 상태와 pending outbox intent를 같은 transaction으로 생성한다.
- App Server는 생성 직후 publisher를 깨워 Agent planning job 발행을 시도한다. SQS 발행 오류도 새 run의
  `201 Created` 응답을 바꾸지 않으며 run은 `planning`을 유지한다.
- publisher는 1, 2, 4, 8, 16분 backoff로 최대 5회 재시도한다. 재시도 소진 후에만 run을 safe `failed`로
  전환하고 Agent log에 운영용 event를 남긴다.
- AI Worker planner의 infrastructure failure는 원본 SQS queue에서 세 번째 수신까지 재시도한다. 세 번째
  수신에서 `planning` run과 남은 planner step을 safe `failed`로 전환하는 DB transaction이 성공할 때만
  메시지를 삭제한다. 이 transaction도 실패하면 메시지는 삭제하지 않아 DLQ 보관함으로 이동한다.
- SQS send 성공 뒤 publisher 상태 저장 전에 process가 종료되면 같은 job이 다시 발행될 수 있다. AI Worker의
  run lock과 상태 전이가 중복 planner 실행을 막는다.
- 클라이언트는 응답의 `run.id`로 상세 조회를 polling한다.

응답:

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "agent_run_uuid",
      "workspaceId": "workspace_uuid",
      "requestedByUserId": "user_uuid",
      "clientRequestId": "agent-run-20260707-0001",
      "requestContext": {
        "surface": "sql_erd",
        "sessionId": "sql_erd_session_uuid"
      },
      "status": "planning",
      "riskLevel": null,
      "prompt": "내일 오후 3시에 주간 회의 일정 만들어줘.",
      "timezone": "Asia/Seoul",
      "message": "요청을 분석하고 있습니다.",
      "finalAnswer": null,
      "errorMessage": null,
      "expiresAt": "2026-08-06T00:00:00.000Z",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z",
      "completedAt": null,
      "steps": [],
      "confirmation": null
    }
  }
}
```

Status code: 새 run 생성은 `201 Created`, 기존 run idempotent 반환은 `200 OK`

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | prompt가 없거나 timezone이 잘못됨 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 |
| `409` | `CLIENT_REQUEST_ID_CONFLICT` | 같은 clientRequestId로 다른 요청을 보냄 |
| `503` | `SERVICE_UNAVAILABLE` | Agent run storage 사용 불가 |

## Run 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/agent/runs?status=completed&page=1&limit=20
```

Query:

| Name | Required | 설명 |
| --- | --- | --- |
| `status` | No | AgentRun status |
| `page` | No | 기본값 1 |
| `limit` | No | 기본값 20, 최대 100 |

서버 규칙:

- 현재 사용자가 생성한 run만 반환한다.
- 현재 Workspace의 30일 보존 기간 안에 있는 run만 반환한다.
- 정렬은 `createdAt DESC`다.
- 목록 응답에는 step 상세를 포함하지 않는다.

응답:

```json
{
  "success": true,
  "data": {
    "runs": [
      {
        "id": "agent_run_uuid",
        "workspaceId": "workspace_uuid",
        "requestedByUserId": "user_uuid",
        "clientRequestId": "agent-run-20260707-0001",
        "status": "waiting_confirmation",
        "riskLevel": "medium",
        "prompt": "내일 오후 3시에 주간 회의 일정 만들어줘.",
        "timezone": "Asia/Seoul",
        "message": "일정 생성 전 확인이 필요합니다.",
        "finalAnswer": null,
        "errorMessage": null,
        "expiresAt": "2026-08-06T00:00:00.000Z",
        "createdAt": "2026-07-07T00:00:00.000Z",
        "updatedAt": "2026-07-07T00:00:03.000Z",
        "completedAt": null,
        "confirmation": {
          "id": "confirmation_uuid",
          "status": "pending",
          "riskLevel": "medium",
          "expiresAt": "2026-07-07T00:15:03.000Z"
        }
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1
    }
  }
}
```

주요 오류: `400`, `401`, `403`

## Run 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/agent/runs/{runId}
```

서버 규칙:

- 현재 사용자가 생성한 run만 조회할 수 있다.
- run은 path의 `workspaceId`에 속해야 한다.
- 이 조회는 새로운 tool execution을 시작하거나 기존 tool step의 실행 상태를 변경하지 않는다.
- `messages`는 같은 run에 append된 `user`, `assistant` message를 `sequence ASC`로 반환한다.
  step과 함께 표시하는 클라이언트는 각 항목의 생성·완료 시각을 기준으로 시간 순서를 유지한다.
- 다만 request-time lifecycle 정책에 따라 만료된 pending confirmation을 `expired`로 전환하고,
  해당 `waiting_confirmation` run을 `cancelled`로 전환할 수 있다.
- 같은 lifecycle에서 현재 사용자·Workspace의 30일 경과 run을 최대 100건 삭제할 수 있다.

응답:

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "agent_run_uuid",
      "workspaceId": "workspace_uuid",
      "requestedByUserId": "user_uuid",
      "clientRequestId": "agent-run-20260707-0001",
      "status": "waiting_confirmation",
      "riskLevel": "medium",
      "prompt": "오후 3시에 주간 회의 일정 만들어줘.",
      "timezone": "Asia/Seoul",
      "message": "일정 생성 전 확인이 필요합니다.",
      "finalAnswer": null,
      "errorMessage": null,
      "expiresAt": "2026-08-06T00:00:00.000Z",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:03.000Z",
      "completedAt": null,
      "messages": [
        {
          "id": "agent_message_uuid_1",
          "sequence": 1,
          "role": "assistant",
          "content": "어느 날짜의 오후 3시인지 알려주세요.",
          "createdAt": "2026-07-07T00:00:02.000Z"
        },
        {
          "id": "agent_message_uuid_2",
          "sequence": 2,
          "role": "user",
          "content": "내일 오후 3시로 해줘",
          "createdAt": "2026-07-07T00:00:03.000Z"
        }
      ],
      "steps": [
        {
          "id": "agent_step_uuid",
          "runId": "agent_run_uuid",
          "order": 1,
          "type": "planner",
          "status": "completed",
          "toolName": null,
          "riskLevel": "medium",
          "inputSummary": {
            "promptLength": 25,
            "timezone": "Asia/Seoul"
          },
          "outputSummary": {
            "intent": "calendar.create_event",
            "requiresConfirmation": true
          },
          "resourceRefs": [],
          "errorMessage": null,
          "startedAt": "2026-07-07T00:00:01.000Z",
          "completedAt": "2026-07-07T00:00:03.000Z"
        }
      ],
      "confirmation": {
        "id": "confirmation_uuid",
        "runId": "agent_run_uuid",
        "status": "pending",
        "riskLevel": "medium",
        "plan": {
          "toolName": "create_calendar_event",
          "summary": "2026-07-08 15:00-16:00에 주간 회의 일정을 생성합니다.",
          "target": {
            "domain": "calendar",
            "resourceType": "event"
          },
          "before": null,
          "after": {
            "title": "주간 회의",
            "description": null,
            "isAllDay": false,
            "startDate": "2026-07-08",
            "endDate": "2026-07-08",
            "startTime": "15:00",
            "endTime": "16:00",
            "color": "#3B82F6"
          },
          "call": {
            "method": "POST",
            "path": "/api/v1/workspaces/{workspaceId}/calendar/events"
          }
        },
        "expiresAt": "2026-07-07T00:15:03.000Z",
        "approvedAt": null,
        "rejectedAt": null,
        "createdAt": "2026-07-07T00:00:03.000Z",
        "updatedAt": "2026-07-07T00:00:03.000Z"
      }
    }
  }
}
```

주요 오류: `401`, `403`, `404`

## 추가 입력 전달

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/inputs
```

Request:

```json
{ "message": "금요일 오후 3시로 해줘" }
```

SQLtoERD session 후보 버튼을 선택하면 기존 endpoint에 선택 정보를 추가한다.

```json
{
  "message": "결제 ERD 세션을 선택했습니다.",
  "selection": {
    "kind": "sql_erd_session",
    "token": "sql_erd_session_uuid"
  }
}
```

Meeting resource 후보 버튼은 별도의 server-owned candidate ID만 전송한다.

```json
{
  "message": "김진호 후보를 선택했습니다.",
  "selection": {
    "kind": "meeting_candidate",
    "candidateSelectionId": "agent_candidate_selection_uuid"
  }
}
```

- `waiting_user_input` 상태인 본인 run에만 전달할 수 있다.
- `message`는 trim 후 1~4,000 bytes여야 한다.
- `selection`은 선택값이며 정확히 `{ kind: "sql_erd_session", token: "uuid" }`만 허용한다.
  서버는 같은 transaction에서 최신 completed tool step이 `inspect_sql_erd_schema`
  clarification인지 확인하고, token이 그 step의 유효한 최대 5개 후보에 정확히 한 번 포함될 때만
  run을 재개한다. 이전 clarification, 중복 token, 잘못된 후보는 사용할 수 없다.
- SQLtoERD 선택 message의 표시 제목은 request 값을 신뢰하지 않고 검증한 최신 후보 title로
  다시 만든다. 내부 planning memory에는 선택 token을 canonical marker로 보존하지만
  `submitRunInput`과 이후 run 조회의 `messages[].content`에는 marker나 UUID를 반환하지 않는다.
- Meeting candidate selection은 정확히 `{ kind: "meeting_candidate", candidateSelectionId: "uuid" }`만
  허용한다. candidate ID는 후보 버튼 이외의 값으로 만들거나 해석하지 않는다. App Server는 같은
  transaction에서 `runId`, Workspace, 요청 사용자, 미소비 상태와 15분 TTL을 확인하고 한 번만 소비한다.
  생성 source인 최신 clarification tool step과도 일치해야 한다. resource reference와 Phase 2 selection
  token은 `agent_candidate_selections` 서버 저장소에만 두며,
  browser, Agent message, SQS, provider prompt에는 넣지 않는다. 선택 직전 resource 존재와 Workspace
  접근을 재검증하지 못하면 run을 재개하거나 tool을 실행하지 않는다.
- 서버는 같은 run의 append-only memory에 저장한 뒤 `planning`으로 되돌린다. 같은 transaction에서
  planner/tool budget을 새 요청 구간 기준 0으로 초기화하고, 기존 `agent_run_outbox`의
  `turn_sequence`를 증가시켜 `reason = 'user_input'`인 pending turn으로 rearm한다.
- 선택한 resource reference가 필요한 Meeting tool은 raw ID를 받지 않는다. 회의방은
  `start_meeting_in_room.useSelectedMeetingRoomCandidate: true`, Meeting은
  `useSelectedMeetingCandidate: true`, 회의록은 `useSelectedMeetingReportCandidate: true`를 쓰며,
  App Server가
  같은 run의 최신 소비 후보를 resource type별로 다시 검증해 tool input에 주입한다.
- 24시간이 지나면 run은 `cancelled` 처리되며, 새 run으로 요청해야 한다.

## Confirmation 승인

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/approve
```

기존 approval plan은 request body가 없거나 빈 object여야 한다.

choice plan은 다음 body로 정확히 하나의 선택지를 보낸다.

```json
{
  "choiceId": "replace_schema"
}
```

서버 규칙:

- confirmation은 `pending` 상태여야 한다.
- confirmation은 만료되지 않아야 한다.
- 서버는 저장된 `plan`만 실행한다.
- approval plan의 approve 요청에는 실행 값, 변경 값, resource id를 받지 않는다.
- choice plan은 저장된 `choices[].id` 중 하나만 허용하며, 선택지의 저장된 `input`만 실행한다.
- 선택한 `choiceId`는 confirmation의 `selectedChoiceId`로 승인 상태와 같은 transaction에서 저장한다.
- approval plan의 non-empty body, choice plan의 누락·미등록 choiceId·추가 field는 `400 BAD_REQUEST`다.
- 실행 전 Workspace 접근 권한을 다시 확인한다.
- write tool은 기존 도메인 service/API 계약을 따른다.
- 실행 성공 후 step에는 출력 요약, resource id, 상태만 저장한다.
- `create_board_issue`가 `502` 또는 처리 중인 `409`처럼 재시도 가능한 오류로 실패하면, 승인된 confirmation은 감사 이력으로 남기고 같은 run에 동일한 plan과 idempotency key를 가진 새 pending confirmation을 생성한다. 이를 승인하면 기존 Board 생성 checkpoint에서 재개한다.
- `assign_board_issue_safely`에도 같은 재시도 정책을 적용한다. 새 pending confirmation은 승인된 추가·제거 delta를 보존하며, 승인하면 cache된 전체 담당자 목록을 재생하지 않고 해당 delta를 다시 시도한다.
- 영구적인 `400`, `403`, `404` 오류에는 새 confirmation을 만들지 않고 run을 `failed`로 끝낸다.

응답:

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "agent_run_uuid",
      "status": "running",
      "message": "승인된 작업을 실행하고 있습니다.",
      "confirmation": {
        "id": "confirmation_uuid",
        "status": "approved",
        "approvedAt": "2026-07-07T00:03:00.000Z"
      }
    }
  }
}
```

Status code: `200 OK`

승인 직후 tool 실행과 답변 생성이 모두 끝난 경우 `status`는 `completed`일 수 있다.
클라이언트는 terminal status가 될 때까지 run 상세를 polling한다.

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | request body가 있거나 plan payload가 실행 불가능함 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 또는 도메인 권한 없음 |
| `404` | `NOT_FOUND` | run 또는 confirmation을 찾을 수 없음 |
| `409` | `CONFIRMATION_NOT_PENDING` | 이미 승인, 거절, 만료된 confirmation |
| `409` | `CONFIRMATION_EXPIRED` | confirmation 만료 |
| `502` | `BAD_GATEWAY` | GitHub 등 외부 provider write 실패. raw error는 노출하지 않음 |

## Confirmation 거절

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/reject
```

Request body 없음.

서버 규칙:

- confirmation은 `pending` 상태여야 한다.
- 서버는 write tool을 실행하지 않는다.
- confirmation은 `rejected`, run은 `cancelled` 상태가 된다.
- 이미 승인, 거절, 만료된 confirmation은 변경하지 않는다.

응답:

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "agent_run_uuid",
      "status": "cancelled",
      "message": "사용자가 실행을 취소했습니다.",
      "confirmation": {
        "id": "confirmation_uuid",
        "status": "rejected",
        "rejectedAt": "2026-07-07T00:03:00.000Z"
      }
    }
  }
}
```

Status code: `200 OK`

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | request body가 있음 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 |
| `404` | `NOT_FOUND` | run 또는 confirmation을 찾을 수 없음 |
| `409` | `CONFIRMATION_NOT_PENDING` | 이미 승인, 거절, 만료된 confirmation |

## 1차 Tool 목록

| Tool | 위험도 | 자동 실행 | 기존 도메인 계약 |
| --- | --- | --- | --- |
| `list_calendar_events` | `low` | 가능 | `GET /workspaces/{workspaceId}/calendar/events` |
| `create_calendar_event` | `medium` | 불가 | `POST /workspaces/{workspaceId}/calendar/events` |
| `update_calendar_event` | `medium` | 불가 | `PATCH /workspaces/{workspaceId}/calendar/events/{eventId}` |
| `list_meeting_rooms` | `low` | 가능 | Workspace 회의방과 방별 현재 Meeting·녹음 상태를 조회한다. |
| `get_active_meeting` | `low` | 가능 | 현재 사용자의 active Meeting과 회의방, 경과 시간을 조회한다. |
| `get_meeting_participants` | `low` | 조건부 | 현재 참여 Meeting 또는 `roomName` selector로 내부 해소 후 참여자를 조회한다. |
| `list_meeting_reports` | `low` | 가능 | `GET /workspaces/{workspaceId}/meeting-reports` |
| `get_meeting_report` | `low` | 가능 | `GET /workspaces/{workspaceId}/meeting-reports/{reportId}` |
| `summarize_meeting_report` | `low` | 가능 | MeetingReport 조회 결과를 요약한다. transcript 전문은 저장하지 않는다. |
| `search_meeting_transcript` | `low` | 가능 | 권한 있는 transcript source를 검색하고 grounded-answer 경로를 시작한다. |
| `search_board_issues` | `low` | 가능 | `GET /workspaces/{workspaceId}/boards/{boardId}/issues` |
| `move_board_issue_status` | `medium` | 불가 | `PATCH /workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status` |
| `get_board_issue_context` | `low` | 가능 | Board issue 상세와 동기화된 관련 PR cache 조회 |
| `create_board_issue` | `medium` | 불가 | `POST /workspaces/{workspaceId}/boards/{boardId}/issues` |
| `resolve_board_context` | `low` | 가능 | 명시 Board → active Board → 유일한 Board 순서로 대상 확인 |
| `get_board_briefing` | `low` | 가능 | Board 상세, column, filter option의 사실 기반 요약 |
| `assign_board_issue_safely` | `medium` | 불가 | `GET .../assignee-options`, Agent 전용 내부 add/remove Board service |
| `diagnose_board_freshness` | `low` | 가능 | active source, Board/issue/PR cache freshness와 Unmapped 진단 |
| `generate_sql_erd` | `medium` | 상황별 | `SqlErdSchemaSpecV1`을 검증해 새 session을 만들거나 현재 operations_v1 session의 schema를 교체 |
| `inspect_sql_erd_schema` | `low` | 가능 | session의 modelJson을 bounded compact projection으로 조회하고 여러 session이면 사용자 선택을 요청 |
| `focus_sql_erd_tables` | `low` | 가능 | inspect 결과의 compact ref와 `modelFingerprint`를 재검증해 일회성 `table_focus` resource ref 생성 |
| `recommend_pr_review_focus` | `low` | 가능 | PR Review context의 immutable revision 안전 projection에서 핵심 검토 파일과 연결 파일을 추천 |
| `delegate_canvas_agent` | `low` | 가능 | 사용자 원문과 검증된 Canvas context를 별도 Canvas Agent run으로 위임 |

> `assign_board_issue_safely`는 공개 assignee option 조회 계약을 사용하지만, 실행은 내부 add/remove
> Board service 경로를 사용한다. 별도의 공개 endpoint는 추가하지 않는다.

## 도메인별 실행 규칙

### SQLtoERD

- `generate_sql_erd`는 완성된 DDL 문자열이 아니라 전체 `SqlErdSchemaSpecV1` object만
  planner input으로 받는다. App Server가 같은 schema를 다시 검증하고 DDL·modelJson·layoutJson을
  결정적으로 생성하며 실제 데이터베이스에는 실행하지 않는다.
- planner input에는 `targetMode`, `sessionId`, `workspaceId`, `userId`, `currentUserId`를 넣지 않는다.
  현재 사용자·Workspace·run은 `AgentToolContext`에서만 주입한다.
- SQLtoERD request context가 없으면 새 session을 즉시 생성한다. context가 있으면 App Server가
  session 접근과 write protocol을 다시 검증한다. `snapshot` session에서는 `new_session`만 제공하고,
  `operations_v1` session에서는 `replace_current`도 제공한다. 클라이언트는 선택한 `choiceId`만 보내며
  저장된 schemaSpec과 session ID는 서버가 복원한다.
- 결과 step에는 sourceText, DDL, modelJson, layoutJson을 저장하지 않는다. `outputSummary`는 action,
  title, dialect, table/relation count, warning code만 포함한다.
- 생성·교체된 session은 `domain=sqltoerd`, `resourceType=session` resource ref 하나로 반환한다.
  Frontend는 검증된 링크를 `ERD 및 DDL 열기`로 표시하고 자동으로 이동하지 않는다.
- 기능 관련 테이블 집중 요청은 `inspect_sql_erd_schema`를 먼저 호출한다. input은 1~200자의
  `featureQuery`와 선택적인 exact `sessionId`, 후보의 `sessionSelectionToken` 또는 `sessionTitle`이다.
  대상 우선순위는 명시 ID, selection token, exact title, 현재 SQLtoERD request context,
  Workspace의 유일한 session 순서다. 남은 session이 여러 개거나 없으면 mutation 없이
  `needs_clarification`과 최대 5개 후보를 반환한다. 각 후보는 같은 title도 구분 가능한
  `selectionToken`을 포함하고, 후속 호출은 선택한 값을 `sessionSelectionToken`으로 그대로 보낸다.
  clarification 질문에는 정규화한 후보 title과 수정일의 번호 목록을 포함한다. Frontend는
  `waiting_user_input` run의 최신 completed inspect clarification만 선택 버튼으로 표시하고,
  title·수정일·table/relation count로 같은 title 후보를 구분한다. 버튼은 구조화된 `selection`을
  기존 `/inputs` endpoint로 보내며 UUID를 사용자 bubble에 표시하지 않는다.
- inspect 결과의 table은 `t1`, `t2` 형태의 요청별 compact ref로 표시한다. projection은 최대
  9,000자이며 내부 table/column ID와 sourceText, DDL, 전체 modelJson을 Agent step에 복제하지 않는다.
- inspect 성공 output은 `sessionId`, 진단용 `sessionRevision`, compact ref 검증용
  `modelFingerprint`를 포함한다.
- `focus_sql_erd_tables`는 inspect 결과의 `sessionId`, `sessionRevision`, `modelFingerprint`, compact
  `primaryTableRefs`·`relatedTableRefs`, confidence와 선택 table별 짧은 reason을 받는다. primary는
  기능에 직접 해당하는 table이고 related는 primary와 직접 FK로 연결된 의미 있는 1-hop table만
  허용한다. 기본 2-hop 확장은 하지 않는다.
- App Server는 현재 model fingerprint와 compact ref, primary/related 중복, primary-related 직접 FK를
  다시 검증한다. layout/annotation 변경으로 revision만 증가한 경우에는 focus를 허용하고, 실제
  modelJson 변경으로 fingerprint가 달라진 경우에만 `409 CONFLICT`와
  `SQLtoERD model changed; inspect the schema again` 메시지로 거부해 inspect부터 다시 수행한다.
- 성공 결과는 `status=focused`, `metadata.version=1`, `view=table_focus`, `sessionRevision`, `modelFingerprint`,
  `featureLabel`, `primaryTableIds`, `relatedTableIds`, `relationIds`, `confidence`를 가진 resource ref다.
  Frontend는 핵심·관련 table과 그 사이 relation만 선명하게 표시하고 나머지 table/relation을 흐리게
  하며 선택·transform·delete를 막는다. 최초 적용 시 revision과 model fingerprint를 검증하고,
  활성화된 뒤에는 layout/annotation revision 증가가 아니라 실제 modelJson 변경 때만 해제한다.
  `전체 보기`, session 변경, 새로고침으로 집중 상태를 해제한다.
- 이 두 tool과 UI는 session을 저장·수정하지 않는 read-only view다. 따라서 SQLtoERD revision,
  writer lease, autosave와 Activity Log를 만들지 않으며 blur는 접근 제어나 보안 경계가 아니다.
- 지원 범위를 벗어난 schema 기능은 `unsupportedFeatures`에 명시한다. DB 실행·배포만 요구하는
  요청은 `unsupported`이며, 요구 entity/table 정보가 없으면 먼저 clarification을 요청한다.

#### Dev Agent CORS preflight 진단

브라우저에서 Agent 답변 뒤 `No 'Access-Control-Allow-Origin' header`가 발생하면 토큰이나 request
body를 보내기 전에 실제 배포 endpoint의 OPTIONS 응답을 확인한다.

```powershell
node apps/app-server/scripts/agent/cors-preflight-smoke.mjs --url "https://api.dev.pilo.my/api/v1/workspaces/<workspaceId>/agent/runs" --origin "https://dev.pilo.my"
```

스크립트는 status와 `Access-Control-Allow-*` header만 출력하며 인증 정보나 response body를
출력하지 않는다. `ok=true`면 preflight 계약은 정상이므로 브라우저 Network 탭에서 실제 실패
request의 status, 배포 시각, gateway 응답 여부를 확인한다. `ok=false`면 App Server 코드를 임의로
완화하지 않고 dev gateway와 배포 환경의 origin 전달 및 OPTIONS routing부터 점검한다.

### PR Review

- `requestContext`는 `null`, `{ "surface": "sql_erd", "sessionId": "uuid" }`, 또는
  `{ "surface": "pr_review", "sessionId": "uuid" }`이다. App Server는 run 생성 시 현재 사용자의
  Workspace 접근 권한과 `pr_review_sessions -> pr_review_rooms.workspace_id` 소속을 다시 검증한다.
  URL의 `sessionId`는 힌트일 뿐 신뢰하지 않는다.
- Tool registry는 선택 사항인 `contextRequirement: { surface }` metadata를 가진다. 선언이 없는 Tool은
  global Tool이고, 선언이 있는 Tool은 같은 surface의 run에만 schema snapshot으로 전달하며 실행 직전에도
  같은 조건을 다시 확인한다. Tool 이름으로 surface 조건을 하드코딩하지 않는다.
- `recommend_pr_review_focus`는 `surface=pr_review`인 run에서만 사용 가능한 read-only contextual Tool이다.
  입력은 선택 `focus` (`api`, `backend`, `frontend`, `test`)뿐이며, session ID나 Workspace ID를 받지 않는다.
- Tool은 해당 revision의 파일 경로, 역할, 위험도, 변경 요약, 검토 포인트, 검토 상태와 파일 관계만 읽는다.
  raw diff, 코드 원문, 사용자 comment, provider payload는 planner input·step output·log에 포함하지 않는다.
- revision이 `analyzing` 또는 `failed`이면 추천을 만들지 않고 분석 완료 또는 재시도 안내를 반환한다.
  읽기 전용이므로 confirmation과 Activity Log는 만들지 않는다. 기존 Agent run/tool step 실행 이력은 유지한다.

### Canvas delegation

- PILO AI는 요청이 Canvas 작업인지까지만 판단하며, Canvas 내부의 기능 설명·도형 검색·HTML 생성 분류는
  `CanvasAgentService`가 시작한 Canvas Agent run이 담당한다.
- `delegate_canvas_agent` input은 선택적인 `canvasId`, `canvasTitle`만 허용한다. `prompt`, 사용자 ID,
  Workspace ID, 선택 도형 또는 viewport를 planner가 다시 작성해 넣을 수 없다.
- 대상 우선순위는 명시 `canvasId`, exact `canvasTitle`, 현재 Canvas request context 순서다. 대상이 없거나
  같은 제목이 여러 개면 child run을 만들지 않고 Canvas 후보를 제시해 사용자 선택을 요청한다.
- App Server는 일반 Agent run의 최신 user message를 그대로 child run의 prompt로 사용한다. Canvas 화면에서
  받은 `selectedShapeIds`, `selectedScene`, loaded shape summary, viewport, `toolHelpMode`는 검증된
  `canvasContext`에서만 복원한다.
- Canvas 화면에서 PILO AI의 `기능 설명` 버튼을 누른 요청만 `toolHelpMode=true`다. 다른 화면에는 버튼을
  노출하지 않고, 일반 모드의 같은 단어는 Canvas 도형 검색으로 처리한다.
- child run resource ref는 `domain=canvas`, `resourceType=canvas_agent_run`이다. 일반 Agent frontend는
  child 상세를 조회해 HTML artifact가 있으면 동일한 sandbox preview/copy UI를 표시한다.
- 같은 Canvas editor가 활성화돼 있으면 delegated child run을 Canvas 결과 presenter에 전달한다. 따라서
  도형 focus와 HTML code block/connector 삽입은 기존 Classic Canvas roomState patch 흐름을 그대로 사용한다.
  Canvas 밖에서는 Canvas를 몰래 수정하지 않고 preview와 검증된 Canvas 링크만 제공한다.

### Calendar

- Agent는 Calendar event 생성/수정 시 `workspaceId`, `createdBy`를 body로 보내지 않는다.
- `workspaceId`는 path에서 오고, `createdBy`는 현재 로그인 사용자에서 온다.
- `update_calendar_event` planner input은 `target`과 `changes`만 받는다. `target`에는 제목과
  명시적 대상 날짜 범위가 필요하며, 시간·종일 여부는 선택적 exact filter다. `eventId`는 planner
  input과 사용자 답변에 포함하지 않는다.
- App Server는 현재 사용자·Workspace의 대상 날짜 범위에서 제목(공백 정리·대소문자 무시)과 날짜,
  선택 시간·종일 여부가 모두 일치하는 후보만 만든다. fuzzy matching이나 LLM 추측으로 event를
  선택하지 않는다.
- 후보가 정확히 하나일 때에만 App Server가 내부 eventId로 현재 event를 다시 조회해 confirmation의
  `before`를 만든다. 후보가 없거나 여러 개이면 confirmation과 write 없이 run을 완료하고, 제목·대상
  날짜·시간을 더 구체적으로 적어 다시 요청하도록 안내한다.
- Calendar 상대 날짜 조회는 run의 `currentDate`와 사용자 timezone을 기준으로 계산한다.
  `이번 주말`은 현재 날짜에서 아직 완전히 지나지 않은 가장 가까운 토요일·일요일이며, 토요일에는
  당일을 포함하고 일요일에는 다음 주말을 사용한다. `다음 주 월요일`은 바로 다가오는 월요일,
  `다다음 주 화요일`은 바로 다가오는 화요일보다 한 주 뒤의 화요일로 해석한다.
- Calendar 생성에서 `endDate`가 없으면 `startDate`와 같은 날짜로, 시간 지정 일정에서 `endTime`이 없으면 Calendar API의 `startTime + 1시간`으로 정규화해 confirmation과 실행에 같은 값을 사용한다. 종일 일정에는 시간을 넣지 않는다.
- `list_calendar_events`는 날짜 범위만 지원한다. 제목·키워드·참석자·현재 시각 조건을 요청하면
  해당 조건을 무시하고 조회하지 않으며, 현재 Agent 범위에서 지원하지 않는다고 안내한다.
- 시간 지정 일정의 `endTime`이 `startTime`과 같거나 같은 날짜에서 더 이르면 confirmation을 만들지 않고
  추가 정보를 요청한다.
- `매일`, `평일마다`, `매주`처럼 반복을 의미하는 Calendar 생성 요청은 1차 Agent 범위에서
  지원하지 않는다. 해당 run은 `unsupported`으로 완료하고, 단일 일정으로 축소하거나 confirmation을
  만들지 않는다.
- 시작일과 종료일이 다른 Calendar 생성 요청에서 `isAllDay`, `startTime`, `endTime`이 모두 없으면
  종일 여부 또는 시간 정보가 필요하다. planner의 `needs_clarification` 질문을 message에 저장하고
  해당 run을 `waiting_user_input`으로 전환하며 confirmation은 만들지 않는다. 사용자가 `/inputs`에
  명시적 `isAllDay: true` 또는 시간 입력을 보내면 같은 run의 다음 planner turn에서 기존 생성 후보
  규칙을 따른다.
- 일정 삭제는 1차 Agent tool이 아니다.

### Meeting·MeetingReport

- `list_meeting_rooms`는 현재 Workspace의 활성 MeetingRoom을 최대 100개까지 반환하고, 각 방의
  current Meeting·현재 Recording 상태를 요약한다. LiveKit room name, token, audio key는 반환하지 않는다.
- `get_active_meeting`은 현재 사용자의 모든 Workspace 기준 active Meeting을 조회한다. active Meeting이
  있으면 Meeting 시작 시각과 현재 시각으로 계산한 `durationSec`을 반환하며, 없으면 `active: false`를 반환한다.
- Meeting control/read selector는 public planner input에서 UUID를 받지 않는다. `current: true`,
  `roomName`, 또는 같은 run의 후보 버튼으로 소비한 selector만 허용하며 selector가 생략되면 현재 사용자의
  active Meeting을 사용한다. active Meeting이 없거나 `roomName`이 여러 Meeting에 해당하면 실행하지 않고
  후보 버튼 clarification을 반환한다.
- `get_meeting_participants`는 해소된 Meeting의 사용자별 중복 제거된 현재·과거 참여자 요약을 최대 100명까지
  반환한다. LiveKit identity·연결 상태는 반환하지 않는다.
- `start_meeting_in_room`, `join_meeting`은 confirmation 뒤 기존 MeetingService를 호출하고,
  LiveKit token 대신 20초 제한의 일회성 `connect_meeting` client action만 step output에 저장한다.
  Frontend는 만료되지 않은 action을 한 번만 소비해 Meeting 화면으로 이동하고, 기존 audio preflight를
  통과한 뒤 join API에서 새 LiveKit token을 받아 연결한다. token은 Agent 응답·URL·영구 저장소에
  전달하거나 보관하지 않는다.
- `leave_meeting`은 selector가 생략된 명시적 나가기 요청도 현재 사용자의 active Meeting으로 해소해 자동
  실행한다. 마지막 참여자면 Meeting 도메인의 기존 녹음 종료·회의 종료·회의록 생성 규칙이 그대로 적용된다.
- `start_meeting_recording`, `end_meeting_recording`은 confirmation 뒤 해소된 Meeting에 실행한다. 녹음
  종료 tool은 서버가 current recording을 다시 조회한다.
- Agent는 MeetingReport 목록/상세를 읽고 요약할 수 있다.
- 목록 응답의 요약 필드를 우선 사용한다.
- `list_meeting_reports`는 `from`, `to`, `status`, Agent 내부 `roomName`, `limit`을 지원한다. 기간과
  개수를 생략하면 `createdAt DESC, id ASC` 정렬의 최신 report 1개를 반환한다. `roomName`은 Agent 내부
  도메인 조회 전용이며 Meeting REST API를 확장하지 않는다.
- 특정 MeetingReport 상세/요약도 UUID `reportId`를 받지 않는다. selector가 없으면 최신 report 1개를
  해소하고, filter 결과가 여러 개면 같은 run의 후보 버튼으로 선택을 요청한다.
- 상세 조회의 `transcriptText`는 답변 생성에 사용할 수 있지만 Agent run/step/confirmation에는 전문 저장하지 않는다.
- `search_meeting_transcript`는 `query`와 선택적 `reportId`를 받는다. transcript 원문과 raw Activity Log를
  Agent run/step에 저장하지 않고, 권한 있는 namespaced source ID만 grounded-answer 경로에 전달한다.
- 실패한 회의록 재생성은 `regenerate_meeting_report` confirmation 뒤 요청할 수 있다.

### Board

- 모든 Board tool은 planner input의 `workspaceId`, `boardId`, `issueId`, `columnId`,
  `idempotencyKey`, 사용자 식별자 주입을 거절한다. Workspace와 현재 사용자는 run context에서만
  가져오며 기존 `BoardService`가 권한과 resource 범위를 다시 검증한다.
- Board 선택은 exact `boardName` 또는 `repositoryFullName`으로 명시한 Board, Workspace의 active
  Board, Workspace의 유일한 Board 순서다. 명시 조건이 없고 active Board도 없는데 Board가 여러
  개이면 최대 5개 후보를 안내하고 임의로 선택하지 않는다.
- Board issue 대상은 planner가 제공한 GitHub `issueNumber`(`#134` 또는 `134`)를 exact match해
  내부 `issueId`를 해석한다. planner input이나 사용자 답변에 내부 ID를 요구하지 않는다.
- 검색은 `search`, `state`(`open`/`closed`), `label`, `assignee`, `limit` 필터만 지원한다.
- `get_board_issue_context`는 issue body를 최대 2,000자로 제한하고 label, assignee,
  ProjectV2 field를 최대 10개씩 표시한다. 관련 PR은 동기화된 cache의 issue 번호·URL heuristic
  결과이며 최대 5개만 표시한다. GitHub API를 새로 호출하거나 확정 관계로 표현하지 않는다.
- `get_board_briefing`은 전체/open/closed 카드 수, column·state·label·assignee 분포와 마지막
  sync 사실만 반환한다. 데이터에 없는 우선순위, 병목 원인, 개인 성과를 추론하지 않는다.
- `resolve_board_context`, `search_board_issues`, `get_board_issue_context`,
  `get_board_briefing`, `diagnose_board_freshness`는 `low` read-only tool로 confirmation 없이
  실행한다.
- `move_board_issue_status`는 GitHub issue 번호와 exact `columnName`을 받는다. confirmation
  직전에 현재 issue와 column을 다시 읽고 `previousColumnId`를 저장하며, 승인 실행은 Board API의
  stale column `409 CONFLICT` 규칙을 그대로 사용한다.
- `create_board_issue`는 `title`, 선택 `body`, 선택 exact `columnName`을 지원한다. Board selector가
  없으면 Workspace active Board를 사용하고, active Board가 없으면 유일한 Board만 자동 선택한다.
  Board가 여러 개이면 후보를 안내하며 임의로 선택하지 않는다. `columnName`이 없으면
  `normalizedName=unmapped`이고 `githubStatusOptionId=null`인 로컬 Unmapped Column이 정확히 하나일
  때만 기본값으로 사용한다. 이 Column이 없거나 모호하면 write 없이 GitHub repository 연결과
  ProjectV2 Board 선택·동기화 상태를 확인하도록 안내한다. 명시한 Board, repository, Column은 기존
  exact match 규칙을 유지한다. confirmation plan에 자동 선택된 Board와 Column을 표시하고
  `agent:{runId}:create_board_issue` 형식의 안정적인 idempotency key를 저장하며, approve와 재시도에서
  같은 key로 기존 Board issue 생성 계약을 호출한다. 최종 Board API 검증은 그대로 유지한다.
  label, assignee, milestone 지정은 생성 범위가 아니다.
- `assign_board_issue_safely` planner input은 GitHub issue 번호와 선택 `addAssignees`,
  `removeAssignees`를 받는다. App Server는 현재 전체 assignee를 다시 읽고 repository의 live
  assignable 후보를 검증한 뒤 confirmation에 유지·추가·제거·최종 전체 목록을 표시한다. 승인 후에는
  confirmation에 저장된 추가·제거 delta만 사용하며, 추가 대상은 live 후보로 다시 검증한 뒤 제거,
  추가 순서로 실행한다. GitHub의 최종 응답으로 issue cache 두 곳을 갱신한다. 이 실행 경로는 Agent
  전용 내부 Board service이며 공개 Board PATCH 계약은 바꾸지 않는다.
- `diagnose_board_freshness`는 active Board 여부, Board hydration 상태와 시각, 최대 20개 issue의
  `lastSyncedAt`, 해당 표본에서 발견된 관련 PR cache의 `lastSyncedAt`, `Unmapped` 카드 수를
  반환한다. 전체 issue가 20개보다 많으면 표본 범위를 함께 표시하며 sync를 시작하지 않는다.
- Board write 세 tool은 모두 `medium`, `confirmation_required`다. clarification, reject, expiry에서는
  GitHub나 ProjectV2 write를 실행하지 않는다.
- provider raw error, token, secret은 응답과 로그에 노출하지 않는다.

## 오류 응답

오류 응답 형식은 공통 API envelope를 따른다.

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human readable message"
  }
}
```

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | request body 또는 query가 잘못됨 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 또는 도메인 권한 없음 |
| `404` | `NOT_FOUND` | run, confirmation, 도메인 resource를 찾을 수 없음 |
| `409` | `CONFIRMATION_NOT_PENDING` | confirmation 상태가 pending이 아님 |
| `409` | `CONFIRMATION_EXPIRED` | confirmation이 만료됨 |
| `409` | `CLIENT_REQUEST_ID_CONFLICT` | 같은 clientRequestId로 다른 요청을 보냄 |
| `422` | `UNPROCESSABLE_REQUEST` | 자연어 요청을 실행 가능한 tool plan으로 해석할 수 없음 |
| `502` | `BAD_GATEWAY` | 외부 provider 실패. raw error는 노출하지 않음 |
| `503` | `SERVICE_UNAVAILABLE` | AI job queue 또는 AI Worker 처리를 시작할 수 없음 |

## MVP 제외

- Files 파일 확인
- PR Review session 조회
- GitHub sync 제안/실행
- PR Review 자동 제출
- GitHub issue label/milestone/due date 변경
- Board due date 자동 변경
- Canvas 자유 편집 자동 생성/수정. 일반 Agent의 Canvas 요청은
  `docs/api/canvas-agent-api.md`의 별도 Canvas Agent 계약만 사용하며, Calendar,
  Issue, PR, Meeting 등 외부 도메인 도구에는 접근하지 않는다.
- Calendar 일정 삭제
- 자동 rollback
- 장기 workflow orchestration
- multi-turn thread memory
- streaming UI
- 정교한 eval 체계
