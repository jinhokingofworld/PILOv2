# PILO API 명세

이 디렉터리는 PILO MVP의 현재 API 계약을 보관한다.

`incoming/`은 사용자가 전달한 원본 초안을 그대로 보존하는 공간이다. 이
디렉터리 루트의 Markdown 파일들이 구현 기준 정리본이며,
`Project_Planning_Document.md`와 `db/migrations/` 기준에 맞춰 유지한다.

API 문서와 기능 명세가 충돌하면 이 디렉터리 루트의 API 문서를 최신 기준으로
본다. 도메인별 담당자는 repo 루트의 `AGENTS.md`를 따른다.

## 문서 목록

| 문서 | 범위 |
| --- | --- |
| [auth-api.md](auth-api.md) | Google/GitHub 로그인 OAuth, bearer session 발급과 logout |
| [user-api.md](user-api.md) | 현재 PILO 사용자 profile과 도메인 API의 current user 기준 |
| [workspace-api.md](workspace-api.md) | 로그인 시 생성된 Workspace 목록, 상세 조회와 공통 접근 경계 |
| [workspace-membership-api.md](workspace-membership-api.md) | Workspace owner/member membership과 email 초대 MVP |
| [github-integration-api.md](github-integration-api.md) | GitHub App/OAuth, repository, issue, PR, ProjectV2 원본 조회와 동기화 |
| [board-api.md](board-api.md) | GitHub Project Kanban 보드 캐시, issue 생성/수정과 Status 변경 API |
| [pr-review-api.md](pr-review-api.md) | PR review session, flow, file, diff view model, 파일별 판단, GitHub Review 제출 |
| [meeting-api.md](meeting-api.md) | 고정 Workspace 회의 페이지, LiveKit 회의 생명주기, 녹음, 회의록 |
| [canvas-api.md](canvas-api.md) | 자유형 Workspace 캔버스와 도형 |
| [sqltoerd-api.md](sqltoerd-api.md) | Workspace sqltoerd MVP session 저장, 복원, 자동 저장 |
| [calendar-api.md](calendar-api.md) | Workspace 일정 CRUD |

## 공통 규칙

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <pilo_access_token>`
- API 응답에는 GitHub installation token, 사용자 OAuth token, 복호화된 secret을 노출하지 않는다.
- GitHub Repository/Issue/PR와 organization ProjectV2 원본 조회와 동기화는 GitHub App installation token을 사용한다.
- 개인 계정 ProjectV2 원본 조회와 동기화는 현재 사용자의 GitHub App user OAuth token을 사용한다.
- GitHub PR Review 제출은 GitHub Integration의 `/me/github/oauth/start`로 연결한 현재 사용자의 GitHub App user OAuth token을 사용한다.
- Supabase public table은 baseline all-deny RLS가 켜져 있다. 명시적인 client policy를 추가하기 전까지 app-server가 서버 권한으로 DB에 접근한다.
- MVP 제외: GitHub Integration 공개 repository write endpoint, PR merge/close, GitHub inline review comment, ProjectV2 field/option 설정 API, 캘린더 반복/알림/외부 연동, MeetingRoom 관리, 자유형 캔버스 실시간 협업.

## Domain Ownership

| Domain | Owner |
| --- | --- |
| Auth | 동현 |
| GitHub Integration | 주형 |
| PR Review | 은재 |
| Board | 주형 |
| Meeting | 진호 |
| Calendar | 세인 |
| Canvas | 동현 |
| sqltoerd | 세인 |
| Infra/Realtime | 진호 |
| DB Schema | 은재 |
