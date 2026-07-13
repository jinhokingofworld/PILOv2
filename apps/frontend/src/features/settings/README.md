# Settings Feature

Owner: 동현

API contract: `docs/api/settings-api.md`

PILO 사용자 설정 화면과 개인 환경설정 상태를 둔다.

## Owned scope

- 일반 설정: 기본 Workspace, 시작 화면, 마지막 Workspace 복원
- 화면 설정: theme, density
- GitHub Integration 후속 작업을 위한 설정 탭 UI 진입점
- 설정 Dialog 안의 프로필(조회 전용), 계정, 개인 설정 통합 구성
- 설정 Dialog의 탭 구성과 저장 상태

## Boundaries

- 프로필 조회와 계정 정보 수정/탈퇴 계약은 `docs/api/user-api.md`를 따른다.
- Workspace 이름·아이콘 수정과 삭제 계약은 `docs/api/workspace-api.md`를 따른다.
- GitHub 연결 상태와 연결 관리는 `src/features/github-integration/`과
  `docs/api/github-integration-api.md`의 책임이다. Settings feature는 해당 구현을
  소유하거나 복제하지 않으며, 현재 GitHub 탭은 후속 연동용 placeholder만 제공한다.
- 공통 Dialog primitive와 Sidebar shell은 `src/components/`에 남기고, 도메인별
  상태와 API 호출은 이 feature 또는 각 소유 feature에 둔다.
