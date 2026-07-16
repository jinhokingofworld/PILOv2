# Agent API

## 범위

Agent API는 Workspace 안에서 자연어 요청을 Agent run으로 생성하고, AI Worker의
계획/답변 생성 결과와 App Server의 tool 실행 상태를 조회하는 API다.

1차 Agent MVP는 완전 자율 실행이 아니라 확인 기반 업무 Agent다.

- 자연어 채팅 입력
- 현재 active Workspace 문맥 사용
- Calendar 일정 조회, 생성, 수정
- MeetingReport 목록/상세 조회와 요약
- Board 문맥 확인, issue 검색·상세 문맥, briefing·최신성 진단
- Board issue 생성, Status 이동, 담당자 추가·제거
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
- 1차는 streaming 없이 polling으로 run 상태를 조회한다.
- `clientRequestId`는 선택값이며, 같은 Workspace와 요청자 안에서 run 생성 재시도 idempotency key로 사용한다.

## 처리 구조

Agent run 생성 transaction은 run과 planning-job outbox intent를 함께 저장한다. App Server는
저장 직후 publisher를 깨워 SQS AI job 발행을 시도하고, 60초 recovery sweep으로 미발행 intent와
stale publisher claim을 재시도한다. AI Worker는 LLM을 호출해 intent, tool plan, 최종 답변 생성을
담당한다.

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
```

AI Worker가 `tool_candidate` planner 결과를 저장하면 인증된 내부 handoff로 App Server에 실행을
요청한다. handoff는 at-least-once 전달될 수 있으며, App Server는 이미 생성된 tool step 또는
confirmation을 중복 생성하지 않는다. 이 내부 endpoint는 public API가 아니며 사용자 bearer token을
받지 않는다.

`search_meeting_transcript`는 read-only tool이지만 일반 formatter로 즉시 완료하지 않는다. App Server가
현재 사용자 권한으로 query embedding과 pgvector 검색을 수행하고, chunk ID만 가진
`agent_grounded_answer_outbox`를 저장한다. AI Worker는 내부 인증 endpoint에서만 bounded transcript
excerpt를 일회성으로 받아 두 번째 LLM 호출을 수행한다. excerpt와 embedding은 Agent run/step/log,
outbox, SQS payload에 저장하지 않는다. final citation은 outbox의 source ID 부분집합만 허용한다.

## 실행 모델

- 1차는 `one prompt = one agent run`으로 시작한다.
- true multi-turn memory, 장기 thread, 예약 실행은 1차 범위가 아니다.
- read-only 요청은 confirmation 없이 자동 실행할 수 있다.
- `search_meeting_transcript`는 `query`와 선택 `reportId`만 받고, Workspace 전체의 owner 또는 해당
  회의의 현재·과거 참여자가 접근 가능한 current transcript chunk만 상위 5개 검색한다. 결과가 없으면
  LLM answer phase를 호출하지 않는다.
- write 요청은 `waiting_confirmation` 상태의 run과 pending confirmation을 만든다.
- 사용자가 승인하면 서버는 confirmation에 저장된 plan만 실행한다.
- 승인 transaction은 `running` tool step을 execution claim으로 함께 만든다. 승인 직후 process가
  중단돼도 tool step이 없는 `running` run을 남기지 않는다.
- AI Worker는 60초마다 2분 이상 stale인 승인 execution을 확인한다. `running` tool step이 남아 있으면
  domain tool을 재실행하지 않고 safe failure로 terminal 상태를 만든다.
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

### AgentConfirmationPlan

| Field | Type | 설명 |
| --- | --- | --- |
| `toolName` | string | 실행할 Agent tool 이름 |
| `summary` | string | 사용자가 확인할 실행 요약 |
| `target` | object | 변경 대상 domain/resource 정보 |
| `before` | object \| null | 현재 값 요약. 생성 작업이면 null 가능 |
| `after` | object | 변경 예정 값 |
| `call` | object | 내부 실행에 필요한 method/path 또는 service action 요약 |

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
  "clientRequestId": "agent-run-20260707-0001"
}
```

| Field | Required | 설명 |
| --- | --- | --- |
| `prompt` | Yes | 사용자 자연어 요청. 빈 문자열 불가 |
| `timezone` | No | IANA timezone. 없으면 `Asia/Seoul` |
| `clientRequestId` | No | 클라이언트가 재시도 방지를 위해 보내는 idempotency key. 최대 128 bytes |

서버 규칙:

- request body의 `workspaceId`, `userId`, `createdBy`, `requestedByUserId`는 무시하지 않고 받지 않는다.
- `prompt`는 trim 후 저장한다.
- `timezone`이 없으면 `Asia/Seoul`을 저장한다.
- `clientRequestId`가 있으면 같은 Workspace와 요청자가 같은 key로 만든 run을 중복 생성하지 않는다.
- 같은 `clientRequestId`, `prompt`, `timezone`으로 재시도하면 기존 run을 반환하고 새 outbox intent를 만들지 않는다.
- 같은 `clientRequestId`로 다른 `prompt` 또는 `timezone`을 보내면 `409 CLIENT_REQUEST_ID_CONFLICT`를 반환한다.
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
      "prompt": "내일 오후 3시에 주간 회의 일정 만들어줘.",
      "timezone": "Asia/Seoul",
      "message": "일정 생성 전 확인이 필요합니다.",
      "finalAnswer": null,
      "errorMessage": null,
      "expiresAt": "2026-08-06T00:00:00.000Z",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:03.000Z",
      "completedAt": null,
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

