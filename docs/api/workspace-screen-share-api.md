# Workspace Screen Share API

Workspace Screen Share는 Meeting과 독립적으로 Workspace당 하나의 화면 공유를
LiveKit으로 제공한다. 화면 공유 session은 일시 상태이며 DB에 저장하지 않는다.

## 공통 계약

- Base URL은 `/api/v1`이다.
- 모든 사용자 endpoint는 `Authorization: Bearer <pilo_access_token>`을 요구한다.
- 모든 endpoint는 현재 사용자의 Workspace membership을 다시 확인한다. start와 viewer
  token 발급은 `workspace_members` row를 PostgreSQL transaction 안에서 lock한 채
  Redis 상태 변경과 token 발급까지 완료한다.
- 성공 응답은 `{ "success": true, "data": ... }` envelope를 사용한다.
- LiveKit API key, secret, provider raw error는 응답이나 로그에 노출하지 않는다.
- LiveKit publisher와 viewer token의 만료 시간은 발급 시점 기준 45초다. publisher
  token은 `starting` lease보다 길지 않다.

```ts
type PublicWorkspaceScreenShareSession = {
  id: string;
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: string;
};

type ScreenShareToken = {
  livekitUrl: string;
  livekitToken: string;
  expiresAt: string;
};
```

`startedAt`과 `expiresAt`은 ISO 8601 문자열이다. `livekitToken`은 지정된 room과
identity에만 사용할 수 있다.

## 현재 화면 공유 조회

```http
GET /api/v1/workspaces/{workspaceId}/screen-share-sessions/current
Authorization: Bearer <pilo_access_token>
```

성공 응답은 `200 OK`다. 아직 LiveKit 화면 track이 확인되지 않은 `starting`
reservation은 public session으로 노출하지 않으며 `session`은 `null`이다.

```json
{
  "success": true,
  "data": {
    "session": {
      "id": "11111111-1111-4111-8111-111111111111",
      "sharer": {
        "userId": "33333333-3333-4333-8333-333333333333",
        "displayName": "민준",
        "avatarUrl": null
      },
      "startedAt": "2026-07-18T00:00:01.000Z"
    }
  }
}
```

활성 화면 공유가 없으면 다음과 같다.

```json
{
  "success": true,
  "data": { "session": null }
}
```

## 화면 공유 시작 예약

```http
POST /api/v1/workspaces/{workspaceId}/screen-share-sessions
Authorization: Bearer <pilo_access_token>
```

request body는 없다. 서버가 session ID, LiveKit room name, publisher identity를
생성하고 현재 사용자에게만 publisher token을 발급한다.

- 새 reservation이면 `201 Created`다.
- 같은 사용자가 자신의 `starting` reservation을 복구하면 새 session을 만들지 않고
  publisher token만 다시 발급하며 `200 OK`다.
- 같은 사용자의 이미 `active`인 화면 공유는 현재 public session을 반환하는
  `409 SCREEN_SHARE_ALREADY_ACTIVE`다.
- 다른 사용자의 `starting` reservation은 생성 후 60초 동안 보호한다. 60초가 지난
  reservation도 LiveKit에 실제 화면 공유 track이 있으면 보호한다. 만료되었고 실제
  track도 없는 reservation만 현재 session과 room이 모두 일치할 때 원자적으로
  회수할 수 있다.
- 다른 사용자의 보호 중인 `starting` 또는 `active` reservation은
  `409 SCREEN_SHARE_ALREADY_ACTIVE`다.

`201`과 same-owner recovery `200`의 data shape은 동일하다.

```json
{
  "success": true,
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "status": "starting",
    "startedAt": null,
    "sharer": {
      "userId": "33333333-3333-4333-8333-333333333333",
      "displayName": "민준",
      "avatarUrl": null
    },
    "livekitUrl": "wss://livekit.example.com",
    "livekitToken": "<publisher_token>",
    "expiresAt": "2026-07-18T00:01:00.000Z"
  }
}
```

publisher grant는 해당 room join, 화면 공유 source publish만 허용한다.
`canPublishSources = ["screen_share"]`, `canPublishData = false`,
`canSubscribe = false`다. 카메라, 마이크, data publish와 다른 participant 구독은
허용하지 않는다.

## Viewer token 발급

```http
POST /api/v1/workspaces/{workspaceId}/screen-share-sessions/{sessionId}/viewer-token
Authorization: Bearer <pilo_access_token>
```

