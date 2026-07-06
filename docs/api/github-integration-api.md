# GitHub Integration API

External callback, setup, and webhook URLs MUST include the `/api/v1` base path. For example:
`/api/v1/github/oauth/callback`, `/api/v1/github/installations/callback`, and
`/api/v1/github/webhooks`.

The endpoint table below follows the common API documentation rule and omits the
`/api/v1` base path. External provider settings such as GitHub OAuth callback
URLs, GitHub App setup URLs, and webhook URLs must use the full public path
including `/api/v1`.

## 외부 Provider 설정 URL

GitHub OAuth App, GitHub App, webhook 설정 화면에는 아래처럼 public origin과
`/api/v1` base path를 모두 포함한 URL을 등록한다.

```text
GitHub OAuth callback URL: {API_PUBLIC_ORIGIN}/api/v1/github/oauth/callback
GitHub App Setup URL:      {API_PUBLIC_ORIGIN}/api/v1/github/installations/callback
GitHub webhook URL:        {API_PUBLIC_ORIGIN}/api/v1/github/webhooks
```

## 범위

GitHub Integration API는 Workspace 단위 GitHub 연결과 원본 데이터 조회를
담당한다.

- 사용자 GitHub OAuth 연결 상태 관리
- GitHub App installation 연결과 installation 목록 조회
- Repository, Issue, Pull Request, ProjectV2 원본 조회
- GitHub 데이터 수동 동기화와 sync run 이력
- GitHub webhook 수신과 처리 이력

PR 리뷰 세션, 파일별 리뷰 판단, Kanban board cache hydrate, GitHub issue
수정, PR merge, inline review comment는 이 문서의 범위가 아니다.

## 인증 구조

| 용도 | 인증 주체 | 저장 위치 |
| --- | --- | --- |
| Repository/Issue/PR/ProjectV2 조회와 동기화 | GitHub App installation token | `github_installations` |
| GitHub Review 제출 | 현재 사용자의 GitHub App user OAuth token | `users.github_access_token_encrypted` |
| PILO API 호출 | PILO access token | application auth/session layer |

GitHub token은 복호화된 상태로 응답하거나 로그에 남기지 않는다.

GitHub Review 제출은 GitHub Integration 공개 API endpoint가 아니다. PR Review API가
제출 workflow와 local submission history를 소유하고, GitHub Integration은 PR Review가
호출하는 서버 내부 dependency로 현재 사용자의 OAuth token 복호화 경계와 body-only
GitHub Review 제출 adapter만 제공한다. 이 adapter는 `event`, `body`만 GitHub로 보내며
inline `comments` payload는 보내지 않는다.
GitHub Review 제출에는 GitHub App `Pull requests: write` permission이 필요하며,
GitHub 403 응답은 provider raw error 대신 safe permission error로 매핑한다.

GitHub App installation 검증은 GitHub의 `/user/installations` endpoint를
호출한다. 저장된 사용자 token은 GitHub App client id/secret으로 발급받은
GitHub App user access token이어야 하며, `repo`/`read:user` scope가 있는
classic GitHub OAuth App token만으로는 이 조회를 통과할 수 없다.

`auth-api.md`의 GitHub 로그인 callback은 GitHub App user OAuth token을 저장하지
않는다. 따라서 GitHub로 로그인한 사용자도 `/me/github/oauth/start` 연결을
완료하기 전까지 `/me/github`에서는 GitHub App user OAuth 미연결 상태로 보인다.

기존 dev 데이터처럼 GitHub 로그인 OAuth token이 `users.github_access_token_encrypted`에
저장된 row는 GitHub App installation lookup을 통과하지 못할 수 있다. 이 경우
`DELETE /me/github`로 기존 GitHub Integration 연결 상태를 해제한 뒤
`POST /me/github/oauth/start`로 다시 연결한다.

