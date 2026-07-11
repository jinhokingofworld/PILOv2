# Meeting API

## 범위

Meeting API는 Workspace 안의 고정 회의 페이지를 담당한다.

- 현재 진행 중인 회의 조회
- 회의 시작, 참여, 나가기, 녹음 시작, 녹음 종료
- Application server를 통한 LiveKit 입장 token 발급
- 회의 녹음 metadata 조회
- 회의록 목록, 상세, 재생성 요청
- 회의 참여자 목록 조회

MVP에는 MeetingRoom 관리가 없다. 기본 `roomKey`는 `MAIN_MEETING_ROOM`이며,
진행 중 회의는 Workspace와 `roomKey` 기준으로 하나만 존재할 수 있다.
`roomKey`는 Workspace 안의 기본 회의실 키이고, `livekitRoomName`은 Meeting
세션마다 고유한 실제 LiveKit room name이다.

## 공통 규칙

- Base URL: `/api/v1`
- 인증: `docs/api/README.md`의 공통 인증 규칙을 따른다.
- 모든 endpoint는 `/workspaces/{workspaceId}` 아래에 있다.
- `workspaceId`와 `userId`는 request body로 받지 않는다.
- 현재 사용자는 공통 인증 layer가 식별한 사용자다.
- Workspace 접근 권한이 없으면 `403 FORBIDDEN`을 반환한다.
- API 응답에는 OAuth token, LiveKit secret, provider raw error를 노출하지 않는다.
- LiveKit token은 입장용 임시 token이며 서버 저장 대상이 아니다.
- LiveKit token 만료 시간은 발급 시점 기준 1시간이다.

성공 응답:

```json
{
  "success": true,
  "data": {}
}
```

