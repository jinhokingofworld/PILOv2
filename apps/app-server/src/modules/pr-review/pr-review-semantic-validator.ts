import type { PrReviewSemanticGraphHandoffPayload } from "./pr-review-semantic-contract";
import { PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION } from "./pr-review-semantic-contract";
import type {
  PrReviewFileRoleType,
  PrReviewRelationSource,
  PrReviewRelationType
} from "./types";

const MIN_RELATION_CONFIDENCE = 60;
const AI_RELATION_CONFIDENCE = 60;
const MAX_RELATIONS_PER_FLOW = 40;
const MAX_RELATIONS_TOTAL = 100;
const FILE_ROLES = new Set<PrReviewFileRoleType>([
  "entry",
  "core_logic",
  "api_contract",
  "ui_state",
  "verification",
  "support",
  "unknown"
]);
const RELATION_TYPES = new Set<PrReviewRelationType>([
  "depends_on",
  "tests",
  "uses_api",
  "passes_data_to",
  "supports"
]);

export interface PrReviewValidatedGraphFile {
  filePath: string;
  roleType: PrReviewFileRoleType;
  roleReason: string;
}

export interface PrReviewValidatedGraphFlow {
  candidateKey: string;
  title: string;
  description: string;
  reviewOrder: string[];
}

export interface PrReviewValidatedGraphRelation {
  flowKey: string;
  fromFilePath: string;
  toFilePath: string;
  relationType: PrReviewRelationType;
  source: PrReviewRelationSource;
  confidence: number;
  reason: string;
}

export interface PrReviewValidatedSemanticGraph {
  schemaVersion: typeof PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION;
  files: PrReviewValidatedGraphFile[];
  flows: PrReviewValidatedGraphFlow[];
  relations: PrReviewValidatedGraphRelation[];
  validationStatus: "validated_ai" | "deterministic_fallback";
  fallbackReason: "missing_ai_graph" | "invalid_ai_graph" | null;
}

export function resolvePrReviewSemanticGraph(
  analysisValue: unknown,
  candidates: PrReviewSemanticGraphHandoffPayload
): PrReviewValidatedSemanticGraph {
  if (!isRecord(analysisValue)) {
    return buildDeterministicFallback(candidates, "missing_ai_graph");
  }
  const hasVersion = analysisValue.graphSchemaVersion !== undefined;
  const hasGraph = analysisValue.semanticGraph !== undefined;
  if (!hasVersion && !hasGraph) {
    return buildDeterministicFallback(candidates, "missing_ai_graph");
  }
  if (!hasVersion || !hasGraph) {
    return buildDeterministicFallback(candidates, "invalid_ai_graph");
  }

  try {
    return validateAiGraph(analysisValue, candidates);
  } catch {
    return buildDeterministicFallback(candidates, "invalid_ai_graph");
  }
}

