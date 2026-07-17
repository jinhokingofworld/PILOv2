# Workspace Membership API

## 범위

Workspace Membership API는 PILO의 Workspace 접근 권한, owner/member 역할, email
초대 MVP 흐름을 담당한다.

- Workspace member 목록 조회
- owner의 member 초대 생성
- 초대 token 조회, 대상 user의 수락과 거절
- member 제거
- Workspace 접근 기준을 `workspace_members` membership으로 판단

Workspace 생성 계약은 [workspace-api.md](workspace-api.md)를 따른다. Workspace 삭제,
이름 수정, owner transfer, admin/viewer/read-only role, 실제 email 발송 인프라는 이
문서의 범위가 아니다.

## 핵심 정책

- MVP role은 `owner`, `member` 두 개만 둔다.
- `admin`, `viewer`, `read-only` role은 만들지 않는다.
- `workspaces.owner_user_id`는 제거하지 않고 기존 호환과 owner 표시용으로 유지한다.
- 실제 Workspace 접근 기준은 `workspace_members` membership이다.
- 한 user는 여러 Workspace에서 `owner` membership을 가질 수 있다.
- owner는 Workspace 관리, member 초대/제거, GitHub installation 연결/해제 같은
  관리 작업을 수행할 수 있다.
- member는 Workspace 내부 데이터 read/write와 Workspace member 목록 조회가
  가능하다.
- member는 Workspace 관리, member 초대/제거, GitHub installation 관리 작업을
  수행할 수 없다.
- GitHub OAuth token은 user 소유로 유지한다.
- GitHub installation, repository, project sync 데이터는 Workspace 소유 모델을
  유지한다.
- PR Review 제출은 Workspace 공유 여부와 별개로 현재 사용자의 GitHub App user
  OAuth token 기준으로 수행한다.

## 데이터 규칙

### `workspace_members`

`workspace_members`는 Workspace 접근 권한의 source of truth다.