현재 `active` session ID가 일치할 때 `200 OK`를 반환한다.

```json
{
  "success": true,
  "data": {
    "livekitUrl": "wss://livekit.example.com",
    "livekitToken": "<viewer_token>",
    "expiresAt": "2026-07-18T00:00:45.000Z"
  }
}
```

viewer grant는 해당 room join과 subscribe만 허용한다. `canPublish = false`,
`canPublishData = false`, `canSubscribe = true`다.
현재 session의 sharer 본인은 viewer token을 발급받을 수 없으며
`403 FORBIDDEN`을 반환한다.

App Server는 viewer identity를 token 생성 전에 Redis에 등록한다. 등록은 현재 active
session과 room 소유권을 원자적으로 확인하며, 등록 TTL은 token TTL보다 길다. token
생성에 실패하면 해당 identity만 compare-safe하게 제거한다.

## 화면 공유 종료

```http
DELETE /api/v1/workspaces/{workspaceId}/screen-share-sessions/{sessionId}
Authorization: Bearer <pilo_access_token>
```

현재 사용자가 sharer이고 현재 session ID가 일치하면 Redis 상태와 LiveKit room을
종료한다. 성공 응답은 `200 OK`다.

```json
{
  "success": true,
  "data": {
    "sessionId": "11111111-1111-4111-8111-111111111111",
    "ended": true
  }
}
```

이미 종료되어 현재 session이 아닌 ID를 다시 종료해도 같은 `200` 응답을 반환한다.
현재 다른 사용자의 session을 종료하려는 요청은 `403 FORBIDDEN`이다. 늦게 도착한
종료 요청은 `sessionId`와 LiveKit room name을 모두 비교한 뒤에만 삭제하며, 이후
생성된 session을 삭제하지 않는다.

## 오류 계약

```json
{
  "success": false,
  "error": {
    "code": "SCREEN_SHARE_NOT_FOUND",
    "message": "Screen share not found"
  }
}
```

| 상황 | HTTP | code |
| --- | --- | --- |
| bearer session 없음 또는 만료 | `401` | `UNAUTHORIZED` |
| Workspace membership 없음 또는 다른 사용자의 session 종료 | `403` | `FORBIDDEN` |
| 현재 sharer가 자신의 session viewer token 발급 요청 | `403` | `FORBIDDEN` |
| viewer token 대상 active session 없음 | `404` | `SCREEN_SHARE_NOT_FOUND` |
| 이미 화면 공유가 예약 또는 활성화됨 | `409` | `SCREEN_SHARE_ALREADY_ACTIVE` |
| Redis 또는 LiveKit 설정/연결/발급 실패 | `503` | `SERVICE_UNAVAILABLE` |

active session 충돌은 public session을 `error.details.session`에 포함한다.

```json
{
  "success": false,
  "error": {
    "code": "SCREEN_SHARE_ALREADY_ACTIVE",
    "message": "Screen share is already active",
    "details": {
      "session": {
        "id": "11111111-1111-4111-8111-111111111111",
        "sharer": {
          "userId": "33333333-3333-4333-8333-333333333333",
          "displayName": "민준",
          "avatarUrl": null
        },
        "startedAt": "2026-07-18T00:00:01.000Z"
      }
    }
  }
}
```

아직 `starting`인 충돌은 public `startedAt`이 없으므로 `details` property 자체를
생략한다. 다른 도메인의 기존 오류도 `details`를 추가하지 않으며 기존 JSON shape을
그대로 유지한다.

## Redis 상태와 realtime event

- Workspace별 현재 session과 LiveKit room name의 reverse lookup을 Redis에 함께
  저장하며 두 key의 TTL은 12시간이다.
- reservation과 만료된 `starting` 회수는 각각 하나의 Lua script로 관련 key를
  원자적으로 변경한다.
- activation과 종료는 저장된 `sessionId`와 `livekitRoomName`이 모두 일치할 때만
  상태를 변경한다.
- activation/종료 상태 변경과 해당 realtime event의 Redis Stream outbox 기록은
  하나의 Lua script에서 원자적으로 수행한다. dispatcher는 subscriber handoff가
  성공한 entry만 같은 원자 연산에서 ack하며, 실패한 entry를 재시도한다.
- 종료와 만료 reservation 회수는 기존 LiveKit room cleanup entry도 같은 상태 전환
  안에서 별도 Redis Stream에 기록한다. cleanup worker는 participant/room 삭제가
  성공하거나 이미 삭제된 경우에만 ack하며 일시 실패를 재시도한다.
