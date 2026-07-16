# Workspace Chat API

## Scope

- active Workspace당 일반 채팅방 1개
- text/emoji/URL, permanent history, unread, author soft delete, member mention

## Access

- bearer session required
- every REST path and Socket join checks `workspace_members`
- body user/workspace identifiers are rejected

Base path는 `/api/v1`이다. 모든 REST 요청은
`Authorization: Bearer <pilo_access_token>`을 사용한다.

## REST endpoints

| Method | Endpoint |
| --- | --- |
| GET | `/workspaces/{workspaceId}/chat/summary` |
| GET | `/workspaces/{workspaceId}/chat/messages?before={cursor}&limit=50` |
| GET | `/workspaces/{workspaceId}/chat/messages/{messageId}/context` |
| POST | `/workspaces/{workspaceId}/chat/messages` |
| DELETE | `/workspaces/{workspaceId}/chat/messages/{messageId}` |
| PUT | `/workspaces/{workspaceId}/chat/read-state` |
| GET | `/workspaces/{workspaceId}/chat/mentions` |
| PUT | `/workspaces/{workspaceId}/chat/mentions/{mentionId}/read` |

## Socket.IO events

- `chat:join`, `chat:leave`, `chat:joined`, `chat:message-created`
- `chat:message-deleted`, `chat:mention-created`, `chat:error`

## Idempotency

- same key + same payload: existing message, 200
- same key + different payload: 409 `IDEMPOTENCY_KEY_REUSED`

## Non-goals

- 여러 채널, 채널 생성·수정·삭제
- 1:1 DM 또는 그룹 DM
- 파일·이미지 첨부
- 답글 thread, 이모지 reaction, 메시지 수정
- `@everyone`, 자기 자신 멘션, 관리자 강제 삭제
- typing indicator, delivery receipt, 사용자별 메시지 read receipt 표시
- push, email, 브라우저 notification
- 메시지 검색과 retention 만료 정책
- 범용 notification platform 재설계

## Response models

### `WorkspaceChatMessage`

```ts
type WorkspaceChatMessage = {
  id: string;
  workspaceId: string;
  clientMessageId: string;
  content: string | null;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  mentions: Array<{
    userId: string;
    displayText: string;
  }>;
  createdAt: string;
  deletedAt: string | null;
};
```

다른 사용자의 mention `readAt`은 message payload에 노출하지 않는다. 삭제된 message는
`content`가 `null`인 tombstone으로 반환한다.

### `ChatSummary`

```ts
type ChatSummary = {
  latestMessageId: string | null;
  lastReadMessageId: string | null;
  unreadCount: number;
  mentionUnreadCount: number;
};
```

### `ChatMentionNotification`

```ts
type ChatMentionNotification = {
  id: string;
  readAt: string | null;
  messageId: string;
  excerpt: string;
  actor: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
};
```

Mention 목록은 current user의 active Workspace mention만 반환한다. `excerpt`는 safe
excerpt이며 삭제된 message는 mention 목록과 unread count에서 제외한다.

## Cursor and read semantics

- message와 mention 목록의 `limit` 기본값은 `50`, 범위는 `1..100`이다.
- cursor는 server가 `{ createdAt, id }` JSON을 base64url로 encoding한 opaque string이다.
- client는 cursor를 생성하거나 해석하지 않고 `nextCursor`를 다음 `before`로 전달한다.
- message page의 `items`는 `createdAt ASC, id ASC`의 chronological order다.
- `workspace_chat_reads`가 없는 사용자는 membership `joined_at` 이후 메시지만 unread로 센다.
- 신규 멤버는 가입 전 기록을 조회할 수 있지만 가입 전 메시지는 unread가 아니다.
- 자기 메시지와 삭제된 메시지는 Chat unread 숫자에서 제외한다.
- read state update는 단조 증가한다. 오래된 tab의 요청이 last-read cursor를 뒤로 이동시키지
  않는다.
- mention notification은 사용자가 알림을 클릭하거나 `/chat`에서 해당 메시지를 실제로 볼 때
  읽음 처리한다.

## REST request and response examples

