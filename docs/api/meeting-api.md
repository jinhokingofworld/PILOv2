# Meeting API

## 범위

Meeting API는 Workspace 안의 고정 회의 페이지를 담당한다.

- 현재 진행 중인 회의 조회
- 회의 시작, 참여, 나가기, 녹음 시작, 녹음 종료
- Application server를 통한 LiveKit 입장 token 발급
- 회의 녹음 metadata 조회
- 회의록 목록, 상세, 재생성 요청
- 회의 참여자 목록 조회

Workspace에는 하나 이상의 MeetingRoom이 있다. 활성 방을 `created_at ASC, id ASC`로
정렬한 첫 방이 기본 방이며 삭제할 수 없다. owner는 모든 방의 이름을 관리할 수 있다.
진행 중 회의는 Workspace와 `roomKey` 기준으로 하나만 존재할 수 있다. `roomKey`는
서버가 관리하는 안정된 내부 키이고, client는 MeetingRoom API의 `id`로 방을 선택한다.
`livekitRoomName`은 Meeting 세션마다 고유한 실제 LiveKit room name이다.

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
- Workspace membership이 철회되면 이미 가입한 Meeting Socket.IO room과 LiveKit
  participant를 즉시 정리한다. 해당 사용자가 이미 발급받은 LiveKit token도
  재입장에 사용할 수 없으며, participant·녹음·Meeting 종료 상태는 기존 LiveKit
  departure webhook으로 보정한다. `removeParticipant`가 이미 없는 participant를
  반환하면 webhook을 기다리지 않고 같은 idempotent Meeting reconciliation 경로로
  `meeting_participants.left_at`과 파생 상태를 보정한다.

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
| `400` | `BAD_REQUEST` | 기본 회의방의 이름 변경·삭제 시도 |
| `409` | `CONFLICT` | 활성 이름 중복, 진행 중 회의가 있는 방 삭제 |
| `409` | `WORKSPACE_RECORDING_CONSENT_REQUIRED` | 현재 Workspace와 정책 버전에 대한 녹음 동의가 없어 음성 회의 시작·참여·재입장이 차단됨 |
| `401` | `UNAUTHORIZED` | 인증 없음 또는 만료 |
| `403` | `FORBIDDEN` | Workspace 접근 불가, 녹음 시작/종료 권한 없음 |
| `404` | `NOT_FOUND` | 회의, 녹음, 회의록을 찾을 수 없음 |

## 데이터 규칙

- 녹음 동의는 `workspace_recording_consents`에 Workspace·사용자·정책 버전별로 저장한다. 같은 정책 버전에 이미 동의한 사용자는 같은 Workspace의 다른 회의방에서도 재동의하지 않는다.
- 브라우저 localStorage는 동의의 source of truth가 아니다. 서버는 start/join 요청의 `recordingConsent` 또는 기존 저장 동의를 확인하고, 둘 다 없으면 `409 WORKSPACE_RECORDING_CONSENT_REQUIRED`로 차단한다.
- 회의 시작, 참여, 재입장은 모두 이 검사를 통과해야 LiveKit 입장 token을 받을 수 있다.
- 회의 중 마이크 ON/OFF, 발화 상태, 연결 상태는 LiveKit/React 상태이며 이 API에서 저장하거나 반환하지 않는다.
- `Meeting.endedAt`은 회의방 생존 여부와 원본 audio retention 시점의 기준이다.
- 원본 audio S3 object는 `Meeting.endedAt` 뒤 30일이 지나면 자동 purge한다. purge가 완료되면 Recording metadata의 `audioFileUrl`과 `audioFileKey`는 `null`이 된다.
- raw transcript, transcript segment, summary, discussion point, decision, evidence, action item은 retention purge 대상이 아니며 기간 제한 없이 보존한다.
- `meeting_participants`는 참여 이력이다. 참여 또는 재입장마다 새 session 행을 만들고, 같은 Meeting·사용자와 같은 Meeting·LiveKit identity에는 각각 active session이 하나만 존재할 수 있다.
- MeetingReport의 Activity evidence는 Recording의 `[startedAt, endedAt)` 구간 안의 같은 Workspace `actorUserId` Activity Log 중, 그 사용자의 non-legacy participant session 하나가 `joinedAt <= occurredAt < leftAt`(아직 active면 `leftAt` 없음)을 만족할 때만 선택한다. 이전 단일-row 구조에서 생성된 legacy session은 실제 참여 구간을 복원할 수 없으므로 새 Activity snapshot 대상에서 제외한다.
- Activity evidence에는 action, 발생 시각, 검증된 metadata summary만 snapshot한다. AI가 summary/discussion/decision/action item을 Activity로 뒷받침한 경우에만 해당 산출물 reference를 함께 저장한다. 원본 Activity Log row, metadata.data, token, provider raw payload는 MeetingReport 응답에 포함하지 않는다.
- audio purge는 수동 API 없이 durable job으로 재시도한다. 처리 중인 MeetingReport 또는 report outbox가 audio를 참조하면 purge 후보에서 제외한다.
- 마지막 active participant가 나가면 회의가 자동 종료될 수 있다.
- Meeting과 Recording은 1:N 관계다. 같은 Meeting 안에서 녹음을 여러 번 시작하고 종료할 수 있다.
- 같은 Meeting 안에서 `RUNNING` 상태 Recording은 하나만 존재할 수 있다.
- 회의 시작 또는 참여는 LiveKit Room 입장 token만 발급하고 녹음을 자동 시작하지 않는다.
- 녹음 시작은 현재 active participant만 요청할 수 있다.
- 녹음 시작 시에도 모든 active participant의 현재 정책 버전 동의를 다시 확인한다.
- 녹음 종료하고 회의록 생성은 현재 active participant만 요청할 수 있다.
- 녹음 종료는 회의방 종료가 아니며, `Meeting.endedAt`을 저장하거나 다른 참여자를 내보내지 않는다.
- `Meeting.endedAt = null`이면 `Recording.status`가 `COMPLETED` 또는 `FAILED`여도 참여할 수 있다.
- `recording.durationSec`이 60 이하면 MeetingReport를 생성하지 않고 회의록 목록에도 노출하지 않는다. 단, 녹음 자체가 실패해 duration을 알 수 없는 경우에는 `FAILED` MeetingReport를 생성할 수 있다.
- 실패한 MeetingReport는 목록과 상세에서 조회할 수 있고 재생성을 요청할 수 있다.
- 녹음 시작, 녹음 종료, STT 요청, LLM 보고서 생성 요청은 같은 recording에 대해 동시에 여러 번 수행되지 않도록 서버에서 lock 또는 동등한 동시성 제어를 적용한다.
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정은 MVP 제외다.
- MeetingRoom 생성·이름 변경·삭제는 Workspace owner만 할 수 있다. member는 방 목록
  조회와 room-scoped 회의 조회·시작·참여를 할 수 있다.
