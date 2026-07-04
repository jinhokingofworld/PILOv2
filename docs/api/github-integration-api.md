# GitHub Integration API

External callback and webhook URLs MUST include the `/api/v1` base path. For example:
`/api/v1/github/oauth/callback`, `/api/v1/github/installations/callback`, and
`/api/v1/github/webhooks`.

The endpoint table below follows the common API documentation rule and omits the
`/api/v1` base path. External provider settings such as GitHub OAuth callback
URLs and webhook URLs must use the full public path including `/api/v1`.

## 외부 Provider 설정 URL

GitHub OAuth App, GitHub App, webhook 설정 화면에는 아래처럼 public origin과
`/api/v1` base path를 모두 포함한 URL을 등록한다.

```text
GitHub OAuth callback URL: {API_PUBLIC_ORIGIN}/api/v1/github/oauth/callback
GitHub App callback URL:   {API_PUBLIC_ORIGIN}/api/v1/github/installations/callback
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
| GitHub Review 제출 | 현재 사용자의 GitHub OAuth token | `users.github_access_token_encrypted` |
| PILO API 호출 | PILO access token | application auth/session layer |

GitHub token은 복호화된 상태로 응답하거나 로그에 남기지 않는다.

## 데이터 규칙

- `github_pull_requests.raw`에서 `state`, `draft`, `mergeable`, `head_sha`, `base_sha`를 파생한다.
- PR 변경 파일은 GitHub Integration의 별도 캐시 테이블에 저장하지 않는다.
- PR 변경 파일과 patch text는 요청 시 GitHub에서 조회한다.
- PR Review는 세션 생성 시 `review_files`에 파일 metadata를 저장할 수 있다. Diff 응답과 큰 diff 판단 기준은 PR Review API 문서를 따른다.
- `github_sync_target` 값은 `repositories`, `issues`, `pull_requests`, `project_v2`, `project_v2_fields`, `project_v2_items`, `full`이다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/me/github` | 현재 사용자의 GitHub OAuth 연결 상태 조회 |
| `POST` | `/me/github/oauth/start` | GitHub OAuth authorization URL 생성 |
| `GET` | `/github/oauth/callback` | GitHub OAuth callback |
| `DELETE` | `/me/github` | 현재 사용자의 GitHub OAuth 연결 해제 |
| `POST` | `/workspaces/{workspaceId}/github/installations/start` | GitHub App 설치 URL 생성 |
| `GET` | `/github/installations/callback` | GitHub App installation callback |
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
