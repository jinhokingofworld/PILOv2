# PDF 공동 열람과 임시 낙서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 Workspace의 PDF를 앱에서 함께 보며, 참여자의 현재 페이지·포인터와 임시 낙서를 공유한다.

**Architecture:** PDF 전용 Socket.IO room(`workspace:{workspaceId}:pdf:{fileId}`)을 realtime-server에 둔다. room state는 서버 메모리에만 보관하고 마지막 socket이 나가면 삭제한다. 브라우저는 `react-pdf`로 presigned preview URL을 직접 렌더링하고, 페이지 위의 투명 SVG layer에서 pointer와 stroke를 표시한다.

**Tech Stack:** Next.js/React, `react-pdf`/PDF.js, Socket.IO, shadcn/ui, lucide-react.

## Global Constraints

- 기존 `GET .../preview-url` 계약과 Drive DB schema는 변경하지 않는다.
- room 입장은 Workspace member이면서 `ready` 상태의 PDF 파일일 때만 허용한다.
- 페이지 변경은 참여자 상태로만 공유하며 다른 참여자의 화면을 강제로 넘기지 않는다.
- 낙서는 현재 PDF 페이지 단위로만 유지한다. pen/highlighter, 개별 선 지우기, 현재 페이지 전체 지우기를 지원한다.
- 낙서·pointer·presence는 영속화하지 않는다. 마지막 참여자가 떠나면 해당 room state를 폐기한다.
- 테스트는 새 payload/state/access 동작과 UI 계약의 focused test만 실행한다. 전체 test/build는 실행하지 않는다.

## 진행 상태

- [x] Workspace member와 `ready` PDF만 입장 가능한 realtime room을 추가했다.
- [x] 페이지·포인터·페이지별 임시 낙서 relay와 마지막 참여자 퇴장 시 state 삭제를 구현했다.
- [x] `react-pdf` 기반 viewer, pen/highlighter/eraser/현재 페이지 전체 지우기 UI를 연결했다.
- [x] Tiptap의 중복 `dropCursor` extension 경고를 제거했다.
- [x] focused test, format check, frontend/realtime typecheck를 통과했다.
- [ ] 인증된 dev 세션 두 개에서 PDF 공동 열람 수동 QA를 진행한다.

---

### Task 1: PDF collaboration room 계약과 접근 제어

**Files:**
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-events.ts`
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-types.ts`
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-payload.ts`
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-room.ts`
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-access.service.ts`
- Test: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-access.service.test.mjs`

**Interfaces:**
- Produces `readPdfCollaborationRoomRef(payload)`, `createPdfCollaborationRoomName(room)`, and `getPdfCollaborationRoomAccess(context, room)`.
- Client events are `pdf-collaboration:join`, `leave`, `page:update`, `pointer:update`, `stroke:commit`, `stroke:remove`, and `strokes:clear`.

- [ ] **Step 1: Write the focused access test**

```js
test("allows a Workspace member to join a ready PDF file room", async () => {
  const access = await service.getPdfCollaborationRoomAccess({ userId }, { fileId, workspaceId });
  assert.deepEqual(access, { readOnly: false });
  assert.match(queries[0].text, /item\.item_type = 'file'/);
  assert.match(queries[0].text, /item\.mime_type = 'application\/pdf'/);
  assert.match(queries[0].text, /item\.upload_status = 'ready'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test src/pdf-collaboration/pdf-collaboration-access.service.test.mjs` in `apps/realtime-server`.
Expected: FAIL because the access service does not exist.

- [ ] **Step 3: Implement the parser, room name, and access service**

`PdfCollaborationRoomRef` contains lowercase UUID `workspaceId` and `fileId`. The access query joins `drive_items` to `workspace_members`, filters `deleted_at IS NULL`, `item_type = 'file'`, `mime_type = 'application/pdf'`, and `upload_status = 'ready'`.

- [ ] **Step 4: Run the focused access test**

Run the command from Step 2.
Expected: PASS.

### Task 2: Ephemeral collaboration state와 Socket.IO relay

**Files:**
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-room-state.ts`
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-room-state.test.mjs`
- Modify: `apps/realtime-server/src/socket/socket-server.ts`

**Interfaces:**
- Consumes the room/access contract from Task 1.
- Produces room snapshot `{ presence, pointers, strokesByPage }` on join and broadcasts validated events to joined clients.

- [ ] **Step 1: Write the room-state test**

