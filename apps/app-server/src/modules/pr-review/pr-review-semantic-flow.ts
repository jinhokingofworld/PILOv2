import type { PrReviewFileRoleType } from "./types";
import type {
  PrReviewFileRoleCandidate,
  PrReviewFlowCandidate,
  PrReviewRelationCandidate,
  PrReviewRelationCandidateV2
} from "./pr-review-semantic-graph";

const FLOW_TITLE_BY_ROLE: Record<PrReviewFileRoleType, string> = {
  api_contract: "API 계약 변경",
  entry: "진입 흐름 변경",
  ui_state: "UI와 상태 변경",
  core_logic: "핵심 로직 변경",
  verification: "검증 변경",
  support: "지원 파일 변경",
  unknown: "기타 변경"
};
const ROLE_PRIORITY: PrReviewFileRoleType[] = [
  "api_contract",
  "entry",
  "ui_state",
  "core_logic",
  "verification",
  "support",
  "unknown"
];

export function buildSemanticFlowCandidates(
  files: readonly PrReviewFileRoleCandidate[],
  relations: readonly PrReviewRelationCandidate[]
): PrReviewFlowCandidate[] {
  if (files.length === 0) {
    return [];
  }

  const filePaths = files.map((file) => file.filePath);
  const indexByPath = new Map(filePaths.map((filePath, index) => [filePath, index]));
  const parent = filePaths.map((_, index) => index);

  for (const relation of relations) {
    const fromIndex = indexByPath.get(relation.fromFilePath);
    const toIndex = indexByPath.get(relation.toFilePath);
    if (fromIndex !== undefined && toIndex !== undefined) {
      union(parent, fromIndex, toIndex);
    }
  }

  const membersByRoot = new Map<number, number[]>();
  for (let index = 0; index < filePaths.length; index += 1) {
    const root = find(parent, index);
    const members = membersByRoot.get(root) ?? [];
    members.push(index);
    membersByRoot.set(root, members);
  }

  const connectedGroups = [...membersByRoot.values()]
    .filter((members) => members.length > 1)
    .sort((left, right) => left[0] - right[0]);
  const isolatedIndexes = [...membersByRoot.values()]
    .filter((members) => members.length === 1)
    .map((members) => members[0])
    .sort((left, right) => left - right);

  const flows = connectedGroups.map((indexes, index) =>
    createFlowCandidate(
      `candidate-flow-${index + 1}`,
      indexes,
      false,
      files,
      relations
    )
  );

  if (isolatedIndexes.length > 0) {
    flows.push(
      createFlowCandidate(
        "candidate-flow-fallback",
        isolatedIndexes,
        true,
        files,
        relations
      )
    );
  }

  return flows;
}

export function buildSemanticFlowCandidatesV2(
  files: readonly PrReviewFileRoleCandidate[],
  relations: readonly PrReviewRelationCandidateV2[]
): PrReviewFlowCandidate[] {
  return buildSemanticFlowCandidates(
    files,
    relations.filter((relation) => relation.groupingBinding === "locked")
  );
}

function createFlowCandidate(
  key: string,
  indexes: readonly number[],
  fallback: boolean,
  files: readonly PrReviewFileRoleCandidate[],
  relations: readonly PrReviewRelationCandidate[]
): PrReviewFlowCandidate {
  const filePaths = indexes.map((index) => files[index].filePath);
  const includedPaths = new Set(filePaths);
  const roles = new Set(indexes.map((index) => files[index].roleType));
  const primaryRole = ROLE_PRIORITY.find((role) => roles.has(role)) ?? "unknown";

  return {
    key,
    title: fallback ? "기타 변경" : FLOW_TITLE_BY_ROLE[primaryRole],
    filePaths,
    relationKeys: relations
      .filter(
        (relation) =>
          includedPaths.has(relation.fromFilePath) &&
          includedPaths.has(relation.toFilePath)
      )
      .map((relation) => relation.key),
    fallback
  };
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) {
    parent[index] = find(parent, parent[index]);
  }
  return parent[index];
}

function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot === rightRoot) {
    return;
  }

  if (leftRoot < rightRoot) {
    parent[rightRoot] = leftRoot;
  } else {
    parent[leftRoot] = rightRoot;
  }
}
