# PR Review 구현 체크리스트

담당자: 은재

구현 기준 문서 우선순위:

1. `docs/api/pr-review-api.md`
2. `Project_Planning_Document.md`
3. `docs/api/incoming/PR_REVIEW_API_SPEC.md`

`docs/api/incoming/`은 원본 초안 보관용이다. 초안과
`docs/api/pr-review-api.md`가 충돌하면 `docs/api/` 루트의 API 계약 문서를 기준으로
본다.

## 확정 범위

- PR Review는 review session lifecycle, AI 분석 결과 저장, review flow/file/order,
  file review decision, PR Review canvas view model, diff view model, GitHub Review
  제출, local submission history를 담당한다.
- GitHub Integration은 open PR 목록, PR 상세, 변경 파일과 patch, conflict 상태,
  GitHub App/OAuth 연결, GitHub 원본 sync를 담당한다.
- PR Review canvas는 `review_flows`, `review_files`, `review_flow_files`에서 만든
  view model이다. MVP에서는 자유형 `canvas` 테이블에 저장하지 않는다.
- MVP workflow canvas 방향은
  `apps/app-server/src/modules/pr-review/WORKFLOW_CANVAS_STRATEGY.md`에 정리한다.
- GitHub Review 제출은 review body만 보낸다. GitHub inline review comment는 MVP
  범위가 아니다.
- Review session은 MVP 기준 임시 작업 데이터다. 사용자가 PR review 화면을 나가면
  session을 삭제하고 관련 local review data를 cascade 삭제한다.

## 0. 계약과 경계

- [x] 구현 시작 전 `AGENTS.md`, `docs/api/README.md`,
  `docs/api/pr-review-api.md`를 다시 확인한다.
- [x] #22 완료 후 PR 상세, 변경 파일, file patch, conflict 상태, 현재 사용자의
  GitHub OAuth 상태를 GitHub Integration에서 어떤 형태로 받을지 확인한다.
- [x] API 계약 변경이 필요 없는지 확인한다. 필요하면 코드 변경과 함께
  `docs/api/pr-review-api.md`를 수정한다.
- [x] DB schema 변경이 필요 없는지 확인한다. 필요하면 이미 공유된 migration을 수정하지
  않고 새 migration을 추가한다.
- [x] PR Review 구현은 PR Review 소유 경로에 두고, session 생성에 필요한 공통
  transaction helper만 최소 변경으로 추가한다.

## 1. GitHub Integration 의존성

- [x] PR Review adapter 경계를 추가하고 deterministic stub data를 둔다. 나중에 실제
  GitHub Integration API로 교체할 때 한 곳만 바꾸도록 만든다.
- [x] #95에서 PR Review adapter를 실제 GitHub Integration API로 교체한다.
- [ ] GitHub Integration을 통해 open PR 목록을 읽을 수 있게 한다.
- [x] GitHub Integration을 통해 현재 `headSha`를 포함한 PR 상세를 읽을 수 있게 한다.
- [x] GitHub Integration을 통해 file metadata와 GitHub patch text를 포함한 변경 파일을
  읽을 수 있게 한다.
- [x] GitHub Integration을 통해 conflict 상태를 읽을 수 있게 한다.
- [ ] 제출 전에 현재 사용자의 GitHub OAuth 연결 상태를 확인할 수 있게 한다.
- [ ] GitHub token, raw secret이 API 응답이나 로그에 노출되지 않게 한다.

## 2. Backend Module Skeleton

- [x] `PrReviewModule`을 추가한다.
- [x] `PrReviewController`를 추가한다.
- [x] `PrReviewService`를 추가한다.
- [x] request/response payload용 DTO/type 파일을 추가한다.
- [x] 별도 repository는 아직 만들지 않고, PR Review service 내부 private query helper로
  유지한다.
- [x] `AppModule`에 `PrReviewModule`을 등록한다.
- [x] 모든 endpoint에 `AuthGuard`와 workspace access check를 적용한다.
- [x] 공통 `{ success: true, data }` response shape를 반환한다.

## 3. Review Session Lifecycle

- [x] `POST /workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions`를
  구현한다.
- [x] session 생성 시 GitHub Integration adapter에서 PR 상세, 변경 파일, conflict 상태를
  조회한다.
