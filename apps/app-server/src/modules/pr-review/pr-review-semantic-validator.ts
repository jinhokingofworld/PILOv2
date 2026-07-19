import { createHash } from "node:crypto";
import {
  PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1,
  PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
  type PrReviewSemanticGraphHandoffPayload,
  type PrReviewSemanticGraphHandoffPayloadV2
} from "./pr-review-semantic-contract";
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
  schemaVersion:
    | typeof PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1
    | typeof PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2;
  files: PrReviewValidatedGraphFile[];
  flows: PrReviewValidatedGraphFlow[];
  relations: PrReviewValidatedGraphRelation[];
  validationStatus:
    | "validated_ai"
    | "validated_ai_relation_fallback"
    | "deterministic_fallback";
  fallbackReason:
    | "missing_ai_graph"
    | "invalid_ai_graph"
    | "invalid_ai_relations"
    | null;
}

export function resolvePrReviewSemanticGraph(
  analysisValue: unknown,
  candidates:
    | PrReviewSemanticGraphHandoffPayload
    | PrReviewSemanticGraphHandoffPayloadV2
): PrReviewValidatedSemanticGraph {
  if (!isRecord(analysisValue)) {
    return buildDeterministicFallbackV1(
      candidates as PrReviewSemanticGraphHandoffPayload,
      "missing_ai_graph"
    );
  }
  const hasVersion = analysisValue.graphSchemaVersion !== undefined;
  const hasGraph = analysisValue.semanticGraph !== undefined;
  if (!hasVersion && !hasGraph) {
    return buildDeterministicFallbackV1(
      candidates as PrReviewSemanticGraphHandoffPayload,
      "missing_ai_graph"
    );
  }
  if (!hasVersion || !hasGraph) {
    if (analysisValue.graphSchemaVersion === PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2) {
      return buildDeterministicFallbackV2(
        candidates as PrReviewSemanticGraphHandoffPayloadV2,
        "invalid_ai_graph"
      );
    }
    return buildDeterministicFallbackV1(
      candidates as PrReviewSemanticGraphHandoffPayload,
      "invalid_ai_graph"
    );
  }

  if (analysisValue.graphSchemaVersion === PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2) {
    try {
      return validateAiGraphV2(
        analysisValue,
        candidates as PrReviewSemanticGraphHandoffPayloadV2
      );
    } catch {
      return buildDeterministicFallbackV2(
        candidates as PrReviewSemanticGraphHandoffPayloadV2,
        "invalid_ai_graph"
      );
    }
  }

  try {
    return validateAiGraphV1(
      analysisValue,
      candidates as PrReviewSemanticGraphHandoffPayload
    );
  } catch {
    return buildDeterministicFallbackV1(
      candidates as PrReviewSemanticGraphHandoffPayload,
      "invalid_ai_graph"
    );
  }
}

