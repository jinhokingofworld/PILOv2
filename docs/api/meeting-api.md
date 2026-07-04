# Meeting API

## 범위

Meeting API는 고정 Workspace 회의 페이지를 담당한다.

- 현재 진행 중인 회의 조회
- 회의 시작, 참여, 나가기, 종료
- Application server를 통한 LiveKit token 발급
- 회의 녹음 metadata
- MeetingReport 생성 상태와 재시도
- 회의 참여자 목록

MVP에는 MeetingRoom 관리가 없다. `roomKey` 기본값은
`MAIN_MEETING_ROOM`이며, 진행 중 회의는 `(workspaceId, roomKey)` 기준으로
하나만 존재할 수 있다.

## 데이터 규칙

- 녹음 동의 여부는 프론트 `localStorage.recordingConsentAccepted = true`로만 저장한다.
- MVP 서버 DB에는 녹음 동의 여부를 저장하지 않는다.
- 60초 미만 회의는 MeetingReport를 생성하지 않는다.
- 마지막 참여자가 나가면 회의가 자동 종료될 수 있다.
- 명시 종료는 `POST /workspaces/{workspaceId}/meetings/{meetingId}/end`로 처리한다.
- 브라우저 강제 종료, 네트워크 단절 보정은 MVP 제외다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/meetings/current` | 기본 room의 현재 진행 중 회의 조회 |
| `POST` | `/workspaces/{workspaceId}/meetings` | 새 회의 시작 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 진행 중 회의 참여 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}` | 회의 상세 조회 |
| `DELETE` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 회의 나가기 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/end` | 회의 종료와 회의록 생성 트리거 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recording` | 녹음 metadata 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports` | MeetingReport 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports/{reportId}` | MeetingReport 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/report` | 특정 회의의 MeetingReport 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs` | 실패한 회의록 재생성 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants` | 회의 참여자 목록 조회 |

## 회의 시작

```json
{
  "roomKey": "MAIN_MEETING_ROOM"
}
```

응답 주요 필드:

```json
{
  "meetingId": "meeting_uuid",
  "roomKey": "MAIN_MEETING_ROOM",
  "livekitRoomName": "pilo-main-meeting-20260704-001",
  "livekitToken": "jwt",
  "recordingStatus": "RUNNING",
  "startedAt": "2026-07-04T00:00:00.000Z"
}
```

서버 규칙:

- Workspace member인지 확인한다.
- `(workspaceId, roomKey)`에 진행 중 회의가 있으면 거부한다.
- `meetings`, `meeting_participants`, `meeting_recordings`를 생성한다.
- LiveKit audio recording을 시작한다.

## 회의 참여

응답에는 LiveKit room name, token, participant identity, 현재 recording
status를 포함한다. 같은 회의에 재입장하면 기존 participant row를 갱신한다.

## 회의 종료

서버 규칙:

- 현재 회의 참여자만 종료할 수 있다.
- `meetings.ended_at`, `ended_by_id`를 저장한다.
- LiveKit recording을 종료한다.
- 회의 시간이 60초 미만이면 MeetingReport를 생성하지 않는다.
- 60초 이상이면 `meeting_reports`를 `PROCESSING` 상태로 생성한다.
- STT/LLM 처리는 AI worker에서 비동기로 수행할 수 있다.

## MeetingReport 상태값

| Field | Values |
| --- | --- |
| `meeting_recordings.status` | `RUNNING`, `COMPLETED`, `FAILED` |
| `meeting_reports.status` | `PROCESSING`, `COMPLETED`, `FAILED` |
| `meeting_reports.failed_step` | `RECORDING`, `STT`, `LLM` |

## MVP 제외

```http
GET /api/v1/me/recording-consent
PUT /api/v1/me/recording-consent
PUT /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording-consents/me
POST /api/v1/workspaces/{workspaceId}/meeting-rooms
GET /api/v1/workspaces/{workspaceId}/meeting-rooms
```
