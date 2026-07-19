# PR Review Relation-Driven Layout Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** semantic 관계가 있는 PR Review Flow는 분기 구조로 배치하면서 1번 파일을 시작점으로 유지한다.

**Architecture:** 저장된 `review_order` edge는 표시용으로 유지하되 layout rank에서는 제외한다. App Server ELK와 Frontend Dagre는 semantic endpoint pair를 낮은 `workflowOrder`에서 높은 순서로 정규화하고, 1번 start에서 각 semantic root로 synthetic anchor를 추가한다. semantic edge가 없는 Flow만 기존 review-order spine을 fallback으로 사용한다.

**Tech Stack:** TypeScript, ELK layered layout, Dagre, Node.js focused regression scripts

## Global Constraints

- 새 Canvas 최초 materialization과 명시적 `현재 Flow 자동 정렬`만 변경한다.
- DB schema, migration, public API response, semantic graph membership은 변경하지 않는다.
- 실제 relation의 방향·type·저장 값은 변경하지 않고 layout 전용 edge만 정규화한다.
- `review_order` relation은 layout rank를 결정하지 않는다.
- semantic relation이 하나도 없는 Flow는 기존 1→2→3 fallback을 사용한다.
- pin된 node와 기존 저장 geometry·route 보존 정책을 유지한다.
- synthetic layout edge는 Canvas relation 또는 DB에 저장하지 않는다.
- 전체 monorepo 테스트는 실행하지 않는다.

---

### Task 1: App Server 최초 Canvas의 관계 기반 ELK 배치

**Files:**
- Modify: `apps/app-server/src/modules/pr-review/pr-review-canvas-layout.ts`
- Test: `apps/app-server/scripts/pr-review/canvas-materializer.test.mjs`

**Interfaces:**
- Consumes: `PrReviewCanvasLayoutFile.workflowOrder`, `PrReviewCanvasLayoutRelation.isReviewOrder`
- Produces: `buildPrReviewCanvasGraphLayout()`의 기존 geometry·route 반환 계약
- Internal: `buildRelationDrivenLayoutEdges(files, relations)`가 ELK 전용 edge 배열을 반환

- [ ] **Step 1: semantic branch와 review-order-only fallback의 실패 테스트를 작성한다**

`canvas-materializer.test.mjs`에 실제 semantic branch와 연속 review-order relation을 함께 전달한다.

```js
const one = layoutFile("one", 1, "entry");
const two = layoutFile("two", 2, "core_logic");
const three = layoutFile("three", 3, "ui_state");
const four = layoutFile("four", 4, "support");
const five = layoutFile("five", 5, "verification");
const branchLayout = await buildPrReviewCanvasGraphLayout({
  files: [one, two, three, four, five],
  relations: [
    layoutRelation("order-1-2", "one", "two", true),
    layoutRelation("order-2-3", "two", "three", true),
    layoutRelation("order-3-4", "three", "four", true),
    layoutRelation("order-4-5", "four", "five", true),
    layoutRelation("semantic-2-1", "two", "one"),
    layoutRelation("semantic-3-1", "three", "one"),
    layoutRelation("semantic-2-4", "two", "four"),
    layoutRelation("semantic-3-5", "three", "five")
  ]
});
const branch = branchLayout.nodeGeometryByRoomFileId;
assert.ok(branch.get("one").x < branch.get("two").x);
assert.ok(branch.get("one").x < branch.get("three").x);
assert.equal(branch.get("two").x, branch.get("three").x);
assert.equal(branch.get("four").x, branch.get("five").x);
assert.ok(new Set([...branch.values()].map((node) => node.x)).size < 5);
```

semantic relation이 없는 별도 Flow에는 review-order relation만 전달하고 `one.x < two.x < three.x`를 검증한다. 기존 semantic 하단 lane, 다음 Flow 간격, synthetic ID 비노출 assertion은 유지한다.