GitHub App installation 연결을 시작하려면 현재 사용자의 GitHub OAuth 연결이
선행되어야 한다. Installation callback 처리 시 서버는 저장된 사용자 OAuth
token으로 GitHub의 user installations 목록을 조회해 callback의
`installation_id`가 현재 연결된 GitHub 사용자에게 접근 가능한 installation인지
검증한 뒤 `github_installations`에 저장한다.

## 데이터 규칙

- `github_pull_requests.raw`에서 `state`, `draft`, `mergeable`, `head_sha`, `base_sha`를 파생한다.
- PR 변경 파일은 GitHub Integration의 별도 캐시 테이블에 저장하지 않는다.
- PR 변경 파일과 patch text는 요청 시 GitHub에서 조회한다.
- PR Review는 세션 생성 시 `review_files`에 파일 metadata를 저장할 수 있다. Diff 응답과 큰 diff 판단 기준은 PR Review API 문서를 따른다.
- `github_sync_target` 값은 `repositories`, `issues`, `pull_requests`, `project_v2`, `project_v2_fields`, `project_v2_items`, `full`이다.
- `full` sync는 허용 저장소를 먼저 갱신한 뒤 GitHub GraphQL의
  `organization.projectsV2` 또는 `user.projectsV2`로 installation 계정에서 접근 가능한
  Projects v2를 발견한다. 발견한 ProjectV2는 `github_projects_v2`에 upsert하고,
  GitHub repository node id와 동기화된 저장소를 매칭해 `github_project_v2_repositories`
  관계를 갱신한다.
- ProjectV2 자동 발견은 GitHub App installation에 Projects read 권한이 있어야 한다.
  권한이 없으면 GitHub GraphQL provider 오류로 sync run이 실패한다.
- GitHub webhook receiver는 delivery 수신과 검증 결과를 `github_webhook_deliveries`에 기록한다. 실제 GitHub source table 동기화는 sync run 또는 별도 background worker가 담당한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me/github` | 현재 사용자의 GitHub App user OAuth 연결 상태 조회 |
| `POST` | `/me/github/oauth/start` | GitHub App user authorization URL 생성 |
| `GET` | `/github/oauth/callback` | GitHub OAuth callback |
| `DELETE` | `/me/github` | 현재 사용자의 GitHub App user OAuth 연결 해제 |
| `POST` | `/workspaces/{workspaceId}/github/installations/start` | GitHub App user access token 검증 후 GitHub App 설치 URL 생성 |
| `GET` | `/github/installations/callback` | GitHub App Setup URL redirect 처리 |
| `GET` | `/workspaces/{workspaceId}/github/installations` | Workspace installation 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/repositories` | 동기화된 repository 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/repositories/{repositoryId}` | Repository 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2` | 동기화된 ProjectV2 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}` | ProjectV2 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/fields` | ProjectV2 Field 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/status-options` | ProjectV2 Status 옵션 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban` | ProjectV2 Status field/options/items 원본 view |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/items` | ProjectV2 Item 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/issues/{issueId}` | Issue 원본 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests` | Repository PR 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}` | PR 원본 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/files` | GitHub에서 PR 변경 파일 조회 |
| `GET` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/conflict-status` | PR conflict 상태 조회 |
| `POST` | `/workspaces/{workspaceId}/github/sync-runs` | 수동 동기화 시작 |
| `GET` | `/workspaces/{workspaceId}/github/sync-runs` | Sync run 이력 조회 |
| `GET` | `/workspaces/{workspaceId}/github/sync-runs/{syncRunId}` | Sync run 상세 조회 |
| `POST` | `/github/webhooks` | GitHub webhook receiver |

## 주요 요청

### 수동 동기화 시작

```json
{
  "target": "full",
  "installationId": "installation_uuid",
  "repositoryId": "repository_uuid",
  "projectV2Id": "project_v2_uuid"
}
```

`repositoryId`, `projectV2Id`는 target에 따라 선택값이다. 서버는
`github_sync_runs`에 status와 count를 기록한다.

### GitHub webhook receiver

GitHub App webhook 설정 URL은 `{API_PUBLIC_ORIGIN}/api/v1/github/webhooks`이다.

