# User API

## 범위

User API는 PILO API 호출의 현재 로그인 사용자 정보를 제공한다.

- 현재 사용자 profile 조회
- 현재 사용자의 PILO profile override 조회와 수정
- 계정 탈퇴 가능 여부 조회와 계정 탈퇴
- 도메인 API가 사용할 `currentUserId` 기준 제공

로그인 OAuth 시작/콜백, session 발급/갱신, GitHub Review 제출용 사용자 GitHub
App user OAuth 연결은 이 문서의 범위가 아니다. 사용자 GitHub App user OAuth 연결 상태는
GitHub Integration API의 `/me/github`를 사용한다.

## 데이터 규칙

- 테이블: `users`, `user_settings`
- 현재 사용자는 `Authorization: Bearer <pilo_access_token>`에서 온다.
- `userId`는 request body나 query로 받지 않는다.
- API 응답에는 `github_access_token_encrypted`, provider access token, session secret을 노출하지 않는다.
- `github_user_id`, `google_user_id` 같은 provider 내부 식별자는 기본 profile 응답에 포함하지 않는다.
- `users.name`, `users.email`, `users.avatar_url`은 로그인 provider 동기화 결과를 유지한다.
- 사용자가 지정한 표시 이름, 직무, 소개, avatar URL과 표시 방식은 `user_settings`에 저장한다.
- 표시 이름이 없으면 `users.name`, 이메일 local-part, `PILO 사용자` 순서로 fallback한다.
- 이메일과 provider 원본 avatar URL은 User API에서 직접 수정하지 않는다.
- 응답의 `avatarUrl`은 `custom`, `provider`, `initials` 표시 방식에 따라 계산한
  최종 표시 URL이다. `initials`면 `null`을 반환한다.
- `active_workspace_id`, `last_seen_at`은 Home 멤버 presence 표시용으로만 사용한다.
- presence 갱신은 현재 bearer session user 본인의 `users` row만 수정한다.
- 탈퇴한 사용자는 `users` row를 audit tombstone으로 유지하고 `deleted_at`을 기록한다.
- 탈퇴한 사용자의 session은 모두 revoke하며 이후 보호 API 접근을 허용하지 않는다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me` | 현재 로그인 사용자 profile 조회 |
| `GET` | `/me/profile` | 현재 사용자의 조회 전용 profile 상세 |
| `PATCH` | `/me/profile` | 현재 사용자의 PILO profile override 수정 |
| `POST` | `/me/presence` | 현재 사용자의 활성 Workspace presence 갱신 |
| `GET` | `/me/deletion-eligibility` | 계정 탈퇴 가능 여부와 차단 Workspace 조회 |
| `DELETE` | `/me` | 현재 계정 탈퇴와 개인정보 익명화 |

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
    "displayName": "은재",
    "email": "eunjae@example.com",
    "avatarUrl": "https://example.com/avatar.png",
    "avatarMode": "provider",
    "avatarColor": "#6366F1",
    "createdAt": "2026-07-04T00:00:00.000Z",
    "updatedAt": "2026-07-04T00:00:00.000Z"
  }
}
```

서버 규칙:

- access token이 없거나 유효하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- token의 subject에 해당하는 `users.id`를 조회한다.
- 사용자가 존재하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- `users.deleted_at IS NOT NULL`이면 `401 UNAUTHORIZED`를 반환한다.
- `name`은 provider 동기화 원본 이름이며 `displayName`은 사용자 override가 있으면
  override, 없으면 fallback 이름을 반환한다.
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

## 현재 사용자 Profile 상세 조회

```http
GET /api/v1/me/profile
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "user_uuid",
    "providerName": "Eunjae",
    "displayName": "은재",
    "jobTitle": "Frontend Developer",
    "bio": "PILO 프로젝트를 개발하고 있습니다.",
    "email": "eunjae@example.com",
    "avatarUrl": "https://cdn.example.com/custom-avatar.png",
    "providerAvatarUrl": "https://example.com/avatar.png",
    "customAvatarUrl": "https://cdn.example.com/custom-avatar.png",
    "avatarMode": "custom",
    "avatarColor": "#6366F1",
    "loginProviders": ["google"],
    "workspaceSummary": {
      "ownedCount": 2,
      "memberCount": 3,
      "activeWorkspaceId": "workspace_uuid"
    },
    "createdAt": "2026-07-04T00:00:00.000Z",
    "updatedAt": "2026-07-13T00:00:00.000Z"
  }
}
```

서버 규칙:

- `loginProviders`는 `users.google_user_id`, `users.github_user_id` 존재 여부에서
  파생하며 provider 내부 id는 노출하지 않는다.
- `workspaceSummary.ownedCount`는 owner membership 수, `memberCount`는 member
  membership 수다.