- 기본 MeetingRoom은 삭제할 수 없다. 활성 Meeting이 있는 추가 방은
  삭제할 수 없으며, 삭제된 방의 과거 Meeting·Recording·MeetingReport는 유지된다.
- 한 사용자는 모든 Workspace를 통틀어 active Meeting participant를 하나만 가질 수 있다.
  다른 active Meeting에 참여 중인 사용자의 start/join은 `409 CONFLICT`를 반환한다.
  같은 Meeting 재입장은 허용한다.
- 같은 Workspace의 활성 MeetingRoom 이름은 대소문자를 무시하고 중복될 수 없다.

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
| MeetingReport | `QUEUED` | 회의록 작업 대기 또는 outbox/SQS 재발행 대기 |
| MeetingReport | `TRANSCRIBING` | Worker가 녹음 음성을 텍스트로 변환 중 |
| MeetingReport | `SUMMARIZING` | Worker가 transcript에서 회의록·결정·후속 작업을 정리 중 |
| MeetingReport | `PROCESSING` | 이전 버전에서 생성된 legacy 진행 상태 |
| MeetingReport | `COMPLETED` | 회의록 생성 완료 |
| MeetingReport | `FAILED` | 회의록 생성 실패 |
| MeetingReport failedStep | `RECORDING` | 녹음 단계 실패 |
| MeetingReport failedStep | `STT` | 음성 텍스트 변환 단계 실패 |
| MeetingReport failedStep | `LLM` | 회의록 생성 단계 실패 |

## Realtime 회의록 상태 이벤트

MeetingReport의 상태가 생성·재생성·Worker 처리·outbox 재시도 소진·stale recovery로
변경되면 App Server는 Redis `meeting:report-events` 채널에 상태를 발행한다.
Realtime Server는 workspace membership을 확인한 socket만 해당 workspace room에
가입시키고, 아래 이벤트를 전달한다. 이벤트는 화면의 DB 조회를 대체하지 않는다.
클라이언트는 이벤트를 받으면 MeetingReport 목록 또는 상세를 다시 조회해야 하며,
중복·순서 지연 이벤트도 허용해야 한다.

### Socket.IO client → server

```ts
socket.emit("meeting:subscribe", { workspaceId });
socket.emit("meeting:unsubscribe", { workspaceId });
```

- socket 인증은 기존 Realtime bearer access token을 사용한다.
- 가입 권한이 없거나 payload가 잘못되면 `meeting:error`를 받는다.
- 가입 성공 시 `meeting:subscribed`를 받는다.
- membership이 철회되면 서버는 해당 Workspace의 기존 `meeting:subscribe` room
  가입을 즉시 해제한다. 별도의 browser event는 보내지 않으며, 재구독은
  `forbidden`으로 거부된다. membership 검사와 `socket.join()` 사이에 철회가
  도착한 in-flight subscribe도 room leave로 rollback하고 `forbidden`으로 거부한다.

### Socket.IO server → client

```ts
socket.on("meeting:report:updated", event => {
  // event: MeetingReportRealtimeEvent
});
```

| Field | Type | 설명 |
| --- | --- | --- |
| `event` | `meeting:report:updated` | 이벤트 이름 |
| `reportId` | string | 갱신된 회의록 id |
| `meetingId` | string | 회의 id |
| `recordingId` | string | 녹음 id |
| `status` | MeetingReport status | DB에서 다시 조회할 최신 상태 힌트 |
| `failedStep` | `RECORDING` \| `STT` \| `LLM` \| null | 실패 단계 |
| `updatedAt` | string | ISO datetime |

## Realtime 음성회의 상태 이벤트

