# PR Review Flow Group Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flow 제목을 드래그하면 같은 Flow의 pinned 파일을 포함한 파일 그래프 전체가 기존 저장·실시간 동기화 계약을 통해 함께 이동하도록 만든다.

**Architecture:** Flow 제목 pointer down 시 같은 `flowId`의 파일 shape id를 계산해 tldraw 다중 선택으로 전환하고, tldraw 기본 translate가 동일한 delta를 적용하도록 한다. system shape 정책은 Flow 제목의 `x`, `y` 변경만 허용하고, 파일 위치 저장과 관계선 재계산은 기존 PR Review Canvas 경로를 재사용한다.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, tldraw 5.1, Node.js focused test scripts

## Global Constraints

- pinned 파일도 Flow 전체 이동에는 포함한다.
- Flow 제목은 별도 저장하지 않고 파일 bounds에서 다시 생성한다.
- 관계선은 선택하거나 저장하지 않고 기존 geometry 재계산 경로를 사용한다.
- 읽기 전용 상태와 자동 정렬 미리보기 중에는 Flow 전체 이동을 시작하지 않는다.
- 저장 가능한 파일 shape가 준비되지 않은 fallback 화면에서는 Canvas 이동을 읽기 전용으로 둔다.
- DB schema, migration, App Server API, realtime payload를 변경하지 않는다.
- Frontend PR Review 도메인 밖의 코드는 수정하지 않는다.
- 전체 monorepo 테스트는 실행하지 않고 PR Review focused test와 Frontend TypeScript 검사만 실행한다.

---

## File Map

- Create: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-flow-group-drag.ts`
  - Flow 제목과 같은 Flow의 파일 shape id를 결정하는 순수 함수만 소유한다.
- Create: `apps/frontend/scripts/pr-review/flow-group-drag.test.mjs`
  - pinned 포함, 다른 Flow 및 관계선 제외 계약을 검증한다.
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-system-shape-policy.ts`
  - Flow 제목 변경을 `x`, `y` translation으로 제한하는 순수 함수를 제공한다.
- Modify: `apps/frontend/scripts/pr-review/system-shape-policy.test.mjs`
  - Flow 제목의 위치만 허용되고 props·회전 등은 보존되는지 검증한다.
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil.tsx`
  - Flow 제목을 다중 선택 이동 핸들로 연결하고 이동 가능 cursor를 표시한다.
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx`
  - system shape 정책에 Flow 제목 예외를 연결하고 자동 정렬 미리보기 중 Canvas를 읽기 전용으로 둔다.
- Modify: `apps/frontend/scripts/pr-review/test.mjs`
  - 새 focused test를 회귀 묶음에 포함하고 wiring 계약을 확인한다.

---

### Task 1: Flow 이동 대상 선택 계산

**Files:**
- Create: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-flow-group-drag.ts`
- Create: `apps/frontend/scripts/pr-review/flow-group-drag.test.mjs`
- Modify: `apps/frontend/scripts/pr-review/test.mjs`

**Interfaces:**
- Consumes: Flow label shape id, `flowId`, 현재 페이지의 파일 shape 참조 목록
- Produces: `getPrReviewFlowDragShapeIds(input): string[]`

- [ ] **Step 1: 같은 Flow 파일만 선택하는 실패 테스트 작성**

```js
import assert from "node:assert/strict";

const { getPrReviewFlowDragShapeIds } = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-flow-group-drag.ts"
);

assert.deepEqual(
  getPrReviewFlowDragShapeIds({
    flowId: "flow-1",
    flowLabelShapeId: "shape:flow-1",
    fileShapes: [
      { id: "shape:file-1", flowId: "flow-1", pinned: false },
      { id: "shape:file-2", flowId: "flow-1", pinned: true },
      { id: "shape:file-3", flowId: "flow-2", pinned: false }
    ]
  }),
  ["shape:flow-1", "shape:file-1", "shape:file-2"]
);

console.log("PR Review Flow group drag tests passed");
```

- [ ] **Step 2: 새 test를 실행해 RED 확인**

Run: `node --experimental-strip-types scripts/pr-review/flow-group-drag.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `pr-review-flow-group-drag.ts`.

- [ ] **Step 3: 최소 선택 계산 함수 구현**

```ts
export type PrReviewFlowDragFileShape = {
  id: string;
  flowId: string;
  pinned: boolean;
};

export function getPrReviewFlowDragShapeIds({
  fileShapes,
  flowId,
  flowLabelShapeId
}: {
  fileShapes: readonly PrReviewFlowDragFileShape[];
  flowId: string;
  flowLabelShapeId: string;
}) {
  return [
    flowLabelShapeId,
    ...fileShapes
      .filter((shape) => shape.flowId === flowId)
      .map((shape) => shape.id)
  ];
}
```

`pinned`은 필터 조건으로 사용하지 않는다. 입력 순서를 유지해 tldraw 선택 순서가 결정적이도록 한다.

- [ ] **Step 4: focused test와 회귀 묶음 연결**

