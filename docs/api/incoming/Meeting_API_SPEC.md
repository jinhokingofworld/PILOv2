## 기준

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <pilo_access_token>`
- MVP 기준 회의실은 고정 회의방 하나로 본다.
- 기본 `roomKey`는 `"MAIN_MEETING_ROOM"`으로 사용한다.
- LiveKit JWT Token은 DB에 저장하지 않고, 회의 시작 또는 참여 시 서버가 매번 발급한다.
- 회의 중 실시간 상태인 마이크 ON/OFF, 발화 상태, 연결 상태는 DB에 저장하지 않는다.
- 회의 종료 처리는 중복 실행되면 안 된다.
- 회의록 생성은 `meeting_reports.meeting_id` 기준으로 중복 생성되면 안 된다.
- MVP에서는 녹음 동의 여부를 서버에 저장하지 않고 프론트 `localStorage`에 저장한다.
- 회의 시간이 60초 미만이면 `MeetingReport`를 생성하지 않고 회의록 목록에도 노출하지 않는다.
- 회의 종료 API는 회의 종료와 회의록 생성 작업을 시작하는 진입점이다. STT/LLM 처리까지 반드시 HTTP 요청 안에서 동기적으로 완료한다는 의미는 아니다.

## MVP API 목록

```http
GET    /api/v1/meetings/current
POST   /api/v1/meetings
POST   /api/v1/meetings/{meetingId}/participants/me
DELETE /api/v1/meetings/{meetingId}/participants/me
POST   /api/v1/meetings/{meetingId}/end
GET    /api/v1/meetings/{meetingId}
GET    /api/v1/meetings/{meetingId}/recording
GET    /api/v1/meeting-reports
GET    /api/v1/meeting-reports/{reportId}
GET    /api/v1/meetings/{meetingId}/report
POST   /api/v1/meeting-reports/{reportId}/regeneration-jobs
GET    /api/v1/meetings/{meetingId}/participants
```

## MVP 제외 / 추후 확장 API

MVP에서는 녹음 동의 여부를 `localStorage`에 저장하므로 아래 API는 구현 범위에서 제외한다.

```http
GET /api/v1/me/recording-consent
PUT /api/v1/me/recording-consent
PUT /api/v1/meetings/{meetingId}/recording-consents/me
```

추후 정책 강화로 서버 DB에 동의 기록을 남겨야 할 때 별도 확장 API로 다시 검토한다.

## 공통 Error Response

```json
{
  "code": "UNAUTHORIZED",
  "message": "인증이 필요합니다."
}
```

```json
{
  "code": "FORBIDDEN",
  "message": "요청 권한이 없습니다."
}
```

```json
{
  "code": "VALIDATION_ERROR",
  "message": "요청 값이 올바르지 않습니다."
}
```

---

# 1. 현재 진행 중인 회의 조회

회의 페이지에 들어왔을 때 현재 진행 중인 회의가 있는지 조회한다.

첨부 기능 흐름에서는 프론트가 회의 페이지 진입 시 `endedAt = null`인 Meeting을 조회하고, 있으면 참여 버튼을 보여주고 없으면 시작 버튼을 보여주는 흐름으로 정리되어 있었다.

## Endpoint

`GET /api/v1/meetings/current`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body - 진행 중 회의가 있는 경우

```json
{
  "exists": true,
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "roomKey": "MAIN_MEETING_ROOM",
    "livekitRoomName": "pilo-main-meeting-20260703-001",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": null,
    "participantCount": 3,
    "recording": {
      "id": "recording_01JZABCDE999999999",
      "status": "RUNNING",
      "startedAt": "2026-07-03T13:00:05Z"
    }
  }
}
```

## Response Body - 진행 중 회의가 없는 경우

```json
{
  "exists": false,
  "meeting": null
}
```

---

# 2. 새 회의 시작

진행 중인 회의가 없을 때 새 회의를 생성한다.

이 API는 내부적으로 다음 작업을 수행한다.

1. `endedAt = null`인 진행 중 회의가 있는지 다시 확인한다.
2. 없으면 `meetings` row를 생성한다.
3. 현재 사용자를 `meeting_participants`에 등록한다.
4. LiveKit Room 이름을 결정한다.
5. 사용자용 LiveKit JWT Token을 발급한다.
6. LiveKit Egress 녹음을 시작한다.
7. `meeting_recordings.status = RUNNING`으로 저장한다.

첨부 흐름에서도 새 회의 시작 시 Meeting 생성, LiveKit JWT 발급, MeetingParticipant 생성, LiveKit Egress 시작, Recording RUNNING 저장 순서로 정리되어 있었다.

녹음 동의 여부는 이 API에서 서버로 전달하지 않는다. MVP에서는 프론트가 호출 전에 `localStorage.recordingConsentAccepted` 값을 확인한다.

## Endpoint

`POST /api/v1/meetings`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

```json
{
  "roomKey": "MAIN_MEETING_ROOM"
}
```

## Response Body

```json
{
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "roomKey": "MAIN_MEETING_ROOM",
    "livekitRoomName": "pilo-main-meeting-20260703-001",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": null
  },
  "participant": {
    "id": "participant_01JZABCDE111111111",
    "meetingId": "meeting_01JZABCDEF123456789",
    "userId": "user_01JZUSER123456789",
    "livekitIdentity": "user_01JZUSER123456789",
    "joinedAt": "2026-07-03T13:00:01Z",
    "leftAt": null
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "meetingId": "meeting_01JZABCDEF123456789",
    "status": "RUNNING",
    "startedAt": "2026-07-03T13:00:05Z"
  },
  "livekit": {
    "url": "wss://pilo-livekit.example.com",
    "roomName": "pilo-main-meeting-20260703-001",
    "token": "<livekit-jwt>"
  }
}
```

## Error Response - 이미 진행 중인 회의가 있는 경우

```json
{
  "code": "ACTIVE_MEETING_ALREADY_EXISTS",
  "message": "이미 진행 중인 회의가 있습니다.",
  "currentMeetingId": "meeting_01JZABCDEF123456789"
}
```

## Error Response - 녹음 시작 실패

```json
{
  "code": "RECORDING_START_FAILED",
  "message": "녹음 시작에 실패했습니다."
}
```

## Error Response - LiveKit 토큰 발급 실패

```json
{
  "code": "LIVEKIT_TOKEN_ISSUE_FAILED",
  "message": "LiveKit 입장 토큰 발급에 실패했습니다."
}
```

---

# 3. 진행 중 회의 참여

이미 진행 중인 회의에 현재 로그인한 사용자를 참여시킨다.

이 API는 “회의에 현재 로그인한 사용자를 참가자로 추가한다”는 의미다.

동일 사용자가 같은 회의에 재입장하는 경우 새로운 `meeting_participants` row를 생성하지 않는다. 기존 participant row의 `joinedAt`, `leftAt`을 갱신한다.

예시:

```txt
최초 입장:
joinedAt = 13:00
leftAt = null

