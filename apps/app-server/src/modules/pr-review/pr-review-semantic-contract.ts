import {
  buildDeterministicSemanticGraphCandidates,
  type PrReviewFlowCandidate,
  type PrReviewRelationCandidate,
  type PrReviewSemanticGraphFileInput
} from "./pr-review-semantic-graph";
import type { PrReviewFileRoleType } from "./types";

export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION =
  "pr-review-semantic-graph:v1" as const;
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

export function buildPrReviewSemanticGraphHandoff(
  files: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphHandoffPayload {
  const candidates = buildDeterministicSemanticGraphCandidates(files);

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