응답은 공통 `{ success: true, data }` envelope를 사용한다.

### Chat summary

`GET /workspaces/{workspaceId}/chat/summary`

```json
{
  "success": true,
  "data": {
    "latestMessageId": "message_uuid",
    "lastReadMessageId": "message_uuid",
    "unreadCount": 3,
    "mentionUnreadCount": 1
  }
}
```

### Message history

`GET /workspaces/{workspaceId}/chat/messages?before={cursor}&limit=50`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "message_uuid",
        "workspaceId": "workspace_uuid",
        "clientMessageId": "client-generated-id",
        "content": "@동현 확인 부탁해요",
        "author": {
          "id": "user_uuid",
          "displayName": "주형",
          "avatarUrl": null
        },
        "mentions": [
          {
            "userId": "mentioned_user_uuid",
            "displayText": "@동현"
          }
        ],
        "createdAt": "2026-07-16T00:00:00.000Z",
        "deletedAt": null
      }
    ],
    "nextCursor": "opaque_cursor_or_null"
  }
}
```

`nextCursor`는 더 오래된 기록이 없으면 `null`이다.

### Message context

`GET /workspaces/{workspaceId}/chat/messages/{messageId}/context`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "message_uuid",
        "workspaceId": "workspace_uuid",
        "clientMessageId": "client-generated-id",
        "content": "확인 부탁해요",
        "author": null,
        "mentions": [],
        "createdAt": "2026-07-16T00:00:00.000Z",
        "deletedAt": null
      }
    ]
  }
}
```

대상 message 앞뒤 최대 25개씩을 chronological order로 반환한다. 다른 Workspace message
id와 접근 불가 message id는 모두 `404 NOT_FOUND`다.

### Create message

`POST /workspaces/{workspaceId}/chat/messages`

```json
{
  "clientMessageId": "client-generated-id",
  "content": "@동현 확인 부탁해요",
  "mentionedUserIds": ["user_uuid"]
}
```

- `clientMessageId` 길이는 `1..128` characters다.
- `content`는 trim 기준 `1..4,000` characters다.

`mentionedUserIds`는 unique하게 normalize하고 최대 20명이다. 각 user는 active Workspace
member여야 하고 sender 자신일 수 없다. server는 current profile 규칙으로 `displayText`를
만들고 본문에 해당 token이 있는지 확인한다. message와 mentions는 한 transaction으로
생성한다.

신규 생성은 `201`, idempotent replay는 `200`이다.

```json
{
  "success": true,
  "data": {
    "id": "message_uuid",
    "workspaceId": "workspace_uuid",
    "clientMessageId": "client-generated-id",
    "content": "@동현 확인 부탁해요",
    "author": {
      "id": "sender_user_uuid",
      "displayName": "주형",
      "avatarUrl": null
    },
    "mentions": [
      {
        "userId": "user_uuid",
        "displayText": "@동현"
      }
    ],
    "createdAt": "2026-07-16T00:00:00.000Z",
    "deletedAt": null
  }
}
```

### Delete message

`DELETE /workspaces/{workspaceId}/chat/messages/{messageId}`

current user가 원 작성자일 때만 삭제할 수 있다. 이미 삭제된 message delete는 현재
tombstone을 반환하는 idempotent success다.

```json
{
  "success": true,
  "data": {
    "id": "message_uuid",
    "workspaceId": "workspace_uuid",
    "clientMessageId": "client-generated-id",
    "content": null,
    "author": {
      "id": "sender_user_uuid",
      "displayName": "주형",
      "avatarUrl": null
    },
    "mentions": [],
    "createdAt": "2026-07-16T00:00:00.000Z",
    "deletedAt": "2026-07-16T00:10:00.000Z"
  }
}
```

### Update read state

`PUT /workspaces/{workspaceId}/chat/read-state`

```json
{
  "lastReadMessageId": "message_uuid"
}
```

message는 path Workspace에 속해야 한다. 현재 cursor보다 오래된 message 요청은 state를
변경하지 않고 current state를 반환한다. server timestamp를 `lastReadAt`에 기록한다.

