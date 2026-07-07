# Frontend Features

Next.js frontend의 도메인별 UI와 client-side feature logic 위치다.

Route 파일은 `src/app`에 두고, 화면 구성 요소, hooks, API client, local state,
types는 가능한 한 이 디렉터리의 도메인 폴더에 둔다.

| Feature | Owner | API Contract |
| --- | --- | --- |
| `auth` | 동현 | `docs/api/auth-api.md` |
| `github-integration` | 주형 | `docs/api/github-integration-api.md` |
| `pr-review` | 은재 | `docs/api/pr-review-api.md` |
| `board` | 주형 | `docs/api/board-api.md` |
| `meeting` | 진호 | `docs/api/meeting-api.md` |
| `calendar` | 세인 | `docs/api/calendar-api.md` |
| `canvas` | 동현 | `docs/api/canvas-api.md` |
| `sql-erd` | 세인 | `docs/api/sqltoerd-api.md` |

권장 구조:

- `components/`
- `hooks/`
- `api/`
- `types/`
- `utils/`