- [ ] **Step 2: RED를 확인한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/canvas-materializer.test.mjs
```

Expected: 현재 full review-order spine 때문에 `two.x === three.x` assertion이 실패한다.

- [ ] **Step 3: semantic relation 전용 layout edge builder를 구현한다**

`buildFlowGeometry`가 `flowRelations`를 ELK builder에 함께 전달한다.

```ts
const layout = await buildElkFlowLayout(sortedMembers, flowRelations);
```

`buildElkFlowLayout`은 아래 규칙으로 edge를 선택한다.

```ts
function buildRelationDrivenLayoutEdges(
  files: readonly PrReviewCanvasLayoutFile[],
  relations: readonly PrReviewCanvasLayoutRelation[]
) {
  const fileById = new Map(files.map((file) => [file.roomFileId, file]));
  const semanticPairs = new Map<string, { from: string; to: string }>();

  for (const relation of relations) {
    if (relation.isReviewOrder) continue;
    const left = fileById.get(relation.fromRoomFileId);
    const right = fileById.get(relation.toRoomFileId);
    if (!left || !right || left.roomFileId === right.roomFileId) continue;
    const [from, to] = compareFilesInFlow(left, right) <= 0
      ? [left, right]
      : [right, left];
    semanticPairs.set(`${from.roomFileId}\u0000${to.roomFileId}`, {
      from: from.roomFileId,
      to: to.roomFileId
    });
  }

  if (!semanticPairs.size) {
    return buildReviewOrderSpine(files);
  }

  const incoming = new Set([...semanticPairs.values()].map((edge) => edge.to));
  const start = files[0].roomFileId;
  const edges = [...semanticPairs.values()].map((edge) => ({
    id: `layout-semantic:${edge.from}->${edge.to}`,
    sources: [edge.from],
    targets: [edge.to]
  }));
  for (const file of files) {
    if (file.roomFileId === start || incoming.has(file.roomFileId)) continue;
    edges.push({
      id: `layout-anchor:${start}->${file.roomFileId}`,
      sources: [start],
      targets: [file.roomFileId]
    });
  }
  return edges;
}
```

첫 file child에만 FIRST constraint를 둔다.

```ts
children: files.map((file, index) => ({
  id: file.roomFileId,
  width: file.width,
  height: file.height,
  ...(index === 0
    ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } }
    : {})
}))
```

- [ ] **Step 4: focused GREEN을 확인한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/canvas-materializer.test.mjs
```

Expected: build와 test 모두 exit code 0.

- [ ] **Step 5: App Server 변경을 커밋한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review-canvas-layout.ts apps/app-server/scripts/pr-review/canvas-materializer.test.mjs
git commit -m "fix: PR Review 최초 Canvas 관계 기반 배치 복원 (#772)"
```

### Task 2: Frontend 현재 Flow의 관계 기반 Dagre 자동 정렬

**Files:**
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-graph-exploration.ts`
- Test: `apps/frontend/scripts/pr-review/graph-exploration.test.mjs`

**Interfaces:**
- Consumes: `PrReviewGraphNode.workflowOrder`, `roomFileId`, `pinned`, `PrReviewGraphRelation.relationTypes`
- Produces: 기존 `createPrReviewFlowLayout(nodes, relations, flowId)` 위치 map
- Internal: `buildRelationDrivenDagreEdges(movableNodes, relations)`가 Dagre 전용 edge를 반환

- [ ] **Step 1: 자동 정렬 branch와 fallback의 실패 테스트를 작성한다**

```js
const branchNodes = [
  workflowNode("one", 1, false),
  workflowNode("two", 2, false),
  workflowNode("three", 3, false),
  workflowNode("four", 4, false),
  workflowNode("five", 5, false)
];
const graphRelation = (id, from, to, relationTypes) => ({
  id,
  fromRoomFileId: `file-${from}`,
  toRoomFileId: `file-${to}`,
  relationTypes
});
const branchRelations = [
  graphRelation("order-1-2", "one", "two", ["review_order"]),
  graphRelation("order-2-3", "two", "three", ["review_order"]),
  graphRelation("semantic-2-1", "two", "one", ["depends_on"]),
  graphRelation("semantic-3-1", "three", "one", ["supports"]),
  graphRelation("semantic-2-4", "two", "four", ["imports"]),
  graphRelation("semantic-3-5", "three", "five", ["blocks"])
];
const branchLayout = createPrReviewFlowLayout(branchNodes, branchRelations, "flow-ordered");
assert.ok(branchLayout.get("one").x < branchLayout.get("two").x);
assert.equal(branchLayout.get("two").x, branchLayout.get("three").x);
assert.equal(branchLayout.get("four").x, branchLayout.get("five").x);
```

semantic relation이 없는 case는 review-order fallback으로 x가 1→2→3 증가하는지 검증한다. 기존 all-pinned와 pinned 제외 assertion을 유지한다.

- [ ] **Step 2: RED를 확인한다**

Run:

```powershell
Set-Location apps/frontend
node --experimental-strip-types scripts/pr-review/graph-exploration.test.mjs
```

Expected: 현재 full spine 때문에 같은 depth의 x equality assertion이 실패한다.

- [ ] **Step 3: semantic relation을 정규화하고 root anchor를 만드는 Dagre edge builder를 구현한다**

`createPrReviewFlowLayout`의 relation parameter를 다시 사용한다.

```ts
const orderedMovableNodes = [...movableNodes].sort(compareLayoutNodes);
const layoutEdges = buildRelationDrivenDagreEdges(
  orderedMovableNodes,
  relations
);
for (const [index, edge] of layoutEdges.entries()) {
  graph.setEdge({
    name: `layout:${index}:${edge.from}->${edge.to}`,
    v: edge.from,
    w: edge.to
  });
}
```

