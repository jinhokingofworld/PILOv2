# GitHub Integration Module

Owner: 주형

API contract: `docs/api/github-integration-api.md`

범위:

- GitHub App installation 연결
- 사용자 GitHub OAuth 연결 상태
- repository, issue, pull request, ProjectV2 원본 조회
- GitHub sync run과 webhook 처리

주의:

- GitHub App 설치 완료 redirect 경로는 GitHub App 설정의 Setup URL에 등록한다.
- GitHub App installation 연결은 현재 사용자의 GitHub App user access token을 선행 조건으로 두고, callback의 `installation_id`가 해당 사용자에게 접근 가능한 installation인지 검증한 뒤 저장한다.
- `/user/installations` 조회가 가능한 GitHub App user access token이 필요하다. classic OAuth App token만 저장된 상태면 installation 시작 단계에서 거절한다.
- Repository/Issue/PR/ProjectV2 조회와 동기화는 GitHub App installation token을 사용한다.
- GitHub Review 제출은 이 모듈이 아니라 PR Review 모듈에서 사용자 OAuth token으로 처리한다.
