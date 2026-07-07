# Workspace API

## 범위

Workspace API는 PILO 도메인 API가 공유하는 Workspace 경계와 기본 Workspace
조회 기능을 담당한다.

- 현재 사용자가 접근 가능한 Workspace 목록 조회
- Workspace 상세 조회와 접근 확인

Workspace 역할/멤버십과 email 초대 모델은
[workspace-membership-api.md](workspace-membership-api.md)를 따른다.

## 데이터 규칙

- 테이블: `workspaces`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- 이 API는 Workspace 생성 endpoint를 제공하지 않는다.
- MVP에서는 OAuth login callback이 WorkspaceService를 통해 현재 user의 기본
  Workspace와 owner membership을 server-side로 자동 보장한다.
- MVP 임시 정책으로 `owner_user_id`가 있는 Workspace를 user당 하나만 허용한다.
  추후 multi-workspace 또는 membership 모델을 열 때 schema 변경 대상으로 본다.
- Workspace 접근 가능 여부는 app-server의 공통 접근 확인 함수에서 판단한다.
- 기본 접근 기준은 `workspace_members`의 `owner` 또는 `member` membership이다.
- `workspaces.owner_user_id`는 기존 호환과 owner 표시용으로 유지한다.
- Frontend는 `GET /workspaces` 응답에서 선택한 `activeWorkspaceId`를 도메인 API path의
  `workspaceId`로 사용한다.
- 도메인 API는 request body의 `workspaceId`, `userId`를 신뢰하지 않는다.
- Workspace 접근 확인은 각 도메인에서 임시로 구현하지 않고 공통 layer를 사용한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces` | 현재 사용자가 접근 가능한 Workspace 목록 조회 |
| `GET` | `/workspaces/{workspaceId}` | Workspace 상세 조회와 접근 확인 |

## Workspace Payload

```json
{
  "id": "workspace_uuid",
  "name": "PILO-a1b2c3d4",
  "ownerUserId": "user_uuid",
  "role": "owner",
  "isOwner": true,
  "createdAt": "2026-07-04T00:00:00.000Z",
  "updatedAt": "2026-07-04T00:00:00.000Z"
}
```

`isOwner`는 `role === 'owner'` 또는 `ownerUserId === currentUserId`로 계산한다.

## Workspace 목록 조회

```http
GET /api/v1/workspaces
```

응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "workspace_uuid",
      "name": "PILO-a1b2c3d4",
      "ownerUserId": "user_uuid",
      "role": "owner",
      "isOwner": true,
      "createdAt": "2026-07-04T00:00:00.000Z",
      "updatedAt": "2026-07-04T00:00:00.000Z"
    }
  ]
}
```

서버 규칙:

- 현재 사용자가 접근 가능한 Workspace만 반환한다.
- 현재 사용자가 `workspace_members`에서 `owner` 또는 `member`인 Workspace를 반환한다.
- 정렬은 `createdAt ASC`를 기본값으로 한다.
- 정상 로그인 직후 빈 배열이 반환되면 MVP 기본 Workspace 또는 owner membership
  초기화 실패로 본다.

## Workspace 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "workspace_uuid",
    "name": "PILO-a1b2c3d4",
    "ownerUserId": "user_uuid",
    "role": "owner",
    "isOwner": true,
    "createdAt": "2026-07-04T00:00:00.000Z",
    "updatedAt": "2026-07-04T00:00:00.000Z"
  }
}
```

서버 규칙:

- `workspaceId`가 존재하지 않으면 `404 NOT_FOUND`를 반환한다.
- 현재 사용자가 접근할 수 없는 Workspace면 `403 FORBIDDEN`을 반환한다.
- 이 endpoint는 프론트와 도메인 API가 Workspace 접근 가능 여부를 확인하는 기준으로 사용할 수 있다.

## 도메인 API 사용 규칙

모든 `/workspaces/{workspaceId}/...` 도메인 API는 요청 처리 전에 공통
Workspace 접근 확인을 수행한다.

도메인 record를 조회할 때는 id만으로 조회하지 않고 path의 `workspaceId`와 함께
검증한다.

예:

```sql
WHERE id = :resourceId
  AND workspace_id = :workspaceId
```

## Validation

| 규칙 | 조건 |
| --- | --- |
| ownerUserId | request body로 받지 않음 |
| 접근 확인 | 모든 Workspace path API에서 필수 |

## MVP 제외

- 수동 Workspace 생성
- Workspace 삭제
- Workspace 이름 수정
- Workspace 소유권 이전
- admin role
- read-only role 판정
