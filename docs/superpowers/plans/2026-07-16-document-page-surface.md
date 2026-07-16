# 프레임 없는 문서 페이지 구현 계획

> **에이전트 작업자용:** 이 계획을 구현할 때는 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`를 사용한다. 각 작업은 체크박스로 추적한다.

**목표:** `/files?documentId=...` 문서 편집기를 카드형 입력 폼에서 Notion형 중앙 문서 페이지로 바꾸고, 현재 저장·서식·오류 상태를 유지한다.

**구조:** `DriveDocumentEditor`가 back action과 load state를 하나의 page column 안에서 렌더링한다. `DocumentEditorSurface`는 제목/저장 상태/header action, borderless command strip, 자연스러운 Tiptap 본문을 같은 문서 컬럼에 배치한다. 별도 Placeholder dependency는 추가하지 않고 editor의 `isEmpty` 상태를 class로 전달한다.

**기술:** Next.js/React, Tiptap, CSS Module, shadcn/ui, Lucide, 기존 source contract test.

## 공통 제약

- API, DB schema, autosave transport, Drive 목록 동작은 변경하지 않는다.
- 현재 undo/redo와 heading/list/quote/code block 명령은 유지한다.
- editor card의 border, rounded corner, 고정된 card background를 제거한다.
- 문서 컬럼은 `max-width: 52rem`을 사용하고 desktop 중앙 정렬, mobile 좌우 padding을 적용한다.
- `/` slash menu, selection bubble menu, block drag handle, inline title rename, 파일 첨부/PDF viewer는 다음 작업으로 남긴다.
- 저장 중/저장됨/저장 실패/충돌의 기존 의미와 readonly conflict 동작을 유지한다.
- frontend 공통 영역을 수정하지 않고 `src/features/drive/**` 안에서 끝낸다.

---

## 작업 1: 레이아웃 계약 테스트를 먼저 추가

**대상 파일:**
- 수정: `apps/frontend/src/features/drive/drive-document-contract.test.mjs`

- [ ] 현재 editor source를 읽는 기존 contract test에 다음 기대를 추가한다.

```js
assert.match(editor, /styles\.documentPage/);
assert.match(editor, /styles\.documentHeader/);
assert.match(editor, /styles\.commandStrip/);
assert.match(editor, /styles\.editorSurface/);
assert.match(editor, /isEditorEmpty/);
assert.ok(editor.includes("입력하려면 /"));
assert.doesNotMatch(editor, /rounded-md border bg-background/);
```

- [ ] 새 기대만 실행해 현재 구현에서 실패하는지 확인한다.

Run: `node src/features/drive/drive-document-contract.test.mjs`
Expected: FAIL because the frame-free classes and empty-state marker do not exist yet.

- [ ] 테스트 파일만 커밋하지 않고 다음 작업의 실제 UI 변경과 함께 하나의 focused PR에 포함한다.

## 작업 2: document editor surface를 중앙 페이지 구조로 변경

**대상 파일:**
- 수정: `apps/frontend/src/features/drive/components/document-editor.tsx`

- [ ] `DocumentEditorSurface` props에 `onClose: () => void`를 추가하고, `DriveDocumentEditor`에서 기존 back button을 제거한 뒤 surface로 전달한다.
- [ ] loading/error/ready 상태의 최상위 wrapper에 `styles.documentPage`를 사용한다.
- [ ] ready header에 back action, 문서 제목, 저장 상태, 기존 수동 저장 icon action을 배치하고 `styles.documentHeader`를 사용한다.
- [ ] 기존 error alert는 `styles.inlineAlert`로 감싸 문서 컬럼 안에 유지한다.
- [ ] editor wrapper를 다음 구조로 바꾼다.

```tsx
<div className={styles.editorSurface}>
  <div className={styles.commandStrip} role="toolbar" aria-label="문서 서식">
    {/* 기존 ToolbarButton 명령을 그대로 유지 */}
  </div>
  <EditorContent
    editor={editor}
    className={`${styles.editor} ${isEditorEmpty ? styles.emptyEditor : ""}`}
  />
</div>
```

- [ ] 기존 `Collaboration`, `Y.encodeStateAsUpdate`, autosave queue, conflict readonly, reload action은 변경하지 않는다.
- [ ] `onUpdate`에서 `setIsEditorEmpty(updatedEditor.isEmpty)`를 호출해 입력 시 placeholder class를 제거하고, editor bootstrap 후 empty 상태를 초기화한다.

## 작업 3: borderless CSS와 빈 문서 placeholder 구현

**대상 파일:**
- 수정: `apps/frontend/src/features/drive/components/document-editor.module.css`

- [ ] `documentPage`는 `width: 100%`, `max-width: 52rem`, `margin-inline: auto`, responsive horizontal padding을 제공한다.
- [ ] `documentHeader`는 title/status/action이 겹치지 않도록 flex-wrap과 고정 gap을 사용하며 하단 border는 사용하지 않는다.
- [ ] `editorSurface`는 `background`, `border`, `border-radius`, `overflow-hidden` 없이 본문을 감싼다.
- [ ] `commandStrip`은 transparent background, 최소 padding, 얇은 bottom divider만 사용하고 현재 toolbar icon의 hit area는 유지한다.
- [ ] `.editor .tiptap`은 자연스러운 `min-height`만 유지하고 card padding 대신 responsive inline padding을 사용한다.
- [ ] `.emptyEditor .tiptap p:first-child::before`에 `입력하려면 /`를 muted 색상으로 표시하고 pointer-events를 끈다. editor가 focus되거나 비어 있지 않으면 보이지 않게 한다.
- [ ] 기존 heading/list/quote/code/hr 스타일은 시각적 계층을 유지하되 page column 안에서 overflow되지 않게 한다.

## 작업 4: frontend 검증과 문서 체크리스트 갱신

**대상 파일:**
- 수정: `docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md`
- 수정: `docs/superpowers/plans/2026-07-16-document-editor-and-pdf-viewer.md` 필요 시 현재 구현 상태 반영

- [ ] `apps/frontend`에서 `npm run format:check`, `npm run lint`, `npm test`를 실행한다.
- [ ] `git diff --check`를 실행한다.
- [ ] desktop에서 빈 문서, 긴 문서, 저장 중/저장 실패/conflict 상태를 확인한다.
- [ ] mobile 폭에서 title, status, toolbar, body가 겹치지 않는지 확인한다.
- [ ] foundation/lifecycle 상단 현황에 #1184 화면 개선의 완료 상태와 다음 interaction 작업을 반영한다.
- [ ] 구현 단위별 commit을 만들고 `dev` 대상 focused PR을 생성한다.