음성회의의 시작·참여·퇴장·종료·녹음 상태가 commit되면 App Server는 Redis
`meeting:state-events`에 상태 무효화 event를 발행한다. Realtime Server는 위의
`meeting:subscribe` membership 검사를 통과한 socket에만 같은 workspace room으로
전달한다. 이 event는 Meeting DB 조회를 대체하지 않는다.

- client → server 구독, 인증, `meeting:error`, `meeting:subscribed` 계약은
  [Realtime 회의록 상태 이벤트](#realtime-회의록-상태-이벤트)와 동일하다.
- client는 `meeting:subscribed` 수신 직후와 socket reconnect 뒤 구독 성공 시 선택한
  MeetingRoom의 current meeting을 한 번 다시 조회한다. legacy 기본 방 화면은
  `GET /workspaces/{workspaceId}/meetings/current`을 사용한다.
- `meeting:state:updated` 수신 뒤에는 선택한 MeetingRoom의 current meeting을 다시
  조회하고, active meeting이 있으면 participant 목록도 다시 조회한다.
- Redis Pub/Sub은 at-most-once이므로 event 중복·순서 지연·유실을 허용한다. 화면은
  event payload를 직접 merge하지 않고 REST snapshot으로 수렴한다.

### Socket.IO server → client

```ts
socket.on("meeting:state:updated", event => {
  // event: MeetingStateRealtimeEvent
});
```

| Field | Type | 설명 |
| --- | --- | --- |
| `event` | `meeting:state:updated` | 이벤트 이름 |
| `meetingId` | string | 상태가 바뀐 회의 id |
| `change` | `started` \| `participant_joined` \| `participant_left` \| `ended` \| `recording_started` \| `recording_ended` \| `recording_failed` | 상태 변경 이유. 화면 state merge 용도가 아닌 재조회 힌트 |
| `updatedAt` | string | event 생성 ISO datetime |

Redis 내부 payload는 fan-out workspace room을 결정하기 위해 `workspaceId`를 포함한다.
browser에 전달하는 event에는 `workspaceId`, participant 목록, LiveKit token, 녹음 URL,
transcript를 포함하지 않는다.

## Meeting 알림·회의 초대

MeetingReport가 `COMPLETED`가 되면 해당 Meeting의 참여 이력이 있는 사용자마다
`meeting_report_completed` 알림을 한 번 생성한다. 현재 Workspace member에게만 제목과
MeetingReport 화면 이동 권한을 제공한다. 이후 Workspace를 떠난 과거 참석자에게는
회의 제목·본문·deep link 없이 완료 사실만 알리며, 기존 MeetingReport 접근 권한을
넓히지 않는다.

진행 중인 Meeting의 active participant는 Workspace Presence에서 온라인인 현재
Workspace member 한 명에게 초대할 수 있다. 초대는 해당 Meeting이 종료되거나 초대자가
취소할 때까지 `PENDING`이며, 수락 시 브라우저는 해당 Meeting에 참여하는 연결 절차를
시작한다. 이미 종료됐거나 Workspace membership이 사라진 초대는 수락할 수 없다.

알림 row는 DB source of truth이고, Redis `meeting:notification-events` 및
`meeting:notification:created`·`meeting:notification:updated`는 Header 재조회 힌트일 뿐이다. browser event에는
notification id와 생성 시각만 전달하며 본문·회의 제목·transcript는 전달하지 않는다.

### AI Worker → App Server 내부 callback

```http
POST /api/v1/internal/meeting-reports/events
X-Meeting-Report-Event-Token: {MEETING_REPORT_EVENT_TOKEN}
Content-Type: application/json

{ "reportId": "uuid" }
```

AI Worker는 DB 상태를 저장한 뒤 이 callback을 호출한다. App Server는 `reportId`로
DB의 현재 MeetingReport를 재조회해서 Redis 이벤트를 구성한다. 따라서 Worker는
workspace 정보나 상태값을 신뢰 경계 밖으로 전달하지 않는다. 성공 응답은
`204 No Content`이며, token 누락·불일치는 `401`, `reportId` 형식 오류는 `400`,
서버 token 설정 누락은 `503`이다.

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

### MeetingRoom

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | MeetingRoom UUID. room-scoped endpoint의 path parameter |
| `workspaceId` | string | 소속 Workspace id |
| `roomKey` | string | 서버 내부의 안정된 room key. client 입력 대상 아님 |
| `name` | string | 화면에 표시할 방 이름 |
| `isDefault` | boolean | 기본 방 여부. 활성 방의 `createdAt ASC, id ASC` 첫 방이며 삭제 불가 |
| `createdById` | string \| null | 방 생성 사용자. 기존 Workspace 기본 방은 null 가능 |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |

### Participant

| Field | Type | 설명 |
| --- | --- | --- |
| `id` | string | 대표 참여 session id. active session이 있으면 그 id, 아니면 마지막 session id |
| `meetingId` | string | 회의 id |
| `userId` | string | 사용자 id |
| `livekitIdentity` | string | 대표 session의 LiveKit participant identity |
| `joinedAt` | string | 해당 사용자의 이 Meeting 첫 입장 ISO datetime |
| `leftAt` | string \| null | active session이 있으면 `null`, 아니면 마지막 퇴장 ISO datetime |
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
| `audioFileUrl` | string \| null | 녹음 파일 URL. retention purge가 완료되면 `null` |
| `audioFileKey` | string \| null | 저장소 object key. retention purge가 완료되면 `null` |
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
| `status` | `QUEUED` \| `TRANSCRIBING` \| `SUMMARIZING` \| `COMPLETED` \| `FAILED` \| `PROCESSING` | 회의록 상태. `PROCESSING`은 legacy 진행 상태 |
| `failedStep` | `RECORDING` \| `STT` \| `LLM` \| null | 실패 단계 |
| `errorMessage` | string \| null | 실패 메시지 |
| `transcriptText` | string \| null | 상세 조회에서만 반환. 시간별 segment가 아닌 전체 Transcript 텍스트다. 목록 응답에는 포함하지 않는다. |
| `evidenceSegments` | array | 상세 조회에서만 반환. 요약·논의·결정·후속 작업의 근거로 연결된 `id`, `segmentIndex`, `startedAtMs`, `endedAtMs`, `text` segment만 포함한다. |
| `evidence` | array | 상세 조회에서만 반환. `sourceType`, `sourceIndex`, `transcriptSegmentId`로 요약 산출물과 evidence segment를 연결 |
| `activityEvidence` | array | 상세 조회에서만 반환. Transcript와 구분된 Activity 근거. `id`, `sourceIndex`, `occurredAt`, `action`, `summary`, `references[]`만 포함하며, reference는 이 Activity가 뒷받침한 `sourceType`, `sourceIndex`다. raw Activity Log metadata는 포함하지 않는다. |
| `summary` | string \| null | 요약 |
| `discussionPoints` | string \| null | 논의사항 |
| `decisions` | string \| null | 결정사항 |
| `actionItemCandidates` | array | 후속 작업 후보 |
| `actionItemExtraction` | object (optional) | 후속 작업 추출 상태. `status`는 `PENDING` \| `PUBLISHING` \| `QUEUED` \| `PROCESSING` \| `COMPLETED` \| `FAILED`이고, `FAILED`일 때만 안전한 `errorMessage`를 포함한다. Migration 이전 회의록처럼 추출 row가 없으면 생략될 수 있다. 회의록 본문 `status`와 독립적이다. |
| `actionItems` | array | 상세 조회에서만 반환. 저장된 후속 작업 검토 항목. `id`, `sourceIndex`, `title`, `description`, `priority`, `assignee`, `deliverySuggestion`, `status`, 승인·반려 audit과 `delivery`(선택 type/status·저장 draft·안전한 대상 요약)를 포함한다. `deliverySuggestion`은 AI가 근거에서 고른 기본 전달 type과, Calendar인 경우에만 안전하게 추출한 `isAllDay`, 날짜·시간 초안이다. 확정된 delivery가 아니며 사용자는 승인 전에 바꿀 수 있다. `delivery`는 internal idempotency key, claim token, provider raw response를 포함하지 않는다. |
| `actionItemAssignees` | array | 상세 조회에서만 반환. 같은 Workspace의 지정 가능한 사용자 목록. `userId`, `name`, `avatarUrl`을 포함한다. |
| `retryCount` | number | 재시도 횟수 |
| `participantSummary` | object | 중복 제거한 참석자 요약. `totalCount`, 대표 참석자 최대 3명의 `participants`, 추가 참석자 여부 `hasMore`를 포함한다. 대표 참석자는 첫 참여 시각 순서다. |
| `canDelete` | boolean | 현재 사용자가 이 회의록을 삭제할 수 있는지. Workspace owner 또는 해당 회의의 참여자만 `true`다. |
| `createdAt` | string | ISO datetime |
| `updatedAt` | string | ISO datetime |

목록 응답에는 긴 `transcriptText`를 포함하지 않는다. Workspace member는 해당 Workspace의 모든 MeetingReport를 목록·상세에서 조회할 수 있다. 회의 참여 이력은 조회 조건이 아니다.

LLM 처리 실패의 내부 진단 코드와 상세 정보는 운영 DB·제한된 운영 로그에서만 사용한다. API·Realtime event·Agent tool·브라우저에는 `failedStep`과 사용자용 `errorMessage`만 반환하며, provider payload, LLM output, transcript, prompt, token, stack trace는 저장하거나 노출하지 않는다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/meeting-rooms` | 활성 MeetingRoom 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-rooms` | MeetingRoom 생성 (owner) |
| `PATCH` | `/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}` | MeetingRoom 이름 변경 (owner) |
| `DELETE` | `/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}` | 빈 MeetingRoom 삭제 (owner) |
| `GET` | `/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/current` | 선택한 방의 현재 진행 중 회의 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/meetings` | 선택한 방에서 새 회의 시작 |
| `GET` | `/me/meetings/active` | 현재 사용자의 모든 Workspace 기준 active Meeting 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/current` | legacy `MAIN_MEETING_ROOM`의 현재 진행 중 회의 조회 |
| `POST` | `/workspaces/{workspaceId}/meetings` | legacy `MAIN_MEETING_ROOM`에서 새 회의 시작 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 진행 중 회의 참여 또는 재입장 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/invitations` | 현재 active participant가 온라인 Workspace member에게 회의 초대 |
| `DELETE` | `/workspaces/{workspaceId}/meetings/{meetingId}/invitations/{invitationId}` | 초대자가 pending 회의 초대 취소 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}` | 회의 상세 조회 |
| `DELETE` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | 회의 나가기 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings` | 녹음 시작 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings` | 녹음 metadata 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings/current` | 진행 중 녹음 metadata 조회 |
| `POST` | `/workspaces/{workspaceId}/meetings/{meetingId}/recordings/{recordingId}/end` | 녹음 종료와 회의록 생성 트리거 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/participants` | 회의 참여자 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports` | MeetingReport 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/meeting-reports/{reportId}` | MeetingReport 상세 조회 |
| `DELETE` | `/workspaces/{workspaceId}/meeting-reports/{reportId}` | 완료·실패 MeetingReport 삭제 |
| `GET` | `/workspaces/{workspaceId}/meetings/{meetingId}/reports` | 특정 회의의 MeetingReport 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs` | 실패한 회의록 재생성 요청 |
| `PATCH` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}` | pending 후속 작업 수정 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/approve` | legacy 상태-only 승인 호환 endpoint (deprecated) |
| `GET` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/delivery-options` | Pilo issue delivery용 Board·Column 선택지 조회 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/deliveries` | Calendar 일정 또는 Pilo issue 하나를 생성하며 후속 작업 승인 |
| `POST` | `/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/dismiss` | pending 후속 작업 반려 |
| `GET` | `/me/meeting-notifications` | 현재 사용자의 Meeting 알림 목록 조회 |
| `PATCH` | `/me/meeting-notifications/{notificationId}/read` | Meeting 알림 읽음 처리 |
| `POST` | `/me/meeting-invitations/{invitationId}/accept` | 회의 초대 수락 후 참여 준비 정보 조회 |
| `POST` | `/me/meeting-invitations/{invitationId}/decline` | 회의 초대 거절 |

## Endpoint 상세

### MeetingRoom 목록과 관리

```http
GET /api/v1/workspaces/{workspaceId}/meeting-rooms
```

Workspace member가 활성 MeetingRoom 목록을 조회한다. response `data.rooms`는
`MeetingRoom[]`이며 `createdAt ASC, id ASC` 순서와 같은 기본 방이 먼저 나온다.

```http
POST /api/v1/workspaces/{workspaceId}/meeting-rooms
Content-Type: application/json

{ "name": "디자인 회의" }
```

Workspace owner만 생성할 수 있다. `name`은 trim·공백 정규화 뒤 1~100자여야 하며,
같은 Workspace의 활성 방 이름과 대소문자를 무시하고 중복될 수 없다. response
`data.room`은 생성한 `MeetingRoom`이다.

```http
PATCH /api/v1/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}
Content-Type: application/json

