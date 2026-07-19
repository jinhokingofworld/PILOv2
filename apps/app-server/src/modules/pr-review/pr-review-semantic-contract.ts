import {
  buildDeterministicSemanticGraphCandidates,
  buildDeterministicSemanticGraphCandidatesV2,
  type PrReviewFileRoleCandidate,
  type PrReviewFlowCandidate,
  type PrReviewRelationCandidate,
  type PrReviewRelationCandidateV2,
  type PrReviewSemanticGraphFileInput
} from "./pr-review-semantic-graph";
import type { PrReviewFileRoleType } from "./types";

export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1 =
  "pr-review-semantic-graph:v1" as const;
export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2 =
  "pr-review-semantic-graph:v2" as const;
export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION =
  PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1;
export const PR_REVIEW_ROLE_OVERRIDE_CONFIDENCE_THRESHOLD = 85;

export interface PrReviewSemanticGraphFileHandoff {
  filePath: string;
  roleType: PrReviewFileRoleType;
  confidence: number;
  evidence: string;
  roleOverrideAllowed: boolean;
}

export interface PrReviewSemanticGraphHandoffPayload {
  files: PrReviewSemanticGraphFileHandoff[];
  relations: PrReviewRelationCandidate[];
  flows: PrReviewFlowCandidate[];
}

export interface PrReviewSemanticGraphHandoffPayloadV2 {
  files: PrReviewSemanticGraphFileHandoff[];
  relations: PrReviewRelationCandidateV2[];
  flows: PrReviewFlowCandidate[];
}

export function buildPrReviewSemanticGraphHandoffV1(
  files: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphHandoffPayload {
  const candidates = buildDeterministicSemanticGraphCandidates(files);

  return addRolePolicy(candidates);
}

export function buildPrReviewSemanticGraphHandoffV2(
  files: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphHandoffPayloadV2 {
  const candidates = buildDeterministicSemanticGraphCandidatesV2(files);

  return addRolePolicy(candidates);
}

function addRolePolicy<TRelation extends PrReviewRelationCandidate>(candidates: {
  files: PrReviewFileRoleCandidate[];
  relations: TRelation[];
  flows: PrReviewFlowCandidate[];
}): {
  files: PrReviewSemanticGraphFileHandoff[];
  relations: TRelation[];
  flows: PrReviewFlowCandidate[];
} {
  return {
    files: candidates.files.map((file) => ({
      ...file,
      roleOverrideAllowed:
        file.roleType === "unknown" ||
        file.confidence < PR_REVIEW_ROLE_OVERRIDE_CONFIDENCE_THRESHOLD
    })),
    relations: candidates.relations,
    flows: candidates.flows
  };
}
