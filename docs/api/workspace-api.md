# Workspace API

## 범위

Workspace API는 PILO 도메인 API가 공유하는 Workspace 경계와 기본 Workspace
조회 기능을 담당한다.

- 현재 사용자가 접근 가능한 Workspace 목록 조회
- Workspace 생성
- Workspace 상세 조회와 접근 확인

Workspace 역할/멤버십 세부 모델은 MVP 이후 별도 명세로 다룬다.

## 데이터 규칙

- 테이블: `workspaces`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- 새 Workspace의 `owner_user_id`는 현재 로그인 사용자에서 온다.
- 현재 baseline schema에는 `workspace_members` 테이블이 없다.
- MVP에서 Workspace 접근 가능 여부는 app-server의 공통 접근 확인 함수에서 판단한다.
- membership schema가 추가되기 전까지 기본 접근 기준은 `workspaces.owner_user_id = currentUserId`이다.
- 도메인 API는 request body의 `workspaceId`, `userId`를 신뢰하지 않는다.
- Workspace 접근 확인은 각 도메인에서 임시로 구현하지 않고 공통 layer를 사용한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces` | 현재 사용자가 접근 가능한 Workspace 목록 조회 |
| `POST` | `/workspaces` | Workspace 생성 |
| `GET` | `/workspaces/{workspaceId}` | Workspace 상세 조회와 접근 확인 |

## Workspace Payload

```json
{
  "id": "workspace_uuid",
  "name": "PILO Team",
  "ownerUserId": "user_uuid",
  "isOwner": true,
  "createdAt": "2026-07-04T00:00:00.000Z",
  "updatedAt": "2026-07-04T00:00:00.000Z"
}
```

`isOwner`는 `ownerUserId === currentUserId`로 계산한다.

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
      "name": "PILO Team",
      "ownerUserId": "user_uuid",
      "isOwner": true,
      "createdAt": "2026-07-04T00:00:00.000Z",
      "updatedAt": "2026-07-04T00:00:00.000Z"
    }
  ]
}
```

서버 규칙:

- 현재 사용자가 접근 가능한 Workspace만 반환한다.
- membership schema가 추가되기 전까지는 현재 사용자가 owner인 Workspace를 반환한다.
- 정렬은 `createdAt ASC`를 기본값으로 한다.

## Workspace 생성

```json
{
  "name": "PILO Team"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "workspace_uuid",
    "name": "PILO Team",
    "ownerUserId": "user_uuid",
    "isOwner": true,
    "createdAt": "2026-07-04T00:00:00.000Z",
    "updatedAt": "2026-07-04T00:00:00.000Z"
  }
}
```

서버 규칙:

- `ownerUserId`는 request body로 받지 않는다.
- `owner_user_id`는 현재 로그인 사용자로 저장한다.
- 생성 성공 시 `201 Created`를 반환한다.

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
    "name": "PILO Team",
    "ownerUserId": "user_uuid",
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
| Workspace 이름 | 빈 문자열 불가 |
| Workspace 이름 길이 | 최대 100자 |
| ownerUserId | request body로 받지 않음 |
| 접근 확인 | 모든 Workspace path API에서 필수 |

## MVP 제외

- Workspace 멤버 초대
- Workspace member 목록
- Workspace role 변경
- Workspace 삭제
- Workspace 이름 수정
- Workspace 소유권 이전
- read-only role 판정