`apps/frontend/scripts/pr-review/test.mjs` 마지막 import 목록에 아래 줄을 추가한다.

```js
await import("./flow-group-drag.test.mjs");
```

Run:

```powershell
node --experimental-strip-types scripts/pr-review/flow-group-drag.test.mjs
node --experimental-strip-types scripts/pr-review/test.mjs
```

Expected: `PR Review Flow group drag tests passed`와 전체 PR Review script success output.

- [ ] **Step 5: Task 1 커밋**

```powershell
git add -- apps/frontend/src/features/pr-review/components/review-canvas/pr-review-flow-group-drag.ts apps/frontend/scripts/pr-review/flow-group-drag.test.mjs apps/frontend/scripts/pr-review/test.mjs
git commit -m "feat: PR Review Flow 이동 대상 계산 추가 (#772)"
```

---

### Task 2: Flow 제목 translation 정책 허용

**Files:**
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-system-shape-policy.ts`
- Modify: `apps/frontend/scripts/pr-review/system-shape-policy.test.mjs`
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx:1343-1362`

**Interfaces:**
- Consumes: 이전 Flow label shape와 tldraw가 제안한 다음 shape
- Produces: `preservePrReviewFlowLabelTranslation(previous, next)` — 이전 shape의 모든 필드를 보존하고 `x`, `y`만 다음 값으로 교체

- [ ] **Step 1: 위치 외 변경을 막는 실패 테스트 작성**

`system-shape-policy.test.mjs` import에 `preservePrReviewFlowLabelTranslation`을 추가하고 다음 검증을 작성한다.

```js
const previousProps = { title: "Flow 1", w: 720 };
const previous = {
  id: "shape:flow-1",
  type: "pr_review_flow_label",
  x: 40,
  y: 32,
  rotation: 0,
  props: previousProps
};
const next = {
  ...previous,
  x: 240,
  y: 180,
  rotation: 1,
  props: { title: "변조", w: 1 }
};

assert.deepEqual(
  preservePrReviewFlowLabelTranslation(previous, next),
  { ...previous, x: 240, y: 180 }
);
```

- [ ] **Step 2: test를 실행해 RED 확인**

Run: `node --experimental-strip-types scripts/pr-review/system-shape-policy.test.mjs`

Expected: FAIL because `preservePrReviewFlowLabelTranslation` is not exported.

- [ ] **Step 3: translation 제한 함수 구현**

`pr-review-system-shape-policy.ts`에 아래 함수를 추가한다.

```ts
export function preservePrReviewFlowLabelTranslation<
  T extends { x: number; y: number }
>(previous: T, next: T): T {
  return {
    ...previous,
    x: next.x,
    y: next.y
  };
}
```

- [ ] **Step 4: Canvas system shape 정책에 Flow label 예외 연결**

`PrReviewCanvasSurface.tsx`에서 helper를 import하고, 일반 system shape 차단보다 먼저 아래 분기를 추가한다.

```ts
if (
  prev.type === PR_REVIEW_FLOW_LABEL_SHAPE_TYPE &&
  next.type === PR_REVIEW_FLOW_LABEL_SHAPE_TYPE
) {
  return preservePrReviewFlowLabelTranslation(prev, next);
}

if (prReviewShapeTypes.has(next.type)) {
  return prev;
}
```

hydration과 internal update bypass는 기존처럼 이 분기보다 먼저 유지한다.

- [ ] **Step 5: 정책 test와 TypeScript 검사 실행**

Run:

```powershell
node --experimental-strip-types scripts/pr-review/system-shape-policy.test.mjs
npm.cmd run lint
```

Expected: policy test PASS and `tsc --noEmit` exits 0.

- [ ] **Step 6: Task 2 커밋**

```powershell
git add -- apps/frontend/src/features/pr-review/components/review-canvas/pr-review-system-shape-policy.ts apps/frontend/scripts/pr-review/system-shape-policy.test.mjs apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx
git commit -m "feat: PR Review Flow 제목 이동 허용 (#772)"
```

---

### Task 3: Flow 제목을 그래프 전체 이동 핸들로 연결

**Files:**
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil.tsx:1-16,682-701`
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx:2641-2660`
- Modify: `apps/frontend/scripts/pr-review/test.mjs`

**Interfaces:**
- Consumes: `getPrReviewFlowDragShapeIds`, tldraw editor의 현재 페이지 파일 shape
- Produces: Flow label pointer down 시 같은 Flow label + 모든 파일을 선택하는 UI 동작

- [ ] **Step 1: wiring 계약 실패 테스트 추가**

`test.mjs`에서 읽고 있는 source string에 아래 assertion을 추가한다.

```js
assert.match(prReviewFileNodeShapeUtil, /getPrReviewFlowDragShapeIds/);
assert.match(prReviewFileNodeShapeUtil, /onPointerDownCapture/);
assert.match(prReviewFileNodeShapeUtil, /cursor-move/);
assert.match(
  prReviewCanvasSurface,
  /readOnly=\{readOnly \|\| !persistedFileShapeEnabled \|\| layoutPreview !== null\}/
);
```

