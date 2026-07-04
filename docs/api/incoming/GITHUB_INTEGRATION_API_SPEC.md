# GitHub Integration API Spec

작성일: 2026-07-03

## 1. 문서 범위

이 문서는 PILO의 GitHub 연동 공통 API를 정의한다.

이 문서가 소유하는 범위는 다음과 같다.

- 워크스페이스 단위 GitHub App 설치 및 installation 관리
- GitHub App installation token 기반 Repository, ProjectV2, Issue, Pull Request 조회/동기화
- PR 리뷰 제출을 위한 사용자 GitHub OAuth 연결 상태 관리
- GitHub 원본 PR 목록/상세/변경 파일/conflict 상태 조회
- GitHub 수동 동기화 실행 및 이력 조회

이 문서가 소유하지 않는 범위는 다음과 같다.

- PR 리뷰 세션 생성
- AI 리뷰 분석 결과
- 리뷰 Flow/File/Canvas 노드
- 파일별 리뷰 판단 및 내부 comment
- PILO 리뷰 결과를 GitHub Review로 제출하는 제출 기록
- PR 리뷰 화면 전용 diff view model

위 제외 범위는 [PR_REVIEW_API_SPEC.md](./PR_REVIEW_API_SPEC.md)에서 정의한다.

## 2. 인증 구조

GitHub 연동은 하이브리드 구조를 사용한다.

| 용도                                       | 인증 주체                     | 저장 위치                             | 설명                                 |
| ------------------------------------------ | ----------------------------- | ------------------------------------- | ------------------------------------ |
| Repository/Project/Issue/PR 읽기 및 동기화 | GitHub App installation token | `github_installations`                | 워크스페이스 단위 GitHub 데이터 조회 |
| GitHub Review 제출                         | 사용자 OAuth token            | `users.github_access_token_encrypted` | 실제 사용자 계정으로 PR Review 제출  |

PR 리뷰 기능은 PR 목록/상세/변경 파일/conflict 조회를 이 문서의 GitHub App 기반 API로 수행한다. 단, GitHub Review 제출 전에는 사용자 OAuth 연결 상태를 확인해야 한다.

## 3. 공통 규칙

### Base URL

```text
/api/v1
```

### 인증과 권한

- `/workspaces/{workspaceId}/...` 경로는 인증된 사용자만 호출할 수 있다.
- 호출 사용자는 대상 `workspaceId`에 접근 권한을 가져야 한다.
- 워크스페이스 단위 GitHub 데이터는 반드시 해당 워크스페이스의 GitHub App installation 범위 안에서 조회한다.
- `id` 필드는 클라이언트에서 불투명 식별자로 취급한다.

### 공통 성공 응답

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### 공통 실패 응답

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message"
  }
}
```

### 페이지네이션

목록 API는 `page`, `limit` query parameter를 사용한다.

| 필드    | 타입   | 기본값 | 설명                       |
| ------- | ------ | ------ | -------------------------- |
| `page`  | number | `1`    | 1부터 시작하는 페이지 번호 |
| `limit` | number | `20`   | 페이지당 항목 수           |

```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### 시간 형식

모든 시간 필드는 ISO 8601 UTC 문자열을 사용한다.

```text
2026-07-02T05:20:00.000Z
```

## 4. API 목록

