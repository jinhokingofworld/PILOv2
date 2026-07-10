# PR Review Post-MVP Conflict 구현 체크리스트

이 문서는 PR Review Post-MVP 중 `AI Conflict Resolution Assistant` 구현을 작은 PR
단위로 일관되게 진행하기 위한 체크리스트다. 방향과 범위는 `POST_MVP.md`를 기준으로
하고, API 계약은 `docs/api/pr-review-api.md`를 기준으로 한다.

## 진행 원칙

- 각 PR은 하나의 Phase slice만 다룬다.
- API 계약 변경이 있으면 `docs/api/pr-review-api.md`를 함께 수정한다.
- DB schema 변경이 필요하면 새 migration을 추가하고 이 문서의 stop gate를 확인한다.
- GitHub write action은 read-only 분석 PR에 포함하지 않는다.
- AI suggestion, apply resolution, merge 실행은 서로 다른 PR로 분리한다.
- 애매한 구현 선택지가 생기면 구현 전에 멈추고 결정한다.

## Phase 추적

| Phase | 목적 | Issue | PR | 상태 |
| --- | --- | --- | --- | --- |
| 1-A | Scope and contract | #503 | #504 | 완료 |
| 1-B | Read-only conflict analysis backend | #506 | #507 | 완료 |
| 1-C | Review room conflict UX | #508 | #511 | 완료 |
| 1-D | AI suggestion draft | #512 | #515 | 구현 완료 |
| 1-E | Apply resolution write path | #529 | TBD | 구현 완료 |

## 공통 Stop Gate

아래 항목 중 하나라도 해당하면 즉시 멈추고 확인받는다.

- API endpoint, request, response, status code, auth rule 변경
- DB table, column, enum/check value, FK, index, RLS 변경
- GitHub write permission, branch commit, merge API 호출 추가
- GitHub Integration 공개 API 확장
- AI provider 호출 방식, prompt contract, output schema 변경
- App Server 공통 영역 변경
- Frontend 공통 영역 변경
- 여러 구현 방식 중 하나를 선택해야 하는 경우

## 1-B Read-only Conflict Analysis Backend

목표:

- review session 기준 conflict analysis 조회 API를 구현한다.
- conflict PR의 content / line conflict hunk를 read-only로 계산한다.
- DB 저장, AI suggestion, apply resolution, branch commit, merge 실행은 하지 않는다.

작업 체크리스트:

- [x] `node-diff3` dependency를 app-server에 추가한다.
- [x] GitHub raw content 조회 adapter를 PR Review 내부 dependency로 추가한다.
- [x] merge base 또는 equivalent base content 조회 방식을 확정한다.
- [x] `content / line conflict` hunk extractor를 구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflicts`를 구현한다.
- [x] session `headSha`와 현재 GitHub PR head SHA가 다르면 stale guard로 막는다.
- [x] `clean`, `checking`, `unknown` conflict status는 빈 file list로 반환한다.
- [x] binary, large, unsupported conflict는 `unsupportedFiles`로 안내한다.
- [x] GitHub token, raw secret, installation token을 응답이나 로그에 노출하지 않는다.
- [x] response shape가 `docs/api/pr-review-api.md`와 일치한다.
- [x] focused backend test를 추가한다.

완료 기준:

- [x] content / line conflict fixture에서 conflict hunk가 반환된다.
- [x] non-conflicted PR에서는 빈 file list가 반환된다.
- [x] stale session은 `409 Conflict`로 실패한다.
- [x] unsupported file은 supported hunk로 오인되지 않는다.
- [x] build/lint/test가 통과한다.

범위 밖:

- AI explanation 또는 suggestion 생성
- resolved content 생성
- conflict resolution 저장
- PR head branch commit
- GitHub merge API 호출
- Review room UI 변경

## 1-C Review Room Conflict UX

목표:

- Review room에서 conflict 상태와 conflict file 진입 흐름을 보여준다.
- conflict file은 일반 file decision보다 Conflict Resolution mode를 우선한다.

작업 체크리스트:

- [x] conflict status를 header와 file node에 표시한다.
- [x] conflict file 클릭 시 Conflict Resolution drawer로 진입한다.
- [x] unresolved conflict file에서는 일반 decision 저장을 숨기거나 비활성화한다.
- [x] loading, empty, unsupported, stale 상태를 화면에 표시한다.
- [x] frontend test 또는 smoke test를 갱신한다.

## 1-D AI Suggestion Draft

목표:

- 추출된 hunk를 바탕으로 충돌 원인 설명과 해결 초안을 생성한다.
- AI output은 사용자가 확인하기 전까지 suggestion으로만 취급한다.

작업 체크리스트:

- [x] AI request/response schema를 문서화한다.
- [x] AI 실패 시 read-only conflict hunk는 계속 볼 수 있게 한다.
- [x] resolved draft에 conflict marker가 남아 있으면 invalid suggestion으로 처리한다.
- [x] suggestion 저장 여부를 별도 결정한다.

## 1-E Apply Resolution Write Path

목표:

- 사용자가 확인한 resolved content만 PR head branch에 적용한다.
- 모든 write action은 명시적 사용자 확인과 guard를 통과해야 한다.

작업 체크리스트:

- [x] GitHub write permission 요구사항을 문서화한다.
- [x] apply request/response 계약을 추가한다.
- [x] head SHA와 blob SHA guard를 구현한다.
- [x] resolved content empty/marker validation을 구현한다.
- [x] apply 결과 후 conflict status를 재확인한다.
- [x] merge 실행은 별도 action으로 분리한다.

## PR 전 확인

- [x] `AGENTS.md`, `convention.md`, `coding-rule.md` 기준을 확인했다.
- [x] `docs/api/README.md`와 `docs/api/pr-review-api.md`를 확인했다.
- [x] `apps/frontend/FRONTEND_COMMON_AREAS.md`를 확인했다.
- [x] `apps/app-server/APP_SERVER_COMMON_AREAS.md`를 확인했다.
- [x] API 계약 변경 여부를 PR 본문에 적었다.
- [x] DB schema 변경 여부를 PR 본문에 적었다.
- [x] GitHub write action 포함 여부를 PR 본문에 적었다.
- [x] 실행한 검증 명령과 결과를 PR 본문에 적었다.