{ "name": "디자인 검토" }
```

Workspace owner만 이름을 변경할 수 있다. 기본 방도 이름을 변경할 수 있다.

```http
DELETE /api/v1/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}
```

Workspace owner만 삭제할 수 있다. 기본 방 또는 진행 중 Meeting이 있는 방은 삭제할 수
없다. 성공 response는 `{ "deleted": true }`이며, 삭제는 Room resource만 archive하고
과거 Meeting·Recording·MeetingReport는 변경하지 않는다.

주요 오류: `400`, `401`, `403`, `404`, `409`

### 선택한 방의 현재 회의 조회

```http
GET /api/v1/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/current
```

Workspace member가 선택한 활성 MeetingRoom의 current meeting을 조회한다. response
형식은 기본 방 current endpoint와 같은 `{ meeting, currentRecording,
activeParticipantCount }`다. 존재하지 않거나 삭제된 방은 `404`다.

### 선택한 방에서 회의 시작

```http
POST /api/v1/workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/meetings
```

Workspace member가 선택한 활성 MeetingRoom에서 Meeting을 시작한다. request body에는
필요할 때 아래 `recordingConsent`를 보낸다.

```json
{
  "recordingConsent": {
    "accepted": true,
    "policyVersion": "v1"
  }
}
```

response 형식은 기존 회의 시작 endpoint와 같으며, 같은 방에 진행 중 Meeting이
있으면 `400 MEETING_ALREADY_IN_PROGRESS`를 반환한다. 현재 사용자가 다른
Workspace 또는 다른 방의 active Meeting participant이면 `409 CONFLICT`를 반환한다.

### 현재 사용자의 active Meeting 조회

```http
GET /api/v1/me/meetings/active
```

로그인한 사용자의 모든 Workspace에서 active participant인 Meeting을 조회한다.
참여 중인 Meeting이 없으면 `data.meeting`, `data.meetingRoom`은 모두 `null`이다.
참여 중이면 `data.meeting`은 Meeting, `data.meetingRoom`은 해당 MeetingRoom이다.
Workspace 접근 권한이 더 이상 없는 Meeting은 반환하지 않는다.

### 현재 회의 조회

```http
GET /api/v1/workspaces/{workspaceId}/meetings/current
```

이 endpoint는 기본 `MAIN_MEETING_ROOM` 호환 경로다. request body는 없다.

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
  "roomKey": "MAIN_MEETING_ROOM",
  "recordingConsent": {
    "accepted": true,
    "policyVersion": "v1"
  }
}
```

