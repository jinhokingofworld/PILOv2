# Meeting API

## 범위

Meeting API는 Workspace 안의 고정 회의 페이지를 담당한다.

- 현재 진행 중인 회의 조회
- 회의 시작, 참여, 나가기, 종료
- Application server를 통한 LiveKit 입장 token 발급
- 회의 녹음 metadata 조회
- 회의록 목록, 상세, 재생성 요청
- 회의 참여자 목록 조회

MVP에는 MeetingRoom 관리가 없다. 기본 `roomKey`는 `MAIN_MEETING_ROOM`이며,
진행 중 회의는 Workspace와 `roomKey` 기준으로 하나만 존재할 수 있다.

## 공통 규칙

- Base URL: `/api/v1`
- 인증: `docs/api/README.md`의 공통 인증 규칙을 따른다.
- 모든 endpoint는 `/workspaces/{workspaceId}` 아래에 있다.
- `workspaceId`와 `userId`는 request body로 받지 않는다.
- 현재 사용자는 공통 인증 layer가 식별한 사용자다.
- Workspace 접근 권한이 없으면 `403 FORBIDDEN`을 반환한다.
- API 응답에는 OAuth token, LiveKit secret, provider raw error를 노출하지 않는다.
- LiveKit token은 입장용 임시 token이며 서버 저장 대상이 아니다.

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
| `400` | `BAD_REQUEST` | 잘못된 요청, 진행 중 회의 중복, 종료된 회의 참여, 재시도 불가 상태 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가, 회의 종료 권한 없음 |
| `404` | `NOT_FOUND` | 회의, 녹음, 회의록을 찾을 수 없음 |

## 데이터 규칙

- 녹음 동의 여부는 프론트 `localStorage.recordingConsentAccepted = true`로만 저장한다.
- MVP 서버에는 녹음 동의 여부를 저장하지 않는다.
- 회의 중 마이크 ON/OFF, 발화 상태, 연결 상태는 LiveKit/React 상태이며 이 API에서 저장하거나 반환하지 않는다.
- 마지막 active participant가 나가면 회의가 자동 종료될 수 있다.
- 회의 종료는 현재 active participant만 요청할 수 있다.
- 60초 미만 회의는 MeetingReport를 생성하지 않고 회의록 목록에도 노출하지 않는다.
- 실패한 MeetingReport는 목록과 상세에서 조회할 수 있고 재생성을 요청할 수 있다.
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정은 MVP 제외다.

## 상태값

| 대상 | 값 | 의미 |
| --- | --- | --- |
| Recording | `RUNNING` | 녹음 진행 중 |
| Recording | `COMPLETED` | 녹음 완료 |
| Recording | `FAILED` | 녹음 실패 |
| MeetingReport | `PROCESSING` | 회의록 생성 중 |
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
| `endedById` | string \| null | 회의 종료 사용자 id |
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
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/end` | 회의 종료와 회의록 생성 트리거 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recording` | 녹음 metadata 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants` | 회의 참여자 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports` | MeetingReport 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports/{reportId}` | MeetingReport 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/report` | 특정 회의의 MeetingReport 조회 |
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
| `recordingStatus` | Recording status \| null | 진행 중 회의가 있을 때의 녹음 상태 |
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
| `recording` | Recording | 녹음 정보 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | 같은 room에 이미 진행 중인 회의가 있음 |
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
| `recording` | Recording | 녹음 정보 |

주요 오류: `400`, `401`, `403`, `404`

### 회의 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 회의 정보 |
| `recording` | Recording \| null | 녹음 정보 |
| `report` | MeetingReport \| null | 회의록. 없으면 `null` |
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

현재 사용자만 회의에서 나간다. 마지막 active participant가 나가면 회의가 자동
종료될 수 있다. 이미 나간 상태에서 다시 호출해도 같은 결과를 반환한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `participant` | Participant | 현재 사용자 참여 정보 |
| `meetingEnded` | boolean | 이 요청으로 회의가 종료됐는지 여부 |
| `meeting` | Meeting | 회의 정보 |
| `recording` | Recording \| null | 녹음 정보 |
| `report` | MeetingReport \| null | 회의록. 60초 미만이면 `null` |

주요 오류: `401`, `403`, `404`

### 회의 종료

```http
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/end
```

Request body 없음.

전체 회의를 종료하고 회의록 생성을 트리거한다. 현재 active participant만 호출할 수
있다. 이미 종료된 회의는 기존 종료 결과를 반환한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 종료된 회의 |
| `recording` | Recording \| null | 녹음 정보 |
| `report` | MeetingReport \| null | 회의록. 60초 미만이면 `null` |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 또는 현재 active participant가 아님 |
| `404` | `NOT_FOUND` | 회의를 찾을 수 없음 |

### 녹음 metadata 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `recording` | Recording | 녹음 정보 |

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

기본 정렬은 `createdAt DESC`다. 60초 미만 회의는 MeetingReport가 없으므로
목록에 나오지 않는다. 실패한 MeetingReport도 목록에 나온다.

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

### 특정 회의의 MeetingReport 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/report
```

회의는 있지만 MeetingReport가 없으면 `report`는 `null`이다. 60초 미만 회의도
`report: null`을 반환한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport \| null | 특정 회의의 회의록 |

주요 오류: `401`, `403`, `404`

### 실패한 MeetingReport 재생성 요청

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs
```

Request body 없음.

`FAILED` 상태의 MeetingReport만 재생성을 요청할 수 있다. 요청이 성공하면
MeetingReport는 다시 `PROCESSING` 상태가 되고 `retryCount`가 증가한다.
MVP 응답에는 별도 `jobId`를 포함하지 않는다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport | 갱신된 회의록 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | `PROCESSING` 또는 `COMPLETED` 상태의 MeetingReport 재생성 요청 |
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
```

- 서버 기반 녹음 동의 저장
- MeetingRoom 관리
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정
- LiveKit Webhook 기반 participant 보정
- realtime-server 기반 음성 송수신
- 회의록 완료 후 참석자 notification
