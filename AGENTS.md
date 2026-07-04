# PILO 작업 규칙

이 문서는 PILO repo에서 작업하는 사람과 AI agent가 공통으로 따르는 기준이다.

AI coding behavior는 `coding-rule.md`를 따른다.

## 협업 컨벤션

PR, commit, issue를 생성하거나 제목/본문을 작성하기 전에는 반드시 `convention.md`를 확인한다.

## API 계약 우선순위

API 관련 작업을 할 때는 먼저 `docs/api/README.md`와 해당 도메인 API 문서를 확인한다.

우선순위:

1. `docs/api/*.md` 현재 API 규약
2. `Project_Planning_Document.md` 기능 기획
3. `docs/api/incoming/*` 원본 초안

API 문서와 기능 명세가 충돌하면 `docs/api/*.md`를 최신 기준으로 본다. 구현 중 API 변경이 필요하면 코드 변경과 함께 해당 API 문서도 같이 수정한다.

## Domain Ownership

각 도메인은 담당자가 1차 책임을 가진다. 다른 팀원이 수정할 수는 있지만, API 계약이나 DB schema에 영향을 주는 변경은 해당 도메인 담당자와 DB Schema 담당자 확인 후 반영한다.

| Domain | Owner | Review Required For |
| --- | --- | --- |
| GitHub Integration | 주형 | GitHub App/OAuth, repository, issue, PR, ProjectV2 sync |
| PR Review | 은재 | review session, flow, diff, file decision, GitHub Review submission |
| Board | 주형 | board, column, issue hydration, kanban behavior |
| Meeting | 진호 | meeting room, participant, recording, report |
| Calendar | 세인 | calendar event, date panel, workspace schedule |
| Canvas | 동현 | freeform canvas, shape, viewport |
| Infra/Realtime | 진호 | realtime-server, deploy, env, secrets |
| DB Schema | 은재 | migrations, RLS, indexes, FK changes |

## 변경 규칙

- API endpoint, request, response, status code, auth rule 변경은 API 계약 변경으로 본다.
- Table, column, enum/check value, FK, index, RLS 변경은 DB schema 변경으로 본다.
- API 계약 변경과 DB schema 변경이 함께 필요하면 도메인 담당자와 DB Schema 담당자 모두 확인한다.
- `docs/api/incoming/`은 원본 보관용이다. 구현 기준 문서는 `docs/api/` 루트의 Markdown 파일이다.
- Frontend 공통 영역 변경은 여러 도메인 화면에 영향을 줄 수 있으므로 사이렌 변경으로 본다.

## Frontend 공통 영역

Frontend 공통 영역 기준은 `apps/frontend/FRONTEND_COMMON_AREAS.md`를 따른다.

대표 공통 영역:

- `apps/frontend/src/app/layout.tsx`
- `apps/frontend/src/app/globals.css`
- `apps/frontend/src/components/`
- `apps/frontend/src/components/ui/`
- `apps/frontend/src/hooks/`
- `apps/frontend/src/lib/`
- `apps/frontend/src/shared/`
- `apps/frontend/components.json`
- `apps/frontend/postcss.config.mjs`
- `apps/frontend/tsconfig.json`
- `apps/frontend/next.config.mjs`
- `apps/frontend/package.json`

공통 영역을 수정해야 하면 작업 전에 아래 내용을 먼저 정리하고 확인을 받는다.

- 수정하려는 공통 영역 경로
- 수정 사유
- 영향을 받을 수 있는 도메인 또는 화면
- 도메인 내부에서 해결할 수 없는 이유
- 검증 방법

도메인 작업 중 공통 영역 수정 필요가 새로 발견되면 즉시 멈추고 확인을 요청한다.
`src/app/<route>/page.tsx`가 `features/<domain>/page`를 re-export만 하는 경우는 route bridge로 보며 별도 공통 영역 사이렌 대상에서 제외한다.

## 구현 폴더

| Area | Path |
| --- | --- |
| App server domain modules | `apps/app-server/src/modules/<domain>/` |
| Frontend domain features | `apps/frontend/src/features/<domain>/` |
| Frontend common areas | `apps/frontend/FRONTEND_COMMON_AREAS.md` |
| Realtime server | `apps/realtime-server/src/` |
| DB migrations | `db/migrations/` |
| API contracts | `docs/api/` |

도메인 이름은 API 문서와 같은 kebab-case를 사용한다. 예: `github-integration`,
`pr-review`, `board`, `meeting`, `calendar`, `canvas`.

## 검증 규칙

- 문서만 수정한 경우 `git diff --check`를 실행한다.
- `apps/app-server` 수정 후에는 해당 디렉터리에서 `npm run lint`, `npm run test`, `npm run build` 중 변경 범위에 맞는 검증을 실행한다.
- `apps/frontend` 수정 후에는 해당 디렉터리에서 `npm run lint`, `npm run test`, `npm run build` 중 변경 범위에 맞는 검증을 실행한다.
- `apps/realtime-server` 수정 후에는 해당 디렉터리에서 `npm run lint`, `npm run test`, `npm run build` 중 변경 범위에 맞는 검증을 실행한다.
- `apps/ai-worker` 수정 후에는 해당 디렉터리에서 `ruff`, `black --check`, `pytest` 중 변경 범위에 맞는 검증을 실행한다.
- DB migration 수정 후에는 PostgreSQL/Supabase에 적용 가능한 SQL인지 확인한다. 공유 DB에 이미 적용된 migration은 수정하지 않고 새 migration을 추가한다.
- 검증을 실행하지 못했으면 최종 작업 보고에 실행하지 못한 이유를 남긴다.

## 보안 규칙

- `.env`, 실제 secret, token, private key는 commit하지 않는다.
- 예시 환경변수는 `.env.example`에 placeholder로만 작성한다.
- GitHub App installation token, 사용자 OAuth token, Supabase service role key, 복호화된 secret은 API 응답이나 로그에 남기지 않는다.
- 오류 응답에는 내부 secret, connection string, provider raw error 전체를 노출하지 않는다.
- 외부 서비스 webhook secret과 private key는 환경변수 또는 secret manager를 통해 주입한다.
