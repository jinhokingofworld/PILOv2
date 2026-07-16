# Workspace 문서 기반과 Lifecycle 구현 계획

> **에이전트 작업자용:** 이 계획을 구현할 때는 반드시 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 작업 추적에는 체크박스(`- [ ]`)를 사용한다.

**목표:** 공유 Drive가 Workspace 멤버의 native 문서를 생성, 목록 조회, 열기, 이름 변경, 이동, soft delete할 수 있게 하고, 합의한 Activity Log를 같은 transaction 안에서 기록한다.

**구조:** `drive_items`는 Drive 트리와 lifecycle의 유일한 소유자다. 1:1 `documents` aggregate는 문서 상태와 durable snapshot을 소유한다. `DocumentService`가 Drive item 변경, 문서 row, `ActivityLogService`를 하나의 App Server transaction으로 묶는다. 본문 동기화는 뒤의 에디터/실시간 계획에서 구현한다.

**기술:** NestJS, PostgreSQL migration, 기존 Drive module, `ActivityLogService`, Node assertion script.

## 현재 구현 현황 (2026-07-16)

- [x] **문서 저장 기반과 생성 API**: Issue [#1146](https://github.com/Developer-EJ/PILO/issues/1146), PR [#1150](https://github.com/Developer-EJ/PILO/pull/1150) 병합 완료
  - [x] `document` Drive item type, 문서/스냅샷/Yjs/edit session 테이블, Activity Log action registry 추가
  - [x] 문서 생성 API와 Drive 목록의 document item 노출
  - [x] Supabase dev DB에 `073_create_workspace_documents` migration 적용 및 schema 검증
- [x] **문서 최신 snapshot 조회 및 저장 API**: Issue [#1151](https://github.com/Developer-EJ/PILO/issues/1151) 완료
  - [x] version 검증 기반 Yjs state/Tiptap JSON snapshot 저장과 `current_version` 갱신
  - [x] `document_content_updated` Activity Log와 rollback 검증
  - [x] API 계약, focused app-server test
- [x] **Tiptap/Yjs 로컬 에디터와 자동 저장**: Issue [#1154](https://github.com/Developer-EJ/PILO/issues/1154), PR [#1160](https://github.com/Developer-EJ/PILO/pull/1160) 병합 완료
  - [x] Tiptap/Yjs 의존성과 최신 snapshot 기반 editor bootstrap
  - [x] 자동 저장 상태와 새로고침 복구
  - [x] frontend lint/test
  - [x] PR [#1160](https://github.com/Developer-EJ/PILO/pull/1160) 생성
- [x] **문서 lifecycle API와 Activity Log**: Issue [#1166](https://github.com/Developer-EJ/PILO/issues/1166), PR [#1169](https://github.com/Developer-EJ/PILO/pull/1169) 병합 완료
  - [x] rename/move/delete의 Activity Log와 문서 aggregate soft delete 구현
  - [x] API 계약과 전체 app-server 검증
  - [x] PR [#1169](https://github.com/Developer-EJ/PILO/pull/1169) 병합 완료
- [x] **Drive 이동 UI**: Issue [#1170](https://github.com/Developer-EJ/PILO/issues/1170), PR [#1175](https://github.com/Developer-EJ/PILO/pull/1175) 병합 완료
  - [x] 폴더/파일/문서 이동 목적지 탐색과 `PATCH` 호출
  - [x] focused test, frontend format/lint/test
  - [ ] 인증된 dev 환경 수동 QA
  - [x] PR [#1175](https://github.com/Developer-EJ/PILO/pull/1175) 병합 완료
- [x] **파일 첨부와 PDF viewer 기반**: Issue [#1179](https://github.com/Developer-EJ/PILO/issues/1179), Issue [#1195](https://github.com/Developer-EJ/PILO/issues/1195)
  - [x] Drive file attachment 검증과 PDF inline preview API
  - [x] frontend attachment picker, PDF inline viewer, 다운로드와 unavailable 상태
  - [ ] 인증된 dev 환경에서 PDF/non-PDF 첨부 수동 QA
- [ ] **후속 작업**: Yjs realtime collaboration

> 아래 작업 1~5는 최초 기반 구현 계획이다. 현재 진행 상태는 이 상단 현황을 기준으로
> 추적하며, 자동 검증은 각 PR에서 완료했고 인증된 dev 환경 수동 QA만 남아 있다.

## 공통 제약

- 최신 `dev` 기반의 격리 worktree에서 시작하고, 수정 전 `AGENTS.md`, `coding-rule.md`, `convention.md`, `docs/api/README.md`, `docs/api/drive-api.md`, `docs/ActivityLogRegistry.md`를 읽는다.
- Drive API와 DB schema 변경이다. merge 전 Drive/DB 담당자의 리뷰를 받고, Drive payload 변경을 frontend 담당자에게 알린다.
- 기존 folder/file 동작을 보존한다. `document`에는 S3 object metadata나 `drive_uploads` row가 절대 생기지 않는다.
- v1에서 Workspace `owner`와 `member`의 문서 권한은 같다. request body의 workspace/user id는 신뢰하지 않는다.
- 모든 Activity Log는 `ActivityLogService.append(transaction, ...)`만 사용한다. 문서 본문, Yjs binary, 원문 파일, raw diff, secret처럼 보이는 제목, meeting id, client timestamp를 기록하지 않는다.
- RAG, MeetingReport 연동, 문서별 권한, public link, version restore UI는 이 계획에 넣지 않는다.

---

## 작업 1: 공개 API와 Activity Log 계약을 먼저 확정

**대상 파일:**
- 수정: `docs/api/README.md`, `docs/api/drive-api.md`, `docs/ActivityLogRegistry.md`
- 수정: `apps/app-server/src/common/activity-log.service.ts`
- 수정: `apps/app-server/scripts/common/activity-log.test.mjs`

- [ ] `docs/api/drive-api.md`에 문서 lifecycle 범위를 추가하고 제외 범위를 갱신한다. frontend 표기는 `/files`, backend path는 `drive`를 유지한다.
- [ ] 다음 public endpoint와 auth/error 규칙을 정의한다.
  - `POST /workspaces/{workspaceId}/drive/documents`: `{ parentId: string | null, name?: string }`을 받고 `{ item, document }`을 반환한다. name이 없으면 서버가 중복 없는 기본 제목을 만든다.
  - `GET /workspaces/{workspaceId}/drive/documents/{documentId}`: Drive item과 최신 durable snapshot을 반환하는 editor bootstrap read다.
  - `PATCH /workspaces/{workspaceId}/drive/items/{itemId}`: `{ name }` 또는 `{ parentId }` 중 정확히 하나만 받는다. document는 active 같은 Workspace folder 또는 root로만 이동한다.
  - list payload의 `itemType`을 `folder | file | document`로 확장한다. document의 `mimeType`, `sizeBytes`, `uploadStatus`는 `null`이다.
- [ ] 중앙 registry에 다음 여섯 action의 target type, bounded `metadata.data`, dedupe 규칙, 한국어 과거형 summary 예시를 등록한다: `document_created`, `document_content_updated`, `document_renamed`, `document_moved`, `document_attachment_updated`, `document_deleted`.
- [ ] action은 중앙 TypeScript registry에만 추가하며 도메인 로컬 string union을 만들지 않는다.
- [ ] registry가 여섯 action을 허용하고 임의의 document action은 거부하는 test를 추가한다.
- [ ] `apps/app-server`에서 `npm run lint`, `npm test`를 실행한다. schema/service 작업 전에 typecheck와 Activity Log 계약 test가 통과해야 한다.

## 작업 2: Drive document type과 durable storage를 위한 migration 073 추가

**대상 파일:**
- 생성: `db/migrations/073_create_workspace_documents.sql`
- 수정: `db/README.md` (migration index를 관리하는 경우만)
- 수정: `apps/app-server/scripts/test.mjs`
- 생성: `apps/app-server/scripts/drive/document-schema.test.mjs`

- [ ] `drive_items` constraint를 변경해 `item_type`에 `document`를 허용하고, 세 shape를 엄격히 검증한다.
  - `folder`: object/MIME/size/upload status가 모두 없다.
  - `file`: 기존 object/MIME/size/status 요건을 유지한다.
  - `document`: object/MIME/size/upload status가 모두 없다.
- [ ] `documents`를 만든다: 1:1 `drive_item_id`, `workspace_id`, 기본값 `0`의 `current_version`, nullable `latest_snapshot_id`, timestamp, soft-delete timestamp. same-workspace FK와 active workspace read index를 둔다.
- [ ] append-only `document_yjs_updates`를 만든다: `document_id`, `workspace_id`, monotonic `update_sequence`, stable `client_update_id`, `edit_session_id`, nullable actor, binary update, `created_at`. `(document_id, update_sequence)`, `(document_id, client_update_id)` unique를 둔다.
- [ ] `document_snapshots`를 만든다: `document_id`, `workspace_id`, `version`, binary Yjs state, JSONB Tiptap state, bounded plain text, source update sequence, timestamp. `(document_id, version)`은 unique다.
- [ ] `document_edit_sessions`를 만든다: actor, first/last update sequence, base/closed version, closed timestamp. open session을 닫을 때만 update를 허용하고, document/update/snapshot은 append-only로 다룬다.
- [ ] `documents.latest_snapshot_id`는 snapshot table 생성 후 추가하고 cross-document/workspace pointer를 막는 FK 또는 동등한 보호 장치를 둔다.
- [ ] 새 public table 모두 RLS를 켜 기존 App Server-only 접근 모델을 유지한다. client-facing RLS policy는 추가하지 않는다.
- [ ] type check, 1:1 relation, retry key, snapshot version unique, RLS를 검증하는 migration assertion을 추가하고 test runner에 등록한다.
- [ ] local dev DB에 migration을 적용한 뒤 `apps/app-server`에서 `npm test`를 실행한다. document가 upload file로 위장할 수 없고 duplicate client update가 거부되어야 한다.

## 작업 3: Drive module에 document read와 lifecycle mutation 구현

**대상 파일:**
- 생성: `apps/app-server/src/modules/drive/document.service.ts`, `document.types.ts`, `document.validation.ts`, `document.mapper.ts`, `document-activity-log.ts`
- 수정: `apps/app-server/src/modules/drive/drive.service.ts`, `drive.controller.ts`, `drive.types.ts`, `drive.validation.ts`, `drive.module.ts`, `drive.mapper.ts`
- 생성: `apps/app-server/scripts/drive/document-lifecycle.test.mjs`
- 수정: `apps/app-server/scripts/drive/test.mjs`

- [ ] `DriveItemPayload.itemType`에 `document`를 추가하고 document의 nullable file field를 안전하게 mapping한다. 기존 file/download route는 바꾸지 않는다.
- [ ] `DocumentService.createDocument(workspaceId, actorUserId, input)`을 `database.transaction` 안에 구현한다.
  1. 기존 Drive access helper로 membership과 parent를 검증한다.
  2. 기존 Drive name rule로 기본 이름을 생성/검증한다.
  3. `drive_items` document row와 `documents` row를 생성한다.
  4. 빈 Tiptap JSON과 빈 Yjs state로 version `0` 초기 snapshot을 만든다.
  5. `document:document_created:{documentId}:0` key로 `document_created`를 append한다.
  6. mapped Drive item과 bootstrap metadata를 반환한다.
- [ ] `getDocument`는 membership, active document/Drive item, latest snapshot join을 검증한다. soft-deleted document는 deleted Drive item과 같은 not-found behavior를 반환한다.
- [ ] rename/delete 경로를 정리해 document row가 Drive lifecycle을 같은 transaction으로 따르게 한다. folder 삭제 시 descendant document도 soft-delete한다. descendant마다 Activity Log를 남길지는 제품 담당자 확인 전까지 확장하지 않는다.
- [ ] document/folder/file 공통 `moveDriveItem`을 추가한다. same-workspace active folder만 target으로 허용하고 recursive CTE로 self/descendant move를 막고 name conflict를 확인한다. document 이동만 `document_moved`를 append한다.
- [ ] `canvas-activity-log.ts`를 참고해 bounded/sanitized 문서 log helper를 만든다. 제목 공백을 정규화하고 160자로 제한하며 민감 pattern이면 `문서`로 대체한다. request마다 새 UUID가 아닌 document id와 durable version/update timestamp 기반 dedupe key를 사용한다.
- [ ] content/attachment mutation이 생기기 전까지 `document_content_updated`, attachment log는 lifecycle service에서 호출하지 않는다.
- [ ] owner/member 성공, non-member 거부, sibling name 중복, invalid parent/cycle, create+log atomicity, rename/move/delete metadata, Activity Log failure rollback을 test한다.
- [ ] `apps/app-server`에서 `npm run lint`, `npm test`를 실행한다. 기존 folder/file route가 유지되고 document lifecycle test가 통과해야 한다.

## 작업 4: editor 없이 기존 `/files` 목록에 document item 통합

**대상 파일:**
- 수정: `apps/frontend/src/features/drive/types/index.ts`, `api/client.ts`, `components/drive-panel.tsx`, `page.tsx` 또는 `/files` route composition file
- 생성: `apps/frontend/src/features/drive/drive-document-contract.test.ts`
- 수정: `apps/frontend/scripts/test.mjs`

- [ ] route/layout 변경 전 `apps/frontend/FRONTEND_COMMON_AREAS.md`를 읽고 shared area 영향이 있으면 PR에 적는다.
- [ ] client type과 목록 renderer에 `document`를 추가한다. 별도 문서 icon을 쓰고 file size/MIME은 표시하지 않으며, 열기는 download가 아닌 향후 document route로 보낸다.
- [ ] 기존 create menu에 `새 문서`를 추가한다. 성공하면 즉시 `/files/documents/{documentId}`로 이동한다. 실제 editor route는 다음 계획에서 제공한다.
- [ ] folder tree/list API를 재사용하는 move action을 추가한다. loading, root empty, invalid target, error state를 포함하고 v1에는 drag-and-drop을 만들지 않는다.
- [ ] rename/delete behavior를 보존하고, 열려 있던 문서가 삭제된 경우의 route 회복은 editor 계획에서 처리한다.
- [ ] document payload parsing, create request shape, download가 아닌 open behavior를 test runner에 등록한다.
- [ ] `apps/frontend`에서 `npm run lint`, `npm test`를 실행하고 desktop/mobile에서 folder, file, document가 함께 보이는지 수동 확인한다.

## 작업 5: 리뷰와 통합 확인

- [ ] `docs/api/drive-api.md`, `docs/ActivityLogRegistry.md`, TypeScript registry, migration `073`이 action/request/response/document item 규칙에서 일치하는지 확인한다.
- [ ] `git diff --check`, `apps/app-server`의 `npm test`, `apps/frontend`의 `npm test`를 실행한다.
- [ ] owner/member로 nested folder 문서 생성, 목록/열기, rename, root 이동, delete를 수동 QA하고 S3 upload object가 생기지 않았는지, 각 mutation당 정확히 한 개의 Activity Log가 남았는지 확인한다.
- [ ] 체크된 작업 단위마다 repository convention에 맞춰 commit하고 하나의 focused PR을 연다. Tiptap/Yjs, PDF, realtime, RAG, MeetingReport 변경은 넣지 않는다.
- [x] **문서 편집 화면 개선**: Issue [#1184](https://github.com/Developer-EJ/PILO/issues/1184)
  - [x] 카드형 프레임 제거, 중앙 문서 컬럼과 borderless command strip 적용
  - [x] 제목/저장 상태/저장 버튼을 문서 페이지 헤더로 통합
  - [x] 빈 문서 placeholder와 반응형 loading/error 상태 적용
  - [x] 기존 자동 저장, 충돌 감지, reload 흐름 유지
  - [ ] 인증된 dev 환경에서 desktop/mobile 수동 QA
  - [ ] 다음 interaction 작업: slash menu, bubble menu, block handle, inline rename