| Method   | Endpoint                                                                         | 소유               | 설명                               |
| -------- | -------------------------------------------------------------------------------- | ------------------ | ---------------------------------- |
| `GET`    | `/me/github`                                                                     | GitHub Integration | 사용자 GitHub OAuth 연결 상태 조회 |
| `POST`   | `/me/github/oauth/start`                                                         | GitHub Integration | 사용자 GitHub OAuth 연결 시작      |
| `GET`    | `/github/oauth/callback`                                                         | GitHub Integration | 사용자 GitHub OAuth callback 처리  |
| `DELETE` | `/me/github`                                                                     | GitHub Integration | 사용자 GitHub OAuth 연결 해제      |
| `POST`   | `/workspaces/{workspaceId}/github/installations/start`                           | GitHub Integration | GitHub App 설치 URL 생성           |
| `GET`    | `/github/installations/callback`                                                 | GitHub Integration | GitHub App 설치 callback 처리      |
| `GET`    | `/workspaces/{workspaceId}/github/installations`                                 | GitHub Integration | GitHub App installation 목록 조회  |
| `GET`    | `/workspaces/{workspaceId}/github/repositories`                                  | GitHub Integration | Repository 목록 조회               |
| `GET`    | `/workspaces/{workspaceId}/github/repositories/{repositoryId}`                   | GitHub Integration | Repository 상세 조회               |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2`                                   | GitHub Integration | ProjectV2 목록 조회                |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}`                     | GitHub Integration | ProjectV2 상세 조회                |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/fields`              | GitHub Integration | ProjectV2 Field 목록 조회          |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/status-options`      | GitHub Integration | ProjectV2 Status 옵션 조회         |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban`              | GitHub Integration | ProjectV2 칸반보드 조회            |
| `GET`    | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/items`               | GitHub Integration | ProjectV2 Item 목록 조회           |
| `GET`    | `/workspaces/{workspaceId}/github/issues/{issueId}`                              | GitHub Integration | Issue 상세 조회                    |
| `GET`    | `/workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests`     | GitHub Integration | Repository PR 목록 조회            |
| `GET`    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}`                 | GitHub Integration | PR 상세 조회                       |
| `GET`    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/files`           | GitHub Integration | PR 변경 파일 조회                  |
| `GET`    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/conflict-status` | GitHub Integration | PR conflict 상태 조회              |
| `POST`   | `/workspaces/{workspaceId}/github/sync-runs`                                     | GitHub Integration | GitHub 데이터 수동 동기화 시작     |
| `GET`    | `/workspaces/{workspaceId}/github/sync-runs`                                     | GitHub Integration | 동기화 이력 조회                   |
| `GET`    | `/workspaces/{workspaceId}/github/sync-runs/{syncRunId}`                         | GitHub Integration | 동기화 상세 조회                   |

## 5. 사용자 GitHub OAuth

사용자 GitHub OAuth는 GitHub Review를 실제 사용자 계정으로 제출하기 위해 필요하다. Repository/PR 조회에는 사용하지 않는다.

### 5.1 내 GitHub OAuth 연결 상태 조회

| 항목        | 내용         |
| ----------- | ------------ |
| Method      | `GET`        |
| Endpoint    | `/me/github` |
| 주요 테이블 | `users`      |

#### Response Body

```json
{
  "success": true,
  "data": {
    "connected": true,
    "githubUserId": 12345678,
    "githubLogin": "jinhokingofworld",
    "tokenScope": "repo,read:user",
    "githubConnectedAt": "2026-07-02T13:00:00.000Z",
    "githubRevokedAt": null
  }
}
```

### 5.2 사용자 GitHub OAuth 연결 시작

| 항목        | 내용                     |
| ----------- | ------------------------ |
| Method      | `POST`                   |
| Endpoint    | `/me/github/oauth/start` |
| 주요 테이블 | `users`                  |

#### Request Body

```json
{
  "returnUrl": "https://pilo.app/settings/integrations/github"
}
```

#### Response Body

```json
{
  "success": true,
  "data": {
    "authorizeUrl": "https://github.com/login/oauth/authorize?client_id=...&state=abc123&scope=repo%20read:user",
    "state": "abc123"
  }
}
```

#### 구현 메모

- `state`는 CSRF 방지 및 사용자 매핑에 사용한다.
- GitHub Review 제출에는 `repo` 권한이 필요하다.
- 발급받은 access token은 `users.github_access_token_encrypted`에 암호화 저장한다.

### 5.3 사용자 GitHub OAuth Callback

| 항목        | 내용                     |
| ----------- | ------------------------ |
| Method      | `GET`                    |
| Endpoint    | `/github/oauth/callback` |
| 주요 테이블 | `users`                  |

#### Query Params

| 이름    | 타입   | 필수 | 설명                            |
| ------- | ------ | ---- | ------------------------------- |
| `code`  | string | Y    | GitHub OAuth authorization code |
| `state` | string | Y    | OAuth 시작 시 발급한 state      |

#### Response Body

```json
{
  "success": true,
  "data": {
    "connected": true,
    "githubUserId": 12345678,
    "githubLogin": "jinhokingofworld",
    "tokenScope": "repo,read:user",
    "githubConnectedAt": "2026-07-02T13:00:00.000Z"
  }
}
```

### 5.4 사용자 GitHub OAuth 연결 해제

| 항목        | 내용         |
| ----------- | ------------ |
| Method      | `DELETE`     |
| Endpoint    | `/me/github` |
| 주요 테이블 | `users`      |

#### Response Body

```json
{
  "success": true,
  "data": {
    "disconnected": true
  }
}
```

#### 저장 규칙

- `github_access_token_encrypted`는 제거하거나 사용할 수 없는 값으로 갱신한다.
- `github_revoked_at`을 기록한다.

## 6. GitHub App 연동

### 6.1 GitHub App 설치 URL 생성

| 항목        | 내용                                                   |
| ----------- | ------------------------------------------------------ |
| Method      | `POST`                                                 |
| Endpoint    | `/workspaces/{workspaceId}/github/installations/start` |
| 주요 테이블 | `github_installations`                                 |

#### Request Body

```json
{
  "returnUrl": "https://pilo.app/workspaces/{workspaceId}/github/callback"
}
```

#### Response Body

```json
{
  "success": true,
  "data": {
    "installUrl": "https://github.com/apps/pilo-github-app/installations/new?state=abc123",
    "state": "abc123"
  }
}
```

### 6.2 GitHub App 설치 Callback

| 항목        | 내용                                    |
| ----------- | --------------------------------------- |
| Method      | `GET`                                   |
| Endpoint    | `/github/installations/callback`        |
| 주요 테이블 | `github_installations`, `activity_logs` |

#### Query Params

| 이름              | 타입   | 필수 | 설명                          |
| ----------------- | ------ | ---- | ----------------------------- |
| `installation_id` | string | Y    | GitHub installation ID        |
| `setup_action`    | string | Y    | GitHub setup action           |
| `state`           | string | Y    | 설치 URL 생성 시 발급한 state |

#### Response Body

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_123",
    "installationId": "inst_123",
    "githubInstallationId": 12345678,
    "accountLogin": "my-team",
    "accountType": "Organization"
  }
}
```