```js
test("deletes an ephemeral room after its last participant leaves", () => {
  state.join(roomName, firstSocketId, firstPresence);
  state.join(roomName, secondSocketId, secondPresence);
  state.leave(roomName, firstSocketId);
  assert.ok(state.getSnapshot(roomName));
  state.leave(roomName, secondSocketId);
  assert.equal(state.getSnapshot(roomName), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test src/pdf-collaboration/pdf-collaboration-room-state.test.mjs` in `apps/realtime-server`.
Expected: FAIL because the state service does not exist.

- [ ] **Step 3: Implement bounded in-memory state and socket handlers**

Store normalized points (`xRatio`, `yRatio`) only. Limit a stroke to 500 points and 32KB serialized payload. Broadcast pointer updates at the client throttle interval. Persist a committed stroke only after `pointerup`; individual erase removes its `strokeId`; clear removes strokes for the requested current page. On `leave` and `disconnect`, remove the presence and delete room state when no participants remain.

- [ ] **Step 4: Run the focused room-state test and realtime typecheck**

Run: `node --experimental-strip-types --test src/pdf-collaboration/pdf-collaboration-room-state.test.mjs` and `npm run lint` in `apps/realtime-server`.
Expected: PASS.

### Task 3: PDF 렌더링, presence, 임시 낙서 UI

**Files:**
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/package-lock.json`
- Create: `apps/frontend/src/features/drive/pdf-collaboration.ts`
- Create: `apps/frontend/src/features/drive/components/pdf-collaboration-surface.tsx`
- Modify: `apps/frontend/src/features/drive/components/pdf-preview-dialog.tsx`
- Modify: `apps/frontend/src/features/drive/components/document-editor.module.css`
- Modify: `apps/frontend/src/features/drive/drive-document-contract.test.mjs`

**Interfaces:**
- Consumes the existing Drive `createPreviewUrl` and new Socket.IO events from Task 2.
- `usePdfCollaborationRoom({ workspaceId, fileId, enabled })` exposes page/pointer/stroke state and `updatePage`, `updatePointer`, `commitStroke`, `removeStroke`, `clearPageStrokes` commands.

- [ ] **Step 1: Write the UI contract assertion**

```js
assert.match(pdfPreview, /PdfCollaborationSurface/);
assert.match(pdfPreview, /react-pdf/);
assert.match(pdfPreview, /pdf-collaboration/);
```

- [ ] **Step 2: Run the focused UI contract test to verify it fails**

Run: `node src/features/drive/drive-document-contract.test.mjs` in `apps/frontend`.
Expected: FAIL because the collaboration surface is absent.

- [ ] **Step 3: Add `react-pdf` and implement the surface**

Configure the PDF.js worker through `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`. Render one controlled PDF page with previous/next icon buttons and page counter. Render remote pointers and SVG strokes inside the page-sized overlay. The toolbar uses icon buttons with titles for pen, highlighter, eraser, and current-page clear. Pointer and page presence uses user display names; the local user is excluded from remote markers.

- [ ] **Step 4: Run the focused UI contract test and frontend lint**

Run: `node src/features/drive/drive-document-contract.test.mjs` and `npm run lint` in `apps/frontend`.
Expected: PASS.

### Task 4: Existing Tiptap warning removal과 manual QA

**Files:**
- Modify: `apps/frontend/src/features/drive/components/document-editor.tsx`
- Modify: `docs/DriveMVPImplementationChecklist.md`

- [ ] **Step 1: Add the failing static assertion for the explicit Dropcursor ownership**

```js
assert.match(editor, /StarterKit\.configure\(\{ undoRedo: false, dropcursor: false \}\)/);
```

- [ ] **Step 2: Run the focused Drive contract test to verify it fails**

Run: `node src/features/drive/drive-document-contract.test.mjs` in `apps/frontend`.
Expected: FAIL because `StarterKit` still provides a second `dropCursor` extension.

- [ ] **Step 3: Disable StarterKit's Dropcursor and keep the configured explicit extension**

Set `dropcursor: false` in the existing `StarterKit.configure` call; do not change editor behavior otherwise.

- [ ] **Step 4: Run focused verification and perform two-browser manual QA**

Run the two focused Drive/realtime tests and both package lint commands. Manually verify two Workspace members can open the same ready PDF, observe page/pointer presence, create/remove/clear current-page strokes, and see all temporary drawings disappear after every participant closes the viewer.
