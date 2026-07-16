# Workspace 문서 에디터와 PDF 뷰어 구현 계획

> **에이전트 작업자용:** 이 계획을 구현할 때는 반드시 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 작업 추적에는 체크박스(`- [ ]`)를 사용한다.

**목표:** `/files`에서 사용할 수 있는 single-user 문서 에디터, 지원 block, 자동 durable save, 기존 Drive 파일 첨부, 앱 내부 PDF 미리보기/다운로드를 제공한다. 이후 Yjs realtime provider로 교체해도 에디터 구조를 유지해야 한다.

**구조:** document route가 기반 계획의 bootstrap snapshot을 조회해 Tiptap editor를 mount한다. editor는 canonical Tiptap JSON과 plain-text projection을 App Server snapshot API에 저장하며, realtime 계획이 transport만 Yjs collaboration provider로 교체할 수 있는 adapter boundary를 제공한다. attachment는 파일 data가 아닌 Drive file id를 갖는 Tiptap atom node다.

**기술:** Next.js/React, shadcn/ui, Lucide, Tiptap, `@tiptap/*`, Yjs document model package, 기존 Drive presigned URL API, 구현 시 선정하는 PDF.js React wrapper.

## 공통 제약

- document foundation API/migration 계획이 merge되었거나 branch에 rebase된 뒤 시작한다.
- dependency 선택 전 현재 Next.js/React version과 lockfile 규칙을 확인한다. 유지보수되는 최소 Tiptap/Yjs/PDF viewer dependency만 추가하고 rich-text parser나 PDF renderer를 직접 만들지 않는다.
- v1 block은 paragraph, heading 1-3, bullet list, ordered list, checklist, blockquote, code block, horizontal rule, link, Drive file attachment로 고정한다.
- template, editable file import, image/table/toggle, 문서별 권한, comment, 사용자용 version history, RAG, MeetingReport 연동은 제외한다.
- Drive file은 private 상태를 유지한다. browser에는 짧은 수명의 preview/download URL만 전달하고 bucket/object key는 전달하지 않는다.
- key stroke, polling, viewer page 이동, pointer, attachment picker 열기는 log로 남기지 않는다. save/attachment endpoint만 transaction 안에서 승인된 Activity Log를 남긴다.

---

## 작업 1: editor persistence와 preview API 계약 확정

**대상 파일:**
- 수정: `docs/api/drive-api.md`
- 수정: `apps/app-server/src/modules/drive/document.service.ts`, `document.types.ts`, `document.validation.ts`, `drive.controller.ts`, `drive-storage.service.ts`
- 생성: `apps/app-server/scripts/drive/document-content.test.mjs`

- [ ] pre-realtime autosave endpoint `PUT /workspaces/{workspaceId}/drive/documents/{documentId}/content`를 정의한다. request에는 canonical Tiptap JSON, stable client save id, editor-derived structural summary만 넣는다. client timestamp나 서버가 계산 가능한 plain-text projection은 받지 않는다.
- [ ] response는 `{ documentId, version, snapshotId, updatedAt }`로 정한다. 같은 save id 재시도는 같은 durable version을 반환하고 duplicate Activity Log를 만들지 않는다.
- [ ] active `ready` PDF file만 대상으로 하는 `GET /workspaces/{workspaceId}/drive/files/{fileId}/preview-url`를 정의한다. inline-content presigned URL을 반환하고 기존 attachment-download endpoint는 바꾸지 않는다. non-PDF, inaccessible, deleted file은 문서화된 error를 반환한다.
- [ ] attachment는 `{ type: "driveFileAttachment", attrs: { driveItemId } }`를 저장한다. picker는 같은 Workspace의 ready file만 고르고, server도 save 시 id를 재검증해 forged/stale id가 저장되지 않게 한다.
- [ ] server에서 지원 JSON node/mark schema, document JSON size, block 수, link protocol allowlist, code-language 길이, attachment 수를 검증한다. unknown node/attribute는 조용히 제거하지 말고 reject한다.
- [ ] save transaction을 구현한다: active document lock, client save id dedupe, prior snapshot과 비교한 plain text/bounded structural diff 계산, immutable snapshot/version 저장, `documents.current_version/latest_snapshot_id/updated_at` 변경, edit session 종료/전진, stable `document:document_content_updated:{documentId}:{editSessionId}` key의 `document_content_updated` append 순서다.
- [ ] canonical JSON이 같은 no-op save는 current version만 반환하고 snapshot과 content Activity Log를 만들지 않는다.
- [ ] attachment validation과 `document_attachment_updated`는 별도 attach/detach endpoint 또는 server-detected atomic content operation 중 하나로 구현하고 문서화한다. 같은 commit에 attachment와 generic content log를 중복 append하지 않는다.
- [ ] malformed JSON, unsupported block, invalid URL, foreign/deleted/pending file, no-op save, retry idempotency, Activity Log failure rollback, PDF-only preview URL, S3 key non-leakage를 test한다.
- [ ] `apps/app-server`에서 `npm run lint`, `npm test`를 실행한다.

## 작업 2: editor dependency와 재사용 가능한 document model boundary 추가

**대상 파일:**
- 수정: `apps/frontend/package.json`, repository lockfile
- 생성: `apps/frontend/src/features/documents/model/document-schema.ts`, `document-content.ts`, `document-content.test.ts`
- 생성: `apps/frontend/src/features/documents/api/client.ts`, `types/index.ts`
- 수정: `apps/frontend/scripts/test.mjs`