### 6.3 GitHub Installation 목록 조회

| 항목        | 내용                                             |
| ----------- | ------------------------------------------------ |
| Method      | `GET`                                            |
| Endpoint    | `/workspaces/{workspaceId}/github/installations` |
| 주요 테이블 | `github_installations`                           |

#### Query Params

| 이름    | 타입   | 필수 | 설명             |
| ------- | ------ | ---- | ---------------- |
| `page`  | number | N    | 페이지 번호      |
| `limit` | number | N    | 페이지당 항목 수 |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "inst_123",
      "githubInstallationId": 12345678,
      "accountLogin": "my-team",
      "accountType": "Organization",
      "repositorySelection": "selected",
      "permissions": {
        "metadata": "read",
        "contents": "read",
        "issues": "read",
        "pull_requests": "read",
        "organization_projects": "read"
      },
      "installedAt": "2026-07-02T05:10:00.000Z",
      "suspendedAt": null,
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 7. Repository

### 7.1 Repository 목록 조회

| 항목        | 내용                                            |
| ----------- | ----------------------------------------------- |
| Method      | `GET`                                           |
| Endpoint    | `/workspaces/{workspaceId}/github/repositories` |
| 주요 테이블 | `github_repositories`                           |

#### Query Params

| 이름              | 타입    | 필수 | 설명                                          |
| ----------------- | ------- | ---- | --------------------------------------------- |
| `q`               | string  | N    | repository 이름 또는 full name 검색어         |
| `includeArchived` | boolean | N    | archived repository 포함 여부. 기본값 `false` |
| `page`            | number  | N    | 페이지 번호                                   |
| `limit`           | number  | N    | 페이지당 항목 수                              |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "repo_123",
      "githubRepositoryId": 987654321,
      "githubNodeId": "R_kgDOExample",
      "ownerLogin": "my-team",
      "name": "pilo",
      "fullName": "my-team/pilo",
      "private": true,
      "archived": false,
      "defaultBranch": "main",
      "htmlUrl": "https://github.com/my-team/pilo",
      "pushedAt": "2026-07-01T14:30:00.000Z",
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### 7.2 Repository 상세 조회

| 항목        | 내용                                                           |
| ----------- | -------------------------------------------------------------- |
| Method      | `GET`                                                          |
| Endpoint    | `/workspaces/{workspaceId}/github/repositories/{repositoryId}` |
| 주요 테이블 | `github_repositories`                                          |

#### Response Body

```json
{
  "success": true,
  "data": {
    "id": "repo_123",
    "githubRepositoryId": 987654321,
    "githubNodeId": "R_kgDOExample",
    "ownerLogin": "my-team",
    "name": "pilo",
    "fullName": "my-team/pilo",
    "private": true,
    "archived": false,
    "defaultBranch": "main",
    "htmlUrl": "https://github.com/my-team/pilo",
    "githubCreatedAt": "2026-06-20T03:00:00.000Z",
    "githubUpdatedAt": "2026-07-01T14:30:00.000Z",
    "pushedAt": "2026-07-01T14:30:00.000Z",
    "lastSyncedAt": "2026-07-02T05:20:00.000Z"
  }
}
```

