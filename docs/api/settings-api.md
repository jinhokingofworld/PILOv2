# Settings API

## 범위

Settings API는 현재 로그인 사용자의 PILO 개인 환경설정을 조회하고 수정한다.

- 기본 Workspace와 로그인 후 시작 화면
- 마지막 Workspace 복원 여부
- theme과 화면 밀도

프로필 조회와 계정 정보 수정·탈퇴는 [User API](user-api.md)를 따른다.
Workspace 이름·아이콘 수정과 삭제는 [Workspace API](workspace-api.md)를 따른다.
GitHub OAuth와 GitHub App installation 관리는
[GitHub Integration API](github-integration-api.md)를 사용하며 Settings API가 새
provider 계약을 만들지 않는다.

## 데이터 규칙

- 테이블: `user_settings`
- 한 사용자당 최대 한 row를 사용하며 `user_settings.user_id`가 primary key다.
- 설정 row가 없는 사용자는 이 문서의 기본값을 반환한다.
- `PATCH /me/settings` 첫 성공 시 row를 upsert한다.
- 현재 사용자는 bearer session에서 얻으며 `userId`를 body나 query로 받지 않는다.
- `defaultWorkspaceId`는 현재 사용자가 owner 또는 member인 Workspace만 허용한다.
- Workspace가 삭제되면 FK의 `ON DELETE SET NULL`에 따라
  `default_workspace_id`가 자동으로 비워진다.
- Supabase public 접근은 all-deny RLS를 유지하고 app-server가 서버 권한으로
  조회·수정한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me/settings` | 현재 사용자의 개인 환경설정 조회 |
| `PATCH` | `/me/settings` | 현재 사용자의 개인 환경설정 일부 수정 |

## Settings Payload

```json
{
  "theme": "system",
  "density": "comfortable",
  "defaultWorkspaceId": "workspace_uuid",
  "defaultLandingPage": "home",
  "restoreLastWorkspace": true,
  "createdAt": "2026-07-13T00:00:00.000Z",
  "updatedAt": "2026-07-13T00:00:00.000Z"
}
```

설정 row가 아직 없으면 `createdAt`, `updatedAt`은 `null`이다.

```json
{
  "theme": "system",
  "density": "comfortable",
  "defaultWorkspaceId": null,
  "defaultLandingPage": "home",
  "restoreLastWorkspace": true,
  "createdAt": null,
  "updatedAt": null
}
```

## 개인 환경설정 조회

```http
GET /api/v1/me/settings
Authorization: Bearer <pilo_access_token>
```

응답:

```json
{
  "success": true,
  "data": {
    "theme": "dark",
    "density": "compact",
    "defaultWorkspaceId": "workspace_uuid",
    "defaultLandingPage": "board",
    "restoreLastWorkspace": true,
    "createdAt": "2026-07-13T00:00:00.000Z",
    "updatedAt": "2026-07-13T00:10:00.000Z"
  }
}
```

서버 규칙:

- access token이 없거나 유효하지 않으면 `401 UNAUTHORIZED`를 반환한다.
- `user_settings` row가 없으면 기본값 payload를 반환하고 조회만으로 row를 만들지
  않는다.
- 저장된 `defaultWorkspaceId`에 현재 사용자가 더 이상 접근할 수 없으면 응답에서
  `null`로 정규화하고 저장값도 비운다.

## 개인 환경설정 수정

```http
PATCH /api/v1/me/settings
Authorization: Bearer <pilo_access_token>
Content-Type: application/json
```

Request Body:

```json
{
  "theme": "dark",
  "density": "compact",
  "defaultWorkspaceId": "workspace_uuid",
  "defaultLandingPage": "board",
  "restoreLastWorkspace": true
}
```

모든 필드는 optional이며 전달한 필드만 수정한다. 단, body에는 지원 필드가 하나
이상 있어야 한다.

응답:

```json
{
  "success": true,
  "data": {
    "theme": "dark",
    "density": "compact",
    "defaultWorkspaceId": "workspace_uuid",
    "defaultLandingPage": "board",
    "restoreLastWorkspace": true,
    "createdAt": "2026-07-13T00:00:00.000Z",
    "updatedAt": "2026-07-13T00:10:00.000Z"
  }
}
```

서버 규칙:

- 지원하지 않는 field가 있으면 `400 BAD_REQUEST`를 반환한다.
- body가 없거나 지원 필드가 하나도 없으면 `400 BAD_REQUEST`를 반환한다.
- validation이 끝난 뒤 현재 사용자 기준으로 `user_settings`를 upsert한다.
- `defaultWorkspaceId`가 문자열이면 UUID여야 하고 현재 사용자가 해당 Workspace의
  owner 또는 member여야 한다.
- 접근할 수 없는 Workspace를 기본값으로 지정하면 `403 FORBIDDEN`을 반환한다.
- `defaultWorkspaceId: null`은 기본 Workspace 설정을 비운다.
- 수정 성공 시 전체 Settings payload를 반환한다.

## Validation

| Field | 허용값/규칙 |
| --- | --- |
| `theme` | `system`, `light`, `dark` |
| `density` | `comfortable`, `compact` |
| `defaultWorkspaceId` | `null` 또는 접근 가능한 Workspace UUID |
| `defaultLandingPage` | `home`, `calendar`, `github`, `board`, `pr-review`, `meeting`, `canvas`, `files`, `sql-erd`, `last` |
| `restoreLastWorkspace` | boolean |

## Frontend 적용 규칙

- Settings Dialog를 열 때 `GET /me/settings`로 초기화한다.
- 저장 중에는 중복 요청을 막고 성공/실패 상태를 표시한다.
- `theme`, `density`는 저장 성공 후 전역 shell에 즉시 반영한다.
- `defaultWorkspaceId`와 `defaultLandingPage`는 다음 로그인/진입부터 사용한다.
- `defaultLandingPage=last`이면 Frontend가 마지막 정상 Workspace route를 사용하고,
  저장된 route가 없거나 접근할 수 없으면 `/home`으로 이동한다.
- `restoreLastWorkspace=true`이면 접근 가능한 마지막 Workspace를 우선 사용하고,
  아니면 `defaultWorkspaceId`, 첫 번째 접근 가능 Workspace 순서로 선택한다.

## 범위 제외

- GitHub OAuth/App installation 연결 구현
- AI 답변 개인화
- 활동 상태와 presence 공개 설정
- 이메일/마지막 활동 개인정보 공개 설정
- 접근성 설정
- 알림 발송 설정
- 파일 업로드 기반 avatar 변경
