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
- App Server 공통 영역 변경은 여러 API 도메인과 서버 부팅 흐름에 영향을 줄 수 있으므로 사이렌 변경으로 본다.

## Frontend 공통 영역

Frontend 공통 영역 기준은 `apps/frontend/FRONTEND_COMMON_AREAS.md`를 따른다.

반드시 PR올리기 전에 `apps/frontend/FRONTEND_COMMON_AREAS.md`에서 공통영역인지 확인한다.

## App Server 공통 영역

App Server 공통 영역 기준은 `apps/app-server/APP_SERVER_COMMON_AREAS.md`를 따른다.

반드시 PR올리기 전에 `apps/app-server/APP_SERVER_COMMON_AREAS.md`에서 공통영역인지 확인한다.