## 8. GitHub ProjectV2

ProjectV2 API는 GitHub App installation token으로 조회한다.

| Method | Endpoint                                                                    | 설명                                  |
| ------ | --------------------------------------------------------------------------- | ------------------------------------- |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2`                              | ProjectV2 목록 조회                   |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}`                | ProjectV2 상세 조회                   |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/fields`         | ProjectV2 Field 목록 조회             |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/status-options` | 칸반 컬럼으로 사용할 Status 옵션 조회 |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban`         | ProjectV2 칸반보드 조회               |
| `GET`  | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/items`          | ProjectV2 Item 목록 조회              |

### 8.1 ProjectV2 목록 조회

#### Query Params

| 이름         | 타입    | 필수 | 설명                     |
| ------------ | ------- | ---- | ------------------------ |
| `ownerLogin` | string  | N    | ProjectV2 owner login    |
| `closed`     | boolean | N    | 종료된 project 포함 여부 |
| `q`          | string  | N    | project title 검색어     |
| `page`       | number  | N    | 페이지 번호              |
| `limit`      | number  | N    | 페이지당 항목 수         |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "proj_123",
      "githubProjectNodeId": "PVT_kwDOExample",
      "githubProjectFullDatabaseId": 42,
      "ownerLogin": "my-team",
      "ownerType": "Organization",
      "projectNumber": 1,
      "title": "PILO MVP",
      "shortDescription": "MVP project board",
      "url": "https://github.com/orgs/my-team/projects/1",
      "public": false,
      "closed": false,
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### 8.2 ProjectV2 칸반보드 조회

| 항목     | 내용                                                                |
| -------- | ------------------------------------------------------------------- |
| Method   | `GET`                                                               |
| Endpoint | `/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban` |

#### Response Body

```json
{
  "success": true,
  "data": {
    "project": {
      "id": "proj_123",
      "title": "PILO MVP"
    },
    "columns": [
      {
        "id": "opt_1",
        "name": "Backlog",
        "key": "backlog",
        "position": 1,
        "items": [
          {
            "id": "item_1",
            "contentType": "PULL_REQUEST",
            "pullRequestId": "pr_1",
            "title": "Add PR review flow",
            "url": "https://github.com/my-team/pilo/pull/15",
            "assignees": [],
            "labels": []
          }
        ]
      }
    ]
  }
}
```

## 9. Issue

### 9.1 Issue 상세 조회

| 항목        | 내용                                                |
| ----------- | --------------------------------------------------- |
| Method      | `GET`                                               |
| Endpoint    | `/workspaces/{workspaceId}/github/issues/{issueId}` |
| 주요 테이블 | `github_issues`                                     |

#### Response Body

```json
{
  "success": true,
  "data": {
    "id": "issue_1",
    "repositoryId": "repo_123",
    "issueNumber": 10,
    "title": "Improve meeting summary",
    "state": "open",
    "authorLogin": "jinhokingofworld",
    "htmlUrl": "https://github.com/my-team/pilo/issues/10",
    "githubCreatedAt": "2026-07-01T10:00:00.000Z",
    "githubUpdatedAt": "2026-07-02T05:20:00.000Z"
  }
}
```

## 10. Pull Request 원본 조회

PR 원본 조회 API는 GitHub App installation token을 사용한다. PR 리뷰 화면은 이 API를 사용해 PR 목록, 상세, 변경 파일, conflict 상태를 표시한다.

### 10.1 Repository PR 목록 조회

| 항목        | 내용                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| Method      | `GET`                                                                        |
| Endpoint    | `/workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests` |
| 주요 테이블 | `github_pull_requests`                                                       |

#### Query Params