- 종료된 LiveKit room은 5분 tombstone으로 분류를 유지하여 중복 종료 webhook이
  Meeting webhook 처리로 넘어가지 않게 한다.
- `REDIS_URL`이 없거나 Redis 연결에 실패하면 memory fallback을 만들지 않고
  `503 SERVICE_UNAVAILABLE`을 반환한다.
- internal Redis channel은 `workspace-screen-share:events:v1`이다.

```ts
type WorkspaceScreenShareRedisEvent =
  | {
      version: 1;
      event: "workspace-screen-share:started";
      workspaceId: string;
      session: PublicWorkspaceScreenShareSession;
    }
  | {
      version: 1;
      event: "workspace-screen-share:ended";
      workspaceId: string;
      sessionId: string;
    };
```

Realtime Server는 Redis event를 해당 Workspace를 구독하고 현재 membership이 있는
socket에만 같은 event name으로 broadcast한다. event에는 LiveKit token, room name,
participant identity를 넣지 않는다.

## LiveKit webhook 보정

기존 비사용자 endpoint `POST /api/v1/livekit/webhooks`가 Meeting room과 화면 공유
room을 모두 처리한다. LiveKit signature 검증은 동일하게 필수다.

- 예약된 publisher identity와 room에서 `screen_share` track이 publish되면 현재
  `starting` session을 `active`로 바꾸고 server event timestamp를 `startedAt`으로
  기록한 뒤 `workspace-screen-share:started`를 발행한다.
- 해당 track의 `track_unpublished`, publisher의 `participant_left` 또는 room 종료가
  오면 일치하는 현재 session만 종료하고 `workspace-screen-share:ended`를 발행한다.
- webhook 재전송, 순서 역전, 이미 종료된 session은 멱등하게 무시한다. 과거 room의
  webhook이 새 화면 공유 상태를 변경해서는 안 된다.
- 화면 공유 room event를 Meeting participant/session 상태로 기록하지 않는다.

## Membership 철회

Workspace membership revocation event를 받으면 Realtime Server는 해당 사용자를
Workspace 화면 공유 구독 room에서 즉시 제거한다. App Server는 해당 사용자의
LiveKit participant를 `removeParticipant`와 `revokeTokenTs`로 제거하여 이미 발급된
token 재사용도 막는다.

철회된 사용자가 sharer라면 현재 session의 ID와 room name이 일치할 때만 Redis
상태를 종료하고 ended event를 발행한다. viewer라면 Redis에 등록된 해당 사용자의
모든 identity를 조회한 뒤, 아직 LiveKit room에 join하지 않은 identity까지 각각
`removeParticipant(..., { revokeTokenTs })`로 명시적으로 revoke한다. revoke에 성공한
identity만 Redis registry에서 제거하므로 일부 LiveKit 호출이 일시적으로 실패해도
실패 identity는 token 수명 창 동안 bounded retry 대상으로 남고, 성공 identity는 다시
revoke하지 않는다. App Server는 LiveKit 호출 전에 Redis pending revocation task를
기록하며, 초기/주기 sweep worker가 due task를 lease로 claim한다. 모든 즉시 retry가
실패하거나 프로세스가 재시작되어도 pending task와 실패 identity가 남아 다음 sweep에서
재시도되며, registry가 비어야 pending task를 ack한다.

철회 event와 start/viewer token 발급이 경쟁하면 PostgreSQL membership row lock이 두
작업을 직렬화한다. 먼저 lock을 획득한 발급은 완료된 뒤 철회 cleanup 대상이 되고,
membership 삭제가 먼저 완료되면 이후 발급은 `403 FORBIDDEN`으로 차단된다. Redis
event가 지연되더라도 모든 조회와 token 발급 endpoint는 매 요청 membership을
확인한다.

## 저장 범위

- 화면 공유 session과 LiveKit room reverse lookup은 Redis의 12시간 TTL 범위에만
  존재한다. 종료 room 분류 tombstone은 5분 유지하며 realtime outbox entry는
  subscriber handoff 성공 시 삭제한다. LiveKit cleanup entry는 cleanup 성공 시
  삭제한다.
- 화면 공유를 위한 DB table, migration, RLS, FK, index를 추가하지 않는다.
- session, token, 화면 frame, track metadata를 DB나 Activity Log에 저장하지 않는다.
- Redis 상태가 만료되면 과거 화면 공유를 복구하지 않는다.