- [ ] Tiptap core/starter-kit과 underline/link/task-list/code-block extension, 이후 collaboration에 필요한 Yjs package를 설치한다. 설치된 React version과 호환되는 version으로 고정한다.
- [ ] local autosave와 이후 collaboration provider가 함께 쓰는 document schema factory를 만든다. 승인된 v1 node/mark 외의 기능은 disable한다.
- [ ] `DriveFileAttachment`를 `driveItemId` attribute만 가진 atom block extension으로 정의한다. raw HTML이 아닌 React로 render/resolve한다.
- [ ] JSON normalization, canonical empty document, safe plain-text extraction, allowed link validation, `isDocumentChanged` 비교 utility를 순수 함수로 구현하고 test한다.
- [ ] bootstrap read, content save, PDF preview URL, file download URL을 위한 API client를 만들고 HTTP error payload를 UI용으로 normalize한다.
- [ ] 지원 block이 모두 round-trip되고, unsupported attribute가 reject되며, HTML/script 실행 없이 bounded plain text가 만들어지는지 test한다.
- [ ] `apps/frontend`에서 `npm run lint`, `npm test`를 실행한다.

## 작업 3: document route, toolbar, autosave state 구현

**대상 파일:**
- 생성: `apps/frontend/src/app/files/documents/[documentId]/page.tsx`
- 생성: `apps/frontend/src/features/documents/components/document-editor-page.tsx`, `document-editor.tsx`, `document-toolbar.tsx`, `document-save-status.tsx`, `document-file-attachment.tsx`, `document-file-picker.tsx`
- 생성: `apps/frontend/src/features/documents/components/document-editor.test.tsx` 또는 repository 호환 script test
- 수정: `apps/frontend/src/features/drive/components/drive-panel.tsx`

- [ ] 기존 auth session/Drive API convention으로 문서를 load한다. breadcrumb, inline title edit, member-list 영역, autosave state, body를 가진 full-height editor surface를 만든다. `/docs` navigation은 만들지 않는다.
- [ ] block/mark command, undo/redo, link edit, attachment insert를 위한 compact shadcn/Lucide toolbar를 만든다. 낯선 control에는 tooltip을 붙이고 control size를 고정해 layout이 흔들리지 않게 한다.
- [ ] title edit는 document body save가 아니라 Drive rename endpoint를 호출한다. 성공 시 Drive list state/cache도 갱신한다.
- [ ] local content save를 debounce하고 canonical JSON만 보낸다. retry 동안 stable client save id를 유지한다. manual save command 없이 `저장 중`, `저장됨`, `재연결 중`, `저장 실패` 상태만 보여준다.
- [ ] save failure 또는 navigation interruption 때만 browser session storage에 unsent local content를 보관한다. matching server acknowledgement 뒤에는 지운다. session storage를 durable truth로 취급하지 않는다.
- [ ] loading, empty document, unauthorized/not-found, 열린 상태에서 삭제됨, save error, retry state를 만든다. delete를 감지하면 edit를 중단하고 간결한 안내와 함께 `/files`로 돌아간다.
- [ ] 같은 Workspace Drive tree를 탐색하는 file picker를 구현하고 `itemType=file`, `uploadStatus=ready`만 선택한다. editor에서 upload path를 추가하지 않는다. API 확인 뒤에만 reference atom을 삽입한다.
- [ ] 모든 지원 block, link insertion, checklist toggle, attachment keyboard focus, desktop/mobile text overflow를 keyboard QA한다.

## 작업 4: PDF preview와 file attachment 표현 추가

**대상 파일:**
- 생성: `apps/frontend/src/features/documents/components/pdf-viewer.tsx`, `file-preview-dialog.tsx`, `pdf-viewer.test.tsx` 또는 repository 호환 script test
- 수정: `apps/frontend/src/features/documents/components/document-file-attachment.tsx`, `apps/frontend/src/features/drive/components/drive-panel.tsx`

- [ ] 유지보수되는 PDF.js React viewer를 사용하고 frontend bundler에 맞는 worker를 설정한다. preview URL을 받은 뒤에만 page를 load하며 dialog close 시 object URL state를 해제한다.
- [ ] PDF attachment는 앱 내부 open action과 download action을 제공한다. open 화면에는 current page, page counter, previous/next, zoom, loading, failed-preview state가 있다.
- [ ] non-PDF attachment는 name, MIME type, size, unavailable state, download만 보여준다. download는 기존 presigned-download path를 계속 쓴다.
- [ ] preview/download 전 attachment availability를 재검증한다. deleted/failed file이면 문서 본문은 손상시키지 않고 `사용할 수 없는 파일`을 표시한다.
- [ ] PDF viewer의 page/pointer state는 명시적인 props interface 뒤의 local state로 유지한다. realtime 계획이 document storage 변경 없이 ephemeral shared presence를 얹을 수 있어야 한다.
- [ ] URL request, PDF/non-PDF branch, unavailable state, viewer control을 test한다. 큰 PDF, image/text file, expired preview URL retry를 수동 확인한다.

## 작업 5: 리뷰와 통합 확인

- [ ] `apps/frontend/FRONTEND_COMMON_AREAS.md`를 다시 읽고 route/layout 영향이 있다면 PR에 기록한다.
- [ ] `git diff --check`, `apps/app-server`의 `npm test`, `apps/frontend`의 `npm test`를 실행한다.
- [ ] `/files`에서 문서를 만들고 모든 block을 작성, reload 후 저장 확인, ready PDF와 다른 file 첨부, preview/download, Drive rename/move/delete, editor에서 새 external file upload가 불가능한지까지 수동 QA한다.
- [ ] Activity Log는 persisted edit session당 content 하나, attachment mutation당 attachment 하나만 남고 toolbar click, keystroke, preview 이동, retry에는 남지 않는지 확인한다.
- [ ] 작업 단위로 commit하고 focused editor/PDF PR을 연다. Yjs networking과 shared PDF presence는 다음 계획으로 남긴다.