| 이름    | 타입   | 필수 | 설명                                           |
| ------- | ------ | ---- | ---------------------------------------------- |
| `state` | string | N    | `open`, `closed`. PR 리뷰 화면은 `open`만 사용 |
| `query` | string | N    | PR 번호 또는 제목 검색어                       |
| `page`  | number | N    | 페이지 번호                                    |
| `limit` | number | N    | 페이지당 항목 수. PR 리뷰 화면 기본값 `10`     |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "pr_1",
      "repositoryId": "repo_123",
      "githubPullRequestId": 123456789,
      "githubNumber": 24,
      "title": "음성회의 및 리포트 페이지 목업 구현",
      "authorName": "jinhokingofworld",
      "authorAvatarUrl": "https://avatars.githubusercontent.com/u/12345678?v=4",
      "state": "open",
      "draft": false,
      "createdAtGithub": "2026-07-01T10:00:00.000Z",
      "updatedAtGithub": "2026-07-02T13:10:00.000Z",
      "relativeTime": "opened 19 hours ago",
      "headBranch": "feature/voice-report",
      "baseBranch": "main",
      "headSha": "abc123",
      "baseSha": "def456",
      "changedFilesCount": 5,
      "additions": 128,
      "deletions": 32,
      "commitsCount": 3,
      "commentsCount": 1,
      "reviewCommentsCount": 0,
      "githubUrl": "https://github.com/my-team/pilo/pull/24"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1
  }
}
```

### 10.2 PR 상세 조회

| 항목        | 내용                                                             |
| ----------- | ---------------------------------------------------------------- |
| Method      | `GET`                                                            |
| Endpoint    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}` |
| 주요 테이블 | `github_pull_requests`                                           |

#### Response Body

```json
{
  "success": true,
  "data": {
    "id": "pr_1",
    "repositoryId": "repo_123",
    "githubNumber": 24,
    "title": "음성회의 및 리포트 페이지 목업 구현",
    "authorName": "jinhokingofworld",
    "authorAvatarUrl": "https://avatars.githubusercontent.com/u/12345678?v=4",
    "state": "open",
    "draft": false,
    "createdAtGithub": "2026-07-01T10:00:00.000Z",
    "updatedAtGithub": "2026-07-02T13:10:00.000Z",
    "headBranch": "feature/voice-report",
    "baseBranch": "main",
    "headSha": "abc123",
    "baseSha": "def456",
    "changedFilesCount": 5,
    "additions": 128,
    "deletions": 32,
    "commitsCount": 3,
    "description": "GitHub PR body",
    "githubUrl": "https://github.com/my-team/pilo/pull/24",
    "lastSyncedAt": "2026-07-02T13:10:00.000Z"
  }
}
```

### 10.3 PR 변경 파일 조회

| 항목        | 내용                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| Method      | `GET`                                                                          |
| Endpoint    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/files`         |
| 주요 테이블 | 즉시 조회 API는 별도 저장 테이블 없음. 리뷰 세션 생성 시 `review_files`에 저장 |

#### Query Params

| 이름    | 타입   | 필수 | 설명             |
| ------- | ------ | ---- | ---------------- |
| `page`  | number | N    | 페이지 번호      |
| `limit` | number | N    | 페이지당 항목 수 |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "filePath": "apps/frontend/VoiceMeetingPage.tsx",
      "previousFilePath": null,
      "fileName": "VoiceMeetingPage.tsx",
      "fileStatus": "modified",
      "additions": 84,
      "deletions": 12,
      "changes": 96,
      "isBinary": false,
      "isLargeDiff": false,
      "blobUrl": "https://github.com/my-team/pilo/blob/abc123/apps/frontend/VoiceMeetingPage.tsx",
      "rawUrl": "https://github.com/my-team/pilo/raw/abc123/apps/frontend/VoiceMeetingPage.tsx",
      "contentsUrl": "https://api.github.com/repos/my-team/pilo/contents/apps/frontend/VoiceMeetingPage.tsx",
      "githubFileUrl": "https://github.com/my-team/pilo/pull/24/files#diff-abc",
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

### 10.4 PR Conflict 상태 조회

| 항목        | 내용                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| Method      | `GET`                                                                            |
| Endpoint    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/conflict-status` |
| 주요 테이블 | 조회 결과는 PR 리뷰 세션 생성 시 `pr_review_sessions`에 snapshot 저장            |

#### Response Body

```json
{
  "success": true,
  "data": {
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-02T13:12:00.000Z",
    "message": "Conflict가 없는 상태입니다."
  }
}
```

#### 상태값

| 값           | 설명                             |
| ------------ | -------------------------------- |
| `checking`   | GitHub에서 mergeable 계산 중     |
| `clean`      | conflict 없음                    |
| `conflicted` | conflict 있음                    |
| `unknown`    | GitHub API 오류 등으로 판단 불가 |

## 11. GitHub 수동 동기화

### 11.1 GitHub 데이터 수동 동기화 시작