나가기:
joinedAt = 13:00
leftAt = 13:20

재입장:
joinedAt = 13:30
leftAt = null
```

이 방식은 구현이 단순하지만, 사용자의 과거 입장/퇴장 이력을 모두 보존하지는 않는다. MVP에서는 단순성을 우선한다.

## Endpoint

`POST /api/v1/meetings/{meetingId}/participants/me`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body

```json
{
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "roomKey": "MAIN_MEETING_ROOM",
    "livekitRoomName": "pilo-main-meeting-20260703-001",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": null
  },
  "participant": {
    "id": "participant_01JZABCDE222222222",
    "meetingId": "meeting_01JZABCDEF123456789",
    "userId": "user_01JZUSER222222222",
    "livekitIdentity": "user_01JZUSER222222222",
    "joinedAt": "2026-07-03T13:05:00Z",
    "leftAt": null
  },
  "livekit": {
    "url": "wss://pilo-livekit.example.com",
    "roomName": "pilo-main-meeting-20260703-001",
    "token": "<livekit-jwt>"
  }
}
```

## Error Response - 종료된 회의에 참여하려는 경우

```json
{
  "code": "MEETING_ALREADY_ENDED",
  "message": "이미 종료된 회의에는 참여할 수 없습니다."
}
```

## Error Response - 회의를 찾을 수 없는 경우

```json
{
  "code": "MEETING_NOT_FOUND",
  "message": "회의를 찾을 수 없습니다."
}
```

## Error Response - LiveKit 토큰 발급 실패

```json
{
  "code": "LIVEKIT_TOKEN_ISSUE_FAILED",
  "message": "LiveKit 입장 토큰 발급에 실패했습니다."
}
```

---

# 4. 회의 상세 조회

회의 상세 정보를 조회한다.

회의 화면 또는 회의 종료 후 상세 화면에서 사용한다.

## Endpoint

`GET /api/v1/meetings/{meetingId}`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body

```json
{
  "id": "meeting_01JZABCDEF123456789",
  "roomKey": "MAIN_MEETING_ROOM",
  "livekitRoomName": "pilo-main-meeting-20260703-001",
  "startedAt": "2026-07-03T13:00:00Z",
  "endedAt": null,
  "participants": [
    {
      "id": "participant_01JZABCDE111111111",
      "userId": "user_01JZUSER123456789",
      "nickname": "진호",
      "livekitIdentity": "user_01JZUSER123456789",
      "joinedAt": "2026-07-03T13:00:01Z",
      "leftAt": null
    }
  ],
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "status": "RUNNING",
    "startedAt": "2026-07-03T13:00:05Z",
    "endedAt": null,
    "durationSec": null,
    "audioFileUrl": null
  },
  "report": null
}
```

---

# 5. 회의 나가기

현재 로그인한 사용자만 회의에서 나간다.

첨부 흐름에서는 `[회의 나가기]`는 나만 LiveKit Room에서 나가는 것이고, 마지막 사용자가 나가면 회의 세션이 자동 종료되며 녹음도 종료되는 것으로 정리되어 있었다.

MVP에서는 사용자가 정상적으로 `[회의 나가기]` 버튼을 누르는 흐름을 기준으로 처리한다. 브라우저 강제 종료, 네트워크 끊김, 비정상 disconnect는 추후 LiveKit Webhook을 통해 보정한다.

## Endpoint

`DELETE /api/v1/meetings/{meetingId}/participants/me`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body - 아직 남은 참여자가 있는 경우

```json
{
  "participant": {
    "id": "participant_01JZABCDE222222222",
    "meetingId": "meeting_01JZABCDEF123456789",
    "userId": "user_01JZUSER222222222",
    "leftAt": "2026-07-03T13:30:00Z"
  },
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "endedAt": null,
    "autoEnded": false
  }
}
```

## Response Body - 마지막 참여자라서 회의가 자동 종료된 경우

```json
{
  "participant": {
    "id": "participant_01JZABCDE222222222",
    "meetingId": "meeting_01JZABCDEF123456789",
    "userId": "user_01JZUSER222222222",
    "leftAt": "2026-07-03T13:30:00Z"
  },
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "endedAt": "2026-07-03T13:30:01Z",
    "autoEnded": true
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "status": "COMPLETED",
    "endedAt": "2026-07-03T13:30:03Z"
  },
  "report": {
    "id": "report_01JZREPORT123456789",
    "status": "PROCESSING"
  }
}
```

## Error Response - 참여 이력이 없는 경우

```json
{
  "code": "PARTICIPANT_NOT_FOUND",
  "message": "현재 사용자의 회의 참여 이력이 없습니다."
}
```

## Error Response - 이미 종료된 회의인 경우

```json
{
  "code": "MEETING_ALREADY_ENDED",
  "message": "이미 종료된 회의입니다."
}
```

---

# 6. 회의 종료하고 회의록 생성

전체 회의 세션을 종료하고, 녹음 종료 후 회의록 생성을 시작한다.

회의 종료는 명확한 액션 API인 `POST /api/v1/meetings/{meetingId}/end`로 처리한다.

첨부 문서에서도 회의 종료 시 `Meeting.endedAt` 저장, LiveKit Egress 중지, Recording 상태 저장, 최소 시간 확인, `MeetingReport.status = PROCESSING` 생성, STT/LLM 요청 흐름으로 정리되어 있었다.

회의 종료 API는 회의 종료와 회의록 생성 작업을 시작하는 진입점이다. STT/LLM 처리까지 반드시 HTTP 요청 안에서 동기적으로 완료한다는 의미는 아니다. 추후 인프라 설계에 따라 큐와 Worker를 통해 비동기로 처리할 수 있다.

처리 범위:

1. Meeting 종료
2. LiveKit Egress 녹음 종료
3. Recording 상태 저장
4. 녹음 파일 저장 확인
5. MeetingReport 생성
6. STT 요청
7. LLM 회의록 생성 요청

회의 종료는 해당 회의에 참여 중인 사용자라면 누구나 실행할 수 있다. 회의에 참여하지 않은 사용자가 종료 요청을 보내면 403 FORBIDDEN을 반환한다.

추후 인프라 설계에 따라 다음처럼 분리될 수 있다.

```txt
App Server:
- 회의 시작/참여/종료 API 처리
- DB 상태 변경
- 작업 큐 발행