| 컬럼 | 타입 | 필요 이유 |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | membership row 식별자 |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | 어떤 Workspace의 member인지 식별 |
| `user_id` | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 어떤 사용자가 member인지 식별 |
| `role` | `TEXT NOT NULL` | `owner`와 `member` 권한 구분 |
| `invited_by_user_id` | `UUID REFERENCES users(id) ON DELETE SET NULL` | 초대로 참여한 member의 초대한 사용자 기록 |
| `joined_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | 실제 Workspace 참여 시점 |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | row 생성 시점 |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | role 또는 관리 정보 변경 시점 |

제약:

- `CHECK (role IN ('owner', 'member'))`
- `UNIQUE (workspace_id, user_id)`
- `INDEX (user_id)`
- `INDEX (workspace_id, role)`
- baseline all-deny RLS를 활성화한다. 별도 client policy를 추가하기 전까지
  app-server가 서버 권한으로 접근한다.

### `workspace_invitations`

`workspace_invitations`는 owner가 email로 member를 초대하는 pending 흐름을
관리한다.

| 컬럼 | 타입 | 필요 이유 |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | invitation row 식별자 |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | 어느 Workspace 초대인지 식별 |
| `email` | `VARCHAR(320) NOT NULL` | 초대 대상 email. 저장 전 trim/lowercase normalize |
| `role` | `TEXT NOT NULL DEFAULT 'member'` | MVP 초대 role. member만 허용 |
| `token_hash` | `TEXT NOT NULL` | 초대 token 검증용 hash. token 원문은 저장하지 않음 |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | `pending`, `accepted`, `revoked`, `expired` 상태 관리 |
| `invited_by_user_id` | `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT` | 초대를 생성한 owner 기록 |
| `accepted_by_user_id` | `UUID REFERENCES users(id) ON DELETE SET NULL` | 초대를 수락한 user 기록 |
| `revoked_by_user_id` | `UUID REFERENCES users(id) ON DELETE SET NULL` | 초대를 거절한 대상 user 기록 |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | 초대 만료 기준 |
| `accepted_at` | `TIMESTAMPTZ` | 초대 수락 시점 |
| `revoked_at` | `TIMESTAMPTZ` | 대상 user가 초대를 거절한 시점 |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | 초대 생성 시점 |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | 상태 변경 시점 |

제약:

- `CHECK (role = 'member')`
- `CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))`
- `UNIQUE (token_hash)`
- partial unique index: `UNIQUE (workspace_id, email) WHERE status = 'pending'`
- `INDEX (workspace_id, status)`
- `INDEX (expires_at)`
- baseline all-deny RLS를 활성화한다. 별도 client policy를 추가하기 전까지
  app-server가 서버 권한으로 접근한다.

## API 목록

| Method | Endpoint | 인증 | 설명 |
| --- | --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/members` | owner/member | Workspace member 목록 조회 |
| `DELETE` | `/workspaces/{workspaceId}/members/me` | member | 현재 사용자가 Workspace 나가기 |
| `DELETE` | `/workspaces/{workspaceId}/members/{userId}` | owner | Workspace member 제거 |
| `GET` | `/workspaces/{workspaceId}/invitations` | owner | Workspace 초대 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/invitations` | owner | member 초대 생성 |
| `GET` | `/me/workspace-invitations` | bearer session | 현재 user email로 받은 pending 초대 목록 조회 |
| `POST` | `/me/workspace-invitations/{invitationId}/accept` | bearer session | 현재 user가 받은 초대를 token 없이 수락 |
| `POST` | `/me/workspace-invitations/{invitationId}/reject` | bearer session | 현재 user가 받은 pending 초대를 거절 |
| `GET` | `/workspace-invitations/{invitationToken}` | bearer session | 초대 token 조회 |
| `POST` | `/workspace-invitations/{invitationToken}/accept` | bearer session | 초대 수락 |

Endpoint 표는 공통 API 문서 규칙에 따라 `/api/v1` base path를 생략한다.

## 공통 Payload

### Workspace Payload

Workspace 조회 API의 payload에는 현재 사용자의 role이 포함된다.

```json
{
  "id": "workspace_uuid",
  "name": "PILO-a1b2c3d4",
  "icon": "🚀",
  "ownerUserId": "user_uuid",
  "role": "owner",
  "isOwner": true,
  "createdAt": "2026-07-04T00:00:00.000Z",
  "updatedAt": "2026-07-04T00:00:00.000Z"
}
```

`isOwner`는 `role === 'owner'` 또는 `ownerUserId === currentUserId`일 때
`true`로 계산한다. 정상 migration 이후 접근 권한 판단은 `role` 기준으로 수행한다.

### Member Payload

```json
{
  "id": "membership_uuid",
  "workspaceId": "workspace_uuid",
  "userId": "user_uuid",
  "role": "member",
  "invitedByUserId": "owner_user_uuid",
  "joinedAt": "2026-07-07T00:00:00.000Z",
  "createdAt": "2026-07-07T00:00:00.000Z",
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "user": {
    "id": "user_uuid",
    "name": "PILO User",
    "jobTitle": "Frontend Developer",
    "bio": "PILO 프로젝트를 개발하고 있습니다.",
    "email": "member@example.com",
    "avatarUrl": null,
    "activeWorkspaceId": "workspace_uuid",
    "lastSeenAt": "2026-07-09T06:00:00.000Z"
  }
}
```

`name`, `jobTitle`, `bio`, `avatarUrl`은 User API와 같은 profile override 및 fallback
규칙을 사용한다. `activeWorkspaceId`와 `lastSeenAt`은 Home 멤버 presence 표시용
필드다. 같은 Workspace를 보고 있는지 판단하기 위해 사용하며, 실시간 접속
보장값은 아니다.

### Invitation Payload

초대 목록과 상세 응답은 token 원문을 포함하지 않는다.

```json
{
  "id": "invitation_uuid",
  "workspaceId": "workspace_uuid",
  "email": "member@example.com",
  "role": "member",
  "status": "pending",
  "invitedByUserId": "owner_user_uuid",
  "acceptedByUserId": null,
  "revokedByUserId": null,
  "expiresAt": "2026-07-14T00:00:00.000Z",
  "acceptedAt": null,
  "revokedAt": null,
  "createdAt": "2026-07-07T00:00:00.000Z",
  "updatedAt": "2026-07-07T00:00:00.000Z"
}
```

## Member 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/members
```