| 항목        | 내용                                                        |
| ----------- | ----------------------------------------------------------- |
| Method      | `POST`                                                      |
| Endpoint    | `/workspaces/{workspaceId}/github/sync-runs`                |
| 주요 테이블 | `github_sync_runs`, `api_idempotency_keys`, `activity_logs` |

#### Headers

| 이름              | 필수 | 설명                       |
| ----------------- | ---- | -------------------------- |
| `Idempotency-Key` | 권장 | 같은 요청의 중복 실행 방지 |

#### Request Body

```json
{
  "target": "full",
  "installationId": "inst_123",
  "repositoryId": "repo_123",
  "projectV2Id": "proj_123"
}
```

#### Response Body

```json
{
  "success": true,
  "data": {
    "id": "sync_1",
    "target": "full",
    "status": "running",
    "installationId": "inst_123",
    "repositoryId": "repo_123",
    "projectV2Id": "proj_123",
    "startedAt": "2026-07-02T05:40:00.000Z",
    "finishedAt": null,
    "fetchedCount": 0,
    "createdCount": 0,
    "updatedCount": 0,
    "skippedCount": 0,
    "errorMessage": null
  }
}
```

### 11.2 동기화 이력 조회

| 항목     | 내용                                         |
| -------- | -------------------------------------------- |
| Method   | `GET`                                        |
| Endpoint | `/workspaces/{workspaceId}/github/sync-runs` |

#### Query Params

| 이름           | 타입   | 필수 | 설명                           |
| -------------- | ------ | ---- | ------------------------------ |
| `target`       | string | N    | 동기화 대상                    |
| `status`       | string | N    | `running`, `success`, `failed` |
| `repositoryId` | string | N    | Repository 필터                |
| `projectV2Id`  | string | N    | ProjectV2 필터                 |
| `page`         | number | N    | 페이지 번호                    |
| `limit`        | number | N    | 페이지당 항목 수               |

#### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "sync_1",
      "target": "full",
      "status": "success",
      "repositoryId": "repo_123",
      "projectV2Id": "proj_123",
      "startedAt": "2026-07-02T05:40:00.000Z",
      "finishedAt": "2026-07-02T05:41:20.000Z",
      "fetchedCount": 150,
      "createdCount": 20,
      "updatedCount": 35,
      "skippedCount": 95,
      "errorMessage": null
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### 11.3 동기화 상세 조회

| 항목     | 내용                                                     |
| -------- | -------------------------------------------------------- |
| Method   | `GET`                                                    |
| Endpoint | `/workspaces/{workspaceId}/github/sync-runs/{syncRunId}` |

#### Response Body

```json
{
  "success": true,
  "data": {
    "id": "sync_1",
    "target": "full",
    "status": "success",
    "installationId": "inst_123",
    "repositoryId": "repo_123",
    "projectV2Id": "proj_123",
    "startedAt": "2026-07-02T05:40:00.000Z",
    "finishedAt": "2026-07-02T05:41:20.000Z",
    "fetchedCount": 150,
    "createdCount": 20,
    "updatedCount": 35,
    "skippedCount": 95,
    "errorMessage": null,
    "cursor": {
      "projectItemsEndCursor": "Y3Vyc29yOnYyOpHOD...",
      "hasNextPage": false
    }
  }
}
```

## 12. 오류 코드

| HTTP Status | Code                             | 설명                                                                         |
| ----------- | -------------------------------- | ---------------------------------------------------------------------------- |
| 400         | `INVALID_REQUEST`                | request body 또는 query parameter가 유효하지 않음                            |
| 401         | `UNAUTHORIZED`                   | 인증되지 않은 요청                                                           |
| 403         | `FORBIDDEN`                      | workspace 접근 권한 없음                                                     |
| 403         | `GITHUB_PERMISSION_INSUFFICIENT` | GitHub App installation 권한 부족                                            |
| 404         | `NOT_FOUND`                      | 요청한 installation, repository, project, issue, PR, sync run을 찾을 수 없음 |
| 409         | `CONFLICT`                       | 중복 설치, 중복 동기화, idempotency 충돌                                     |
| 422         | `UNPROCESSABLE_ENTITY`           | GitHub 상태상 요청을 처리할 수 없음                                          |
| 429         | `RATE_LIMITED`                   | GitHub API 또는 서비스 rate limit 초과                                       |
| 500         | `INTERNAL_ERROR`                 | 서버 내부 오류                                                               |
| 502         | `GITHUB_API_ERROR`               | GitHub API 호출 실패                                                         |