- GitHub Integration OAuth/App installation 상태는 이 응답에 포함하지 않는다.
  해당 상태는 GitHub Integration API가 소유한다.
- 이 endpoint는 조회 전용 Profile 화면의 기준 payload다.

## 현재 사용자 Profile 수정

```http
PATCH /api/v1/me/profile
Content-Type: application/json
```

Request Body:

```json
{
  "displayName": "은재",
  "jobTitle": "Frontend Developer",
  "bio": "PILO 프로젝트를 개발하고 있습니다.",
  "avatarMode": "custom",
  "customAvatarUrl": "https://cdn.example.com/custom-avatar.png",
  "avatarColor": "#6366F1"
}
```

모든 필드는 optional이며 지원 필드가 하나 이상 있어야 한다.
`displayName`, `jobTitle`, `bio`, `customAvatarUrl`에 `null`을 전달하면 해당
override를 비운다.

Validation:

| Field | 규칙 |
| --- | --- |
| `displayName` | `null` 또는 trim 후 1~100자 |
| `jobTitle` | `null` 또는 trim 후 1~100자 |
| `bio` | `null` 또는 trim 후 1~500자 |
| `avatarMode` | `provider`, `custom`, `initials` |
| `customAvatarUrl` | `null` 또는 1~2048자의 HTTPS URL |
| `avatarColor` | `#RRGGBB` |

서버 규칙:

- body가 없거나 지원 필드가 하나도 없으면 `400 BAD_REQUEST`를 반환한다.
- 이메일, provider 이름, provider avatar URL은 이 endpoint에서 받지 않는다.
- `avatarMode=custom`인 최종 상태에는 유효한 `customAvatarUrl`이 있어야 한다.
- 사용자 지정 URL은 `user_settings.custom_avatar_url`에 저장하며 OAuth 로그인으로
  갱신되는 `users.avatar_url`은 수정하지 않는다.
- validation 후 `user_settings`를 현재 사용자 기준으로 upsert한다.
- 성공 시 `GET /me/profile`과 같은 전체 payload를 반환한다.

## 계정 탈퇴 가능 여부 조회

```http
GET /api/v1/me/deletion-eligibility
```

응답:

```json
{
  "success": true,
  "data": {
    "canDelete": false,
    "blockingReason": "OWNED_WORKSPACE_EXISTS",
    "ownedWorkspaces": [
      {
        "id": "workspace_uuid",
        "name": "PILO Team",
        "memberCount": 3
      }
    ]
  }
}
```

서버 규칙:

- 현재 사용자가 owner인 Workspace가 하나라도 있으면 `canDelete=false`다.
- 계정 탈퇴 전에 각 소유 Workspace를 삭제하거나 후속 소유권 이전 기능으로
  정리해야 한다.
- 다른 Workspace에 member로만 참여 중인 것은 탈퇴 차단 사유가 아니다.

## 현재 계정 탈퇴

```http
DELETE /api/v1/me
Content-Type: application/json
```

Request Body:

```json
{
  "confirmationText": "계정 탈퇴"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

서버 규칙:

- `confirmationText`가 정확히 `계정 탈퇴`가 아니면 `400 BAD_REQUEST`를 반환한다.
- 현재 사용자가 owner인 Workspace가 있으면 `409 CONFLICT`와
  `OWNED_WORKSPACE_EXISTS`를 반환한다.
- 현재 사용자의 모든 `user_sessions`를 revoke한다.
- 현재 사용자의 active GitHub OAuth connection은 token을 revoke/clear하고
  `revoked_at`을 기록한다. GitHub provider raw error나 token은 노출하지 않는다.
- 현재 사용자의 Workspace member membership과 개인 Settings row를 삭제한다.
- `users` row는 domain audit FK를 보존하기 위해 물리 삭제하지 않는다.
- `users.name`은 `탈퇴한 사용자`, email/avatar/provider identity는 `null`,
  `active_workspace_id`는 `null`, `deleted_at`은 현재 시각으로 갱신한다.
- 위 DB 변경은 하나의 transaction에서 처리한다. provider revoke 같은 외부 작업이
  필요하면 실패/재시도 정책을 별도로 적용하고 secret을 로그에 남기지 않는다.
- 성공 응답 뒤 Frontend는 local access token과 선택 Workspace를 삭제하고 로그인
  화면으로 이동한다.
- 익명화 이후 같은 provider로 로그인하면 과거 계정을 복구하지 않고 새 사용자로
  가입한다.

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

- 사용자 검색
- team member 초대
- provider raw profile 조회
- session 발급/갱신 API
- 계정 복구
- 로그인 provider 추가·제거
- 이메일 직접 변경
- 파일 업로드 기반 avatar 변경