- [x] `github_pull_requests`에 이미 sync된 PR에 대해서만 session을 생성한다.
- [x] 생성 시점의 `headSha`를 `pr_review_sessions`에 저장한다.
- [x] 변경 파일 metadata를 `review_files`에 저장한다.
- [x] 분석 결과를 기준으로 `review_flows`, `review_flow_files`를 생성한다.
- [x] 같은 PR을 다시 리뷰하더라도 새 session을 생성한다.
- [x] 반복 클릭으로 같은 생성 요청이 중복 진행되지 않도록 방어한다.
- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`를 구현한다.
- [x] `PATCH /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`를 구현한다.
- [x] `DELETE /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`를 구현한다.
- [ ] session 삭제 시 flows, files, flow-file links, decisions, submission history가 cascade
  삭제되는지 DB integration/fixture 환경에서 확인한다.

## 4. AI 분석 결과

- [x] 구현 전에 초기 방식이 deterministic app-server analyzer인지, `ai-worker` 직접
  연동인지 결정한다.
- [x] `prPurpose`, `changeSummary`, `recommendedReviewOrder`, `cautionPoints`를 저장한다.
- [x] file 단위 `fileRole`, `changeReason`, `changeSummary`, `reviewPoints`를 저장한다.
- [x] flow order와 file workflow order를 저장한다.
- [x] MVP에서는 flow/node/edge 편집을 제외한다.
- [ ] 후속 이슈에서 `ai-worker`를 연결하기 전에 `pr_analysis` request/response 계약과
  실패 처리를 정의한다. #47에서는 deterministic app-server analyzer까지만 유지한다.

## 5. Review Read APIs

- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary`를
  구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result`를
  구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas`를
  구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/flows`를
  구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-flows/{flowId}/files`를 구현한다.
- [x] `GET /workspaces/{workspaceId}/github/review-files/{reviewFileId}`를 구현한다.
- [x] canvas 응답은 자유형 canvas table이 아니라 PR Review table에서 만든다.

## 6. Diff View Model

- [ ] `GET /workspaces/{workspaceId}/github/review-files/{reviewFileId}/diff`를 구현한다.
- [ ] GitHub patch text를 side-by-side rows로 변환한다.
- [ ] old/new line number를 포함한다.
- [ ] `added`, `modified`, `deleted`, `renamed` file status를 처리한다.
- [ ] binary file은 rows 없는 `mode: "binary"`로 처리한다.
- [ ] large diff는 rows 없는 `mode: "large"`로 처리한다.
- [ ] API 계약의 large diff 기준을 적용한다:
  `additions + deletions >= 1000`, `patchSizeBytes >= 200KB`, GitHub patch 누락.
- [ ] preview가 생략될 때 frontend가 GitHub로 이동할 수 있도록 `githubFileUrl`을
  반환한다.
- [ ] inline comment 입력 UI/API는 구현하지 않는다.

## 7. File Review Decision

- [ ] `PATCH /workspaces/{workspaceId}/github/review-files/{reviewFileId}/review`를 구현한다.
- [ ] `approved`, `discussion_needed`, `unknown`만 허용한다.
- [ ] `review_files.current_status`를 갱신한다.
- [ ] `review_files.comment`를 갱신한다.
- [ ] status가 선택되면 `reviewed_by_user_id`, `reviewed_at`을 설정한다.
- [ ] `file_review_decisions` history row를 추가한다.
- [ ] `reviewed_count`를 다시 계산한다.
- [ ] 모든 file에 review status가 있으면 session status를 `ready_to_submit`으로 바꾼다.
- [ ] `GET /workspaces/{workspaceId}/github/review-files/{reviewFileId}/decisions`를
  구현한다.

## 8. GitHub Review 제출

- [ ] `POST /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions`를
  구현한다.
- [ ] `submitType`은 `COMMENT`, `APPROVE`, `REQUEST_CHANGES`만 허용한다.
- [ ] `reviewBody`가 비어 있지 않은지 검증한다.
- [ ] 현재 사용자의 GitHub OAuth 연결 상태를 확인한다.
- [ ] 현재 PR의 `headSha`를 다시 조회하고 session의 `headSha`와 다르면 제출을 막는다.
- [ ] 현재 사용자의 OAuth token으로 GitHub Review를 제출한다.
- [ ] review body만 보낸다. line comment는 보내지 않는다.
- [ ] 모든 제출 시도를 `review_submissions`에 저장한다.
- [ ] submitted/failed status와 sanitize된 error message를 저장한다.
- [ ] 제출 성공 후 session status를 `submitted`로 바꾼다.
- [ ] `GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions`를
  구현한다.
- [ ] `GET /workspaces/{workspaceId}/github/review-submissions/{submissionId}`를 구현한다.

## 9. Frontend PR 선택