```json
{
  "success": true,
  "data": {
    "lastReadMessageId": "message_uuid",
    "lastReadAt": "2026-07-16T00:10:00.000Z"
  }
}
```

### Mention list

`GET /workspaces/{workspaceId}/chat/mentions`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "mention_uuid",
        "readAt": null,
        "messageId": "message_uuid",
        "excerpt": "@동현 확인 부탁해요",
        "actor": {
          "id": "sender_user_uuid",
          "displayName": "주형",
          "avatarUrl": null
        },
        "workspaceId": "workspace_uuid",
        "workspaceName": "PILO",
        "createdAt": "2026-07-16T00:00:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

### Read mention

`PUT /workspaces/{workspaceId}/chat/mentions/{mentionId}/read`

```json
{
  "success": true,
  "data": {
    "id": "mention_uuid",
    "readAt": "2026-07-16T00:10:00.000Z",
    "messageId": "message_uuid",
    "excerpt": "@동현 확인 부탁해요",
    "actor": {
      "id": "sender_user_uuid",
      "displayName": "주형",
      "avatarUrl": null
    },
    "workspaceId": "workspace_uuid",
    "workspaceName": "PILO",
    "createdAt": "2026-07-16T00:00:00.000Z"
  }
}
```

## Socket.IO contract

Internal room names:

- Workspace Chat: `workspace:{workspaceId}:chat`
- Target user: `workspace:{workspaceId}:chat:user:{userId}`

| Direction | Event | Payload purpose |
| --- | --- | --- |
| client → server | `chat:join` | `{ workspaceId }` membership join |
| client → server | `chat:leave` | `{ workspaceId }` leave rooms |
| server → client | `chat:joined` | joined acknowledgement |
| server → client | `chat:message-created` | persisted full message |
| server → client | `chat:message-deleted` | message tombstone update |
| server → client | `chat:mention-created` | target-only mention notification |
| server → client | `chat:error` | safe socket error |

Redis channel은 `chat:events`다. Event envelope는 `version: 1`, `type`, `workspaceId`,
`occurredAt`, type별 payload를 포함한다. Realtime Server는 version과 payload를 검증한
뒤에만 emit한다.

Socket error code:

- `invalid_payload`
- `unauthenticated`
- `forbidden`
- `room_not_joined`
- `internal_error`

## Error/status matrix

| Condition | Status | Code |
| --- | --- | --- |
| request body, path id, query 또는 cursor가 잘못됨 | `400` | `BAD_REQUEST` |
| bearer session 없음 또는 만료 | `401` | `UNAUTHORIZED` |
| Workspace 접근 권한 없음 또는 원 작성자가 아닌 message 삭제 | `403` | `FORBIDDEN` |
| message, mention 또는 다른 Workspace resource에 접근할 수 없음 | `404` | `NOT_FOUND` |
| 같은 idempotency key를 다른 content 또는 mention set으로 재사용 | `409` | `IDEMPOTENCY_KEY_REUSED` |

## Failure handling

| Failure | Behavior |
| --- | --- |
| POST timeout/failure | pending message를 failed로 표시하고 same id 재시도 제공 |
| Redis publish failure | DB message 유지, server log, focus/reconnect REST catch-up |
| Socket disconnect | 연결 상태 표시, REST write 유지, reconnect 후 summary/history catch-up |
| invalid mention member | draft 유지, member list refresh, safe validation message |
| membership removed | composer disable, Chat rooms leave, auth Workspace session refresh |
| stale read update | current server cursor 반환, cursor rollback 금지 |
| duplicate Socket event | reducer가 message id와 deletion state로 idempotent 처리 |
| deleted mention target | 안내 후 mention read, deleted message는 list/count 제외 |

## Security

- 모든 message, read, mention query는 `workspace_id`를 조건에 포함한다.
- mention target room은 target user socket만 join한다.
- message content를 `dangerouslySetInnerHTML`로 렌더링하지 않는다.
- URL linkification은 `http`와 `https` scheme만 허용한다.
- error response와 log에는 bearer token 또는 secret을 포함하지 않는다.
- deleted content는 DB에서 null 처리하여 UI tombstone 뒤에 원문을 보존하지 않는다.