요청은 GitHub가 보내는 raw body 기준으로 `X-Hub-Signature-256` HMAC-SHA256 signature를 검증한다. signature 검증에는 `GITHUB_WEBHOOK_SECRET`을 사용하며, webhook secret이나 provider 원문 오류는 응답 또는 로그에 노출하지 않는다.

필수 header:

| Header | 설명 |
| --- | --- |
| `X-GitHub-Delivery` | GitHub delivery id. `github_webhook_deliveries.delivery_id`에 저장하며 중복 판단 기준으로 사용한다. |
| `X-GitHub-Event` | GitHub event name. `github_webhook_deliveries.event_name`에 저장한다. |
| `X-Hub-Signature-256` | `sha256=` prefix를 포함한 GitHub webhook signature. |

처리 규칙:

- signature가 유효하지 않으면 delivery를 `failed`로 기록하고 `400 BAD_REQUEST`를 반환한다.
- 이미 같은 `delivery_id` row가 있으면 신규 insert나 overwrite 없이 기존 row를 반환한다.
- 지원하는 event는 `received`로 기록한다. `received`는 delivery가 검증되어 수신됐다는 의미이며, source table 동기화 완료를 의미하지 않는다.
- 지원하지 않는 event는 오류 없이 `ignored`로 기록한다.
- 현재 receiver는 sync run이나 background job을 직접 시작하지 않는다. webhook 기반 자동 동기화가 필요하면 별도 worker/queue 계약을 추가로 정의한다.

응답 예시:

```json
{
  "success": true,
  "data": {
    "deliveryId": "b32d8c10-5975-11ef-8e7e-000000000000",
    "eventName": "ping",
    "status": "received",
    "receivedAt": "2026-07-05T09:00:00.000Z",
    "processedAt": null,
    "message": "GitHub webhook received"
  }
}
```

### PR 변경 파일 응답

```json
{
  "success": true,
  "data": [
    {
      "filePath": "apps/frontend/page.tsx",
      "previousFilePath": null,
      "fileName": "page.tsx",
      "fileStatus": "modified",
      "additions": 84,
      "deletions": 12,
      "isBinary": false,
      "isLargeDiff": false,
      "githubFileUrl": "https://github.com/org/repo/pull/24/files#diff-abc",
      "patch": "@@ -10,6 +10,18 @@..."
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

`patch`는 GitHub API 응답값이며 DB 저장 컬럼이 아니다.

## MVP 제외

- GitHub repository 생성/삭제
- GitHub issue 생성/수정/삭제
- GitHub ProjectV2 field/option write
- PR merge/close
- GitHub inline review comment

## Callback redirect rule

- `POST /me/github/oauth/start` and
  `POST /workspaces/{workspaceId}/github/installations/start` store the optional
  `returnUrl` in signed state.
- Both start endpoints also create a server-side callback state row and set an
  HttpOnly `SameSite=Lax` binding cookie scoped to `{API_BASE_PATH}/github`.
- Browser clients must call the start endpoints with credentials included, and
  app-server CORS must use a concrete frontend origin with credentials enabled
  so the binding cookie can be stored.
- `returnUrl` must use the configured frontend origin (`FRONTEND_URL`) or a
  frontend-relative path.
- `GET /github/oauth/callback` requires a valid signed OAuth state, the matching
  browser binding cookie, and an unexpired unconsumed server-side state row.
  The server consumes the state row before exchanging the GitHub OAuth code.
- `GET /github/installations/callback` requires a valid signed GitHub App
  installation state, the matching browser binding cookie, and an unexpired
  unconsumed server-side state row. The server consumes the state row before
  checking the user's installation access or looking up the installation.
- Missing cookies, expired rows, already-consumed rows, or nonce/binding
  mismatches are rejected as invalid callback state. Callback state is one-time
  use and MUST NOT be accepted on replay.
- On callback success, app-server redirects to `returnUrl` with `302`.
- If `returnUrl` is omitted, the callback returns the JSON payload for
  diagnostic/API-client use.
