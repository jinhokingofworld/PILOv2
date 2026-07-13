# User API

## 범위

User API는 PILO API 호출의 현재 로그인 사용자 정보를 제공한다.

- 현재 사용자 profile 조회
- 도메인 API가 사용할 `currentUserId` 기준 제공

로그인 OAuth 시작/콜백, session 발급/갱신, GitHub Review 제출용 사용자 GitHub
App user OAuth 연결은 이 문서의 범위가 아니다. 사용자 GitHub App user OAuth 연결 상태는
GitHub Integration API의 `/me/github`를 사용한다.

## 데이터 규칙

- 테이블: `users`
- 현재 사용자는 `Authorization: Bearer <pilo_access_token>`에서 온다.
- `userId`는 request body나 query로 받지 않는다.
- API 응답에는 `github_access_token_encrypted`, provider access token, session secret을 노출하지 않는다.
- `github_user_id`, `google_user_id` 같은 provider 내부 식별자는 기본 profile 응답에 포함하지 않는다.
- 사용자 profile 수정 API는 MVP 범위가 아니다. 이름, 이메일, avatar는 로그인 또는 연결된 provider 동기화 결과를 사용한다.
- `active_workspace_id`, `last_seen_at`은 Home 멤버 presence 표시용으로만 사용한다.
- presence 갱신은 현재 bearer session user 본인의 `users` row만 수정한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me` | 현재 로그인 사용자 profile 조회 |
| `POST` | `/me/presence` | 현재 사용자의 활성 Workspace presence 갱신 |

## 현재 사용자 조회

```http
GET /api/v1/me
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "user_uuid",
    "name": "Eunjae",
    "email": "eunjae@example.com",
    "avatarUrl": "https://example.com/avatar.png",
    "createdAt": "2026-07-04T00:00:00.000Z",
    "updatedAt": "2026-07-04T00:00:00.000Z"
  }
}
```

서버 규칙:

- access token이 없거나 유효하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- token의 subject에 해당하는 `users.id`를 조회한다.
- 사용자가 존재하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- 응답에는 token, encrypted token, provider raw profile을 포함하지 않는다.

## 현재 사용자 Presence 갱신

```http
POST /api/v1/me/presence
```

Request Body:

```json
{
  "activeWorkspaceId": "workspace_uuid"
}
```

`activeWorkspaceId`는 `null`도 허용한다. `null`이면 현재 사용자의 활성 Workspace를 비운다.

응답:

```json
{
  "success": true,
  "data": {
    "activeWorkspaceId": "workspace_uuid",
    "lastSeenAt": "2026-07-09T06:00:00.000Z"
  }
}
```

서버 규칙:

- access token이 없거나 유효하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- `activeWorkspaceId`가 문자열이면 UUID 형식이어야 하며, 현재 사용자가 해당 Workspace의 owner 또는 member여야 한다.
- 현재 사용자가 해당 Workspace member가 아니면 `403 FORBIDDEN`을 반환한다.
- body가 없거나 `activeWorkspaceId`가 생략되면 `400 BAD_REQUEST`를 반환한다.
- 성공 시 `users.active_workspace_id`와 `users.last_seen_at`을 갱신한다.
- 브라우저 종료/탭 종료 이벤트에서는 Frontend가 현재 사용자의 기본 owner Workspace id로 이 endpoint를 `keepalive` 요청한다.

## 도메인 API 사용 규칙

도메인 API는 현재 사용자가 필요할 때 request body의 `userId`를 신뢰하지 않는다.
항상 인증 layer에서 얻은 `currentUserId`를 사용한다.

예:

| 도메인 | 사용 필드 |
| --- | --- |
| PR Review | `created_by_user_id`, `reviewed_by_user_id`, `submitted_by_user_id` |
| Meeting | `meeting_participants.user_id`, `ended_by_id` |
| Calendar | `calendar_events.created_by` |
| Canvas | `canvas_user_states.user_id` |
| GitHub Integration | `github_oauth_connections` (`purpose=app_user`) GitHub App user OAuth 연결 상태 |

## MVP 제외

- 사용자 profile 직접 수정
- 사용자 삭제
- 사용자 검색
- team member 초대
- provider raw profile 조회
- session 발급/갱신 API