builder는 `roomFileId`가 있는 movable node만 map에 넣고, relation에 `review_order` 외 type이 하나라도 있을 때 semantic relation으로 취급한다. endpoint를 `workflowOrder`, node ID 순으로 정규화하고 pair를 dedupe한다. semantic pair가 없으면 기존 adjacent spine을 반환한다. semantic pair가 있으면 incoming이 없는 각 root에 earliest movable start의 anchor를 추가한다.

```ts
type DagreLayoutEdge = { from: string; to: string };

function compareLayoutNodes(left: PrReviewGraphNode, right: PrReviewGraphNode) {
  return left.workflowOrder - right.workflowOrder || left.id.localeCompare(right.id);
}

function buildRelationDrivenDagreEdges(
  nodes: readonly PrReviewGraphNode[],
  relations: readonly PrReviewGraphRelation[]
): DagreLayoutEdge[] {
  const nodeByRoomFileId = new Map(
    nodes.flatMap((node) => node.roomFileId ? [[node.roomFileId, node]] : [])
  );
  const semanticPairs = new Map<string, DagreLayoutEdge>();

  for (const relation of relations) {
    if (!relation.relationTypes.some((type) => type !== "review_order")) continue;
    const left = nodeByRoomFileId.get(relation.fromRoomFileId);
    const right = nodeByRoomFileId.get(relation.toRoomFileId);
    if (!left || !right || left.id === right.id) continue;
    const [from, to] = compareLayoutNodes(left, right) <= 0
      ? [left, right]
      : [right, left];
    semanticPairs.set(`${from.id}\u0000${to.id}`, { from: from.id, to: to.id });
  }

  if (!semanticPairs.size) {
    return nodes.slice(1).map((node, index) => ({
      from: nodes[index].id,
      to: node.id
    }));
  }

  const edges = [...semanticPairs.values()];
  const incoming = new Set(edges.map((edge) => edge.to));
  const start = nodes[0].id;
  for (const node of nodes) {
    if (node.id === start || incoming.has(node.id)) continue;
    edges.push({ from: start, to: node.id });
  }
  return edges;
}
```

- [ ] **Step 4: focused GREEN과 기존 PR Review regression을 확인한다**

Run:

```powershell
Set-Location apps/frontend
node --experimental-strip-types scripts/pr-review/graph-exploration.test.mjs
node --experimental-strip-types scripts/pr-review/test.mjs
```

Expected: 두 명령 모두 exit code 0. Frontend 전체 test나 lint는 다시 실행하지 않는다.

- [ ] **Step 5: Frontend 변경을 커밋한다**

```powershell
git add apps/frontend/src/features/pr-review/components/review-canvas/pr-review-graph-exploration.ts apps/frontend/scripts/pr-review/graph-exploration.test.mjs
git commit -m "fix: PR Review 자동 정렬 관계 기반 배치 복원 (#772)"
```

### Task 3: 레이아웃 계약 문서 정합성과 PR 업데이트

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-pr-review-semantic-flow-layout-design.md`
- Modify: `docs/api/pr-review-api.md`
- Read: `docs/superpowers/specs/2026-07-19-pr-review-relation-driven-layout-amendment-design.md`

**Interfaces:**
- Documents: 최초 materialization과 명시적 자동 정렬의 relation-driven rank 정책
- Preserves: v1/v2 semantic graph, fallback, deployment 계약

- [ ] **Step 1: 기존 strict spine 설명을 보완 설계로 교체한다**

두 문서에 아래 규칙을 같은 의미로 반영한다.

```text
workflowOrder 1은 layout start다.
review_order edge는 rank에 사용하지 않는다.
semantic endpoint pair를 workflowOrder 순으로 정규화해 branch/depth를 만든다.
semantic root는 start anchor로 연결한다.
semantic relation이 없는 Flow만 review-order spine으로 fallback한다.
pin된 node와 기존 저장 geometry 보존 정책은 유지한다.
```

- [ ] **Step 2: 문서와 전체 diff whitespace를 검사한다**

Run:

```powershell
rg -n "workflowOrder.*유일한 spine|semantic relation.*rank 계산에 넣지|1→2→3 순서가 유지" docs/api/pr-review-api.md docs/superpowers/specs/2026-07-19-pr-review-semantic-flow-layout-design.md
git diff --check
```

Expected: 이전 strict spine 문구는 출력되지 않고 `git diff --check`는 exit code 0.

- [ ] **Step 3: 문서 변경을 커밋한다**

```powershell
git add docs/superpowers/specs/2026-07-19-pr-review-semantic-flow-layout-design.md docs/api/pr-review-api.md
git commit -m "docs: PR Review 관계 기반 레이아웃 계약 반영 (#772)"
```

- [ ] **Step 4: 최종 범위와 기존 PR을 갱신한다**

Run:

```powershell
git diff --check origin/dev...HEAD
git status --short
git push
```

Expected: tracked source는 clean이고 기존 PR #1521에 세 후속 커밋이 추가된다. `.superpowers/` 작업 보고 파일은 stage하지 않는다.
