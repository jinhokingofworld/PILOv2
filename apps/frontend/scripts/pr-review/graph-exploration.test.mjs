import assert from "node:assert/strict";

const {
  buildPrReviewGraphPresentation,
  createPrReviewFlowLayout,
  findMissingPrReviewOrderEdges
} = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-graph-exploration.ts"
);

const nodes = [
  {
    id: "node-a",
    flowId: "flow-1",
    roomFileId: "file-a",
    x: 120,
    y: 80,
    width: 272,
    height: 116,
    workflowOrder: 1,
    pinned: true,
    riskLevel: "high",
    reviewStatus: "not_reviewed"
  },
  {
    id: "node-b",
    flowId: "flow-1",
    roomFileId: "file-b",
    x: 120,
    y: 280,
    width: 272,
    height: 116,
    workflowOrder: 2,
    pinned: false,
    riskLevel: "medium",
    reviewStatus: "not_reviewed"
  },
  {
    id: "node-c",
    flowId: "flow-2",
    roomFileId: "file-c",
    x: 120,
    y: 480,
    width: 272,
    height: 116,
    workflowOrder: 1,
    pinned: false,
    riskLevel: "low",
    reviewStatus: "approved"
  }
];
const relations = [
  {
    id: "edge-ab",
    fromRoomFileId: "file-a",
    toRoomFileId: "file-b",
    relationTypes: ["review_order", "depends_on"]
  },
  {
    id: "edge-bc",
    fromRoomFileId: "file-b",
    toRoomFileId: "file-c",
    relationTypes: ["supports"]
  }
];

const relatedPresentation = buildPrReviewGraphPresentation(nodes, relations, {
  collapsedFlowIds: new Set(),
  focusedFlowId: null,
  mode: "related",
  relationTypes: new Set(),
  riskLevels: new Set(),
  reviewStatuses: new Set(),
  selectedRoomFileId: "file-a"
});

assert.equal(relatedPresentation.nodeOpacityById.get("node-a"), 1);
assert.equal(relatedPresentation.nodeOpacityById.get("node-b"), 1);
assert.equal(relatedPresentation.nodeOpacityById.get("node-c"), 0.14);
assert.equal(relatedPresentation.edgeOpacityById.get("edge-ab"), 1);
assert.equal(relatedPresentation.edgeOpacityById.get("edge-bc"), 0);

const layout = createPrReviewFlowLayout(nodes, relations, "flow-1");
assert.equal(layout.has("node-a"), false);
assert.ok(layout.get("node-b").x > nodes[0].x + nodes[0].width);

const workflowNode = (id, workflowOrder, pinned) => ({
  id,
  flowId: "flow-ordered",
  roomFileId: `file-${id}`,
  x: 120,
  y: 80,
  width: 272,
  height: 116,
  workflowOrder,
  pinned,
  riskLevel: "low",
  reviewStatus: "not_reviewed"
});

const orderedNodes = [
  workflowNode("one", 1, false),
  workflowNode("two", 2, false),
  workflowNode("three", 3, false)
];
const reversedAndCyclicRelations = [
  {
    id: "edge-three-one",
    fromRoomFileId: "file-three",
    toRoomFileId: "file-one",
    relationTypes: ["depends_on"]
  },
  {
    id: "edge-two-one",
    fromRoomFileId: "file-two",
    toRoomFileId: "file-one",
    relationTypes: ["supports"]
  },
  {
    id: "edge-one-three",
    fromRoomFileId: "file-one",
    toRoomFileId: "file-three",
    relationTypes: ["blocks"]
  }
];
const orderedLayout = createPrReviewFlowLayout(
  orderedNodes,
  reversedAndCyclicRelations,
  "flow-ordered"
);
assert.ok(orderedLayout.get("one").x < orderedLayout.get("two").x);
assert.ok(orderedLayout.get("two").x < orderedLayout.get("three").x);

const allPinnedLayout = createPrReviewFlowLayout(
  [workflowNode("pinned-one", 1, true), workflowNode("pinned-two", 2, true)],
  [],
  "flow-ordered"
);
assert.equal(allPinnedLayout.size, 0);

assert.deepEqual(
  findMissingPrReviewOrderEdges(
    [
      {
        id: "flow-1",
        files: [
          { reviewFileId: "file-a", workflowOrder: 1 },
          { reviewFileId: "file-b", workflowOrder: 2 },
          { reviewFileId: "file-c", workflowOrder: 3 }
        ]
      }
    ],
    [
      {
        flowId: "flow-1",
        fromReviewFileId: "file-a",
        toReviewFileId: "file-b",
        relationTypes: ["depends_on"]
      },
      {
        flowId: "flow-1",
        fromReviewFileId: "file-b",
        toReviewFileId: "file-c",
        relationTypes: ["review_order"]
      }
    ]
  ),
  [
    {
      flowId: "flow-1",
      fromReviewFileId: "file-a",
      toReviewFileId: "file-b"
    }
  ]
);

console.log("PR Review graph exploration tests passed");