이 endpoint는 기본 `MAIN_MEETING_ROOM` 호환 경로다. `roomKey`는 optional이며
생략하면 `MAIN_MEETING_ROOM`을 사용하고, 다른 값을 직접 지정할 수 없다. 추가 방의
회의 시작은 room-scoped endpoint를 사용한다.

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
| `409` | `WORKSPACE_RECORDING_CONSENT_REQUIRED` | 현재 Workspace 동의가 없음 |
| `401` | `UNAUTHORIZED` | 인증 없음 |
| `403` | `FORBIDDEN` | Workspace 접근 불가 |

### 회의 참여 또는 재입장

```http
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/participants/me
```

Request body는 최초 동의가 필요한 경우에만 보낸다.

```json
{
  "recordingConsent": {
    "accepted": true,
    "policyVersion": "v1"
  }
}
```

같은 사용자가 같은 회의에 다시 참여하면 새 participant session을 만든다. 이미 active인
상태에서 재시도하면 같은 active session을 반환한다.
LiveKit 입장 token은 참여 요청마다 다시 받을 수 있다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `meeting` | Meeting | 참여한 회의 |
| `participant` | Participant | 현재 사용자 참여 정보 |
| `livekit` | LiveKitJoin | LiveKit 입장 정보 |
| `currentRecording` | Recording \| null | 진행 중 녹음. 없으면 `null` |

