# PR Review Post-MVP Merge 구현 체크리스트

이 문서는 PR Review Post-MVP `AI Conflict Resolution Assistant`의 마지막 happy path인
GitHub merge action 구현을 작은 PR 단위로 일관되게 진행하기 위한 체크리스트다.

기준 문서:

- `apps/app-server/src/modules/pr-review/POST_MVP.md`
- `apps/app-server/src/modules/pr-review/POST_MVP_CONFLICT_IMPLEMENTATION_CHECKLIST.md`
- `docs/api/pr-review-api.md`
- `docs/api/github-integration-api.md`

관련 Issue:

- #537 `[은재][pr-review] PR Review room에서 GitHub merge를 실행할 수 있게 한다`

## 진행 원칙

- merge는 conflict apply와 다른 명시적 사용자 action으로 구현한다.
- merge는 자동 실행하지 않고 confirmation dialog 승인 후에만 실행한다.
- GitHub token, permission, raw provider error 처리는 GitHub Integration 내부 adapter 경계 안에 둔다.
- PR Review는 merge 가능 조건, review session guard, UI 흐름을 담당한다.
- GitHub Integration 공개 endpoint는 늘리지 않고 내부 dependency/action adapter를 우선 사용한다.
- DB schema 변경 없이 첫 버전을 구현하는 것을 기본 방향으로 둔다.
- 구현 중 정책 선택지가 생기면 멈추고 결정한 뒤 진행한다.

## Phase 추적

| Phase | 목적 | Issue | PR | 상태 |
| --- | --- | --- | --- | --- |
| 1-E | Apply resolution write path | #529 | #534 | 완료 |
| 1-F | Merge action | #537 | #539 | 진행 중 |

## 구현 전 결정 필요

- [x] 기본 merge method를 정한다: `merge`, `squash`, `rebase`
- [x] GitHub Review 제출 전 merge를 허용할지 정한다.
- [x] required checks pending/fail 상태를 PILO에서 사전 차단할지, GitHub merge API 응답으로 처리할지 정한다.
- [x] merge 성공 후 review session status를 별도 `merged` 상태로 확장할지, 기존 status를 유지하고 PR state만 refresh할지 정한다.
- [x] merge 성공 후 head branch 삭제 기능은 이번 범위에서 제외할지 정한다.

권장 1차 기본값:

- merge method: `merge`
- GitHub Review 제출 전 merge: 허용하지 않음
- required checks: 첫 버전은 GitHub merge API 응답을 안전하게 매핑
- review session status: DB enum 확장 없이 기존 status 유지, PR state refresh
- head branch 삭제: 제외

## API 계약 체크리스트

- [x] `POST /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/merge` 계약을 `docs/api/pr-review-api.md`에 추가한다.
- [x] request body에 필요한 confirmation/expected head guard 값을 정의한다.
- [x] response body에 merge 결과, merged commit SHA, merged URL, PR state refresh 결과를 정의한다.
- [x] stale head SHA는 `409 Conflict`로 문서화한다.
- [x] conflict clean guard 실패는 `400 Bad Request`로 문서화한다.
- [x] mergeable false/null 상태 처리 규칙을 문서화한다.
- [x] GitHub permission/token source와 safe error mapping을 `docs/api/github-integration-api.md`에 문서화한다.

## Backend 구현 체크리스트

- [x] GitHub Integration 내부 merge adapter를 추가한다.
- [x] 현재 사용자 GitHub OAuth token을 사용해 GitHub PR merge API를 호출한다.
- [x] GitHub merge API에 전달할 owner, repo, pull number, expected head SHA를 안전하게 조회한다.
- [x] GitHub 401/403/404/405/409 응답을 사용자 행동 가능한 API error로 매핑한다.
- [x] raw provider error와 token이 응답/로그에 노출되지 않게 한다.
- [x] PR Review dependency interface에 merge action을 추가한다.
- [x] review session workspace access guard를 적용한다.
- [x] review session head SHA와 현재 GitHub PR head SHA가 다르면 stale로 막는다.
- [x] PR state가 open이 아니면 merge를 막는다.
- [x] `conflictStatus === clean`이 아니면 merge를 막는다.
- [x] review file 판단 완료 여부는 merge hard guard에서 제외한다.
- [x] GitHub `mergeable === true`가 아니면 merge를 막는다.
- [x] merge 성공 후 PR 상태를 refresh한다.
- [x] merge 성공 후 review room이 최신 PR 상태를 볼 수 있게 한다.

## Frontend 구현 체크리스트

- [x] PR Review API client에 merge method를 추가한다.
- [x] PR Review types에 merge request/response payload를 추가한다.
- [x] Review room header의 disabled Merge button을 조건부 활성화한다.
- [x] Merge button 비활성화 이유를 tooltip 또는 짧은 문구로 표시한다.
- [x] merge confirmation dialog를 추가한다.
- [x] merge 실행 중 loading state를 표시한다.
- [x] merge 실패 시 안전한 error message를 표시한다.
- [x] merge 성공 후 PR/review room 상태를 refresh한다.
- [x] merge 성공 상태에서 중복 merge 실행을 막는다.

## Guard 정의 초안

Merge button 활성 조건:

- review session status가 `submitted`
- conflict status가 `clean`
- review file 판단 완료 여부는 merge hard guard가 아님
- PR state가 `open`
- PR head SHA가 review session head SHA와 같음
- GitHub 원격 `mergeable` 여부는 버튼 조건이 아니라 server/GitHub merge 응답으로 처리

서버는 UI 조건을 신뢰하지 않고 같은 guard를 다시 검증한다.

## 완료 기준

- [x] conflict clean + GitHub Review 제출 완료 상태에서 Merge button이 활성화되고, GitHub mergeable 여부는 server/GitHub 응답으로 처리한다.
- [x] 사용자가 confirmation dialog를 승인해야 merge가 실행된다.
- [x] merge 성공 후 GitHub PR 상태가 closed/merged로 반영된다.
- [x] merge 실패 시 사용자가 다음 행동을 알 수 있는 메시지가 표시된다.
- [x] GitHub token, raw provider error, secret이 응답이나 로그에 노출되지 않는다.
- [x] API 문서와 구현이 일치한다.

## 검증 체크리스트

- [x] `apps/app-server`: `npm.cmd run format:check`
- [x] `apps/app-server`: `npm.cmd run lint`
- [x] `apps/app-server`: `npm.cmd run build`
- [x] `apps/app-server`: `npm.cmd run test`
- [x] `apps/frontend`: `npm.cmd run format:check`
- [x] `apps/frontend`: `npm.cmd run lint`
- [x] `apps/frontend`: `npm.cmd run build`
- [x] `apps/frontend`: `npm.cmd run test`
- [x] `git diff --check`

## PR 작성 전 확인

- [ ] `AGENTS.md`, `convention.md`, `coding-rule.md` 기준을 확인했다.
- [ ] `docs/api/README.md`, `docs/api/pr-review-api.md`, `docs/api/github-integration-api.md`를 확인했다.
- [ ] `apps/frontend/FRONTEND_COMMON_AREAS.md` 기준으로 공통영역 변경 여부를 확인했다.
- [ ] `apps/app-server/APP_SERVER_COMMON_AREAS.md` 기준으로 공통영역 변경 여부를 확인했다.
- [ ] API 계약 변경 여부를 PR 본문에 적었다.
- [ ] DB schema 변경 여부를 PR 본문에 적었다.
- [ ] GitHub write action 포함 여부를 PR 본문에 적었다.
- [ ] 실행한 검증 명령과 결과를 PR 본문에 적었다.