Realtime Server 또는 LiveKit 관련 처리:
- LiveKit Room 연결
- LiveKit Egress 시작/종료

AI Worker:
- STT 처리
- LLM 회의록 생성
- MeetingReport 업데이트
```

## Endpoint

`POST /api/v1/meetings/{meetingId}/end`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body - 회의록 생성 시작

```json
{
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "roomKey": "MAIN_MEETING_ROOM",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": "2026-07-03T13:40:00Z",
    "durationSec": 2400
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "meetingId": "meeting_01JZABCDEF123456789",
    "status": "COMPLETED",
    "audioFileUrl": "<https://cdn.example.com/recordings/meeting_01JZABCDEF123456789.mp3>",
    "audioFileKey": "recordings/meeting_01JZABCDEF123456789.mp3",
    "durationSec": 2390,
    "fileSizeBytes": 12345678,
    "startedAt": "2026-07-03T13:00:05Z",
    "endedAt": "2026-07-03T13:40:02Z"
  },
  "report": {
    "id": "report_01JZREPORT123456789",
    "meetingId": "meeting_01JZABCDEF123456789",
    "recordingId": "recording_01JZABCDE999999999",
    "status": "PROCESSING",
    "failedStep": null,
    "errorMessage": null,
    "retryCount": 0,
    "createdAt": "2026-07-03T13:40:05Z"
  }
}
```

## Response Body - 회의 시간이 너무 짧아 회의록을 생성하지 않는 경우

```json
{
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": "2026-07-03T13:00:30Z",
    "durationSec": 30
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "status": "COMPLETED",
    "durationSec": 30
  },
  "report": null,
  "skipReason": {
    "code": "MEETING_TOO_SHORT",
    "message": "회의 시간이 너무 짧아 회의록을 생성하지 않습니다.",
    "minDurationSec": 60
  }
}
```

## Response Body - 이미 종료된 회의인 경우

```json
{
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": "2026-07-03T13:40:00Z",
    "durationSec": 2400
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "status": "COMPLETED"
  },
  "report": {
    "id": "report_01JZREPORT123456789",
    "status": "PROCESSING"
  },
  "alreadyEnded": true
}
```

회의 시간이 60초 미만이면 `MeetingReport`를 생성하지 않는다. 따라서 해당 회의는 회의록 목록에 노출되지 않는다.

## Error Response - 회의를 찾을 수 없는 경우

```json
{
  "code": "MEETING_NOT_FOUND",
  "message": "회의를 찾을 수 없습니다."
}
```

## Error Response - 이미 종료된 회의인 경우

```json
{
  "code": "MEETING_ALREADY_ENDED",
  "message": "이미 종료된 회의입니다."
}
```

## Error Response - 회의 참여자가 아닌 경우

```json
{
  "code": "NOT_MEETING_PARTICIPANT",
  "message": "회의 참여자만 회의를 종료할 수 있습니다."
}
```

## Error Response - 녹음 종료 실패

```json
{
  "code": "RECORDING_STOP_FAILED",
  "message": "녹음 종료 처리에 실패했습니다."
}
```

## Error Response - 회의록 중복 생성

```json
{
  "code": "REPORT_ALREADY_EXISTS",
  "message": "이미 해당 회의의 회의록이 생성되었거나 생성 중입니다."
}
```

---

# 7. 내 녹음 동의 상태 조회 - MVP 제외 / 추후 확장

MVP에서는 녹음 동의 여부를 `localStorage`에 저장한다.

```txt
recordingConsentAccepted = true
```

따라서 이 API는 MVP 구현 범위에서 제외한다. 추후 정책 강화로 서버 DB에 동의 기록을 저장할 때 사용하는 확장 API다.

첨부 DB 설계에서는 녹음 동의 저장 방식으로 사용자 단위 `recording_consents`와 회의별 `meeting_recording_consents`가 선택 테이블로 제시되어 있었다.

## Endpoint

`GET /api/v1/me/recording-consent`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body - 동의한 경우

```json
{
  "agreed": true,
  "agreedAt": "2026-07-03T12:50:00Z"
}
```

## Response Body - 동의하지 않은 경우

```json
{
  "agreed": false,
  "agreedAt": null
}
```

---

# 8. 내 녹음 동의 저장 - MVP 제외 / 추후 확장

MVP에서는 사용자가 녹음 동의 모달에서 동의했을 때 서버 API를 호출하지 않고 `localStorage.recordingConsentAccepted = true`를 저장한다. 이 API는 추후 확장용이다.

## Endpoint

`PUT /api/v1/me/recording-consent`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

```json
{
  "agreed": true
}
```

## Response Body

```json
{
  "agreed": true,
  "agreedAt": "2026-07-03T12:50:00Z"
}
```

---

# 9. 회의별 내 녹음 동의 저장 - MVP 제외 / 추후 확장

회의마다 녹음 동의를 따로 받아야 하는 정책이라면 추후 이 API를 사용한다. MVP 구현 범위에는 포함하지 않는다.

## Endpoint

`PUT /api/v1/meetings/{meetingId}/recording-consents/me`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

```json
{
  "agreed": true
}
```

## Response Body

```json
{
  "id": "consent_01JZCONSENT123456789",
  "meetingId": "meeting_01JZABCDEF123456789",
  "userId": "user_01JZUSER123456789",
  "agreed": true,
  "agreedAt": "2026-07-03T12:59:00Z"
}
```

---

# 10. 회의 녹음 정보 조회

회의에 연결된 녹음 정보를 조회한다.

## Endpoint

`GET /api/v1/meetings/{meetingId}/recording`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body

```json
{
  "id": "recording_01JZABCDE999999999",
  "meetingId": "meeting_01JZABCDEF123456789",
  "livekitEgressId": "EG_abc123xyz",
  "status": "COMPLETED",
  "audioFileUrl": "<https://cdn.example.com/recordings/meeting_01JZABCDEF123456789.mp3>",
  "audioFileKey": "recordings/meeting_01JZABCDEF123456789.mp3",
  "durationSec": 2390,
  "fileSizeBytes": 12345678,
  "startedAt": "2026-07-03T13:00:05Z",
  "endedAt": "2026-07-03T13:40:02Z",
  "errorMessage": null,
  "createdAt": "2026-07-03T13:00:05Z",
  "updatedAt": "2026-07-03T13:40:02Z"
}
```

---

# 11. 회의록 목록 조회

회의록 게시판에서 사용하는 API다.

첨부 흐름에서는 회의록 게시판에서 `PROCESSING`, `COMPLETED`, `FAILED` 상태를 확인하고, 완료된 회의록은 상세 조회, 실패한 회의록은 재시도할 수 있는 흐름으로 정리되어 있었다.

회의 시간이 60초 미만이면 `MeetingReport`를 생성하지 않는다. 따라서 해당 회의는 회의록 목록에 노출되지 않는다.

회의록 페이지 UI에는 다음 안내를 표시한다.

```txt
회의록은 1분 이상 진행된 회의에 대해서만 생성됩니다.
1분 이내로 종료된 짧은 회의는 회의록 목록에 표시되지 않습니다.
```

## Endpoint

`GET /api/v1/meeting-reports`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Query Parameters

| 이름     | 타입   | 필수 | 설명                                |
| -------- | ------ | ---- | ----------------------------------- |
| `status` | string | N    | `PROCESSING`, `COMPLETED`, `FAILED` |
| `page`   | number | N    | 페이지 번호                         |
| `size`   | number | N    | 페이지 크기                         |

## Request Body

없음

## Response Body

```json
{
  "items": [
    {
      "id": "report_01JZREPORT123456789",
      "meetingId": "meeting_01JZABCDEF123456789",
      "recordingId": "recording_01JZABCDE999999999",
      "status": "COMPLETED",
      "summary": "오늘 회의에서는 LiveKit 기반 음성 회의와 회의록 생성 흐름을 정리했다.",
      "startedAt": "2026-07-03T13:00:00Z",
      "endedAt": "2026-07-03T13:40:00Z",
      "createdAt": "2026-07-03T13:40:05Z",
      "updatedAt": "2026-07-03T13:45:10Z"
    },
    {
      "id": "report_01JZREPORT987654321",
      "meetingId": "meeting_01JZMEETING987654321",
      "recordingId": "recording_01JZREC987654321",
      "status": "PROCESSING",
      "summary": null,
      "startedAt": "2026-07-03T14:00:00Z",
      "endedAt": "2026-07-03T14:20:00Z",
      "createdAt": "2026-07-03T14:20:05Z",
      "updatedAt": "2026-07-03T14:20:05Z"
    }
  ],
  "page": 1,
  "size": 20,
  "totalCount": 2,
  "totalPages": 1
}
```

---

# 12. 회의록 상세 조회

회의록 상세 페이지에서 사용한다.

첨부 DB 설계의 `meeting_reports`에는 `transcript_text`, `summary`, `discussion_points`, `decisions`, `action_item_candidates`, `failed_step`, `error_message`, `retry_count`가 포함되어 있었다.

## Endpoint

`GET /api/v1/meeting-reports/{reportId}`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body - 생성 완료

```json
{
  "id": "report_01JZREPORT123456789",
  "meetingId": "meeting_01JZABCDEF123456789",
  "recordingId": "recording_01JZABCDE999999999",
  "status": "COMPLETED",
  "failedStep": null,
  "errorMessage": null,
  "transcriptText": "진호: 오늘은 회의 기능에 대해서 정리해보겠습니다...",
  "summary": "LiveKit 기반 음성 회의와 회의록 생성 MVP 흐름을 정리했다.",
  "discussionPoints": "1. 진행 중 회의는 하나만 존재해야 한다.\n2. 회의 시작 시 녹음을 시작한다.\n3. 회의 종료 시 STT와 LLM을 실행한다.",
  "decisions": "1. MVP에서는 고정 회의방 하나만 사용한다.\n2. 실시간 마이크 상태는 DB에 저장하지 않는다.\n3. 회의록 상태는 PROCESSING, COMPLETED, FAILED로 관리한다.",
  "actionItemCandidates": [
    {
      "title": "회의 시작 API 구현",
      "description": "POST /api/v1/meetings API를 구현한다.",
      "assigneeUserId": "user_01JZUSER123456789",
      "priority": "HIGH"
    },
    {
      "title": "회의록 목록 페이지 구현",
      "description": "회의록 상태별 목록 조회 UI를 구현한다.",
      "assigneeUserId": null,
      "priority": "MEDIUM"
    }
  ],
  "retryCount": 0,
  "meeting": {
    "id": "meeting_01JZABCDEF123456789",
    "roomKey": "MAIN_MEETING_ROOM",
    "startedAt": "2026-07-03T13:00:00Z",
    "endedAt": "2026-07-03T13:40:00Z"
  },
  "recording": {
    "id": "recording_01JZABCDE999999999",
    "audioFileUrl": "<https://cdn.example.com/recordings/meeting_01JZABCDEF123456789.mp3>",
    "durationSec": 2390
  },
  "createdAt": "2026-07-03T13:40:05Z",
  "updatedAt": "2026-07-03T13:45:10Z"
}
```

## Response Body - 생성 실패

```json
{
  "id": "report_01JZREPORT123456789",
  "meetingId": "meeting_01JZABCDEF123456789",
  "recordingId": "recording_01JZABCDE999999999",
  "status": "FAILED",
  "failedStep": "STT",
  "errorMessage": "STT 처리 중 오류가 발생했습니다.",
  "transcriptText": null,
  "summary": null,
  "discussionPoints": null,
  "decisions": null,
  "actionItemCandidates": [],
  "retryCount": 1,
  "createdAt": "2026-07-03T13:40:05Z",
  "updatedAt": "2026-07-03T13:45:10Z"
}
```

---

# 13. 특정 회의의 회의록 조회

회의 상세 화면에서 연결된 회의록을 바로 조회할 때 사용한다.

## Endpoint

`GET /api/v1/meetings/{meetingId}/report`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body

```json
{
  "id": "report_01JZREPORT123456789",
  "meetingId": "meeting_01JZABCDEF123456789",
  "recordingId": "recording_01JZABCDE999999999",
  "status": "COMPLETED",
  "summary": "LiveKit 기반 음성 회의와 회의록 생성 MVP 흐름을 정리했다.",
  "discussionPoints": "1. 진행 중 회의는 하나만 존재해야 한다.\n2. 회의 시작 시 녹음을 시작한다.",
  "decisions": "1. MVP에서는 고정 회의방 하나만 사용한다.",
  "retryCount": 0,
  "createdAt": "2026-07-03T13:40:05Z",
  "updatedAt": "2026-07-03T13:45:10Z"
}
```

## Response Body - 회의록이 없는 경우

```json
{
  "report": null,
  "reason": {
    "code": "REPORT_NOT_CREATED",
    "message": "아직 생성된 회의록이 없습니다."
  }
}
```

---

# 14. 회의록 재생성 작업 생성

실패한 회의록을 다시 처리한다.

이 API는 “회의록에 대해 재처리 작업을 생성한다”는 의미다.

첨부 문서에서도 `FAILED` 상태인 회의록은 재시도 버튼을 통해 다시 `PROCESSING`으로 바꾸고 STT/LLM을 재실행하는 흐름으로 정리되어 있었다.

재시도 정책:

```txt
PROCESSING 상태에서는 재시도할 수 없다.
COMPLETED 상태에서는 재시도할 수 없다.
FAILED 상태에서만 재시도할 수 있다.
```

## Endpoint

`POST /api/v1/meeting-reports/{reportId}/regeneration-jobs`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

```json
{
  "fromFailedStep": true
}
```

## Response Body

```json
{
  "job": {
    "id": "report_job_01JZJOB123456789",
    "reportId": "report_01JZREPORT123456789",
    "status": "QUEUED",
    "createdAt": "2026-07-03T14:00:00Z"
  },
  "report": {
    "id": "report_01JZREPORT123456789",
    "status": "PROCESSING",
    "failedStep": null,
    "errorMessage": null,
    "retryCount": 2,
    "updatedAt": "2026-07-03T14:00:00Z"
  }
}
```

## Error Response - 이미 처리 중인 경우

```json
{
  "code": "REPORT_ALREADY_PROCESSING",
  "message": "이미 회의록을 생성 중입니다."
}
```

## Error Response - 이미 완료된 경우

```json
{
  "code": "REPORT_ALREADY_COMPLETED",
  "message": "이미 생성 완료된 회의록입니다."
}
```

## Error Response - 회의록을 찾을 수 없는 경우

```json
{
  "code": "REPORT_NOT_FOUND",
  "message": "회의록을 찾을 수 없습니다."
}
```

## Error Response - 재시도할 수 없는 상태인 경우

```json
{
  "code": "REPORT_RETRY_NOT_ALLOWED",
  "message": "실패 상태의 회의록만 재시도할 수 있습니다."
}
```

---

# 15. 회의 참석자 목록 조회

회의 상세 화면에서 DB에 저장된 참석 이력을 조회한다.

실시간 참여자 상태는 LiveKit/React 상태로 처리하지만, 회의 종료 후 “누가 참석했는지”를 남기기 위해 `meeting_participants`는 필요하다고 정리되어 있었다.

## Endpoint

`GET /api/v1/meetings/{meetingId}/participants`

## Headers

```
Authorization: Bearer <pilo_access_token>
```

## Request Body

없음

## Response Body

```json
{
  "items": [
    {
      "id": "participant_01JZABCDE111111111",
      "meetingId": "meeting_01JZABCDEF123456789",
      "userId": "user_01JZUSER123456789",
      "nickname": "진호",
      "livekitIdentity": "user_01JZUSER123456789",
      "joinedAt": "2026-07-03T13:00:01Z",
      "leftAt": "2026-07-03T13:40:00Z"
    },
    {
      "id": "participant_01JZABCDE222222222",
      "meetingId": "meeting_01JZABCDEF123456789",
      "userId": "user_01JZUSER222222222",
      "nickname": "팀원A",
      "livekitIdentity": "user_01JZUSER222222222",
      "joinedAt": "2026-07-03T13:05:00Z",
      "leftAt": "2026-07-03T13:35:00Z"
    }
  ]
}
```

---

# 최종 API 목록 요약

## MVP API

| 기능                      | Method   | Path                                                   |
| ------------------------- | -------- | ------------------------------------------------------ |
| 현재 진행 중인 회의 조회  | `GET`    | `/api/v1/meetings/current`                             |
| 새 회의 시작              | `POST`   | `/api/v1/meetings`                                     |
| 회의 참여                 | `POST`   | `/api/v1/meetings/{meetingId}/participants/me`         |
| 회의 상세 조회            | `GET`    | `/api/v1/meetings/{meetingId}`                         |
| 회의 나가기               | `DELETE` | `/api/v1/meetings/{meetingId}/participants/me`         |
| 회의 종료하고 회의록 생성 | `POST`   | `/api/v1/meetings/{meetingId}/end`                     |
| 회의 녹음 정보 조회       | `GET`    | `/api/v1/meetings/{meetingId}/recording`               |
| 회의록 목록 조회          | `GET`    | `/api/v1/meeting-reports`                              |
| 회의록 상세 조회          | `GET`    | `/api/v1/meeting-reports/{reportId}`                   |
| 특정 회의의 회의록 조회   | `GET`    | `/api/v1/meetings/{meetingId}/report`                  |
| 회의록 재생성 작업 생성   | `POST`   | `/api/v1/meeting-reports/{reportId}/regeneration-jobs` |
| 회의 참석자 목록 조회     | `GET`    | `/api/v1/meetings/{meetingId}/participants`            |

## MVP 제외 / 추후 확장 API

| 기능                     | Method | Path                                                 |
| ------------------------ | ------ | ---------------------------------------------------- |
| 내 녹음 동의 상태 조회   | `GET`  | `/api/v1/me/recording-consent`                       |
| 내 녹음 동의 저장        | `PUT`  | `/api/v1/me/recording-consent`                       |
| 회의별 내 녹음 동의 저장 | `PUT`  | `/api/v1/meetings/{meetingId}/recording-consents/me` |