주요 오류: `400`, `401`, `403`, `404`, `409 WORKSPACE_RECORDING_CONSENT_REQUIRED`

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
| `reports` | MeetingReport[] | 회의록 목록. Transcript 전문은 제공하지 않음 |
| `participantCount` | number | 중복 제거한 전체 참여자 수 |
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
`QUEUED`로 남고, 서버는 durable outbox에 재발행 의도를 보존한다. 이후
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
QUEUED`와 durable outbox intent를 같은 transaction으로 생성하고 AI job 발행을
시도한다. SQS 일시 실패는 outbox에 `pending`으로 남고, dispatcher가 시작 직후와
60초마다 다시 발행한다. 각 발행은 60초 claim lease와 `FOR UPDATE SKIP LOCKED`를
사용하며, 실패 시 1·2·4·8·16분 뒤 재시도한다. 5회 재시도 뒤에도 실패하면 outbox와
Report를 `FAILED`로 전환한다. SQS 발행은 at-least-once이므로, 발행 성공 뒤
delivery 기록이 유실된 경우 같은 report job이 다시 전달될 수 있다.

AI Worker는 job lock을 획득하면 `TRANSCRIBING`, STT 원문을 확보하면 `SUMMARIZING`으로
상태를 갱신하고, 결과 저장 시 `COMPLETED` 또는 `FAILED`로 끝낸 뒤 internal callback으로
Realtime 이벤트 발행을 요청한다. 이전 버전의 `PROCESSING`은 legacy 진행 상태로 조회만
지원한다. Worker가 이미 delivery된 job을 처리하지 못해 Report가 20분 넘게 진행 상태이면,
dispatcher는 Worker가 보유한 report advisory lock이 없는 경우에만 해당 Report를
`FAILED`로 전환하고 동일한 Realtime 이벤트를 발행한다. API 응답과 화면 조회의 source of
truth는 DB의 MeetingReport다.

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

이 목록은 사용자별로 중복 제거한 회의 참석 요약이다. `joinedAt`은 첫 입장,
`leftAt`은 active session이 없을 때 마지막 퇴장이다. 마이크 상태, 발화 상태,
LiveKit connection state는 포함하지 않는다.

주요 오류: `401`, `403`, `404`

### MeetingReport 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/meeting-reports?status=FAILED&q=녹음&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z&limit=20
```

Query:

| Name | Required | 설명 |
| --- | --- | --- |
| `cursor` | No | 이전 응답의 `nextCursor`. 다음 페이지를 같은 정렬 기준으로 조회한다. 임의 값은 `400` |
| `from` | No | `createdAt` 하한 ISO 8601 시각(포함) |
| `to` | No | `createdAt` 상한 ISO 8601 시각(미포함) |
| `q` | No | 요약, 논의, 결정, 액션 아이템 후보, 실패 사유를 대상으로 하는 서버 측 키워드 검색. raw Transcript는 포함하지 않음 |
| `status` | No | `QUEUED`, `TRANSCRIBING`, `SUMMARIZING`, `COMPLETED`, `FAILED`, legacy `PROCESSING` |
| `limit` | No | 반환 개수. 기본값 20, 최대 100 |

`status`가 허용값이 아니거나 `cursor`, `from`, `to`가 올바른 형식이 아니면
`400 BAD_REQUEST`를 반환한다. `from`은 `to`보다 앞서야 한다. `q`는 공백 제거 후
최대 200자다. `limit`이 숫자가 아니거나 20 미만이면 20으로, 100 초과면 100으로
보정한다.

기본 정렬은 `createdAt DESC, id ASC`다. `nextCursor`가 `null`이면 다음 페이지가 없다.
`recording.durationSec`이 60 이하인 녹음은 MeetingReport가 없으므로 목록에 나오지 않는다.
실패한 MeetingReport도 목록에 나온다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `nextCursor` | string \| null | 다음 페이지 cursor. 다음 요청에 그대로 전달한다. |
| `reports` | MeetingReport[] | 회의록 목록. Transcript 전문 제외 |

주요 오류: `400`, `401`, `403`

