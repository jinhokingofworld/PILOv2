# GitHub Integration API

External callback, setup, and webhook URLs MUST include the `/api/v1` base path. For example:
`/api/v1/github/oauth/callback`, `/api/v1/github/project-oauth/callback`,
`/api/v1/github/installations/callback`, and `/api/v1/github/webhooks`.

The endpoint table below follows the common API documentation rule and omits the
`/api/v1` base path. External provider settings such as GitHub OAuth callback
URLs, GitHub App setup URLs, and webhook URLs must use the full public path
including `/api/v1`.

## 외부 Provider 설정 URL

GitHub OAuth App, GitHub App, webhook 설정 화면에는 아래처럼 public origin과
`/api/v1` base path를 모두 포함한 URL을 등록한다.

```text
GitHub OAuth callback URL: {API_PUBLIC_ORIGIN}/api/v1/github/oauth/callback
GitHub ProjectV2 OAuth callback URL: {API_PUBLIC_ORIGIN}/api/v1/github/project-oauth/callback
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
수정, 공개 PR merge/close endpoint, inline review comment는 이 문서의 범위가 아니다.

## 인증 구조

| 용도 | 인증 주체 | 저장 위치 |
| --- | --- | --- |
| Repository/Issue/PR와 organization ProjectV2 조회와 동기화 | GitHub App installation token | `github_installations` |
| personal ProjectV2 read/write and sync | regular GitHub OAuth App token with `project` scope | `users.github_project_access_token_encrypted` |
| GitHub Review 제출 | 현재 사용자의 GitHub App user OAuth token | `users.github_access_token_encrypted` |
| PR Review conflict resolution apply commit | 현재 사용자의 GitHub App user OAuth token | `users.github_access_token_encrypted` |
| PR Review merge action | 현재 사용자의 GitHub App user OAuth token | `users.github_access_token_encrypted` |
| PILO API 호출 | PILO access token | application auth/session layer |

GitHub token은 복호화된 상태로 응답하거나 로그에 남기지 않는다.

ProjectV2 OAuth is intentionally separate from `/me/github/oauth/start`.
`/me/github/oauth/start` remains the GitHub App user authorization flow used for
installation lookup and PR review submission. Personal ProjectV2 discovery and
ProjectV2 item status writes use `/me/github/project-oauth/start`, which
requests `read:user user:email project` and stores the encrypted token in
`users.github_project_access_token_encrypted`. The callback rejects tokens whose
scope does not include `project`. If the user already has an active
`/me/github/oauth/start` connection, the ProjectV2 OAuth callback also rejects a
different GitHub login with
`GitHub ProjectV2 OAuth account must match GitHub OAuth account`.

GitHub Review 제출은 GitHub Integration 공개 API endpoint가 아니다. PR Review API가
제출 workflow와 local submission history를 소유하고, GitHub Integration은 PR Review가
호출하는 서버 내부 dependency로 현재 사용자의 OAuth token 복호화 경계와 body-only
GitHub Review 제출 adapter만 제공한다. 이 adapter는 `event`, `body`만 GitHub로 보내며
inline `comments` payload는 보내지 않는다.
GitHub Review 제출에는 GitHub App `Pull requests: write` permission이 필요하며,
GitHub 403 응답은 provider raw error 대신 safe permission error로 매핑한다.

PR Review conflict resolution apply commit은 GitHub Integration 공개 API endpoint가 아니다.
PR Review API가 사용자 확인 workflow와 review session head 갱신을 소유하고, GitHub
Integration은 PR Review가 호출하는 서버 내부 dependency로 현재 사용자의 OAuth token
복호화 경계와 single-file Contents API update adapter만 제공한다. 이 adapter에는 GitHub App
`Contents: write` permission이 필요하며, GitHub 403 응답은 provider raw error 대신 safe
permission error로 매핑한다.

PR Review merge action은 GitHub Integration 공개 API endpoint가 아니다. PR Review API가
merge 가능 조건, confirmation, review room 상태 갱신을 소유하고, GitHub Integration은
PR Review가 호출하는 서버 내부 dependency로 현재 사용자의 OAuth token 복호화 경계와
GitHub `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` adapter만 제공한다. 이 adapter는
1차에서 `merge` commit 방식만 사용한다. Branch protection, required checks, required reviews,
conversation resolution, merge method 제한은 PILO가 사전 판정하지 않고 GitHub merge API 응답을
safe permission/conflict/bad request error로 매핑한다. GitHub token, raw provider error, secret은
API 응답이나 로그에 노출하지 않는다.

GitHub App installation 검증은 GitHub의 `/user/installations` endpoint를
호출한다. 저장된 사용자 token은 GitHub App client id/secret으로 발급받은
GitHub App user access token이어야 한다. GitHub App user access token은
traditional OAuth scope로 접근 가능성을 판단하지 않으며, GitHub 응답의 scope 값은
빈 문자열일 수 있다. `repo`/`read:user`/`read:project` scope가 있는 classic GitHub
OAuth App token만으로는 이 조회를 통과할 수 없다.

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
검증한 뒤 `github_installations`에 저장한다. 저장 성공 후 서버는 같은 요청 흐름에서
초기 `full` sync run을 시도한다. 초기 sync 실패는 callback 자체를 실패시키지 않고
서버 warning log와 실패한 sync run 기록으로 남긴다.

## 데이터 규칙

- `github_pull_requests.raw`에서 `state`, `draft`, `mergeable`, `head_sha`, `base_sha`를 파생한다.
- PR 변경 파일은 GitHub Integration의 별도 캐시 테이블에 저장하지 않는다.
- PR 변경 파일과 patch text는 요청 시 GitHub에서 조회한다.
- PR Review는 세션 생성 시 `review_files`에 파일 metadata를 저장할 수 있다. Diff 응답과 큰 diff 판단 기준은 PR Review API 문서를 따른다.
- `github_sync_target` 값은 `repositories`, `issues`, `pull_requests`, `project_v2`, `project_v2_fields`, `project_v2_items`, `full`이다.
- GitHub 원본 cache identity는 Workspace 범위다. 같은 GitHub
  installation/repository/issue/PR/ProjectV2/field/item이 여러 Workspace에
  동기화될 수 있으며, sync upsert는 현재 Workspace 또는 현재 ProjectV2 안에서만
  충돌 처리하고 다른 Workspace의 row를 재할당하지 않는다.
- `full` sync는 허용 저장소를 먼저 갱신한 뒤 GitHub GraphQL의
  `organization.projectsV2` 또는 `user.projectsV2`로 Projects v2를 발견한다.
  organization ProjectV2는 GitHub App installation token을 사용하고, personal
  ProjectV2는 현재 사용자의 ProjectV2 OAuth token을 사용한다. 발견한
  ProjectV2는 `github_projects_v2`에 upsert하고, GitHub repository node id와
  동기화된 저장소를 매칭해 `github_project_v2_repositories` 관계를 갱신한다.
  ProjectV2 item sync는 GitHub ProjectV2 repository 연결 목록이 불완전한 경우에도
  동기화된 issue/PR content의 repository를 기준으로 이 관계를 보강한다.
- `full` sync 요청에 `repositoryId`가 있으면, 선택된 ProjectV2가 없는 경우에도
  발견한 ProjectV2 중 해당 repository에 연결된 ProjectV2만 fields/items
  동기화 대상으로 삼는다. `projectV2Id`가 있으면 그 ProjectV2를 우선한다.
- ProjectV2 fields/items 동기화가 끝나면 서버는 같은 workspace의 기존 Board
  cache 중 해당 ProjectV2와 repository 조합으로 이미 생성된 board만 다시
  hydrate한다. 이 동작은 새 board를 자동 생성하지 않는다.
- organization ProjectV2 자동 발견은 GitHub App installation에 Projects read 권한이
  있어야 한다. 권한이 없으면 GitHub GraphQL provider 오류로 sync run이 실패한다.
- personal ProjectV2 discovery and sync require an active ProjectV2 OAuth
  connection from `/me/github/project-oauth/start`. The ProjectV2 OAuth account
  must match the personal ProjectV2 owner and `users.github_project_token_scope`
  must include `project`. Missing connection fails the sync run with
  `GitHub ProjectV2 OAuth connection is required for personal ProjectV2 sync`.
  Owner mismatch fails with
  `GitHub ProjectV2 OAuth account does not match this personal ProjectV2 owner`.
  Missing scope fails with
  `GitHub ProjectV2 OAuth connection must be reconnected with project scope`.
  GraphQL permission failure with a ProjectV2 OAuth token is reported as
  `GitHub ProjectV2 OAuth token lacks permission to read personal ProjectV2`.
  GitHub owner resolution failure remains
  `GitHub ProjectV2 owner could not be resolved`; using an installation token for
  personal ProjectV2 remains
  `GitHub App installation token cannot access personal ProjectV2`; organization
  ProjectV2 installation-token permission failure remains
  `GitHub App installation token cannot access organization ProjectV2`.
- GitHub webhook receiver는 delivery 수신과 검증 결과를 `github_webhook_deliveries`에 기록한다. 실제 GitHub source table 동기화는 sync run 또는 별도 background worker가 담당한다.
- GitHub App installation 삭제는 GitHub 원격 `DELETE /app/installations/{installation_id}`를
  App JWT로 호출한 뒤 local `github_installations` row를 삭제한다. GitHub가 `404`를
  반환하면 이미 원격에서 삭제된 상태로 보고 local cleanup을 진행한다.
- GitHub App installation 삭제 시 `github_projects_v2` 계열 cache는 FK cascade로
  삭제된다. `github_repositories`, `github_issues`, `github_pull_requests`, PR review
  기록은 과거 cache로 남기며, repository 목록 API는 현재 active installation에 연결된
  repository만 반환한다. 같은 Workspace에서 재설치 후 full sync가 같은
  `github_repository_id`를 다시 발견하면 해당 Workspace 안의 기존 repository cache
  `installation_id`가 새 installation으로 갱신된다.

## 공통 조회/페이지네이션 규칙

- 모든 `/workspaces/{workspaceId}/github/*` 조회 API는 PILO bearer token과
  Workspace 접근 권한을 요구한다.
- `DELETE /workspaces/{workspaceId}/github/installations/{installationId}`만
  Workspace owner 권한을 요구한다. Installation 시작, 목록, 원본 조회, sync run
  조회/시작은 Workspace 접근 권한을 사용한다.
- 페이지네이션 query는 `page`, `limit`을 사용한다. `page`와 `limit`은 양의 정수여야
  하며 `limit` 최대값은 `100`이다.
- repository 목록, ProjectV2 목록, sync run 목록, PR file 목록의 기본 `limit`은
  `20`이다. repository별 PR 목록의 기본 `limit`은 `10`이다.
- 페이지네이션 응답은 `{ success: true, data: [...], meta: { page, limit, total } }`
  형태다.
- boolean query는 구현상 문자열 `true` 또는 `false`만 허용한다. 빈 값은 생략으로
  처리한다.
- string query는 배열이면 거절하고, 앞뒤 공백을 제거한 뒤 빈 문자열이면 생략으로
  처리한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me/github` | 현재 사용자의 GitHub App user OAuth 연결 상태 조회 |
| `POST` | `/me/github/oauth/start` | GitHub App user authorization URL 생성 |
| `GET` | `/github/oauth/callback` | GitHub OAuth callback |
| `DELETE` | `/me/github` | 현재 사용자의 GitHub App user OAuth 연결 해제 |
| `GET` | `/me/github/project-oauth` | ProjectV2 OAuth connection status |
| `POST` | `/me/github/project-oauth/start` | ProjectV2 OAuth authorization URL with `project` scope |
| `GET` | `/github/project-oauth/callback` | ProjectV2 OAuth callback |
| `DELETE` | `/me/github/project-oauth` | Disconnect ProjectV2 OAuth token |
| `POST` | `/workspaces/{workspaceId}/github/installations/start` | GitHub App user access token 검증 후 GitHub App 설치 URL 생성 |
| `GET` | `/github/installations/callback` | GitHub App Setup URL redirect 처리 |
| `GET` | `/workspaces/{workspaceId}/github/installations` | Workspace installation 목록 조회 |
| `DELETE` | `/workspaces/{workspaceId}/github/installations/{installationId}` | GitHub 원격 App installation 삭제 후 local 연결 정리 |
| `GET` | `/workspaces/{workspaceId}/github/repositories` | 동기화된 repository 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/repositories/{repositoryId}` | Repository 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/repositories/{repositoryId}/collaborator-status` | 현재 사용자의 Repository collaborator 권한 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2` | 동기화된 ProjectV2 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/access-status` | 현재 사용자의 ProjectV2 접근 권한 조회 |
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

### OAuth 상태, 시작, 해제

`GET /me/github`와 `GET /me/github/project-oauth`는 같은 shape를 반환한다. 연결이
해제됐거나 아직 연결되지 않은 경우 `connected=false`이며 `tokenScope`는 `null`이다.

```json
{
  "success": true,
  "data": {
    "connected": true,
    "githubUserId": 123456,
    "githubLogin": "octocat",
    "tokenScope": "read:user,user:email,project",
    "githubConnectedAt": "2026-07-07T12:00:00.000Z",
    "githubRevokedAt": null
  }
}
```

`POST /me/github/oauth/start`, `POST /me/github/project-oauth/start`,
`POST /workspaces/{workspaceId}/github/installations/start`는 선택 body
`{ "returnUrl": "/settings/integrations" }`를 받을 수 있다. 성공 시 JSON에는
provider URL과 signed state만 포함되고, callback binding token은 `Set-Cookie`
header로만 전달된다.

```json
{
  "success": true,
  "data": {
    "authorizeUrl": "https://github.com/login/oauth/authorize?...",
    "state": "signed_state"
  }
}
```

Installation 시작 응답은 `authorizeUrl` 대신 `installUrl`을 사용한다.

```json
{
  "success": true,
  "data": {
    "installUrl": "https://github.com/apps/pilo-github-app/installations/new?state=signed_state",
    "state": "signed_state"
  }
}
```

`DELETE /me/github`와 `DELETE /me/github/project-oauth`는 현재 사용자의 암호화된
token과 scope를 제거하고 revoked timestamp를 남긴다.

```json
{
  "success": true,
  "data": {
    "disconnected": true
  }
}
```

### GitHub App installation

`POST /workspaces/{workspaceId}/github/installations/start`는 Workspace 접근 권한,
활성 `/me/github/oauth/start` 연결, GitHub `/user/installations` 조회 가능 여부를
검증한 뒤 GitHub App 설치 URL을 생성한다.

`GET /github/installations/callback` query:

| Query | 설명 |
| --- | --- |
| `installation_id` | GitHub installation id. 양의 정수여야 한다. |
| `setup_action` | GitHub App setup action. 값 자체는 저장하지 않지만 필수다. |
| `state` | 설치 시작 API가 만든 signed state. |

callback은 state와 binding cookie를 소비한 뒤, 저장된 사용자 OAuth token으로 해당
installation이 현재 GitHub 사용자에게 접근 가능한지 검증한다. 성공하면
`github_installations`를 upsert하고 초기 `full` sync를 시도한다.

Installation 목록 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "installation_uuid",
      "workspaceId": "workspace_uuid",
      "githubInstallationId": 12345678,
      "accountLogin": "my-team",
      "accountType": "Organization",
      "repositorySelection": "selected",
      "permissions": { "contents": "write", "pull_requests": "write" },
      "installedByUserId": "user_uuid",
      "installedAt": "2026-07-07T12:00:00.000Z",
      "suspendedAt": null,
      "lastSyncedAt": "2026-07-07T12:05:00.000Z"
    }
  ]
}
```

### 원본 조회 Query

Repository 목록:

```http
GET /api/v1/workspaces/{workspaceId}/github/repositories?q=pilo&includeArchived=false&page=1&limit=20
```

| Query | 설명 |
| --- | --- |
| `q` | `ownerLogin`, `name`, `fullName` 부분 검색 |
| `includeArchived` | `true`면 archived repository도 포함. 생략 또는 `false`면 제외 |
| `page`, `limit` | 기본 `1`, `20`; 최대 limit `100` |

Repository 목록은 `installation_id IS NOT NULL`인 현재 active installation cache만
반환하며 `fullName ASC, id ASC`로 정렬한다.

ProjectV2 목록:

```http
GET /api/v1/workspaces/{workspaceId}/github/projects-v2?ownerLogin=my-team&closed=false&q=MVP&page=1&limit=20
```

| Query | 설명 |
| --- | --- |
| `ownerLogin` | GitHub owner login exact match |
| `closed` | `true`면 closed ProjectV2도 포함. 생략 또는 `false`면 `closed=false`만 반환 |
| `q` | `title`, `shortDescription` 부분 검색 |
| `page`, `limit` | 기본 `1`, `20`; 최대 limit `100` |

ProjectV2 목록은 `ownerLogin ASC, projectNumber ASC, id ASC`로 정렬한다.

Repository PR 목록:

```http
GET /api/v1/workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests?state=open&query=24&page=1&limit=10
```

| Query | 설명 |
| --- | --- |
| `state` | `open` 또는 `closed` |
| `query` | PR title 또는 PR number text 부분 검색 |
| `page`, `limit` | 기본 `1`, `10`; 최대 limit `100` |

PR state는 `github_pull_requests.raw.state`를 우선 사용하고, 없으면
`merged_at` 또는 `github_closed_at` 존재 여부에서 파생한다. 목록은
`github_updated_at DESC NULLS LAST, pr_number DESC, id ASC`로 정렬한다.

Sync run 목록:

| Query | 설명 |
| --- | --- |
| `target` | `repositories`, `issues`, `pull_requests`, `project_v2`, `project_v2_fields`, `project_v2_items`, `full` |
| `status` | `running`, `success`, `failed` |
| `repositoryId` | 특정 repository 관련 run만 조회 |
| `projectV2Id` | 특정 ProjectV2 관련 run만 조회 |
| `page`, `limit` | 기본 `1`, `20`; 최대 limit `100` |

### 수동 동기화 시작

```json
{
  "target": "full",
  "installationId": "installation_uuid",
  "repositoryId": "repository_uuid",
  "projectV2Id": "project_v2_uuid"
}
```

`target`과 `installationId`는 필수다. `repositoryId`, `projectV2Id`는 선택값이지만,
값이 있으면 path의 Workspace 안에 존재하고 같은 installation에 속해야 한다.
`project_v2`, `project_v2_fields`, `project_v2_items` target은 `projectV2Id`가
필수다. `issues`와 `pull_requests`는 `repositoryId`가 있으면 해당 repository만,
없으면 installation에 연결된 repository 전체를 동기화한다.

수동 sync API는 `github_sync_runs` row를 `running`으로 만든 뒤 executor를 실행하고,
완료된 `success` 또는 `failed` payload를 반환한다. Provider 처리 중 발생한 오류는
가능한 경우 API 예외 대신 `status="failed"`와 `errorMessage`로 기록해 반환한다.
요청 validation, Workspace 범위, installation/repository/project lookup 실패는 일반
API error로 반환한다.

응답 예시:

```json
{
  "success": true,
  "data": {
    "id": "sync_run_uuid",
    "target": "full",
    "status": "success",
    "installationId": "installation_uuid",
    "repositoryId": "repository_uuid",
    "projectV2Id": "project_v2_uuid",
    "startedAt": "2026-07-07T12:00:00.000Z",
    "finishedAt": "2026-07-07T12:01:00.000Z",
    "fetchedCount": 5,
    "createdCount": 2,
    "updatedCount": 2,
    "skippedCount": 1,
    "errorMessage": null
  }
}
```

`GET /workspaces/{workspaceId}/github/sync-runs/{syncRunId}`는 위 payload에
`cursor: Record<string, unknown>`을 추가로 포함한다.

### ProjectV2 응답

`GET /workspaces/{workspaceId}/github/projects-v2`와
`GET /workspaces/{workspaceId}/github/projects-v2/{projectV2Id}`의 ProjectV2
payload는 board 구성을 위해 연결된 repository id 목록을 포함한다.

```json
{
  "id": "project_v2_uuid",
  "installationId": "installation_uuid",
  "githubProjectNodeId": "PVT_kwDOExample",
  "githubProjectFullDatabaseId": 42,
  "ownerLogin": "my-team",
  "ownerType": "Organization",
  "projectNumber": 10,
  "title": "PILO MVP",
  "shortDescription": "MVP board",
  "url": "https://github.com/orgs/my-team/projects/10",
  "public": false,
  "closed": false,
  "template": false,
  "repositoryIds": ["repository_uuid"],
  "lastSyncedAt": "2026-07-07T12:00:00.000Z"
}
```

상세 응답은 목록 필드에 `readme`, `resourcePath`, `githubCreatedAt`,
`githubUpdatedAt`, `githubClosedAt`을 추가한다.

`GET /workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban`은
동기화된 Status field와 option, item cache를 원본 view 형태로 묶어 반환한다.
Status field가 없으면 `statusField=null`, `columns=[]`가 될 수 있으며 status option에
매핑되지 않는 item은 `unmappedItems`에 들어간다.

### PR 변경 파일과 conflict 상태

PR 변경 파일은 DB에 캐시하지 않고 요청 시 GitHub App installation token으로 GitHub에서
조회한다. 응답 `meta.total`은 cached PR의 `changedFilesCount`를 사용한다.

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
      "changes": 96,
      "isBinary": false,
      "isLargeDiff": false,
      "blobUrl": "https://github.com/org/repo/blob/abc/apps/frontend/page.tsx",
      "rawUrl": "https://github.com/org/repo/raw/abc/apps/frontend/page.tsx",
      "contentsUrl": "https://api.github.com/repos/org/repo/contents/apps/frontend/page.tsx",
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

`patch`는 GitHub API 응답값이며 DB 저장 컬럼이 아니다. Binary 파일이거나 큰 diff이면
`patch=null`로 반환한다. 큰 diff 기준은 `additions + deletions >= 1000`,
patch 누락, 또는 UTF-8 patch byte length `>= 200KB` 중 하나다.

Conflict 상태 응답:

```json
{
  "success": true,
  "data": {
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-07T12:00:00.000Z",
    "message": "Conflict가 없는 상태입니다."
  }
}
```

GitHub PR `mergeable=true`는 `clean`, `false`는 `conflicted`, `null`은 `checking`으로
매핑한다. GitHub PR 조회 자체가 실패하면 provider raw error를 노출하지 않고
`unknown`과 `Conflict 상태를 확인할 수 없습니다.` 메시지를 반환한다.

### GitHub webhook receiver

GitHub App webhook 설정 URL은 `{API_PUBLIC_ORIGIN}/api/v1/github/webhooks`이다.

요청은 GitHub가 보내는 raw body 기준으로 `X-Hub-Signature-256` HMAC-SHA256
signature를 검증한다. signature 검증에는 `GITHUB_WEBHOOK_SECRET`을 사용하며, webhook
secret이나 provider 원문 오류는 응답 또는 로그에 노출하지 않는다.

필수 header:

| Header | 설명 |
| --- | --- |
| `X-GitHub-Delivery` | GitHub delivery id. `github_webhook_deliveries.delivery_id`에 저장하며 중복 판단 기준으로 사용한다. |
| `X-GitHub-Event` | GitHub event name. `github_webhook_deliveries.event_name`에 저장한다. |
| `X-Hub-Signature-256` | `sha256=` prefix를 포함한 GitHub webhook signature. |

지원 event:

```text
ping
installation
installation_repositories
repository
issues
issue_comment
pull_request
pull_request_review
pull_request_review_comment
projects_v2
projects_v2_item
projects_v2_status_update
github_app_authorization
```

처리 규칙:

- signature가 유효하지 않으면 delivery를 `failed`로 기록하고 `400 BAD_REQUEST`를 반환한다.
- 이미 같은 `delivery_id` row가 있고 상태가 `received` 또는 `ignored`이면 신규 insert나 overwrite 없이 기존 row를 반환한다.
- 지원하는 event는 `received`로 기록한다. `received`는 delivery가 검증되어 수신됐다는 의미이며, source table 동기화 완료를 의미하지 않는다.
- 지원하지 않는 event는 오류 없이 `ignored`로 기록하고 `processedAt`을 기록한다.
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

### GitHub App installation 삭제

```text
DELETE /api/v1/workspaces/{workspaceId}/github/installations/{installationId}
```

권한:

- PILO bearer token이 필요하다.
- 현재 사용자는 해당 Workspace의 `owner`여야 한다. `member`는 GitHub installation
  관리 작업을 수행할 수 없다.

처리 규칙:

- 서버는 `github_installations.id`와 `workspace_id`로 대상 installation을 조회한다.
- 서버는 GitHub App JWT로 GitHub REST API
  `DELETE /app/installations/{githubInstallationId}`를 호출한다.
- GitHub가 `202`를 반환하면 local `github_installations` row를 삭제한다.
- GitHub가 `404`를 반환하면 이미 원격에서 삭제된 상태로 보고 local
  `github_installations` row를 삭제한다.
- GitHub가 `401`, `403`, `5xx` 등 실패 응답을 반환하거나 네트워크 오류가 발생하면
  provider raw error를 노출하지 않고 safe error를 반환하며 local row는 유지한다.
- API 응답이나 로그에 GitHub App private key, JWT, installation token, 사용자 OAuth
  token을 노출하지 않는다.

응답 예시:

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "alreadyDeleted": false,
    "installationId": "installation_uuid",
    "githubInstallationId": 12345678,
    "accountLogin": "my-team"
  }
}
```

## MVP 제외

- GitHub repository 생성/삭제
- GitHub issue 생성/수정/삭제
- GitHub ProjectV2 field/option write
- Public PR merge/close endpoint
- GitHub inline review comment

## Callback redirect rule

- `POST /me/github/oauth/start`, `POST /me/github/project-oauth/start`, and
  `POST /workspaces/{workspaceId}/github/installations/start` store the optional
  `returnUrl` in signed state.
- `POST /me/github/oauth/start` creates a GitHub App user authorization URL.
  GitHub App user access tokens do not use traditional OAuth scopes, so
  `users.github_token_scope` is stored for diagnostics/display only and is not a
  mandatory ProjectV2 access precondition.
- `POST /me/github/project-oauth/start` creates a regular GitHub OAuth App
  authorization URL with `read:user user:email project`. Its callback stores
  `users.github_project_access_token_encrypted` and requires the returned scope
  to include `project`.
- All start endpoints also create a server-side callback state row and set an
  HttpOnly `SameSite=Lax` binding cookie scoped to `{API_BASE_PATH}/github`.
- Browser clients must call the start endpoints with credentials included, and
  app-server CORS must use a concrete frontend origin with credentials enabled
  so the binding cookie can be stored.
- `returnUrl` must use the configured frontend origin (`FRONTEND_URL`) or a
  frontend-relative path.
- `GET /github/oauth/callback` requires a valid signed OAuth state, the matching
  browser binding cookie, and an unexpired unconsumed server-side state row.
  The server consumes the state row before exchanging the GitHub OAuth code.
- `GET /github/project-oauth/callback` requires a valid signed ProjectV2 OAuth
  state, the matching browser binding cookie, and an unexpired unconsumed
  server-side state row. The server consumes the state row before exchanging the
  GitHub OAuth code and rejects returned tokens without `project` scope.
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
- If `GET /github/oauth/callback` cannot save the GitHub account because
  `users.github_user_id` or `users.github_login` already belongs to another
  PILO user, the failure is treated as a safe duplicate-account conflict.
  Without callback redirect handling, the equivalent API error is
  `409 CONFLICT` with `error.code = "CONFLICT"` and
  `error.message = "GitHub account is already connected to another PILO account"`.
- On callback failure, app-server redirects with `302` to the stored `returnUrl`
  when it can be safely recovered from callback state. If `returnUrl` cannot be
  recovered, app-server redirects to the configured frontend GitHub connection
  page, `{FRONTEND_URL}/github`.
- Callback failure redirects append `github_callback_error=<code>` so the
  frontend can show a user-facing error message instead of exposing raw JSON,
  raw provider errors, or a raw 500 page. The legacy
  `github_oauth_error=account_already_connected` query is still appended for the
  duplicate GitHub account OAuth case.
- Callback error query values:
  - `github_callback_error=account_already_connected`: the GitHub account is
    already connected to another PILO user.
  - `github_callback_error=authorization_cancelled`: GitHub authorization was
    cancelled or denied by the user.
  - `github_callback_error=invalid_state`: signed state, binding cookie, or
    one-time server-side state validation failed.
  - `github_callback_error=token_exchange_failed`: GitHub OAuth token exchange
    failed.
  - `github_callback_error=project_oauth_scope_missing`: ProjectV2 OAuth token
    was returned without the required `project` scope.
  - `github_callback_error=project_oauth_account_mismatch`: ProjectV2 OAuth
    account does not match the connected GitHub OAuth account.
  - `github_callback_error=installation_not_accessible`: callback installation
    is not accessible to the connected GitHub user.
  - `github_callback_error=installation_lookup_failed`: app-server could not
    look up the GitHub App installation safely.
  - `github_callback_error=installation_failed`: app-server could not save the
    GitHub App installation.
  - `github_callback_error=callback_failed` or
    `github_callback_error=connection_failed`: generic safe fallback for
    callback validation or connection failures.
