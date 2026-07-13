# Settings Module

Owner: 동현

API contract: `docs/api/settings-api.md`

현재 사용자 개인 환경설정의 조회·수정을 담당하는 도메인 모듈 경계다.

## Owned scope

- `GET /me/settings`
- `PATCH /me/settings`
- `user_settings` validation, mapping, query
- 기본 Workspace membership validation

## Boundaries

- 프로필과 계정 탈퇴는 User API와 `src/modules/user/`가 소유한다.
- Workspace 수정·삭제는 Workspace API와 `src/modules/workspace/`가 소유한다.
- GitHub OAuth와 installation은 GitHub Integration module이 소유한다.
- `SettingsModule`은 `AppModule`에 등록되어 bearer session 기준으로 동작한다.