- [ ] **Step 2: PR Review 회귀 script를 실행해 RED 확인**

Run: `node --experimental-strip-types scripts/pr-review/test.mjs`

Expected: FAIL on the new source contract assertions.

- [ ] **Step 3: Flow label pointer down에서 전체 Flow 선택**

`PrReviewFileNodeShapeUtil.tsx`에 `PointerEvent`, `TLShapeId`, helper import를 추가하고 `PrReviewFlowLabel`을 다음 구조로 변경한다.

```tsx
function PrReviewFlowLabel({ shape }: { shape: PrReviewFlowLabelShape }) {
  const editor = useEditor();

  function handlePointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || editor.getInstanceState().isReadonly) {
      return;
    }

    const fileShapes = editor
      .getCurrentPageShapes()
      .filter(isPrReviewFileNodeShape)
      .map((fileShape) => ({
        id: String(fileShape.id),
        flowId: fileShape.props.flowId,
        pinned: fileShape.props.pinned
      }));
    const shapeIds = getPrReviewFlowDragShapeIds({
      fileShapes,
      flowId: shape.props.flowId,
      flowLabelShapeId: String(shape.id)
    });

    editor.select(...shapeIds.map((shapeId) => shapeId as TLShapeId));
  }

  return (
    <HTMLContainer
      className="cursor-move"
      onPointerDownCapture={handlePointerDownCapture}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      {/* 기존 Flow 제목 markup 유지 */}
    </HTMLContainer>
  );
}
```

pointer event의 propagation을 중단하지 않는다. 선택을 확장한 뒤 tldraw 기본 translate가 계속 실행되어야 한다.

- [ ] **Step 4: 자동 정렬 미리보기 중 이동 차단**

`PrReviewCanvasRealtimeBridge` 호출에 전달하는 값만 아래처럼 바꾼다.

```tsx
<PrReviewCanvasRealtimeBridge
  presence={canvasPresence}
  readOnly={
    readOnly || !persistedFileShapeEnabled || layoutPreview !== null
  }
/>
```

이 변경은 미리보기 또는 fallback 화면에서 개별 파일과 Flow 전체 이동을 모두 차단한다. 저장 가능한 파일 shape가 준비되고 미리보기를 적용 또는 취소하면 기존 `readOnly` 값으로 복구된다.

- [ ] **Step 5: focused 회귀와 TypeScript 검사 실행**

Run:

```powershell
node --experimental-strip-types scripts/pr-review/flow-group-drag.test.mjs
node --experimental-strip-types scripts/pr-review/system-shape-policy.test.mjs
node --experimental-strip-types scripts/pr-review/canvas-shape-persistence.test.mjs
node --experimental-strip-types scripts/pr-review/test.mjs
npm.cmd run lint
```

Expected: all focused scripts PASS and `tsc --noEmit` exits 0.

- [ ] **Step 6: diff 범위 확인**

Run:

```powershell
git diff --check
git status --short
```

Expected: whitespace errors 없음. 변경 파일은 File Map에 적힌 Frontend PR Review 파일과 설계·계획 문서뿐이며 `.superpowers/`는 미추적 상태로 남는다.

- [ ] **Step 7: Task 3 커밋**

```powershell
git add -- apps/frontend/src/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil.tsx apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx apps/frontend/scripts/pr-review/test.mjs
git commit -m "feat: PR Review Flow 그래프 전체 이동 지원 (#772)"
```

---

### Task 4: 최종 검증과 문서 일치 확인

**Files:**
- Verify: `docs/superpowers/specs/2026-07-20-pr-review-flow-group-drag-design.md`
- Verify: Task 1~3의 변경 파일

**Interfaces:**
- Consumes: 완료된 Flow drag 구현과 focused test 결과
- Produces: 리뷰 가능한 완료 상태

- [ ] **Step 1: 최종 focused 검증**

Run:

```powershell
node --experimental-strip-types scripts/pr-review/test.mjs
npm.cmd run lint
git diff --check HEAD~3..HEAD
```

Expected: PR Review scripts PASS, `tsc --noEmit` exits 0, whitespace errors 없음.

- [ ] **Step 2: 설계 계약 대조**

다음 항목을 코드와 test assertion에서 각각 확인한다.

- 같은 Flow 파일 전체와 pinned 파일 포함
- 다른 Flow와 relation edge 선택 제외
- Flow 제목은 `x`, `y`만 변경 가능
- 파일 위치 저장 API와 relation geometry 재계산 경로 유지
- 읽기 전용 및 layout preview 중 이동 차단
- 저장 가능한 파일 shape가 없는 fallback 화면 이동 차단
- App Server, API 문서, migration 변경 없음

- [ ] **Step 3: 최종 상태 기록**

Run:

```powershell
git log --oneline -4
git status --short
```

Expected: 설계 커밋과 Task 1~3 구현 커밋이 보이며, tracked working tree가 clean이다.