function validateAiGraph(
  analysis: Record<string, unknown>,
  candidates: PrReviewSemanticGraphHandoffPayload
): PrReviewValidatedSemanticGraph {
  if (analysis.graphSchemaVersion !== PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION) {
    throw new Error("Semantic graph version is invalid");
  }
  const graph = requireRecord(analysis.semanticGraph);
  const candidateFileByPath = new Map(
    candidates.files.map((file) => [file.filePath, file])
  );
  const candidateFlowByKey = new Map(
    candidates.flows.map((flow) => [flow.key, flow])
  );
  const candidateRelationByKey = new Map(
    candidates.relations.map((relation) => [relation.key, relation])
  );
  const flowKeyByFilePath = buildFlowKeyByFilePath(candidates);

  const files = requireArray(graph.files).map((value) => {
    const file = requireRecord(value);
    const filePath = requireText(file.filePath, 4000);
    const candidate = candidateFileByPath.get(filePath);
    const roleType = requireRoleType(file.roleType);
    if (
      !candidate ||
      (!candidate.roleOverrideAllowed && roleType !== candidate.roleType)
    ) {
      throw new Error("Semantic graph file is invalid");
    }
    return {
      filePath,
      roleType,
      roleReason: requireText(file.roleReason, 500)
    };
  });
  assertExactUniqueKeys(
    files.map((file) => file.filePath),
    candidateFileByPath.keys()
  );

  const flows = requireArray(graph.flows).map((value) => {
    const flow = requireRecord(value);
    const candidateKey = requireText(flow.candidateKey, 255);
    const candidate = candidateFlowByKey.get(candidateKey);
    if (!candidate) {
      throw new Error("Semantic graph flow is invalid");
    }
    const reviewOrder = requireTextArray(flow.reviewOrder, 4000);
    assertExactUniqueKeys(reviewOrder, candidate.filePaths);
    return {
      candidateKey,
      title: requireText(flow.title, 255),
      description: requireText(flow.description, 10000),
      reviewOrder
    };
  });
  assertExactUniqueKeys(
    flows.map((flow) => flow.candidateKey),
    candidateFlowByKey.keys()
  );

  const relationIdentities = new Set<string>();
  const relations = requireArray(graph.relations).map((value) => {
    const relation = requireRecord(value);
    const fromFilePath = requireText(relation.fromFilePath, 4000);
    const toFilePath = requireText(relation.toFilePath, 4000);
    const relationType = requireRelationType(relation.relationType);
    const flowKey = flowKeyByFilePath.get(fromFilePath);
    if (
      fromFilePath === toFilePath ||
      !candidateFileByPath.has(fromFilePath) ||
      !candidateFileByPath.has(toFilePath) ||
      !flowKey ||
      flowKeyByFilePath.get(toFilePath) !== flowKey
    ) {
      throw new Error("Semantic graph relation endpoint is invalid");
    }

    const identity = relationIdentity(
      flowKey,
      fromFilePath,
      toFilePath,
      relationType
    );
    if (relationIdentities.has(identity)) {
      throw new Error("Semantic graph relation is duplicated");
    }
    relationIdentities.add(identity);

    const candidateKey = relation.candidateKey;
    const candidate =
      candidateKey === null
        ? null
        : typeof candidateKey === "string"
          ? candidateRelationByKey.get(candidateKey)
          : undefined;
    if (candidate === undefined) {
      throw new Error("Semantic graph relation candidate is invalid");
    }
    if (
      candidate &&
      (candidate.fromFilePath !== fromFilePath ||
        candidate.toFilePath !== toFilePath ||
        candidate.relationType !== relationType)
    ) {
      throw new Error("Semantic graph relation candidate does not match");
    }

    return {
      flowKey,
      fromFilePath,
      toFilePath,
      relationType,
      source: candidate ? ("hybrid" as const) : ("ai" as const),
      confidence: candidate ? candidate.confidence : AI_RELATION_CONFIDENCE,
      reason: requireRelationReason(relation.reason)
    };
  });

  return {
    schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
    files,
    flows,
    relations: limitRelations(relations, candidates),
    validationStatus: "validated_ai",
    fallbackReason: null
  };
}

function buildDeterministicFallback(
  candidates: PrReviewSemanticGraphHandoffPayload,
  fallbackReason: "missing_ai_graph" | "invalid_ai_graph"
): PrReviewValidatedSemanticGraph {
  const flowKeyByFilePath = buildFlowKeyByFilePath(candidates);
  const relations = candidates.relations.flatMap((relation) => {
    const flowKey = flowKeyByFilePath.get(relation.fromFilePath);
    if (!flowKey || flowKeyByFilePath.get(relation.toFilePath) !== flowKey) {
      return [];
    }
    return [
      {
        flowKey,
        fromFilePath: relation.fromFilePath,
        toFilePath: relation.toFilePath,
        relationType: relation.relationType,
        source: "rule" as const,
        confidence: relation.confidence,
        reason: relation.evidence
      }
    ];
  });

  return {
    schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
    files: candidates.files.map((file) => ({
      filePath: file.filePath,
      roleType: file.roleType,
      roleReason: `규칙 기반 후보: ${file.evidence}`
    })),
    flows: candidates.flows.map((flow) => ({
      candidateKey: flow.key,
      title: flow.title,
      description: "규칙 기반 파일 관계로 생성한 리뷰 Flow입니다.",
      reviewOrder: [...flow.filePaths]
    })),
    relations: limitRelations(relations, candidates),
    validationStatus: "deterministic_fallback",
    fallbackReason
  };
}

