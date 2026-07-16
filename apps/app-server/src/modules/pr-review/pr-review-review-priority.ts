import type {
  PrReviewFileRiskLevel,
  PrReviewFileRoleType
} from "./types";
import type {
  PrReviewValidatedGraphFlow,
  PrReviewValidatedGraphRelation,
  PrReviewValidatedSemanticGraph
} from "./pr-review-semantic-validator";

export interface PrReviewReviewPriorityInput {
  filePath: string;
  riskLevel: PrReviewFileRiskLevel;
}

const RISK_PRIORITY: Record<PrReviewFileRiskLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3
};

const ROLE_PRIORITY: Record<PrReviewFileRoleType, number> = {
  api_contract: 0,
  core_logic: 1,
  entry: 2,
  ui_state: 3,
  verification: 4,
  support: 5,
  unknown: 6
};

interface FilePriority {
  filePath: string;
  riskPriority: number;
  rolePriority: number;
  originalIndex: number;
}

/**
 * Keeps prerequisite relationships ahead of their consumers, then applies the
 * stable review priority configured for files that can be reviewed in parallel.
 */
export function prioritizePrReviewSemanticGraph(
  graph: PrReviewValidatedSemanticGraph,
  inputs: readonly PrReviewReviewPriorityInput[]
): PrReviewValidatedSemanticGraph {
  const priorityByPath = buildPriorityByPath(graph, inputs);
  const flows = graph.flows
    .map((flow, originalIndex) => ({
      flow: {
        ...flow,
        reviewOrder: prioritizeFlow(flow, graph.relations, priorityByPath)
      },
      originalIndex
    }))
    .sort((left, right) => {
      const leftFirst = priorityByPath.get(left.flow.reviewOrder[0]);
      const rightFirst = priorityByPath.get(right.flow.reviewOrder[0]);
      return comparePriorities(leftFirst, rightFirst) || left.originalIndex - right.originalIndex;
    })
    .map(({ flow }) => flow);

  return {
    ...graph,
    flows
  };
}

function buildPriorityByPath(
  graph: PrReviewValidatedSemanticGraph,
  inputs: readonly PrReviewReviewPriorityInput[]
): Map<string, FilePriority> {
  const inputByPath = new Map(
    inputs.map((input, originalIndex) => [input.filePath, { ...input, originalIndex }])
  );

  return new Map(
    graph.files.map((file, fallbackIndex) => {
      const input = inputByPath.get(file.filePath);
      return [
        file.filePath,
        {
          filePath: file.filePath,
          riskPriority: RISK_PRIORITY[input?.riskLevel ?? "unknown"],
          rolePriority: ROLE_PRIORITY[file.roleType],
          originalIndex: input?.originalIndex ?? inputs.length + fallbackIndex
        }
      ];
    })
  );
}

function prioritizeFlow(
  flow: PrReviewValidatedGraphFlow,
  relations: readonly PrReviewValidatedGraphRelation[],
  priorityByPath: ReadonlyMap<string, FilePriority>
): string[] {
  const remaining = new Set(flow.reviewOrder);
  const prerequisitesByPath = new Map(
    flow.reviewOrder.map((filePath) => [filePath, new Set<string>()])
  );

  for (const relation of relations) {
    if (relation.flowKey !== flow.candidateKey) {
      continue;
    }

    const [prerequisite, dependent] = resolvePrecedence(relation);
    if (!remaining.has(prerequisite) || !remaining.has(dependent)) {
      continue;
    }
    prerequisitesByPath.get(dependent)?.add(prerequisite);
  }

  const reviewOrder: string[] = [];
  while (remaining.size > 0) {
    const available = [...remaining].filter((filePath) =>
      [...(prerequisitesByPath.get(filePath) ?? [])].every(
        (prerequisite) => !remaining.has(prerequisite)
      )
    );
    const candidates = available.length > 0 ? available : [...remaining];
    const next = candidates.sort((left, right) =>
      comparePriorities(priorityByPath.get(left), priorityByPath.get(right))
    )[0];

    reviewOrder.push(next);
    remaining.delete(next);
  }

  return reviewOrder;
}

function resolvePrecedence(
  relation: PrReviewValidatedGraphRelation
): [string, string] {
  if (relation.relationType === "passes_data_to") {
    return [relation.fromFilePath, relation.toFilePath];
  }

  return [relation.toFilePath, relation.fromFilePath];
}

function comparePriorities(
  left: FilePriority | undefined,
  right: FilePriority | undefined
): number {
  const leftPriority = left ?? fallbackPriority("");
  const rightPriority = right ?? fallbackPriority("");

  return (
    leftPriority.riskPriority - rightPriority.riskPriority ||
    leftPriority.rolePriority - rightPriority.rolePriority ||
    leftPriority.originalIndex - rightPriority.originalIndex ||
    leftPriority.filePath.localeCompare(rightPriority.filePath)
  );
}

function fallbackPriority(filePath: string): FilePriority {
  return {
    filePath,
    riskPriority: RISK_PRIORITY.unknown,
    rolePriority: ROLE_PRIORITY.unknown,
    originalIndex: Number.MAX_SAFE_INTEGER
  };
}
