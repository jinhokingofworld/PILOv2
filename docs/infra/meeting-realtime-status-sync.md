# 음성회의 상태 Realtime 동기화 구현 계획

> 관련 Issue: [#931](https://github.com/Developer-EJ/PILO/issues/931)
> 상위 추적: [#674](https://github.com/Developer-EJ/PILO/issues/674)
> 상태: 코드 구현 완료 — TypeScript compile과 dev 다중 브라우저 E2E는 의존성·인프라 환경 확인 대기

## 1. 문제와 목표

현재 음성회의의 현재 방·참여자·녹음 상태는 화면에서 5초마다 REST API를 호출해
갱신한다. 이 방식은 상태 변경을 최대 5초 늦게 보이게 하고, 탭이 많아질수록 같은
Workspace에 중복 요청을 만든다.

이번 작업의 목표는 Meeting 상태 변경을 아래 경로로 전달하고, 반복 polling 없이
화면을 갱신하는 것이다.

```text
Meeting API transaction commit
  -> App Server Redis publish
  -> Realtime Server Redis subscribe
  -> membership 확인을 거친 workspace Socket.IO room fan-out
  -> Frontend runtime이 상태 무효화 알림 수신
  -> REST snapshot 1회 재조회
```

Redis Pub/Sub은 전달 보장 큐가 아니다. 따라서 Socket.IO 이벤트는 **DB 상태가
변했음을 알리는 힌트**이고, REST `current meeting`/참여자 조회 결과가 최종
source of truth다. 초기 구독과 재연결에서는 이벤트를 기다리지 않고 REST snapshot을
한 번 조회해 이벤트 유실을 보정한다.

## 2. 현재 기준선

### 이미 구현된 회의록 Realtime 경로

- App Server는 `meeting:report-events` Redis 채널에 회의록 상태를 발행한다.
  `MeetingReportRealtimePublisherService`가 DB를 다시 읽어 payload를 구성한다.
- Realtime Server는 `meeting:subscribe`에서 workspace membership을 확인하고,
  `meeting:report:updated`를 workspace room에만 전송한다.
- Frontend는 `useMeetingReportRealtime`에서 socket을 구독하고, 이벤트 수신 후
  회의록 데이터를 다시 조회한다.

이 작업은 이 권한 경계와 "이벤트 후 REST 재조회" 원칙을 그대로 재사용한다.

### 제거 대상과 유지 대상

| 구분 | 현재 | 이번 작업 |
| --- | --- | --- |
| Header 현재 회의 상태 | 5초 `reloadCurrentMeeting()` | 제거 |
| MeetingPanel 현재 회의·참여자 상태 | 5초 `reloadCurrentMeeting()`/`reloadParticipants()` | 제거 |
| 녹음 경과 시간 표시 | 1초 타이머 | 유지 — 화면 표시용 타이머이며 서버 상태 polling이 아님 |
| MeetingReport 상태 | 10초 fallback polling + Realtime 이벤트 | 유지 — 이 Issue 범위 밖 |
| outbox/recovery worker sweep | 서버 내부 `setInterval` | 유지 — 브라우저 상태 polling이 아님 |

## 3. 확정할 계약 초안

### 3.1 Socket.IO 구독

기존 구독 계약을 유지한다. 새 room이나 새 인증 방식은 만들지 않는다.

```ts
socket.emit("meeting:subscribe", { workspaceId });
socket.emit("meeting:unsubscribe", { workspaceId });
```

- Realtime Server는 기존 bearer access token을 인증하고, `workspaceId` membership을
  통과한 socket만 `meeting:{workspaceId}` room에 넣는다.
- `meeting:subscribed`를 받은 뒤 Frontend는 REST snapshot을 한 번 읽는다.
- socket reconnect 뒤에도 다시 `meeting:subscribe`를 보내고 같은 snapshot 절차를
  수행한다.

### 3.2 Server event 권장안

권장 계약은 이벤트를 여러 개로 나누지 않고 하나의 상태 무효화 이벤트로 둔다.

```ts
type MeetingStateRealtimeEvent = {
  event: "meeting:state:updated";
  meetingId: string;
  change:
    | "started"
    | "participant_joined"
    | "participant_left"
    | "ended"
    | "recording_started"
    | "recording_ended"
    | "recording_failed";
  updatedAt: string; // ISO datetime
};

socket.on("meeting:state:updated", event => {
  // event은 화면 state를 직접 merge하지 않는다.
  // current meeting과, 필요한 경우 participant 목록을 다시 조회한다.
});
```

Redis 내부 payload에는 Realtime Server가 fan-out room을 결정할 수 있도록
`workspaceId`를 추가한다. browser로 내보내는 payload에서는 이를 제외한다.

```ts
type MeetingStateRedisEvent = MeetingStateRealtimeEvent & {
  workspaceId: string;
};
```

이벤트 payload에 participant 목록, LiveKit token, 녹음 URL, report 내용은 넣지 않는다.
이벤트 순서 역전·중복·유실을 모두 허용하고, 화면은 REST snapshot으로 수렴한다.

## 4. 세부 구현 계획

### Phase 0 — 계약 확정 및 작업 경계 고정

- [x] 이 문서의 `meeting:state:updated` 단일 이벤트와 `change` enum을 API 계약으로
      확정한다.
- [x] `docs/api/meeting-api.md`의 기존 "Realtime 회의록 상태 이벤트" 아래에
      "Realtime 음성회의 상태 이벤트" 절을 추가한다.
- [x] `docs/api/meeting-api.md`에서 다음을 명시한다.
  - [x] client 구독/권한 오류/구독 성공 계약은 기존 회의록 이벤트와 공유한다.
  - [x] event는 at-most-once notification이며 REST snapshot을 대체하지 않는다.
  - [x] 초기 구독·reconnect 뒤 snapshot을 한 번 조회한다.
  - [x] 중복·순서 지연 event를 허용한다.
- [x] API 계약 변경이므로 구현 시작 전 Meeting/Infra 담당자인 진호의 확인 기록을
      Issue #931에 남긴다. DB schema 변경은 없다.

### Phase 1 — App Server: commit 뒤 Redis 발행

- [x] `meeting-state-realtime-publisher.service.ts`를 Meeting module에 추가한다.
  - [x] Redis 채널은 `meeting:state-events`로 둔다.
  - [x] 기존 MeetingReport publisher와 같이 `REDIS_URL`이 없으면 publish를 생략하고
        warning/error를 남긴다.
  - [x] `publishStateUpdatedSafely()`는 publish 실패가 이미 commit된 Meeting API
        transaction을 실패시키지 않게 한다.
  - [x] Redis payload의 필수 필드와 `updatedAt` ISO 형식을 정적 테스트로 검증한다.
- [x] publisher provider를 `MeetingModule`에 등록하고 shutdown 시 Redis client를
      정상 종료한다.
- [x] 아래 lifecycle mutation이 **transaction commit 이후** publisher를 호출하도록
      수정한다.

| 변경 지점 | `change` | 발행 시점 |
| --- | --- | --- |
| `startMeeting` | `started` | meeting 및 최초 participant insert commit 후 |
| `joinMeeting` | `participant_joined` | participant upsert commit 후 |
| `leaveMeeting` | `participant_left` | participant left update commit 후 |
| `leaveMeeting`의 마지막 active participant | `ended` | meeting end commit 후 |
| LiveKit disconnect webhook reconciliation | `participant_left`, 필요 시 `ended` | reconciliation transaction commit 후 |
| `startRecording` | `recording_started` | recording start commit 후 |
| `endRecordingAndCreateReport` | `recording_ended` 또는 `recording_failed` | recording terminal state commit 후 |

- [x] 같은 transaction에서 여러 상태가 바뀌면 의미가 다른 event를 순서대로 발행할 수
      있다. Frontend는 이를 debounce한 단일 snapshot reload로 합친다.
- [x] 기존 MeetingReport outbox publish 및 `meeting:report:updated` 호출 순서는
      바꾸지 않는다.

### Phase 2 — Realtime Server: 검증 후 workspace fan-out

- [x] `apps/realtime-server/src/meeting/meeting-socket-events.ts`에 다음을 추가한다.
  - [x] `meetingServerEvents.stateUpdated`
  - [x] `MeetingStateRedisEvent`와 browser event type
  - [x] runtime payload validator: UUID/문자열 최소 검증, 허용 `change`, 유효 ISO 시간
- [x] `socket-server.ts`에서 `meeting:state-events` Redis channel을 구독한다.
- [x] JSON parse와 validator를 통과한 payload만
      `createMeetingRoomName(workspaceId)`에 `meeting:state:updated`로 fan-out한다.
- [x] `workspaceId`는 Redis message에서만 room 선택에 사용하고 browser payload에는
      포함하지 않는다.
- [x] 기존 Canvas 및 `meeting:report-events` subscription을 유지한다.
- [ ] Realtime Server test에서 다음을 확인한다.
  - [ ] 허용된 socket만 구독할 수 있다.
  - [ ] 다른 workspace room에는 event가 전달되지 않는다.
  - [ ] malformed Redis payload는 emit하지 않는다.
  - [ ] 기존 `meeting:report:updated` fan-out이 계속 동작한다.

### Phase 3 — Frontend: Runtime socket과 snapshot invalidation

- [x] `MeetingRuntimeProvider`가 active workspace와 access token으로 Meeting 상태
      socket 하나를 관리하게 한다. 이 socket은 LiveKit socket이 아니라 App realtime
      notification socket이다.
- [x] provider는 다음 경우 상태 변경 notification을 feature-local store/context에
      전파한다.
  - [x] `meeting:subscribed` 수신
  - [x] `meeting:state:updated` 검증 성공
  - [x] socket reconnect 후 재구독 성공
- [x] Header와 MeetingPanel의 `useMeetingWorkspaceData` 인스턴스는 notification을
      수신하면 `reloadCurrentMeeting()`을 실행한다. active meeting이 있을 때만
      `reloadParticipants(meetingId)`도 실행한다.
- [x] 같은 event burst에 대해 REST 요청이 여러 번 실행되지 않도록 microtask 또는
      짧은 in-flight guard로 snapshot reload를 하나로 합친다. 시간 기반 polling은
      다시 넣지 않는다.
- [x] 직접 사용자 action(시작·참여·퇴장·녹음 시작/종료) 뒤의 즉시 reload는 유지한다.
      내 browser의 응답성을 event 수신에 의존하지 않기 위해서다.
- [x] `HeaderMeetingStatus`의 5초 interval을 제거한다.
- [x] `MeetingPanel`의 5초 interval을 제거한다. 녹음 경과 시간을 위한 1초 interval은
      제거하지 않는다.
- [x] `useMeetingReportRealtime`과 `MeetingReportSection`은 이번 Issue에서 구조를
      바꾸지 않는다. 회의록 Realtime과 fallback polling 회귀만 확인한다.

### Phase 4 — 문서·검증·관측성

- [x] `docs/api/meeting-api.md`와 이 문서의 실제 event 이름, payload, reconnect
      동작을 일치시킨다.
- [x] Redis publish 실패, malformed event drop, socket reconnect를 기존 서비스 log로
      확인 가능하게 한다. payload 안의 token·recording URL·transcript는 log에 남기지
      않는다.
- [ ] App Server, Realtime Server, Frontend의 변경 파일 단위 test/lint/typecheck를
      실행한다.
- [ ] dev 환경에서 두 browser로 다음 smoke를 수행한다.
  - [ ] A가 회의를 시작하면 B의 header/panel이 5초 polling 없이 갱신된다.
  - [ ] B가 참여·퇴장하면 A의 participant 수와 목록이 갱신된다.
  - [ ] 마지막 participant가 나가면 양쪽이 종료 상태로 수렴한다.
  - [ ] 녹음 시작·종료·실패가 갱신된다.
  - [ ] 한 browser의 network를 끊었다가 복구하면 reconnect snapshot으로 현재 상태가
        수렴한다.
  - [ ] 다른 workspace browser에는 어떤 Meeting event도 보이지 않는다.
  - [ ] 회의록 상태 event 및 fallback polling이 계속 동작한다.
- [ ] Issue #931의 완료 기준과 체크리스트를 실제 검증 결과로 갱신한다.

## 5. 실패·재연결 동작

| 상황 | 처리 |
| --- | --- |
| Redis Pub/Sub event 유실 | 다음 `meeting:subscribed`/reconnect snapshot 또는 사용자의 직접 action reload로 DB 상태에 수렴 |
| event 중복 또는 순서 역전 | `change`를 UI state에 직접 반영하지 않고 snapshot을 다시 읽으므로 안전 |
| Realtime Server 일시 중단 | Socket.IO 재연결 후 재구독, 구독 성공 뒤 snapshot 1회 조회 |
| Redis publish 실패 | API transaction은 성공을 유지하고 warning을 남김; 다른 탭은 reconnect 또는 다음 상태 event에서 수렴 |
| 권한 없는 workspace 구독 | `meeting:error`만 반환하고 room join/fan-out 하지 않음 |
| Frontend snapshot 요청 실패 | 기존 error state를 표시하고 다음 event 또는 사용자의 재시도로 다시 조회; 반복 polling은 재도입하지 않음 |

## 6. 구현 전 사용자 결정 필요 사항

코딩 규칙상 API 계약 변경과 기존 polling 동작 변경은 구현 전에 확인이 필요하다.
아래 두 항목만 결정하면 구현을 시작할 수 있다.

### 결정 1 — 상태 Socket.IO event 모양

- **권장: 단일 `meeting:state:updated` + `change` enum**
  - 현재 회의록 이벤트처럼 "재조회가 필요하다"는 신호 하나로 유지할 수 있다.
  - event 이름·handler가 늘지 않고, 중복·순서 역전에 대응하기 쉽다.
- 대안: `meeting:started`, `meeting:participant:joined`처럼 lifecycle별 event를 분리한다.
  - 이벤트를 바로 UI에 반영할 계획이라면 의미가 분명하지만, 이번 설계처럼 REST를
    다시 읽으면 실익이 작고 계약 표면만 커진다.

### 결정 2 — 이번 Issue의 polling 제거 범위

- **권장: Header/MeetingPanel의 5초 "현재 회의 상태" polling만 제거한다.**
  - 사용자 요청인 방 존재·참여 상태 판별을 notification으로 전환한다.
  - MeetingReport의 10초 fallback polling은 현재 at-most-once Realtime 계약의
    안전망이므로 그대로 둔다.
- 대안: MeetingReport의 10초 fallback polling도 함께 제거한다.
  - 이 경우 socket 미연결·event 유실 중 report 상태가 자동 갱신되지 않는 문제를
    별도 해결해야 하므로 #931의 범위를 넓힌다.

> 권장안(단일 상태 event, 5초 Meeting 상태 polling만 제거)은 2026-07-14에 확정했고,
> 구현을 완료했다.

## 7. 비목표

- MeetingRoom resource 및 다중 음성채널 도입
- LiveKit 음성 송수신 또는 microphone state를 App realtime으로 중계
- DB schema/migration 변경
- transcript/RAG/사용자 action 추적
- MeetingReport의 worker/outbox 설계 변경

## 8. 원리와 인프라 구조: polling 없이 어떻게 최신 상태를 보는가

### 8.1 먼저 바로잡을 한 가지

회의 상태의 **저장소는 Redis가 아니라 DB**다. Redis Pub/Sub은 상태를 오래 보관하거나
App Server에 데이터를 전달하는 저장소가 아니다. 여기서는 "회의 상태가 바뀌었다"는
짧은 알림을 **App Server에서 Realtime Server로** 전달하는 방송 장치다.

따라서 정확한 흐름은 아래와 같다.

```text
사용자 A가 "회의 시작" 클릭
        |
        v
App Server: meetings / meeting_participants를 DB에 저장하고 commit
        |
        |  "workspace W의 meeting M 상태가 바뀜" 알림 발행
        v
Redis Pub/Sub 채널 (meeting:state-events)
        |
        v
Realtime Server: Redis 알림을 구독
        |
        |  Workspace W 구성원인지 확인된 Socket.IO 연결에만 전송
        v
사용자 B의 브라우저: meeting:state:updated 수신
        |
        |  최신 값은 알림에서 조립하지 않고 REST API로 한 번 조회
        v
App Server -> DB 조회 -> B 화면을 새로고침 없이 갱신
```

여기서 "새로고침 없이"는 페이지 전체를 다시 여는 일이 없다는 뜻이다. 브라우저는
필요한 회의 영역의 데이터만 다시 요청해 React 화면을 바꾼다.

### 8.2 polling과 알림 방식의 차이

Polling은 브라우저가 일정 시간마다 "바뀐 것이 있나요?"라고 묻는 방식이다. 현재
5초 polling이라면 상태가 전혀 바뀌지 않아도 각 탭이 5초마다 App Server와 DB를
찾는다. 반대로 알림 방식은 상태가 바뀌는 순간에만 서버가 "바뀌었습니다"라고
알린다.

| 상황 | 5초 polling | Socket.IO 알림 + REST snapshot |
| --- | --- | --- |
| 회의가 1시간 동안 바뀌지 않음 | 탭마다 약 720번의 불필요한 확인 요청 | 상태 변경 알림 없음, 추가 조회 없음 |
| A가 회의를 시작함 | B는 최대 5초 뒤에 알 수 있음 | B가 거의 즉시 알림을 받고 한 번 조회 |
| 참여자가 여러 명·탭이 여러 개 | 같은 상태를 각 탭이 반복 조회 | 한 번의 변경에 필요한 탭만 한 번씩 갱신 |
| 네트워크가 잠시 끊김 | 다음 polling 때 다시 확인 | Socket.IO 재연결 뒤 REST snapshot으로 현재 상태 복구 |

알림을 받았다고 해서 알림 payload만 믿고 화면을 고치지 않는 이유는, 네트워크
메시지는 중복되거나 순서가 바뀌거나 빠질 수 있기 때문이다. 예를 들어
`participant_joined` 알림보다 `participant_left` 알림이 먼저 도착할 수 있다.
이 설계는 두 알림을 단지 "DB를 다시 볼 시간"이라는 신호로 취급하므로, 마지막에
읽은 DB snapshot으로 화면이 올바른 상태에 수렴한다.

### 8.3 각 인프라 구성요소의 역할

| 구성요소 | 맡는 일 | 맡지 않는 일 |
| --- | --- | --- |
| DB | 회의, 참여자, 녹음의 확정 상태를 저장하는 원본 | 브라우저에 실시간 방송 |
| App Server | 사용자의 회의 API를 처리하고 DB commit 뒤 상태 변경 알림을 발행 | 연결된 모든 브라우저 socket을 직접 관리 |
| Redis Pub/Sub | App Server가 낸 알림을 여러 Realtime Server 인스턴스에 빠르게 전달 | 상태 영구 저장, 유실된 메시지 재전송 |
| Realtime Server | Redis 알림을 받고 권한 있는 workspace Socket.IO room에 fan-out | DB 상태의 최종 판정 |
| Socket.IO | 서버에서 이미 연결된 브라우저로 즉시 push하고 재연결을 관리 | 권한 없는 workspace 이벤트 전달 |
| Frontend | 알림을 받으면 관련 REST snapshot을 한 번 읽어 화면 state를 갱신 | 이벤트만으로 회의 데이터를 영구 보관 |
| LiveKit | 실제 음성 송수신과 LiveKit 연결 상태 관리 | App의 Meeting DB 상태 동기화 대체 |

Redis와 Realtime Server를 분리하는 이유는 App Server가 여러 대가 되어도 같다.
어느 App Server가 회의 시작 요청을 처리하든 Redis에 한 번 publish하면, Redis를
구독하는 모든 Realtime Server가 알림을 받는다. 그리고 각 Realtime Server는 자신에게
연결된 브라우저에만 전달한다. 그래서 특정 서버 한 대에 모든 WebSocket 연결이 몰려도
다른 서버에서 발생한 회의 변경을 놓치지 않는다.

### 8.4 방(room)과 권한은 왜 필요한가

Socket.IO의 room은 실제 음성방이 아니라 **같은 Workspace에 속한 브라우저 연결을
묶는 전송 그룹**이다. 예를 들어 `meeting:{workspaceId}` room을 사용한다.

1. 브라우저가 access token과 `workspaceId`로 `meeting:subscribe`를 요청한다.
2. Realtime Server가 token의 사용자와 해당 Workspace membership을 확인한다.
3. 확인에 성공한 socket만 그 Workspace room에 넣는다.
4. `workspaceId`가 포함된 Redis 알림이 오면 Realtime Server는 같은 room에만
   `meeting:state:updated`를 보낸다.

이 네 단계가 없으면 다른 Workspace 사용자가 회의가 시작되었는지, 참여자가 늘었는지
같은 정보를 볼 위험이 있다. Redis 메시지의 `workspaceId`는 **어디로 보낼지 고르는
용도**이고, 브라우저로 보내는 event에는 넣지 않아도 된다.

### 8.5 재연결과 메시지 유실에도 맞는 이유

Redis Pub/Sub은 "발행 당시 구독 중인 서버"에게만 전달되는 at-most-once 방식이다.
Realtime Server 또는 브라우저가 잠깐 끊겨 있으면 그 사이의 알림을 다시 받지 못할 수
있다. 이 문제를 해결하려고 Redis를 DB처럼 쓰거나 polling을 되살리지 않는다.

대신 Socket.IO가 재연결된 뒤 다음 순서로 동작한다.

```text
브라우저 network 복구
  -> Socket.IO reconnect
  -> meeting:subscribe 재전송
  -> membership 확인 및 meeting:subscribed 수신
  -> REST current-meeting snapshot 1회 조회
  -> DB의 현재 상태로 화면 갱신
```

중간에 놓친 `started`, `joined`, `left` 알림을 하나씩 복구할 필요가 없다. 지금 시점의
DB 결과가 "회의가 진행 중인지", "현재 참여자가 누구인지", "녹음 중인지"를 모두
포함하므로 한 번의 snapshot이 정답이다. 이것이 알림은 빠르게, DB 조회는 정확하게라는
역할 분리다.

### 8.6 commit 뒤에 publish해야 하는 이유

App Server는 DB transaction이 성공적으로 commit된 **뒤에만** Redis 알림을 보낸다.
만약 commit 전에 "회의가 시작됐다"고 방송한 뒤 DB 저장이 실패하면, 다른 사용자는
존재하지 않는 회의를 보게 된다. 반대로 Redis publish가 실패해도 이미 DB commit은
정상이라면 회의 시작 API 자체를 실패로 바꾸지 않는다. 다음 재연결 snapshot이나 다음
상태 변경 알림이 화면을 다시 맞춘다.

```text
올바른 순서: DB commit 성공 -> Redis publish -> Socket.IO push -> REST snapshot
피해야 할 순서: Redis publish -> DB commit 실패
```

이 규칙 덕분에 DB는 언제나 최종 사실을 갖고, 실시간 계층은 빠른 갱신을 돕되 DB의
정합성을 훼손하지 않는다.