function limitRelations(
  relations: readonly PrReviewValidatedGraphRelation[],
  candidates: PrReviewSemanticGraphHandoffPayload
): PrReviewValidatedGraphRelation[] {
  const flowFileCount = new Map(
    candidates.flows.map((flow) => [flow.key, flow.filePaths.length])
  );
  const flowOrder = new Map(
    candidates.flows.map((flow, index) => [flow.key, index])
  );
  const selectedPerFlow = new Map<string, number>();

  return relations
    .filter((relation) => relation.confidence >= MIN_RELATION_CONFIDENCE)
    .sort(compareRelationPriority)
    .filter((relation) => {
      const fileCount = flowFileCount.get(relation.flowKey) ?? 0;
      const flowLimit = Math.min(fileCount * 2, MAX_RELATIONS_PER_FLOW);
      const selected = selectedPerFlow.get(relation.flowKey) ?? 0;
      if (selected >= flowLimit) {
        return false;
      }
      selectedPerFlow.set(relation.flowKey, selected + 1);
      return true;
    })
    .slice(0, MAX_RELATIONS_TOTAL)
    .sort(
      (left, right) =>
        (flowOrder.get(left.flowKey) ?? Number.MAX_SAFE_INTEGER) -
          (flowOrder.get(right.flowKey) ?? Number.MAX_SAFE_INTEGER) ||
        compareRelationPriority(left, right)
    );
}

function compareRelationPriority(
  left: PrReviewValidatedGraphRelation,
  right: PrReviewValidatedGraphRelation
): number {
  return (
    relationSourcePriority(left.source) - relationSourcePriority(right.source) ||
    right.confidence - left.confidence ||
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    left.toFilePath.localeCompare(right.toFilePath) ||
    left.relationType.localeCompare(right.relationType)
  );
}

function relationSourcePriority(source: PrReviewRelationSource): number {
  if (source === "hybrid") return 0;
  if (source === "rule") return 1;
  return 2;
}

function buildFlowKeyByFilePath(
  candidates: PrReviewSemanticGraphHandoffPayload
): Map<string, string> {
  const result = new Map<string, string>();
  for (const flow of candidates.flows) {
    for (const filePath of flow.filePaths) {
      if (result.has(filePath)) {
        throw new Error("Semantic graph candidate file belongs to multiple flows");
      }
      result.set(filePath, flow.key);
    }
  }
  return result;
}

function assertExactUniqueKeys(
  actual: readonly string[],
  expectedValues: Iterable<string>
): void {
  const expected = new Set(expectedValues);
  if (
    actual.length !== expected.size ||
    new Set(actual).size !== actual.length ||
    actual.some((value) => !expected.has(value))
  ) {
    throw new Error("Semantic graph membership is invalid");
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Semantic graph value must be an object");
  return value;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Semantic graph value must be an array");
  return value;
}

function requireText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("Semantic graph text is invalid");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error("Semantic graph text is invalid");
  }
  return normalized;
}

function requireTextArray(value: unknown, maxItemLength: number): string[] {
  return requireArray(value).map((item) => requireText(item, maxItemLength));
}

function requireRoleType(value: unknown): PrReviewFileRoleType {
  if (typeof value !== "string" || !FILE_ROLES.has(value as PrReviewFileRoleType)) {
    throw new Error("Semantic graph role type is invalid");
  }
  return value as PrReviewFileRoleType;
}

function requireRelationType(value: unknown): PrReviewRelationType {
  if (
    typeof value !== "string" ||
    !RELATION_TYPES.has(value as PrReviewRelationType)
  ) {
    throw new Error("Semantic graph relation type is invalid");
  }
  return value as PrReviewRelationType;
}

function requireRelationReason(value: unknown): string {
  const reason = requireText(value, 500);
  if (Buffer.byteLength(reason, "utf8") > 500) {
    throw new Error("Semantic graph relation reason is too long");
  }
  return reason;
}

function relationIdentity(
  flowKey: string,
  fromFilePath: string,
  toFilePath: string,
  relationType: PrReviewRelationType
): string {
  return `${flowKey}:${fromFilePath}->${toFilePath}:${relationType}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