function validateAiGraphV1(
  analysis: Record<string, unknown>,
  candidates: PrReviewSemanticGraphHandoffPayload
): PrReviewValidatedSemanticGraph {
  if (analysis.graphSchemaVersion !== PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1) {
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
  const files = validateFiles(requireArray(graph.files), candidateFileByPath);

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

  const relations = validateRelations(
    requireArray(graph.relations),
    candidateFileByPath,
    candidateRelationByKey,
    flowKeyByFilePath
  );

  return {
    schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1,
    files,
    flows,
    relations: limitRelations(relations, flows),
    validationStatus: "validated_ai",
    fallbackReason: null
  };
}

function validateAiGraphV2(
  analysis: Record<string, unknown>,
  candidates: PrReviewSemanticGraphHandoffPayloadV2
): PrReviewValidatedSemanticGraph {
  const graph = requireRecord(analysis.semanticGraph);
  const candidateFileByPath = new Map(
    candidates.files.map((file) => [file.filePath, file])
  );
  const files = validateFiles(requireArray(graph.files), candidateFileByPath);
  const flows = validateAndKeyV2Flows(
    requireArray(graph.flows),
    candidates.files.map((file) => file.filePath),
    buildLockedComponents(candidates)
  );

  try {
    const relations = mergeLockedRelations(
      validateV2Relations(requireArray(graph.relations), candidates, flows),
      candidates,
      flows
    );
    return {
      schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
      files,
      flows,
      relations: limitRelations(relations, flows),
      validationStatus: "validated_ai",
      fallbackReason: null
    };
  } catch {
    const relations = buildDeterministicRelationsForAcceptedFlows(candidates, flows);
    return {
      schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
      files,
      flows,
      relations: limitRelations(relations, flows),
      validationStatus: "validated_ai_relation_fallback",
      fallbackReason: "invalid_ai_relations"
    };
  }
}

function validateFiles(
  rawFiles: unknown[],
  candidateFileByPath: Map<
    string,
    {
      filePath: string;
      roleType: PrReviewFileRoleType;
      roleOverrideAllowed: boolean;
    }
  >
): PrReviewValidatedGraphFile[] {
  const files = rawFiles.map((value) => {
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
  return files;
}

function validateAndKeyV2Flows(
  rawFlows: unknown[],
  filePaths: readonly string[],
  lockedComponents: readonly string[][]
): PrReviewValidatedGraphFlow[] {
  if (filePaths.length === 0) {
    if (rawFlows.length !== 0) {
      throw new Error("Semantic graph flow is invalid");
    }
    return [];
  }
  if (rawFlows.length < 1 || rawFlows.length > Math.min(8, filePaths.length)) {
    throw new Error("Semantic graph flow count is invalid");
  }

  const expectedPaths = new Set(filePaths);
  const flowKeyByFilePath = new Map<string, string>();
  const flows = rawFlows.map((value) => {
    const flow = requireRecord(value);
    const reviewOrder = requireTextArray(flow.reviewOrder, 4000);
    if (reviewOrder.length === 0) {
      throw new Error("Semantic graph flow is empty");
    }
    const candidateKey = membershipFlowKey(reviewOrder);
    for (const filePath of reviewOrder) {
      if (!expectedPaths.has(filePath) || flowKeyByFilePath.has(filePath)) {
        throw new Error("Semantic graph flow membership is invalid");
      }
      flowKeyByFilePath.set(filePath, candidateKey);
    }
    return {
      candidateKey,
      title: requireText(flow.title, 255),
      description: requireText(flow.description, 10000),
      reviewOrder
    };
  });

  assertExactUniqueKeys([...flowKeyByFilePath.keys()], expectedPaths);
  for (const component of lockedComponents) {
    const flowKey = flowKeyByFilePath.get(component[0]);
    if (!flowKey || component.some((filePath) => flowKeyByFilePath.get(filePath) !== flowKey)) {
      throw new Error("Semantic graph locked component is split");
    }
  }
  return flows;
}

function validateV2Relations(
  rawRelations: unknown[],
  candidates: PrReviewSemanticGraphHandoffPayloadV2,
  flows: readonly PrReviewValidatedGraphFlow[]
): PrReviewValidatedGraphRelation[] {
  const candidateFileByPath = new Map(
    candidates.files.map((file) => [file.filePath, file])
  );
  const candidateRelationByKey = new Map(
    candidates.relations.map((relation) => [relation.key, relation])
  );
  return validateRelations(
    rawRelations,
    candidateFileByPath,
    candidateRelationByKey,
    buildFlowKeyByFilePathFromFlows(flows)
  );
}

function validateRelations(
  rawRelations: unknown[],
  candidateFileByPath: Map<string, unknown>,
  candidateRelationByKey: Map<
    string,
    {
      fromFilePath: string;
      toFilePath: string;
      relationType: PrReviewRelationType;
      confidence: number;
    }
  >,
  flowKeyByFilePath: Map<string, string>
): PrReviewValidatedGraphRelation[] {
  const relationIdentities = new Set<string>();
  const candidateRelationIdentities = new Set(
    [...candidateRelationByKey.values()].map((candidate) =>
      relationCandidateIdentity(
        candidate.fromFilePath,
        candidate.toFilePath,
        candidate.relationType
      )
    )
  );
  return rawRelations.map((value) => {
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
      candidateKey === null &&
      candidateRelationIdentities.has(
        relationCandidateIdentity(fromFilePath, toFilePath, relationType)
      )
    ) {
      throw new Error("Semantic graph new relation overlaps a candidate");
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
}

function buildLockedComponents(
  candidates: PrReviewSemanticGraphHandoffPayloadV2
): string[][] {
  const filePaths = candidates.files.map((file) => file.filePath);
  const indexByFilePath = new Map(filePaths.map((filePath, index) => [filePath, index]));
  const parent = filePaths.map((_, index) => index);
  for (const relation of candidates.relations) {
    if (relation.groupingBinding !== "locked") continue;
    const from = indexByFilePath.get(relation.fromFilePath);
    const to = indexByFilePath.get(relation.toFilePath);
    if (from !== undefined && to !== undefined) {
      union(parent, from, to);
    }
  }
  const membersByRoot = new Map<number, string[]>();
  for (const [index, filePath] of filePaths.entries()) {
    const root = find(parent, index);
    const members = membersByRoot.get(root) ?? [];
    members.push(filePath);
    membersByRoot.set(root, members);
  }
  return [...membersByRoot.values()].filter((members) => members.length > 1);
}

function mergeLockedRelations(
  relations: readonly PrReviewValidatedGraphRelation[],
  candidates: PrReviewSemanticGraphHandoffPayloadV2,
  flows: readonly PrReviewValidatedGraphFlow[]
): PrReviewValidatedGraphRelation[] {
  const merged = [...relations];
  const flowKeyByFilePath = buildFlowKeyByFilePathFromFlows(flows);
  const identities = new Set(
    merged.map((relation) =>
      relationIdentity(
        relation.flowKey,
        relation.fromFilePath,
        relation.toFilePath,
        relation.relationType
      )
    )
  );
  for (const relation of candidates.relations) {
    if (relation.groupingBinding !== "locked") continue;
    const flowKey = flowKeyByFilePath.get(relation.fromFilePath);
    if (!flowKey || flowKeyByFilePath.get(relation.toFilePath) !== flowKey) continue;
    const identity = relationIdentity(
      flowKey,
      relation.fromFilePath,
      relation.toFilePath,
      relation.relationType
    );
    if (identities.has(identity)) continue;
    identities.add(identity);
    merged.push({
      flowKey,
      fromFilePath: relation.fromFilePath,
      toFilePath: relation.toFilePath,
      relationType: relation.relationType,
      source: "rule",
      confidence: relation.confidence,
      reason: relation.evidence
    });
  }
  return merged;
}

function buildDeterministicFallbackV1(
  candidates: PrReviewSemanticGraphHandoffPayload,
  fallbackReason: "missing_ai_graph" | "invalid_ai_graph"
): PrReviewValidatedSemanticGraph {
  const flows = candidates.flows.map((flow) => ({
    candidateKey: flow.key,
    title: flow.title,
    description: "규칙 기반 파일 관계로 생성한 리뷰 Flow입니다.",
    reviewOrder: [...flow.filePaths]
  }));
  return {
    schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1,
    files: fallbackFiles(candidates),
    flows,
    relations: limitRelations(
      buildDeterministicRelationsForAcceptedFlows(candidates, flows),
      flows
    ),
    validationStatus: "deterministic_fallback",
    fallbackReason
  };
}

function buildDeterministicFallbackV2(
  candidates: PrReviewSemanticGraphHandoffPayloadV2,
  fallbackReason: "invalid_ai_graph"
): PrReviewValidatedSemanticGraph {
  const flows = candidates.flows.map((flow) => ({
    candidateKey: flow.key,
    title: flow.title,
    description: "규칙 기반 파일 관계로 생성한 리뷰 Flow입니다.",
    reviewOrder: [...flow.filePaths]
  }));
  return {
    schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
    files: fallbackFiles(candidates),
    flows,
    relations: limitRelations(
      buildDeterministicRelationsForAcceptedFlows(candidates, flows),
      flows
    ),
    validationStatus: "deterministic_fallback",
    fallbackReason
  };
}

function fallbackFiles(
  candidates: PrReviewSemanticGraphHandoffPayload | PrReviewSemanticGraphHandoffPayloadV2
): PrReviewValidatedGraphFile[] {
  return candidates.files.map((file) => ({
    filePath: file.filePath,
    roleType: file.roleType,
    roleReason: `규칙 기반 후보: ${file.evidence}`
  }));
}

function buildDeterministicRelationsForAcceptedFlows(
  candidates: PrReviewSemanticGraphHandoffPayload | PrReviewSemanticGraphHandoffPayloadV2,
  flows: readonly PrReviewValidatedGraphFlow[]
): PrReviewValidatedGraphRelation[] {
  const flowKeyByFilePath = buildFlowKeyByFilePathFromFlows(flows);
  return candidates.relations.flatMap((relation) => {
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
}

function limitRelations(
  relations: readonly PrReviewValidatedGraphRelation[],
  flows: readonly PrReviewValidatedGraphFlow[]
): PrReviewValidatedGraphRelation[] {
  const flowFileCount = new Map(
    flows.map((flow) => [flow.candidateKey, flow.reviewOrder.length])
  );
  const flowOrder = new Map(
    flows.map((flow, index) => [flow.candidateKey, index])
  );
  const selectedPerFlow = new Map<string, number>();
  return relations
    .filter((relation) => relation.confidence >= MIN_RELATION_CONFIDENCE)
    .sort(compareRelationPriority)
    .filter((relation) => {
      const fileCount = flowFileCount.get(relation.flowKey) ?? 0;
      const flowLimit = Math.min(fileCount * 2, MAX_RELATIONS_PER_FLOW);
      const selected = selectedPerFlow.get(relation.flowKey) ?? 0;
      if (selected >= flowLimit) return false;
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

function membershipFlowKey(filePaths: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...filePaths].sort().join("\u0000"), "utf8")
    .digest("hex");
  return `ai-flow:${digest}`;
}

function buildFlowKeyByFilePath(
  candidates: PrReviewSemanticGraphHandoffPayload
): Map<string, string> {
  return buildFlowKeyByFilePathFromFlows(
    candidates.flows.map((flow) => ({
      candidateKey: flow.key,
      title: flow.title,
      description: "",
      reviewOrder: flow.filePaths
    }))
  );
}

function buildFlowKeyByFilePathFromFlows(
  flows: readonly PrReviewValidatedGraphFlow[]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const flow of flows) {
    for (const filePath of flow.reviewOrder) {
      if (result.has(filePath)) {
        throw new Error("Semantic graph candidate file belongs to multiple flows");
      }
      result.set(filePath, flow.candidateKey);
    }
  }
  return result;
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

function relationCandidateIdentity(
  fromFilePath: string,
  toFilePath: string,
  relationType: PrReviewRelationType
): string {
  return JSON.stringify([fromFilePath, toFilePath, relationType]);
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) parent[index] = find(parent, parent[index]);
  return parent[index];
}

function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot === rightRoot) return;
  if (leftRoot < rightRoot) parent[rightRoot] = leftRoot;
  else parent[leftRoot] = rightRoot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