오류 응답:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human readable message"
  }
}
```

공통 오류 code:

| HTTP | Code | 대표 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | 잘못된 요청, 종료된 회의 참여, 재시도 불가 상태 |
| `400` | `MEETING_ALREADY_IN_PROGRESS` | 같은 room에 이미 진행 중인 회의가 있음 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가, 녹음 시작/종료 권한 없음 |
| `404` | `NOT_FOUND` | 회의, 녹음, 회의록을 찾을 수 없음 |

## 데이터 규칙

- 녹음 동의 여부는 프론트 `localStorage.recordingConsentAccepted = true`로만 저장한다.
- MVP 서버에는 녹음 동의 여부를 저장하지 않는다.
- 프론트는 녹음 동의가 완료된 사용자에게만 회의 시작/참여 요청을 보낸다.
- 회의 중 마이크 ON/OFF, 발화 상태, 연결 상태는 LiveKit/React 상태이며 이 API에서 저장하거나 반환하지 않는다.
- `Meeting.endedAt`은 회의방 생존 여부를 판단하는 기준이다.
- 마지막 active participant가 나가면 회의가 자동 종료될 수 있다.
- Meeting과 Recording은 1:N 관계다. 같은 Meeting 안에서 녹음을 여러 번 시작하고 종료할 수 있다.
- 같은 Meeting 안에서 `RUNNING` 상태 Recording은 하나만 존재할 수 있다.
- 회의 시작 또는 참여는 LiveKit Room 입장 token만 발급하고 녹음을 자동 시작하지 않는다.
- 녹음 시작은 현재 active participant만 요청할 수 있다.
- 녹음 종료하고 회의록 생성은 현재 active participant만 요청할 수 있다.
- 녹음 종료는 회의방 종료가 아니며, `Meeting.endedAt`을 저장하거나 다른 참여자를 내보내지 않는다.
- `Meeting.endedAt = null`이면 `Recording.status`가 `COMPLETED` 또는 `FAILED`여도 참여할 수 있다.
- `recording.durationSec`이 60 이하면 MeetingReport를 생성하지 않고 회의록 목록에도 노출하지 않는다. 단, 녹음 자체가 실패해 duration을 알 수 없는 경우에는 `FAILED` MeetingReport를 생성할 수 있다.
- 실패한 MeetingReport는 목록과 상세에서 조회할 수 있고 재생성을 요청할 수 있다.
- 녹음 시작, 녹음 종료, STT 요청, LLM 보고서 생성 요청은 같은 recording에 대해 동시에 여러 번 수행되지 않도록 서버에서 lock 또는 동등한 동시성 제어를 적용한다.
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정은 MVP 제외다.

## LiveKit webhook

LiveKit host는 다음 비사용자 endpoint로 참여자 이탈 delivery를 보낸다.

```http
POST /api/v1/livekit/webhooks
```

- Workspace bearer session은 사용하지 않는다. App Server는 `Authorization` header와 raw request body를 현재 `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`으로 검증한다.
- App Server는 LiveKit raw payload나 API secret을 DB, 로그, 응답에 저장하거나 노출하지 않는다.
- `participant_left`와 `participant_connection_aborted` delivery는 `livekit_webhook_deliveries`에 멱등하게 기록한다. 같은 event id가 재전송되면 기존 결과를 반환한다.
- 신규 departure delivery는 같은 transaction 안에서 room·participant identity 기준의 active participant를 `leftAt`으로 보정한다. 매칭되지 않거나 이미 나간 participant는 안전하게 무시한다.
- 재입장 뒤 늦게 도착한 이전 departure delivery는 LiveKit event 시각이 현재 participant의 `joinedAt`보다 이른 경우 무시한다.
- 보정으로 마지막 active participant가 남지 않으면 Meeting을 종료한다. `RUNNING` Recording은 종료를 시도하고, 실패하면 Recording을 `FAILED`로 기록한다. 이 경우에도 실제로 끊긴 participant와 Meeting을 다시 active로 복구하지 않는다.
- 정상 종료된 Recording이 60초를 초과하면 MeetingReport job을 준비한다. job enqueue 실패 시 Report만 `FAILED`로 기록하며, participant·Meeting 종료를 되돌리지 않는다. durable 재시도는 별도 운영 흐름에서 처리한다.
- 다른 LiveKit event는 `ignored`로 기록하고 `200`을 반환한다.
- 유효·중복·미지원 delivery는 `200`, 서명 불일치는 `401`, JSON 형식 오류는 `400`을 반환한다.

## 상태값

| 대상 | 값 | 의미 |
| --- | --- | --- |
| Recording | `RUNNING` | 녹음 진행 중 |
| Recording | `COMPLETED` | 녹음 완료 |
| Recording | `FAILED` | 녹음 실패 |
| MeetingReport | `PROCESSING` | 회의록 작업 대기 또는 생성 중 |
| MeetingReport | `COMPLETED` | 회의록 생성 완료 |
| MeetingReport | `FAILED` | 회의록 생성 실패 |
| MeetingReport failedStep | `RECORDING` | 녹음 단계 실패 |
| MeetingReport failedStep | `STT` | 음성 텍스트 변환 단계 실패 |
| MeetingReport failedStep | `LLM` | 회의록 생성 단계 실패 |

## Payload 요약

### Meeting

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | 회의 id |
| `workspaceId` | string | Workspace id |
| `roomKey` | string | 기본값 `MAIN_MEETING_ROOM` |
| `livekitRoomName` | string | LiveKit room name |
| `createdById` | string | 회의 시작 사용자 id |
| `endedById` | string \| null | 회의 세션 종료 기록 사용자 id. 자동 종료면 null 가능 |
| `startedAt` | string | ISO datetime |
| `endedAt` | string \| null | ISO datetime |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |

### Participant

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | 참여 정보 id |
| `meetingId` | string | 회의 id |
| `userId` | string | 사용자 id |
| `livekitIdentity` | string | LiveKit participant identity |
| `joinedAt` | string | ISO datetime |
| `leftAt` | string \| null | ISO datetime |
| `isActive` | boolean | 현재 회의에 남아 있는지 여부 |
| `user` | object | 화면 표시용 사용자 요약 |

`user`에는 `id`, `name`, `avatarUrl`만 포함한다. Email, OAuth token, encrypted token은 포함하지 않는다.

### LiveKitJoin

| Field | Type | 설명 |
| --- | --- | --- |
| `livekitRoomName` | string | 접속할 LiveKit room name |
| `livekitIdentity` | string | 현재 사용자의 LiveKit identity |
| `livekitToken` | string | LiveKit 입장 token |
| `livekitUrl` | string | LiveKit 접속 URL |
| `expiresAt` | string | ISO datetime. 발급 시점 기준 1시간 뒤 |

### Recording

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | 녹음 id |
| `meetingId` | string | 회의 id |
| `status` | `RUNNING` \| `COMPLETED` \| `FAILED` | 녹음 상태 |
| `audioFileUrl` | string \| null | 녹음 파일 URL |
| `audioFileKey` | string \| null | 저장소 object key |
| `durationSec` | number \| null | 녹음 길이 |
| `fileSizeBytes` | number \| null | 파일 크기 |
| `startedAt` | string | ISO datetime |
| `endedAt` | string \| null | ISO datetime |
| `errorMessage` | string \| null | 실패 메시지 |

Meeting 하나에는 여러 Recording이 있을 수 있다. API에서 `currentRecording`은
`RUNNING` 상태 Recording을 뜻한다. 없으면 `null`이다.

### MeetingReport

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | 회의록 id |
| `meetingId` | string | 회의 id |
| `recordingId` | string | 녹음 id |
| `status` | `PROCESSING` \| `COMPLETED` \| `FAILED` | 회의록 상태 |
| `failedStep` | `RECORDING` \| `STT` \| `LLM` \| null | 실패 단계 |
| `errorMessage` | string \| null | 실패 메시지 |
| `transcriptText` | string \| null | 상세 조회에서만 반환 |
| `summary` | string \| null | 요약 |
| `discussionPoints` | string \| null | 논의사항 |
| `decisions` | string \| null | 결정사항 |
| `actionItemCandidates` | array | 후속 작업 후보 |
| `retryCount` | number | 재시도 횟수 |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |

목록 응답에는 긴 `transcriptText`를 포함하지 않는다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/meetings/current` | 기본 room의 현재 진행 중 회의 조회 |
| `POST` | `/workspaces/{workspaceId}/meetings` | 새 회의 시작 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 진행 중 회의 참여 또는 재입장 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}` | 회의 상세 조회 |
| `DELETE` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 회의 나가기 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings` | 녹음 시작 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings` | 녹음 metadata 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings/current` | 진행 중 녹음 metadata 조회 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings/{recordingId}/end` | 녹음 종료와 회의록 생성 트리거 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants` | 회의 참여자 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports` | MeetingReport 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports/{reportId}` | MeetingReport 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/reports` | 특정 회의의 MeetingReport 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs` | 실패한 회의록 재생성 요청 |

