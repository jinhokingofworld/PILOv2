# GitHub Integration Module

Owner: 주형

API contract: `docs/api/github-integration-api.md`

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
- Repository/Issue/PR/ProjectV2 조회와 동기화는 GitHub App installation token을 사용한다.
- GitHub Review 제출 공개 API는 PR Review가 소유하고, 이 모듈은 PR Review가 호출하는
  서버 내부 OAuth token/decrypt 및 body-only 제출 adapter를 제공한다.
- GitHub App `Pull requests: write` permission이 없으면 Review 제출은 권한 부족 에러로
  실패한다.
