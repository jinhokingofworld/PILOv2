# App Server Modules

NestJS app-server의 도메인별 API 구현 위치다.

API 관련 구현 전에는 repo 루트의 `AGENTS.md`, `docs/api/README.md`, 해당
도메인 API 문서를 먼저 확인한다. API 문서와 기능 명세가 충돌하면
`docs/api/*.md`를 최신 기준으로 본다.

| Module | Owner | API Contract |
| --- | --- | --- |
| `auth` | 동현 | `docs/api/auth-api.md` |
| `github-integration` | 주형 | `docs/api/github-integration-api.md` |
| `pr-review` | 은재 | `docs/api/pr-review-api.md` |
| `board` | 주형 | `docs/api/board-api.md` |
| `meeting` | 진호 | `docs/api/meeting-api.md` |
| `calendar` | 세인 | `docs/api/calendar-api.md` |
| `canvas` | 동현 | `docs/api/canvas-api.md` |

권장 구조:

- `*.module.ts`
- `*.controller.ts`
- `*.service.ts`
- `dto/`
- `repositories/` 또는 `queries/`
- `types/`

DB migration, RLS, FK, index 변경이 필요하면 DB Schema 담당자 확인 후
`db/migrations/`에 시간순 migration으로 추가한다.