## Endpoint 상세

### 현재 회의 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/current
```

Request body 없음.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting \| null | 진행 중 회의. 없으면 `null` |
| `currentRecording` | Recording \| null | 진행 중 녹음. 없으면 `null` |
| `activeParticipantCount` | number | 현재 active participant 수 |

주요 오류: `401`, `403`

### 새 회의 시작

```http
POST /api/v1/workspaces/{workspaceId}/meetings
```

Request body:

```json
{
  "roomKey": "MAIN_MEETING_ROOM"
}
```

`roomKey`는 optional이며 생략하면 `MAIN_MEETING_ROOM`을 사용한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 새로 시작된 회의 |
| `participant` | Participant | 현재 사용자 참여 정보 |
| `livekit` | LiveKitJoin | LiveKit 입장 정보 |
| `currentRecording` | null | 회의 시작만으로는 녹음을 시작하지 않는다 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `MEETING_ALREADY_IN_PROGRESS` | 같은 room에 이미 진행 중인 회의가 있음 |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 |

### 회의 참여 또는 재입장

```http
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/participants/me
```

Request body 없음.

같은 사용자가 같은 회의에 다시 참여하면 기존 participant 기준으로 재입장한다.
LiveKit 입장 token은 참여 요청마다 다시 받을 수 있다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 참여한 회의 |
| `participant` | Participant | 현재 사용자 참여 정보 |
| `livekit` | LiveKitJoin | LiveKit 입장 정보 |
| `currentRecording` | Recording \| null | 진행 중 녹음. 없으면 `null` |

주요 오류: `400`, `401`, `403`, `404`

### 회의 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 회의 정보 |
| `currentRecording` | Recording \| null | 진행 중 녹음. 없으면 `null` |
| `recordings` | Recording[] | 녹음 목록 |
| `reports` | MeetingReport[] | 회의록 목록. `transcriptText` 제외 |
| `participantCount` | number | 전체 참여자 수 |
| `activeParticipantCount` | number | 현재 active participant 수 |
| `currentUserParticipant` | Participant \| null | 현재 사용자의 참여 정보 |

마이크 상태, 발화 상태, 연결 상태는 LiveKit/React 상태이므로 이 응답에 포함하지 않는다.

주요 오류: `401`, `403`, `404`

### 회의 나가기

```http
DELETE /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/participants/me
```

Request body 없음.

현재 사용자만 회의에서 나간다. `RUNNING` Recording이 있어도 모든 active
participant는 나갈 수 있다. 단, 마지막 active participant가 나가는 시점에
`RUNNING` Recording이 있으면 서버는 먼저 녹음을 정상 종료하고 MeetingReport 생성
trigger를 수행한 뒤 participant를 나가게 하고 회의를 자동 종료한다. 녹음 종료가
정상 완료되지 않으면 나가기 요청은 실패하고 participant는 active 상태로 남는다.
MeetingReport SQS 발행이 일시 실패해도 요청은 성공한다. 생성된 MeetingReport는
`PROCESSING`으로 남고, 서버는 durable outbox에 재발행 의도를 보존한다. 이후
dispatcher가 해당 job을 다시 발행한다.
이미 나간 상태에서 다시 호출해도 같은 결과를 반환한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `participant` | Participant | 현재 사용자 참여 정보 |
| `meetingEnded` | boolean | 마지막 참여자 나가기라서 회의 세션이 자동 종료됐는지 여부 |
| `meeting` | Meeting | 회의 정보 |
| `currentRecording` | Recording \| null | 진행 중 녹음. 마지막 참여자 나가기 중 녹음이 정상 종료됐으면 `null` |

주요 오류: `400`, `401`, `403`, `404`

### 녹음 시작

```http
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recordings
```

Request body 없음.

현재 active participant만 호출할 수 있다. 서버는 같은 Meeting의 `RUNNING`
Recording이 있는지 lock으로 확인한다. 이미 진행 중인 녹음이 있으면 기존
Recording을 반환하고 LiveKit Egress 시작 side effect를 다시 수행하지 않는다.

새 녹음 시작 시 서버는 녹음 파일 object key를 결정하고 LiveKit Egress를 시작한
뒤 `meeting_recordings.status = RUNNING` row를 저장한다. LiveKit Egress 시작에
실패하면 `FAILED` Recording으로 저장하거나 실패 응답을 반환하되, 성공하지 않은
녹음을 `RUNNING`으로 남기지 않는다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 회의 정보 |
| `recording` | Recording | 시작됐거나 이미 진행 중이던 녹음 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | 종료된 회의이거나 녹음을 시작할 수 없는 상태 |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 또는 현재 active participant가 아님 |
| `404` | `NOT_FOUND` | 회의를 찾을 수 없음 |

### 녹음 종료하고 회의록 생성

```http
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recordings/{recordingId}/end
```

Request body 없음.

녹음만 종료하고 회의록 생성을 트리거한다. 현재 active participant만 호출할 수
있다. 이 요청은 `Meeting.endedAt`을 저장하지 않고, LiveKit Room에 남아 있는 다른
참여자를 내보내지 않는다. `Meeting.endedAt = null`이면 녹음 종료 후에도 기존
참여자와 새 사용자가 계속 참여할 수 있다.

서버는 target Recording row를 lock으로 잡고 `RUNNING`인지 확인한다. 프론트는
`currentRecording.id`를 target `recordingId`로 보낸다. 녹음이 시작되지 않아
`currentRecording`이 없는데 종료를 요청하면 잘못된 요청으로 처리한다. 이미 종료된
녹음은 기존 Recording과 MeetingReport 결과를 반환한다. 녹음 종료, STT 요청, LLM
보고서 생성 요청 side effect는 서버에서 한 번만 수행되어야 한다.

`recording.durationSec`이 60을 초과하면 App Server는 `MeetingReport.status =
PROCESSING`과 durable outbox intent를 같은 transaction으로 생성하고 AI job 발행을
시도한다. SQS 일시 실패는 outbox에 `pending`으로 남고, dispatcher가 시작 직후와
60초마다 다시 발행한다. 각 발행은 60초 claim lease와 `FOR UPDATE SKIP LOCKED`를
사용하며, 실패 시 1·2·4·8·16분 뒤 재시도한다. 5회 재시도 뒤에도 실패하면 outbox와
Report를 `FAILED`로 전환한다. SQS 발행은 at-least-once이므로, 발행 성공 뒤
delivery 기록이 유실된 경우 같은 report job이 다시 전달될 수 있다.

MVP에서는 `PROCESSING`을 queued와 running을 모두 포함하는 상태로 사용한다. AI
Worker가 이미 delivery된 job을 처리하지 못해 Report가 20분 넘게 `PROCESSING`이면,
dispatcher는 해당 Report를 `FAILED`로 전환한다. AI Worker는 job을 consume해 OpenAI
STT API로 transcript를 만들고, OpenAI LLM API로 보고서를 생성한 뒤 DB의
MeetingReport를 `COMPLETED` 또는 `FAILED`로 갱신한다. Frontend는 App Server API로
MeetingReport 상태를 조회한다. API 응답과 화면 조회의 source of truth는 DB의
MeetingReport다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 회의 정보 |
| `recording` | Recording | 종료됐거나 이미 종료돼 있던 녹음 |
| `report` | MeetingReport \| null | 회의록. `recording.durationSec`이 60 이하면 `null` |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | 녹음이 시작되지 않았거나 종료할 수 있는 진행 중 녹음이 없음 |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 또는 현재 active participant가 아님 |
| `404` | `NOT_FOUND` | 회의 또는 녹음을 찾을 수 없음 |

### 녹음 metadata 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recordings
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `recordings` | Recording[] | 녹음 목록. 기본 정렬은 `startedAt DESC` |

주요 오류: `401`, `403`, `404`

### 진행 중 녹음 metadata 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recordings/current
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `recording` | Recording \| null | 진행 중 녹음. 없으면 `null` |

주요 오류: `401`, `403`, `404`

### 회의 참여자 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/participants
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `participants` | Participant[] | 회의 참석자 목록 |

이 목록은 회의 참석 이력이다. 마이크 상태, 발화 상태, LiveKit connection state는
포함하지 않는다.

주요 오류: `401`, `403`, `404`

### MeetingReport 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/meeting-reports?status=FAILED&limit=20
```