### MeetingReport 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}
```

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport | 회의록 상세. 전체 `transcriptText`와 근거 연결용 `evidenceSegments`를 포함 |

Workspace member는 해당 Workspace의 모든 MeetingReport를 목록·상세에서 조회할 수 있다. 회의 참여 이력은 조회 조건이 아니다. 실패한 MeetingReport도 상세 조회할 수 있다.

`actionItems`는 AI 후보를 Worker가 `PENDING` 상태로 저장한 검토 모델이다.
`sourceIndex`는 원본 `actionItemCandidates`와 transcript evidence 연결에 사용한다.
`PENDING`만 수정·반려할 수 있다. `PENDING` 또는 `DELIVERY_FAILED`는 delivery 요청으로
Calendar 일정 또는 Pilo issue 중 하나를 생성한다. 생성 성공 뒤에만 `APPROVED`가 되며,
`DELIVERING`은 lease를 가진 실행 중 상태, `DELIVERY_FAILED`는 같은 선택·idempotency key로
Workspace member가 재시도할 수 있는 상태다. `APPROVED`와 `DISMISSED`는 종결 상태다.

회의록 본문(요약·논의·결정)과 후속 작업 추출은 분리된 비동기 lifecycle이다. 본문이
유효하면 MeetingReport는 `COMPLETED`가 되며, 이후 `actionItemExtraction`이 `PENDING` →
`QUEUED` → `PROCESSING` → `COMPLETED`로 진행한다. 후속 작업 후보의 evidence 검증 또는
추출 자체가 실패해도 MeetingReport는 `FAILED`로 바뀌지 않고 extraction만 `FAILED`가 된다.
`COMPLETED`와 빈 `actionItems`는 “검토할 후속 작업 없음”을, 진행 상태의 빈 배열은 아직
추출 중임을 뜻한다.

주요 오류: `401`, `403`, `404`

### MeetingReport 삭제

```http
DELETE /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}
```

Workspace owner 또는 해당 Meeting의 참여자만 호출할 수 있다. 현재 Workspace member가 아닌 사용자는 호출할 수 없다. `COMPLETED` 또는 `FAILED` 상태만 삭제하며, 진행 중 상태는 `400`이다.

삭제하면 MeetingReport와 종속 outbox, transcript segment, evidence, action item이 함께 삭제된다. 원본 Recording/audio와 이미 생성된 Calendar event는 유지한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `deletedReportId` | string | 삭제된 회의록 id |

주요 오류: `400`, `401`, `403`, `404`

### 실패한 후속 작업 추출 재시도

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-item-extractions/retry
```

Request body 없음.

Workspace member는 본문이 `COMPLETED`이고 후속 작업 extraction만 `FAILED`인 report에
대해 추출을 다시 요청할 수 있다. 재시도는 기존 report 본문, transcript, Activity evidence를
변경하지 않고 extraction을 `PENDING`으로 되돌린다. App Server outbox publisher가 같은
report id의 SQS extraction job을 at-least-once로 전달하며, 중복 delivery는 report별 lock과
상태 전이로 멱등 처리한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `actionItemExtraction` | object | 재시도된 extraction 상태. `status`는 `PENDING` |

주요 오류: `400` (본문 미완료 또는 extraction 재시도 불가), `401`, `403`, `404`

### MeetingReport 후속 작업 수정

```http
PATCH /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}
```

Request body는 아래 필드 중 하나 이상을 가진다.

| Field | Type | 설명 |
| --- | --- | --- |
| `title` | string | 공백 제거 후 1~500 bytes |
| `description` | string | 공백 제거 후 1~5000 bytes |
| `priority` | `LOW` \| `MEDIUM` \| `HIGH` | 우선순위 |
| `assigneeUserId` | string \| null | 같은 Workspace member의 user id. `null`이면 담당자 해제 |

Workspace member는 `PENDING` 항목만 수정할 수 있다. 다른 Workspace 또는 다른
MeetingReport의 item은 `404`, terminal item·잘못된 body·Workspace member가 아닌
담당자는 `400`을 반환한다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `actionItem` | object | 수정된 저장 action item |

### MeetingReport 후속 작업 delivery·반려

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/approve
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/dismiss
```

`/approve`는 기존 frontend와 이미 열린 브라우저 탭을 위한 호환 endpoint다. Workspace member가
`PENDING` item을 `APPROVED`로 전이하며, Calendar 일정이나 Pilo issue는 생성하지 않는다. 새 UI는
`/deliveries`를 사용한다. 독립 배포 순서에서 `/deliveries`가 아직 없는 구 App Server를 만난 새 UI는
`404`일 때 이 endpoint로 한 번 fallback하고, 대상 생성 없이 legacy 승인만 완료됐음을 표시한다. 이
endpoint 제거는 모든 배포 환경의 `/deliveries` 전환이 완료된 다음 release에서만 수행한다.
`/dismiss`는 Workspace member가 `PENDING` item을 `DISMISSED`로 한 번만 전이하며,
응답은 `{ actionItem }`이다.

```http
GET /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/delivery-options
```

Workspace member가 Pilo issue delivery dialog에 필요한 `data.boards[]`를 조회한다. 각
Board는 `id`, `name`, `columns[]`(`id`, `name`)만 포함한다. Board OAuth token, repository
secret, raw provider metadata는 포함하지 않는다.

목록은 Board 도메인의 생성 가능 read model을 그대로 사용한다. 실제 Board issue 생성
직전 검증과 동일한 repository·ProjectV2 Status·Column Status option metadata 기준을
통과한 Column만 반환하며, 유효한 Column이 하나도 없는 Board는 반환하지 않는다. Board
이름이 같아도 이름으로 중복 제거하지 않고 Board id를 identity로 유지한다. Meeting
도메인은 GitHub 또는 ProjectV2 metadata를 직접 조회하거나 판정하지 않는다.

생성 가능한 대상이 없으면 오류 대신 HTTP `200`과 `data: { "boards": [] }`를 반환한다.
이 경우 UI는 빈 select 대신 ProjectV2 Board 선택·동기화 안내를 표시하고 Pilo issue 생성
버튼을 비활성화한다. Calendar 후속 일정 생성 흐름에는 이 목록의 빈 상태를 적용하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/action-items/{actionItemId}/deliveries
Content-Type: application/json

{
  "deliveryType": "calendar_event",
  "calendar": {
    "title": "API 배포 일정",
    "description": "회의 후속 작업",
    "isAllDay": true,
    "startDate": "2026-07-18",
    "endDate": "2026-07-18"
  }
}
```

