# 프레임 없는 문서 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/files?documentId=...`의 editor를 프레임 없는 Notion형 중앙 문서 페이지로 바꾸고 기존 저장과 서식 명령을 보존한다.

**Architecture:** `DriveDocumentEditor`가 로딩·오류·뒤로가기와 중앙 컬럼을 소유하고, `DocumentEditorSurface`는 제목·저장 상태·명령 strip·본문을 렌더한다. autosave와 API client는 변경하지 않고 feature-local CSS로 visual 규칙을 둔다.

**Tech Stack:** Next.js/React, Tailwind, shadcn/ui, Lucide, Tiptap, Yjs, CSS Modules, Node assertion script.

## Global Constraints

- `apps/frontend/src/features/drive/**`만 수정한다. route shell, shared UI, frontend package/lockfile은 수정하지 않는다.
- API, DB schema, Drive API client, snapshot autosave transport와 `409 CONFLICT` 의미를 바꾸지 않는다.
- card와 fixed input canvas는 제거하되 undo/redo, block command, 수동 저장 icon은 유지한다.
- desktop 본문은 `max-w-[52rem]`, mobile은 안정적인 수평 padding을 사용한다.
- slash menu, bubble menu, block drag handle, inline title rename, attachment/PDF viewer는 다음 작업으로 남긴다.

---

### Task 1: 페이지 surface contract를 고정

**Files:**
- Modify: `apps/frontend/src/features/drive/drive-document-contract.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md`

- [ ] **Step 1: 다음 assertions를 추가한다.**

```js
assert.match(editor, /max-w-\[52rem\]/);
assert.match(editor, /aria-label="문서 서식"/);
assert.match(editor, /입력하려면 \//);
assert.doesNotMatch(editor, /mt-4 overflow-hidden rounded-md border bg-background/);
assert.match(editor, /saveDocumentSnapshot/);
assert.match(editor, /status === 409/);
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `node src/features/drive/drive-document-contract.test.mjs`

Expected: 새 page surface assertion에서 실패.

- [ ] **Step 3: foundation 현황에 #1184 진행 중 항목을 추가하고 contract 변경을 commit한다.**

```bash
git add src/features/drive/drive-document-contract.test.mjs ../../docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md
git commit -m "test: 문서 페이지 surface 계약 추가 (#1184)"
```

### Task 2: 카드 없는 중앙 문서 페이지 구현

**Files:**
- Modify: `apps/frontend/src/features/drive/components/document-editor.tsx`
- Modify: `apps/frontend/src/features/drive/components/document-editor.module.css`

- [ ] **Step 1: outer shell을 중앙 문서 컬럼으로 바꾼다.**

```tsx
<div className="min-h-[calc(100vh-6.5rem)]">
  <div className="mx-auto w-full max-w-[52rem] px-5 py-6 sm:px-8 sm:py-10">
    <Button type="button" variant="ghost" size="sm" onClick={onClose}>
      <ArrowLeft />
      파일
    </Button>
    {/* existing load state */}
  </div>
</div>
```

- [ ] **Step 2: `DocumentEditorSurface`의 bordered card를 아래 구조로 교체한다.**

```tsx
<section className="pt-8 sm:pt-10">
  <header className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">
        {bootstrap.item.name}
      </h1>
      <p className="mt-3 min-h-5 text-sm text-muted-foreground" role="status">
        {saveStateLabel}
      </p>
    </div>
    {/* existing save icon */}
  </header>
  {/* existing inline error */}
  <div className="mt-8 flex flex-wrap items-center gap-1" aria-label="문서 서식">
    {/* existing ToolbarButton controls */}
  </div>
  <EditorContent editor={editor} className={styles.editor} />
</section>
```

- [ ] **Step 3: editor attribute와 CSS를 natural document flow로 바꾼다.**

```ts
editorProps: { attributes: { class: "outline-none text-base leading-8" } }
```

```css
.editor :global(.tiptap) {
  min-height: 0;
  outline: none;
  padding: 2rem 0 6rem;
}

.editor :global(.tiptap > p:first-child:last-child:has(br.ProseMirror-trailingBreak))::before {
  color: var(--muted-foreground);
  content: "입력하려면 /";
  pointer-events: none;
}
```

- [ ] **Step 4: focused test를 green으로 만들고 구현을 commit한다.**

Run: `node src/features/drive/drive-document-contract.test.mjs`

Expected: exit code 0.

```bash
git add src/features/drive/components/document-editor.tsx src/features/drive/components/document-editor.module.css
git commit -m "feat: 프레임 없는 문서 페이지 구현 (#1184)"
```

### Task 3: frontend 검증과 시각 QA

**Files:**
- Modify: `docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md`

- [ ] **Step 1: 정적 검증을 실행한다.**

```bash
npm.cmd run format:check
npm.cmd run lint
npm.cmd test
git diff --check
```

Expected: 모든 명령 exit code 0.

- [ ] **Step 2: 다음 시나리오를 desktop/mobile에서 확인한다.**

```text
빈 문서: title, status, 본문이 border 없는 중앙 컬럼에 이어진다.
긴 문서: 자연스럽게 세로 scroll하며 fixed input box처럼 보이지 않는다.
저장 중/실패/conflict: 상태 text와 alert가 title/body와 겹치지 않는다.
mobile: back action, title, command strip이 줄바꿈 후에도 겹치지 않는다.
```

- [ ] **Step 3: #1184 완료 상태를 foundation 계획에 반영하고 commit한다.**

```bash
git add ../../docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md
git commit -m "docs: 문서 페이지 작업 현황 갱신 (#1184)"
```

- [ ] **Step 4: PR 전 상태를 확인한다.**

```bash
git status --short
git log --oneline origin/dev..HEAD
```

Expected: 관련 파일만 변경되고 모든 commit 제목에 `(#1184)`가 포함된다.
