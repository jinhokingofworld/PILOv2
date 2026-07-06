# Auth API

PILO 로그인과 bearer session 발급 API를 정의한다.

이 문서의 GitHub OAuth는 PILO 로그인용이다. GitHub 로그인 callback은 사용자
식별과 session 발급에 필요한 profile만 저장하고, GitHub App 연동용 OAuth
token 컬럼은 갱신하지 않는다.

GitHub App installation lookup, GitHub 원본 조회, GitHub Review 제출에 필요한
사용자 GitHub OAuth 연결은 GitHub Integration API의 `/me/github/oauth/start`
흐름에서 완료한다.

## 공통 규칙

- Base URL: `/api/v1`
- session token은 `Authorization: Bearer <pilo_access_token>`으로 사용한다.
- session token 원문은 DB에 저장하지 않고 `user_sessions.token_hash`만 저장한다.
- OAuth callback URL은 `API_PUBLIC_ORIGIN + API_BASE_PATH` 기준으로 만든다.
- OAuth 성공 후 frontend `/login/callback`으로 redirect하며 token은 URL fragment에만 담는다.
- MVP에서는 OAuth callback이 로그인 직후 서비스 진입을 위해 현재 user의 기본
  Workspace를 보장한다. 단, AuthService는 `workspaces`를 직접 insert하지 않고
  WorkspaceService의 기본 Workspace 보장 메서드에 위임한다.
- Workspace 선택은 frontend가 `GET /workspaces` 응답에서 `activeWorkspaceId`를
  결정한 뒤 도메인 API path에 넘기는 방식으로 처리한다.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Google 로그인 OAuth client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google 로그인 OAuth client secret |
| `GITHUB_LOGIN_CLIENT_ID` | GitHub 로그인 OAuth client id |
| `GITHUB_LOGIN_CLIENT_SECRET` | GitHub 로그인 OAuth client secret |
| `SESSION_SECRET` | OAuth state 서명 secret |
| `AUTH_SESSION_TTL_SECONDS` | bearer session 만료 시간. 기본값 30일 |
| `OAUTH_STATE_TTL_SECONDS` | OAuth state 만료 시간. 기본값 10분 |
| `FRONTEND_URL` | 로그인 성공/실패 후 돌아갈 frontend origin |
| `API_PUBLIC_ORIGIN` | OAuth provider에 등록된 callback origin |
| `API_BASE_PATH` | API base path. 기본값 `/api/v1` |

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `POST` | `/auth/google/start` | Google 로그인 시작 |
| `GET` | `/auth/google/callback` | Google OAuth callback 처리 |
| `POST` | `/auth/github/start` | GitHub 로그인 시작 |
| `GET` | `/auth/github/callback` | GitHub OAuth callback 처리 |
| `POST` | `/auth/logout` | 현재 bearer session revoke |

## Google 로그인 시작

| 항목 | 내용 |
| --- | --- |
| Method | `POST` |
| Endpoint | `/auth/google/start` |

### Request Body

```json
{
  "returnUrl": "/calendar"
}
```

`returnUrl`은 optional이다. 값이 있으면 frontend 내부 path 또는 `FRONTEND_URL`
origin의 URL이어야 한다.

### Response Body

```json
{
  "success": true,
  "data": {
    "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "state": "signed-state"
  }
}
```

## Google OAuth Callback

| 항목 | 내용 |
| --- | --- |
| Method | `GET` |
| Endpoint | `/auth/google/callback` |

### Query Params

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `code` | Y | Google authorization code |
| `state` | Y | 로그인 시작 시 발급한 signed state |

### 성공 처리

서버는 Google profile 기준으로 `users` row를 생성하거나 갱신하고,
WorkspaceService를 통해 MVP 기본 Workspace를 보장한 뒤 `user_sessions` row를
생성하고 frontend로 redirect한다.

```text
{FRONTEND_URL}/login/callback#access_token=<pilo_access_token>&expires_at=<iso>&return_to=/calendar
```

## GitHub 로그인 시작

| 항목 | 내용 |
| --- | --- |
| Method | `POST` |
| Endpoint | `/auth/github/start` |

### Request Body

```json
{
  "returnUrl": "/calendar"
}
```

### Response Body

```json
{
  "success": true,
  "data": {
    "authorizeUrl": "https://github.com/login/oauth/authorize?...",
    "state": "signed-state"
  }
}
```

## GitHub OAuth Callback

| 항목 | 내용 |
| --- | --- |
| Method | `GET` |
| Endpoint | `/auth/github/callback` |

### Query Params

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `code` | Y | GitHub authorization code |
| `state` | Y | 로그인 시작 시 발급한 signed state |

### 성공 처리

서버는 GitHub profile 기준으로 `users` row를 생성하거나 갱신한다. GitHub
login OAuth access token은 profile 조회에만 사용하고 DB에 저장하지 않는다.
이후 WorkspaceService를 통해 MVP 기본 Workspace를 보장한 뒤 `user_sessions`
row를 생성하고 frontend로 redirect한다.

GitHub login OAuth scope는 `read:user user:email`을 요청한다.
`users.github_user_id`, `github_login`, 이름, 이메일, avatar만 로그인 profile
동기화 대상으로 사용한다. `github_access_token_encrypted`, `github_token_scope`,
`github_connected_at`, `github_revoked_at`은 GitHub Integration API의 GitHub
App user OAuth 연결 상태로만 갱신한다.

```text
{FRONTEND_URL}/login/callback#access_token=<pilo_access_token>&expires_at=<iso>&return_to=/calendar
```

## Logout

| 항목 | 내용 |
| --- | --- |
| Method | `POST` |
| Endpoint | `/auth/logout` |
| 인증 | `Authorization: Bearer <pilo_access_token>` |

### Response Body

```json
{
  "success": true,
  "data": {
    "loggedOut": true
  }
}
```

### 저장 규칙

- 현재 bearer token의 hash와 일치하는 `user_sessions` row에 `revoked_at`을 기록한다.
- 이미 만료되었거나 revoke된 session token은 보호 API에서 `401`로 처리된다.

## 로그인 후 Frontend 진입 규칙

Frontend는 `/login/callback`에서 token을 저장한 뒤 다음 순서로 진입한다.

1. `GET /me`로 현재 사용자 profile 조회
2. `GET /workspaces`로 내 workspace 조회
3. 응답된 workspace id를 저장하고 `return_to` 또는 `/calendar`로 이동

MVP에서는 로그인 callback이 기본 Workspace를 보장하므로 `GET /workspaces`가
빈 배열이면 기본 Workspace 초기화 실패로 보고 session 초기화 실패 상태로 처리한다.