- [ ] placeholder PR Review panel을 실제 PR 선택 화면으로 교체한다.
- [ ] open PR만 불러온다.
- [ ] PR 번호 또는 제목 검색을 추가한다.
- [ ] 검색 input에 300ms debounce를 적용한다.
- [ ] 10개 단위 pagination과 previous/next button을 추가한다.
- [ ] loading, empty, error, retry, GitHub-not-connected 상태를 추가한다.
- [ ] title, author, branch info, changed files, additions/deletions, commits,
  description, file list를 보여주는 PR detail modal을 추가한다.
- [ ] review start button을 추가한다.
- [ ] session 생성 중에는 review start를 비활성화한다.
- [ ] analysis loading/failure 상태를 보여준다.

## 10. Frontend Review Canvas

- [ ] `WORKFLOW_CANVAS_STRATEGY.md`를 따른다. MVP에서는 Canvas API/DB persistence 없이
  tldraw surface를 사용하고, Post-MVP에서 Canvas persistence를 별도 확장한다.
- [ ] PR Review canvas endpoint 응답으로 flow, file node, edge view를 렌더링한다.
- [ ] workflow 데이터를 future Canvas persistence와 호환되도록 deterministic tldraw
  shapes와 stable review metadata로 변환한다.
- [ ] `PiloCanvasRuntime`을 import하지 않고 얇은 `PiloTldrawSurface`를 사용하거나
  분리한다.
- [ ] `review_file_node`는 PR Review 소유 custom shape util로 둔다.
- [ ] PR purpose, change summary, recommended order, caution points, selected flow
  description을 보여준다.
- [ ] reviewed count와 total file count로 review progress를 보여준다.
- [ ] 모든 file에 status가 선택된 경우에만 Review 제출을 활성화한다.
- [ ] conflict status는 정보성으로만 보여준다.
- [ ] Merge button은 MVP 안내 문구와 함께 disabled 상태로 보여준다.
- [ ] node position은 frontend-only로 유지한다.
- [ ] MVP에서는 flow/node/edge 편집을 허용하지 않는다.

## 11. Frontend File Review

- [ ] file node를 선택하면 file review view를 연다.
- [ ] side-by-side diff rows를 렌더링한다.
- [ ] binary/large diff fallback과 GitHub link를 보여준다.
- [ ] file role, change reason, change summary, related flow/files, review points를
  보여준다.
- [ ] decision button을 추가한다: `문제 없음`, `논의/수정 필요`, `판단 불가`.
- [ ] status는 즉시 저장한다.
- [ ] comment는 blur 또는 500ms debounce로 저장한다.
- [ ] comment는 optional로 둔다.
- [ ] inline GitHub comment UI는 추가하지 않는다.

## 12. Frontend Submission Modal

- [ ] approved, discussion-needed, unknown file 수를 보여준다.
- [ ] file별 review result와 comment를 보여준다.
- [ ] 사용자가 `COMMENT`, `APPROVE`, `REQUEST_CHANGES` 중 하나를 선택하게 한다.
- [ ] submit type을 자동 선택하지 않는다.
- [ ] 수정 가능한 markdown `reviewBody`를 생성한다.
- [ ] PR Review API로 제출한다.
- [ ] submitted, submitting, failed 상태를 처리한다.
- [ ] GitHub OAuth not connected 상태를 처리한다.
- [ ] stale PR head SHA 상태를 처리한다.

## 13. 검증

- [ ] session lifecycle에 대한 focused backend test를 추가한다.
- [ ] session 삭제 cascade는 DB integration/fixture 환경이 준비되면 검증한다.
- [ ] diff parsing에 대한 focused backend test를 추가한다.
- [ ] file review decision update에 대한 focused backend test를 추가한다.
- [ ] OAuth missing과 stale head submission guard에 대한 focused backend test를 추가한다.
- [ ] submission success/failure persistence에 대한 focused backend test를 추가한다.
- [ ] navigation과 PR Review screen state에 대한 frontend test를 추가한다.
- [x] backend 변경 후 `apps/app-server`에서 `npm run lint`, `npm run test`,
  `npm run build`를 실행한다.
- [ ] frontend 변경 후 `apps/frontend`에서 `npm run lint`, `npm run test`,
  `npm run build`를 실행한다.
- [ ] `apps/ai-worker`를 수정했다면 `ruff`, `black --check`, `pytest`를 실행한다.

## MVP 제외 범위

- [ ] GitHub inline review comment를 구현하지 않는다.
- [ ] PR merge/close를 구현하지 않는다.
- [ ] ProjectV2 write API를 구현하지 않는다.
- [ ] PR Review graph를 자유형 canvas table에 저장하지 않는다.
- [ ] MVP에서는 사용자가 flow/node/edge graph를 편집할 수 있게 하지 않는다.
- [ ] MVP에서는 review submission history를 임시 review session lifecycle 밖에 영구
  저장하지 않는다.