또는 Pilo issue 하나를 선택한다.

```json
{
  "deliveryType": "pilo_issue",
  "issue": {
    "boardId": "12",
    "columnId": "37",
    "title": "API 배포 준비",
    "body": "회의에서 합의한 후속 작업입니다."
  }
}
```

`deliveryType`은 `calendar_event` 또는 `pilo_issue` 중 하나이며 반대 type의 payload를 함께
보낼 수 없다. Calendar는 `startDate`가 필수이고 `endDate`를 생략하면 `startDate`와 같은 날짜로
정규화한다. 종일 일정에는 시간을 보내지 않으며, 시간 지정 시 `HH:MM` 형식의 `startTime`을 필수로
받고 `endTime`을 생략하면 `startTime + 1시간`으로 정규화한다. Pilo issue는 같은 Workspace의 Board와 해당 Board Column을
명시해야 한다. title/description/body를 생략하면 저장된 Action Item 내용을 기본값으로 쓴다.
Action Item에 담당 Workspace member가 있고 그 사용자의 GitHub login이 연결돼 있으면, Pilo issue
body에는 해당 login의 `@mention`을 덧붙인다. 이는 GitHub Issue assignee 변경이 아니라 본문 태그다.

응답 `data`는 `actionItemId`, `deliveryType`, `status`(`COMPLETED` 또는 `FAILED`)와 성공 시
`calendarEventId` 또는 `piloIssueId`, 실패 시 안전한 `errorCode`만 반환한다.
`GITHUB_PROJECT_OAUTH_RECONNECT_REQUIRED`은 Pilo issue 생성에 필요한 GitHub ProjectV2 OAuth를
`project`·`repo` 권한으로 다시 연결해야 함을 뜻한다. 실패는 HTTP 성공
응답 안의 `FAILED` 결과로 저장되며 UI는 상세 재조회 뒤 재시도 상태를 표시한다. validation·소속·진행 중
상태는 `400`, 다른 Workspace/report/action item은 `404`, Board OAuth 등 provider 오류는 안전한
`FAILED.errorCode`로만 노출한다. 최초 요청자와 가장 최근 재시도자는 audit으로 남고, 같은 Workspace
member는 저장된 동일 draft와 idempotency key로 재시도할 수 있다.

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
| `reports` | MeetingReport[] | 특정 회의의 회의록 목록. Transcript 전문 제외 |

주요 오류: `401`, `403`, `404`

### 실패한 MeetingReport 재생성 요청

```http
POST /api/v1/workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs
```

Request body 없음.

`FAILED` 상태의 MeetingReport만 재생성을 요청할 수 있다. 단, 연결된 Recording이
`COMPLETED` 상태이고 `audioFileKey`가 있어 AI Worker가 다시 처리할 수 있는 경우만
허용한다. 요청이 성공하면 MeetingReport는 다시 `QUEUED` 상태가 되고
`retryCount`가 증가한다. 기존 실패 정보와 이전 산출물은 초기화한다. MVP 응답에는
별도 `jobId`와 Transcript 전문은 포함하지 않는다.

LLM output의 evidence 연결 정보가 내부 검증에 실패한 경우 Worker는 동일 transcript와 안전한 Activity evidence로 한 번만 보정 생성을 시도한다. 보정도 실패하면 최종 `FAILED`로 기록하며, 일반 OpenAI·SQS·network 인프라 오류의 기존 재시도 정책은 바꾸지 않는다.

Meeting 종료 뒤 30일 retention purge가 완료되어 `audioFileKey`가 `null`인 경우에는
기존 transcript·요약 등 MeetingReport 산출물은 계속 조회할 수 있지만, 원본 audio가 없어
재생성할 수 없다.

Response `data`:

| Field | Type | 설명 |
| --- | --- | --- |
| `report` | MeetingReport | 갱신된 회의록 |

주요 오류:

| HTTP | Code | 상황 |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | 진행 중 상태 또는 `COMPLETED` 상태의 MeetingReport 재생성 요청 |
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
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/end
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording
POST /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/recording/end
GET /api/v1/workspaces/{workspaceId}/meetings/{meetingId}/report
```

- 서버 기반 녹음 동의 저장
- 참여자 강제 퇴장 또는 방 전체를 즉시 닫는 수동 회의 종료 API
- 브라우저 강제 종료, 네트워크 단절, 비정상 disconnect 보정
- LiveKit Webhook 기반 participant 보정
- realtime-server 기반 음성 송수신
