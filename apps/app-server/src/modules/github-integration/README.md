# GitHub Integration Module

Owner: 주형

API contract: `docs/api/github-integration-api.md`

범위:

- GitHub App installation 연결
- 사용자 GitHub OAuth 연결 상태
- repository, issue, pull request, ProjectV2 원본 조회
- GitHub sync run과 webhook 처리

주의:

- Repository/Issue/PR/ProjectV2 조회와 동기화는 GitHub App installation token을 사용한다.
- GitHub Review 제출은 이 모듈이 아니라 PR Review 모듈에서 사용자 OAuth token으로 처리한다.