응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "membership_uuid",
      "workspaceId": "workspace_uuid",
      "userId": "owner_user_uuid",
      "role": "owner",
      "invitedByUserId": null,
      "joinedAt": "2026-07-04T00:00:00.000Z",
      "createdAt": "2026-07-04T00:00:00.000Z",
      "updatedAt": "2026-07-04T00:00:00.000Z",
      "user": {
        "id": "owner_user_uuid",
        "name": "Owner",
        "jobTitle": "Product Owner",
        "bio": "Workspace를 운영하고 있습니다.",
        "email": "owner@example.com",
        "avatarUrl": null,
        "activeWorkspaceId": "workspace_uuid",
        "lastSeenAt": "2026-07-09T06:00:00.000Z"
      }
    }
  ]
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 owner 또는 member가 아니면 `403 FORBIDDEN`을 반환한다.
- 정렬은 `role ASC`, `joinedAt ASC`를 기본값으로 한다. owner가 먼저 보이도록
  구현해도 된다.
- member 목록은 같은 Workspace에 속한 사용자에게 공개할 수 있다. 초대/제거 같은
  관리 작업은 owner-only로 유지한다.
- 응답의 `user.activeWorkspaceId`가 요청한 `workspaceId`와 같으면 Home에서는 온라인으로 표시할 수 있다.
- `user.activeWorkspaceId`가 다르거나 `null`이면 Home에서는 오프라인으로 표시할 수 있다.

## Member 제거

```http
DELETE /api/v1/workspaces/{workspaceId}/members/{userId}
```

응답:

