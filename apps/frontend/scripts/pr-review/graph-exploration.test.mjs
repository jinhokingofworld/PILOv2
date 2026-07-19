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
  workflowNode("three", 3, false),
  workflowNode("four", 4, false),
  workflowNode("five", 5, false)
];
const reversedAndCyclicRelations = [
  {
    id: "order-one-two",
    fromRoomFileId: "file-one",
    toRoomFileId: "file-two",
    relationTypes: ["review_order"]
  },
  {
    id: "order-two-three",
    fromRoomFileId: "file-two",
    toRoomFileId: "file-three",
    relationTypes: ["review_order"]
  },
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
    id: "edge-two-four",
    fromRoomFileId: "file-two",
    toRoomFileId: "file-four",
    relationTypes: ["imports"]
  },
  {
    id: "edge-three-five",
    fromRoomFileId: "file-three",
    toRoomFileId: "file-five",
    relationTypes: ["blocks"]
  }
];
const orderedLayout = createPrReviewFlowLayout(
  orderedNodes,
  reversedAndCyclicRelations,
  "flow-ordered"
);
assert.ok(orderedLayout.get("one").x < orderedLayout.get("two").x);
assert.ok(orderedLayout.get("one").x < orderedLayout.get("three").x);
assert.equal(orderedLayout.get("two").x, orderedLayout.get("three").x);
assert.notEqual(orderedLayout.get("two").y, orderedLayout.get("three").y);
assert.equal(orderedLayout.get("four").x, orderedLayout.get("five").x);
assert.ok(orderedLayout.get("two").x < orderedLayout.get("four").x);

const reviewOrderFallbackLayout = createPrReviewFlowLayout(
  orderedNodes.slice(0, 3),
  reversedAndCyclicRelations.filter((relation) =>
    relation.relationTypes.includes("review_order")
  ),
  "flow-ordered"
);
assert.ok(
  reviewOrderFallbackLayout.get("one").x <
    reviewOrderFallbackLayout.get("two").x
);
assert.ok(
  reviewOrderFallbackLayout.get("two").x <
    reviewOrderFallbackLayout.get("three").x
);

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