Query:

| Name | Required | 설명 |
| --- | --- | --- |
| `status` | No | `PROCESSING`, `COMPLETED`, `FAILED` |
| `limit` | No | 반환 개수. 기본값 20, 최대 100 |

`status`가 허용값이 아니면 `400 BAD_REQUEST`를 반환한다. `limit`이 숫자가
아니거나 20 미만이면 20으로, 100 초과면 100으로 보정한다.

기본 정렬은 `createdAt DESC`다. `recording.durationSec`이 60 이하인 녹음은
MeetingReport가 없으므로 목록에 나오지 않는다. 실패한 MeetingReport도 목록에 나온다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `reports` | MeetingReport[] | 회의록 목록. `transcriptText` 제외 |

주요 오류: `400`, `401`, `403`

### MeetingReport 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport | 회의록 상세. `transcriptText` 포함 |

실패한 MeetingReport도 상세 조회할 수 있다.

주요 오류: `401`, `403`, `404`

### 특정 회의의 MeetingReport 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/reports
```

회의는 있지만 MeetingReport가 없으면 빈 배열을 반환한다.
`recording.durationSec`이 60 이하인 녹음은 MeetingReport가 없으므로 목록에
포함되지 않는다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `reports` | MeetingReport[] | 특정 회의의 회의록 목록. `transcriptText` 제외 |

주요 오류: `401`, `403`, `404`

### 실패한 MeetingReport 재생성 요청

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs
```