```json
{
  "success": true,
  "data": {
    "removed": true
  }
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 owner가 아니면 `403 FORBIDDEN`을 반환한다.
- 제거 대상이 존재하지 않으면 `404 NOT_FOUND`를 반환한다.
- `owner` membership은 이 endpoint로 제거할 수 없다.
- 마지막 owner 제거는 허용하지 않는다.
- member 제거는 `workspace_members` row delete로 처리한다.

## Workspace 나가기

```http
DELETE /api/v1/workspaces/{workspaceId}/members/me
```

응답:

```json
{
  "success": true,
  "data": {
    "removed": true
  }
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 member가 아니면 `403 FORBIDDEN`을 반환한다.
- 현재 사용자가 해당 Workspace의 owner이면 `400 BAD_REQUEST`를 반환한다.
- 나가기는 현재 bearer session user의 `workspace_members` row delete로 처리한다.
- 나가기 후 접근 가능한 Workspace가 없으면 사용자는 onboarding 필요 상태가 될 수
  있다. 서버가 기본 Workspace를 자동 생성하지 않는다.

## Membership 제거 후 Realtime 접근 회수

member 제거, Workspace 나가기, 계정 탈퇴는 membership delete와 같은 transaction 안에
`workspace_membership_revocation_outbox` delivery intent를 만든다. commit 뒤 publisher는
intent를 claim해 `workspace:membership-revocations` internal Redis channel에 exact V1
`membership.revoked` event를 발행한다. Event에는 UUID `workspaceId`, UUID `userId`,
canonical ISO `occurredAt`이 포함된다.

Redis 연결 또는 publish가 실패하면 outbox intent는 `pending`으로 되돌아가 bounded
backoff로 재시도한다. claim lease가 만료된 `publishing` intent도 다시 claim할 수 있다.
따라서 Redis 실패는 이미 commit된 membership 제거를 rollback하거나 성공 API 응답을
바꾸지 않으며, transaction이 실패한 경우에는 delivery intent와 event가 모두 남지
않는다.

Realtime Server는 event를 받으면 해당 사용자의 모든 Chat tab을 Workspace Chat room과
target user room에서 제거한다. 같은 event를 SQLtoERD handler에도 전달해 해당
Workspace의 모든 SQLtoERD room과 in-memory presence를 정리하고, 사용자가 보유한
`sql_erd_session_source_locks` row를 즉시 삭제한다. SQLtoERD socket은 같은 연결에서
철회된 Workspace에 다시 join하거나 presence를 전송할 수 없다. 다른 사용자와 다른
Workspace의 room·presence·source lock은 유지한다. room leave가 하나라도 실패하면
해당 socket을 강제 종료한다. Meeting Socket.IO room과 Workspace presence도 같은 event로
정리한다. 철회 event가 DB membership 확인과 room join 사이에 도착하면 Realtime Server는
socket/workspace fence를 기록해 진행 중인 Meeting·presence join을 rollback하고 이후
event를 거부한다.
Redis event가 유실되어도 Chat fan-out 직전의 batch membership recheck가 제거된 사용자의
수신을 차단한다. SQLtoERD의 HTTP operation, source lock, source publish 경로는 각
요청에서 Workspace membership을 다시 검증한다.

## 초대 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/invitations
```

응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "invitation_uuid",
      "workspaceId": "workspace_uuid",
      "email": "member@example.com",
      "role": "member",
      "status": "pending",
      "invitedByUserId": "owner_user_uuid",
      "acceptedByUserId": null,
      "revokedByUserId": null,
      "expiresAt": "2026-07-14T00:00:00.000Z",
      "acceptedAt": null,
      "revokedAt": null,
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    }
  ]
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 owner가 아니면 `403 FORBIDDEN`을 반환한다.
- token 원문과 `token_hash`는 응답하지 않는다.
- 만료 시간이 지난 pending 초대는 조회 시 `expired`로 전환할 수 있다.

## 초대 생성

```http
POST /api/v1/workspaces/{workspaceId}/invitations
```

Request Body:

```json
{
  "email": "member@example.com",
  "role": "member"
}
```

`role`은 optional이다. 값이 없으면 `member`로 처리한다. MVP에서 `member`가 아닌
role은 `400 BAD_REQUEST`를 반환한다.

응답:

```json
{
  "success": true,
  "data": {
    "invitation": {
      "id": "invitation_uuid",
      "workspaceId": "workspace_uuid",
      "email": "member@example.com",
      "role": "member",
      "status": "pending",
      "invitedByUserId": "owner_user_uuid",
      "acceptedByUserId": null,
      "revokedByUserId": null,
      "expiresAt": "2026-07-14T00:00:00.000Z",
      "acceptedAt": null,
      "revokedAt": null,
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    },
    "invitationToken": "raw-invitation-token-returned-once",
    "acceptUrl": "https://pilo.app/invitations/accept?token=raw-invitation-token-returned-once"
  }
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 owner가 아니면 `403 FORBIDDEN`을 반환한다.
- email은 trim/lowercase normalize 후 저장한다.
- token은 충분히 긴 random 값으로 생성하고, DB에는 `token_hash`만 저장한다.
- token 원문은 초대 생성 응답에서 한 번만 반환한다.
- 같은 Workspace와 email에 pending 초대가 있으면 `400 BAD_REQUEST`를 반환한다.
- email과 일치하는 user가 이미 같은 Workspace member이면 `400 BAD_REQUEST`를 반환한다.
- 실제 email 발송은 MVP 범위가 아니다. Frontend는 `acceptUrl`을 copy/share할 수 있다.
- 생성된 pending 초대는 owner가 취소할 수 없으며, 대상 user가 수락하거나 거절하거나
  만료될 때까지 유지한다.

## 내 pending 초대 거절

```http
POST /api/v1/me/workspace-invitations/{invitationId}/reject
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "invitation_uuid",
    "workspaceId": "workspace_uuid",
    "email": "member@example.com",
    "role": "member",
    "status": "revoked",
    "invitedByUserId": "owner_user_uuid",
    "acceptedByUserId": null,
    "revokedByUserId": "member_user_uuid",
    "expiresAt": "2026-07-14T00:00:00.000Z",
    "acceptedAt": null,
    "revokedAt": "2026-07-07T01:00:00.000Z",
    "createdAt": "2026-07-07T00:00:00.000Z",
    "updatedAt": "2026-07-07T01:00:00.000Z"
  }
}
```

서버 규칙:

- bearer session이 없으면 `401 UNAUTHORIZED`를 반환한다.
- invitation id와 일치하는 초대가 없으면 `404 NOT_FOUND`를 반환한다.
- pending 초대만 거절할 수 있다.
- 현재 user의 email이 초대 email과 일치하지 않으면 `403 FORBIDDEN`을 반환한다.
- 거절 시 `status = 'revoked'`, `revoked_by_user_id = current user`,
  `revoked_at = now()`를 기록한다.

## 내 pending 초대 목록 조회

```http
GET /api/v1/me/workspace-invitations
```

응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "invitation_uuid",
      "workspaceId": "workspace_uuid",
      "workspaceName": "PILO-a1b2c3d4",
      "email": "member@example.com",
      "role": "member",
      "status": "pending",
      "invitedByUserId": "owner_user_uuid",
      "expiresAt": "2026-07-14T00:00:00.000Z",
      "createdAt": "2026-07-07T00:00:00.000Z"
    }
  ]
}
```

서버 규칙:

- bearer session이 없으면 `401 UNAUTHORIZED`를 반환한다.
- 현재 user의 `users.email`과 초대 email이 일치하는 pending 초대만 반환한다.
- 이미 현재 user가 해당 Workspace member이면 목록에서 제외한다.
- 만료 시간이 지난 pending 초대는 `expired`로 전환하고 목록에서 제외한다.
- 응답에는 token 원문과 `token_hash`를 포함하지 않는다.

## 내 pending 초대 수락

```http
POST /api/v1/me/workspace-invitations/{invitationId}/accept
```

응답 payload는 token 기반 `POST /workspace-invitations/{invitationToken}/accept`와 같다.

서버 규칙:

- bearer session이 없으면 `401 UNAUTHORIZED`를 반환한다.
- invitation id와 일치하는 초대가 없으면 `404 NOT_FOUND`를 반환한다.
- pending 초대만 수락할 수 있다.
- 현재 user의 email이 초대 email과 일치하지 않으면 `403 FORBIDDEN`을 반환한다.
- 이미 같은 Workspace member이면 `400 BAD_REQUEST`를 반환한다.
- 수락은 transaction으로 처리한다.

## 초대 token 조회

```http
GET /api/v1/workspace-invitations/{invitationToken}
```

응답:

```json
{
  "success": true,
  "data": {
    "workspaceId": "workspace_uuid",
    "workspaceName": "PILO-a1b2c3d4",
    "email": "member@example.com",
    "role": "member",
    "status": "pending",
    "expiresAt": "2026-07-14T00:00:00.000Z"
  }
}
```

서버 규칙:

- bearer session이 없으면 `401 UNAUTHORIZED`를 반환한다.
- token hash와 일치하는 초대가 없으면 `404 NOT_FOUND`를 반환한다.
- revoked 초대는 `400 BAD_REQUEST`를 반환한다.
- 만료 시간이 지난 pending 초대는 `expired`로 전환한 뒤 `400 BAD_REQUEST`를
  반환한다.
- 응답에는 token 원문과 `token_hash`를 포함하지 않는다.

## 초대 수락

```http
POST /api/v1/workspace-invitations/{invitationToken}/accept
```

응답:

```json
{
  "success": true,
  "data": {
    "workspace": {
      "id": "workspace_uuid",
      "name": "PILO-a1b2c3d4",
      "icon": "🚀",
      "ownerUserId": "owner_user_uuid",
      "role": "member",
      "isOwner": false,
      "createdAt": "2026-07-04T00:00:00.000Z",
      "updatedAt": "2026-07-04T00:00:00.000Z"
    },
    "membership": {
      "id": "membership_uuid",
      "workspaceId": "workspace_uuid",
      "userId": "member_user_uuid",
      "role": "member",
      "invitedByUserId": "owner_user_uuid",
      "joinedAt": "2026-07-07T00:00:00.000Z",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    }
  }
}
```

서버 규칙:

- bearer session이 없으면 `401 UNAUTHORIZED`를 반환한다.
- token hash와 일치하는 초대가 없으면 `404 NOT_FOUND`를 반환한다.
- pending 초대만 수락할 수 있다.
- 현재 user의 email이 초대 email과 일치하지 않으면 `403 FORBIDDEN`을 반환한다.
- 이미 같은 Workspace member이면 `400 BAD_REQUEST`를 반환한다.
- 수락은 transaction으로 처리한다.
  - `workspace_members`에 `member` row를 생성한다.
  - `workspace_invitations.status`를 `accepted`로 변경한다.
  - `accepted_by_user_id`, `accepted_at`을 기록한다.
- 같은 Workspace와 user의 membership 중복은 DB unique 제약으로도 방지한다.

## Workspace 접근 확인 규칙

모든 `/workspaces/{workspaceId}/...` 도메인 API는 request body의 `workspaceId`,
`userId`를 신뢰하지 않는다. path의 `workspaceId`와 현재 bearer session의 user를
기준으로 `workspace_members`를 조회한다.

일반 Workspace 내부 기능은 `owner` 또는 `member`이면 통과한다.

owner-only 기능은 `role = 'owner'`일 때만 통과한다.

owner-only 기능:

- Workspace member 초대 생성
- Workspace member 제거
- GitHub App installation 연결/해제
- GitHub 수동 sync 같은 Workspace 관리 작업

owner/member 공통 조회 기능:

- Workspace member 목록 조회

member self-service 기능:

- Workspace 나가기

## 로그인 후 Workspace onboarding

OAuth login callback은 user row와 bearer session을 생성하거나 갱신하지만 Workspace를
자동 생성하지 않는다.

처리 규칙:

- 로그인 후 `GET /workspaces`가 빈 배열을 반환하는 것은 정상 상태다.
- Frontend는 빈 배열을 onboarding 필요 상태로 처리한다.
- 사용자가 이름을 입력해 `POST /workspaces`를 호출하면 Workspace와 현재 user의
  `workspace_members(owner)` row를 transaction으로 생성한다.
- 기존 Workspace가 있는 user도 `POST /workspaces`로 추가 owner Workspace를 생성할 수
  있다.
- GitHub Integration 연결 여부는 Workspace 및 owner membership 생성의 선행 조건이
  아니다.

## 에러 규칙

| 조건 | Status | Code |
| --- | --- | --- |
| bearer session 없음 또는 만료 | `401` | `UNAUTHORIZED` |
| Workspace 접근 권한 없음 | `403` | `FORBIDDEN` |
| owner-only 기능을 member가 호출 | `403` | `FORBIDDEN` |
| Workspace, member, invitation 없음 | `404` | `NOT_FOUND` |
| 지원하지 않는 role | `400` | `BAD_REQUEST` |
| 중복 pending 초대 | `400` | `BAD_REQUEST` |
| 이미 member인 email 초대 | `400` | `BAD_REQUEST` |
| revoked/expired/accepted 초대 수락 또는 거절 | `400` | `BAD_REQUEST` |
| 초대 email과 현재 user email 불일치 | `403` | `FORBIDDEN` |

## MVP 제외

- admin role
- viewer/read-only role
- owner transfer
- 여러 owner 정책
- Workspace 삭제/이름 수정
- 실제 email 발송 인프라
- public link share
- realtime 협업 권한 모델
- GitHub Integration의 ownership 모델 변경
- PR Review 제출 token 정책 변경