## Confirmation 승인

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/approve
```

Request body 없음.

서버 규칙:

- confirmation은 `pending` 상태여야 한다.
- confirmation은 만료되지 않아야 한다.
- 서버는 저장된 `plan`만 실행한다.
- approve 요청 body에 실행 값, 변경 값, resource id를 받지 않는다.
- non-empty body가 오면 `400 BAD_REQUEST`를 반환한다.
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
| `get_meeting_participants` | `low` | 가능 | `GET /workspaces/{workspaceId}/meetings/{meetingId}/participants` |
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

> `assign_board_issue_safely`는 공개 assignee option 조회 계약을 사용하지만, 실행은 내부 add/remove
> Board service 경로를 사용한다. 별도의 공개 endpoint는 추가하지 않는다.

## 도메인별 실행 규칙

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
- 시간 지정 일정에서 `endTime`이 없으면 Calendar API의 `startTime + 1시간` 정규화를 따른다.
- `list_calendar_events`는 날짜 범위만 지원한다. 제목·키워드·참석자·현재 시각 조건을 요청하면
  해당 조건을 무시하고 조회하지 않으며, 현재 Agent 범위에서 지원하지 않는다고 안내한다.
- 시간 지정 일정의 `endTime`이 `startTime`과 같거나 같은 날짜에서 더 이르면 confirmation을 만들지 않고
  추가 정보를 요청한다.
- `매일`, `평일마다`, `매주`처럼 반복을 의미하는 Calendar 생성 요청은 1차 Agent 범위에서
  지원하지 않는다. 해당 run은 `unsupported`으로 완료하고, 단일 일정으로 축소하거나 confirmation을
  만들지 않는다.
- 시작일과 종료일이 다른 Calendar 생성 요청에서 `isAllDay`, `startTime`, `endTime`이 모두 없으면
  종일 여부 또는 시간 정보가 필요하다. 해당 run은 `needs_clarification`으로 완료하고 confirmation을
  만들지 않는다. 명시적 `isAllDay: true` 또는 시간 입력이 있으면 기존 생성 후보 규칙을 따른다.
- 일정 삭제는 1차 Agent tool이 아니다.

### Meeting·MeetingReport

- `list_meeting_rooms`는 현재 Workspace의 활성 MeetingRoom을 최대 100개까지 반환하고, 각 방의
  current Meeting·현재 Recording 상태를 요약한다. LiveKit room name, token, audio key는 반환하지 않는다.
- `get_active_meeting`은 현재 사용자의 모든 Workspace 기준 active Meeting을 조회한다. active Meeting이
  있으면 Meeting 시작 시각과 현재 시각으로 계산한 `durationSec`을 반환하며, 없으면 `active: false`를 반환한다.
- `get_meeting_participants`는 UUID `meetingId`가 필요하고, 사용자별 중복 제거된 현재·과거 참여자 요약을
  최대 100명까지 반환한다. LiveKit identity·연결 상태는 반환하지 않는다.
- Agent는 MeetingReport 목록/상세를 읽고 요약할 수 있다.
- 목록 응답의 요약 필드를 우선 사용한다.
- report ID 없는 넓은 조회(예: `지난 회의 결정사항 보여줘`)는 `list_meeting_reports`에 `limit: 1`을
  사용한다. Meeting domain의 `created_at DESC, id ASC` 정렬에 따라 같은 Workspace의 최신 report 하나를
  조회하고, 요청한 범주만 답변에 표시한다.
- 특정 MeetingReport 상세/요약은 UUID `reportId`가 필요하다. 현재 one prompt = one run에서는 후보
  선택을 이어갈 수 없으므로 ID 없는 특정 상세 요청은 `unsupported`로 완료한다.
- 상세 조회의 `transcriptText`는 답변 생성에 사용할 수 있지만 Agent run/step/confirmation에는 전문 저장하지 않는다.
- `search_meeting_transcript`는 `query`와 선택적 `reportId`를 받는다. transcript 원문을
  Agent run/step에 저장하지 않고, 권한 있는 source ID만 grounded-answer 경로에 전달한다.
- 녹음 시작, 녹음 종료, 회의록 재생성 요청은 1차 Agent tool이 아니다.

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
- `create_board_issue`는 `title`, 선택 `body`, exact `columnName`만 지원한다. confirmation plan에
  `agent:{runId}:create_board_issue` 형식의 안정적인 idempotency key를 저장하고 approve와 재시도에서
  같은 key로 기존 Board issue 생성 계약을 호출한다. label, assignee, milestone 지정은 생성 범위가
  아니다.
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
- Canvas 자유 편집 자동 생성/수정 (일반 Agent 범위). Canvas 전용 요청은
  `docs/api/canvas-agent-api.md`의 별도 Canvas Agent 계약만 사용하며, Calendar,
  Issue, PR, Meeting 등 외부 도메인 도구에는 접근하지 않는다.
- Meeting 녹음 시작/종료
- MeetingReport 재생성 요청
- Calendar 일정 삭제
- 자동 rollback
- 장기 workflow orchestration
- multi-turn thread memory
- streaming UI
- 정교한 eval 체계
