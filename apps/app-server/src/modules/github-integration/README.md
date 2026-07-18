# GitHub Integration Module

Owner: 주형

API contract: `docs/api/github-integration-api.md`

## Safe app-user OAuth recovery

App-user credentials are capability-validated against GitHub user-installation lookup
before persistence. Failed validation leaves the current credential intact. OAuth callback
state includes the expected active connection identity; conditional replacement rejects
stale callbacks. Reconnect-required failures are distinct from rate-limit and transient
lookup failures so callers can retry without destructive credential mutation.

경계 보강:

- GitHub Review 제출 공개 API는 PR Review가 소유한다.
- GitHub Integration은 PR Review가 사용하는 서버 내부 OAuth token/decrypt 경계와
  body-only GitHub Review 제출 adapter를 소유한다.
- adapter는 raw GitHub token, 복호화된 token 값, provider secret 정보를 API 응답이나
  로그로 노출하지 않는다.
- GitHub Review 제출에는 GitHub App `Pull requests: write` permission이 필요하며,
  GitHub 403 응답은 safe permission error로 매핑한다.

범위:

- GitHub App installation 연결
- 사용자 GitHub OAuth 연결 상태
- repository, issue, pull request, ProjectV2 원본 조회
- GitHub sync run과 webhook 처리

주의:

- GitHub App 설치 완료 redirect 경로는 GitHub App 설정의 Setup URL에 등록한다.
- GitHub App installation 연결은 현재 사용자의 GitHub App user access token을 선행 조건으로 두고, callback의 `installation_id`가 해당 사용자에게 접근 가능한 installation인지 검증한 뒤 저장한다.
- `/user/installations` 조회가 가능한 GitHub App user access token이 필요하다. classic OAuth App token만 저장된 상태면 installation 시작 단계에서 거절한다.
- Repository/Issue/PR와 organization ProjectV2 조회와 동기화는 GitHub App installation token을 사용한다.
- GitHub App installation 삭제는 repository, ProjectV2, repository link와 Board cache identity를 보존하고 repository/ProjectV2의 `installation_id`만 `NULL`로 분리한다. 같은 Workspace의 재연결 sync는 workspace-scoped remote identity upsert로 두 row를 새 installation에 재결합하며 기존 Board id를 재사용한다.
- installation이 분리된 cache는 새 installation에 재결합되기 전까지 active repository/ProjectV2 목록, ProjectV2 상세 read, installation-scoped sync 및 Board write 대상이 아니다. 공개 ProjectV2 payload의 `installationId`는 nullable로 바꾸지 않는다.
- ProjectV2 OAuth authorize scope는 정확히 `read:user user:email project repo`이며 callback과 runtime은 project and repo scopes를 모두 요구한다. 기존 `project`-only 연결은 다시 연결해야 한다.
- personal ProjectV2 조회/쓰기/동기화와 Board issue create는 별도 GitHub OAuth App token(`purpose=project_v2`)을 사용한다.
- Board issue update와 assignee 변경·조회, PR Review는 GitHub App user OAuth token(`purpose=app_user`)을 유지한다.
- The repo scope grants broad read/write access to public and private repositories available to the connected GitHub user.
- GitHub Review 제출 공개 API는 PR Review가 소유하고, 이 모듈은 PR Review가 호출하는
  서버 내부 OAuth token/decrypt 및 body-only 제출 adapter를 제공한다.
- GitHub App `Pull requests: write` permission이 없으면 Review 제출은 권한 부족 에러로
  실패한다.