Request body 없음.

`FAILED` 상태의 MeetingReport만 재생성을 요청할 수 있다. 단, 연결된 Recording이
`COMPLETED` 상태이고 `audioFileKey`가 있어 AI Worker가 다시 처리할 수 있는 경우만
허용한다. 요청이 성공하면 MeetingReport는 다시 `PROCESSING` 상태가 되고
`retryCount`가 증가한다. 기존 실패 정보와 이전 산출물은 초기화한다. MVP 응답에는
별도 `jobId`를 포함하지 않고, 긴 `transcriptText`도 포함하지 않는다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport | 갱신된 회의록 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | `PROCESSING` 또는 `COMPLETED` 상태의 MeetingReport 재생성 요청 |
| `400` | `BAD_REQUEST` | Recording이 완료되지 않았거나 `audioFileKey`가 없어 재생성할 수 없음 |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 |
| `404` | `NOT_FOUND` | 회의록을 찾을 수 없음 |

## MVP 제외

다음 API와 기능은 MVP Meeting API 범위에서 제외한다.

```http
GET /api/v1/me/recording-consent
PUT /api/v1/me/recording-consent
PUT /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording-consents/me
POST /api/v1/workspaces/{workspaceId}/meeting-rooms
GET /api/v1/workspaces/{workspaceId}/meeting-rooms
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/end
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording/end
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/report
```

- 서버 기반 녹음 동의 저장
- MeetingRoom 관리
- 참여자 강제 퇴장 또는 방 전체를 즉시 닫는 수동 회의 종료 API
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정
- LiveKit Webhook 기반 participant 보정
- realtime-server 기반 음성 송수신
- 회의록 완료 후 참석자 notification
