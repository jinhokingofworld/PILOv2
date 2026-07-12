import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const service = new PrReviewService({}, {}, {}, {}, {});

function flowFile(flowId, reviewFileId, workflowOrder) {
  return {
    id: `${flowId}:${reviewFileId}`,
    reviewSessionId: "session-id",
    flowId,
    reviewFileId,
    workflowOrder,
    filePath: `${reviewFileId}.ts`,
    fileName: `${reviewFileId}.ts`,
    fileStatus: "modified",
    fileRole: null,
    roleType: "unknown",
    riskLevel: "unknown",
    currentStatus: "not_reviewed",
    fileNodeData: {
      reviewFileId,
      reviewSessionId: "session-id",
      reviewFlowFileId: `${flowId}:${reviewFileId}`,
      flowId,
      workflowOrder,
      fileName: `${reviewFileId}.ts`,
      filePath: `${reviewFileId}.ts`,
      roleSummary: null,
      roleType: "unknown",
      riskLevel: "unknown",
      reviewStatus: "not_reviewed"
    }
  };
}

function flow(id, reviewFileIds) {
  return {
    id,
    reviewSessionId: "session-id",
    title: id,
    description: null,
    sortOrder: 1,
    fileCount: reviewFileIds.length,
    files: reviewFileIds.map((reviewFileId, index) =>
      flowFile(id, reviewFileId, index + 1)
    )
  };
}

{
  const semanticEdge = {
    id: "relation-id",
    fromReviewFileId: "controller",
    toReviewFileId: "service",
    fromReviewFlowFileId: "semantic:controller",
    toReviewFlowFileId: "semantic:service",
    flowId: "semantic",
    relationType: "depends_on",
    reason: "Controller가 Service에 의존합니다.",
    source: "hybrid",
    confidence: 88
  };

  const edges = service.buildCanvasEdges(
    [flow("semantic", ["controller", "service"]), flow("legacy", ["a", "b"])],
    [semanticEdge]
  );

  assert.deepEqual(edges[0], semanticEdge);
  assert.equal(
    edges.some(
      (edge) =>
        edge.flowId === "semantic" && edge.relationType === "review_order"
    ),
    false
  );
  assert.deepEqual(edges[1], {
    id: "review-order:legacy:legacy:a:legacy:b",
    fromReviewFileId: "a",
    toReviewFileId: "b",
    fromReviewFlowFileId: "legacy:a",
    toReviewFlowFileId: "legacy:b",
    flowId: "legacy",
    relationType: "review_order",
    reason: "리뷰 순서",
    source: "fallback",
    confidence: 100
  });
}

{
  const edge = service.mapFlowRelation({
    id: "relation-id",
    session_id: "session-id",
    flow_id: "flow-id",
    from_review_flow_file_id: "from-membership-id",
    to_review_flow_file_id: "to-membership-id",
    from_review_file_id: "from-file-id",
    to_review_file_id: "to-file-id",
    relation_type: "tests",
    source: "rule",
    confidence: "91",
    reason: "테스트가 대상 로직을 검증합니다."
  });

  assert.equal(edge.confidence, 91);
  assert.equal(edge.relationType, "tests");
  assert.equal(edge.fromReviewFlowFileId, "from-membership-id");
  assert.equal(edge.toReviewFlowFileId, "to-membership-id");
}
