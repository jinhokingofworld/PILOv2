import type { SqlErdAgentSchemaProjection } from "./sql-erd-table-focus";

const MAX_PRIMARY_TABLES = 30;
const DIRECT_FOCUS_TERMS = new Set([
  "focus",
  "focused",
  "on",
  "only",
  "please",
  "show",
  "table",
  "table에",
  "tables",
  "view",
  "테이블",
  "테이블로",
  "테이블만",
  "테이블에",
  "테이블을",
  "보기",
  "보여줘",
  "보여주세요",
  "보고싶어",
  "보고싶어요",
  "집중",
  "집중보기",
  "집중적으로",
  "집중해서",
  "집중해줘",
  "집중해주세요",
  "표시해줘",
  "표시해주세요"
]);

export type SqlErdFocusResolution =
  | {
      kind: "focused";
      featureLabel: string;
      primaryTableRefs: string[];
      relatedTableRefs: string[];
      confidence: "high" | "medium" | "low";
      source: "deterministic" | "llm";
    }
  | {
      kind: "needs_clarification";
      reason:
        | "no_schema_match"
        | "ambiguous_schema_match"
        | "resolver_unavailable"
        | "invalid_resolver_result";
      question: string;
    };

export function resolveDeterministicSqlErdTableFocus(
  projection: SqlErdAgentSchemaProjection,
  featureQuery: string
): SqlErdFocusResolution | null {
  const exactNameRefs = resolveExactTableNameRefs(projection, featureQuery);
  if (exactNameRefs.length === 1) {
    return buildFocusedResolution(
      projection,
      featureQuery,
      exactNameRefs,
      "high",
      "deterministic"
    );
  }
  return null;
}

export function validateLlmSqlErdTableFocus(
  projection: SqlErdAgentSchemaProjection,
  featureQuery: string,
  value: unknown
): SqlErdFocusResolution {
  if (!isRecord(value)) {
    return invalidResult();
  }
  if (value.status === "needs_clarification") {
    return {
      kind: "needs_clarification",
      reason: "ambiguous_schema_match",
      question: boundedQuestion(value.question)
    };
  }
  if (
    value.status !== "focused" ||
    !Array.isArray(value.primaryTableRefs) ||
    !["high", "medium", "low"].includes(String(value.confidence))
  ) {
    return invalidResult();
  }

  if (
    value.primaryTableRefs.length === 0 ||
    value.primaryTableRefs.length > MAX_PRIMARY_TABLES ||
    value.primaryTableRefs.some((ref) => typeof ref !== "string")
  ) {
    return invalidResult();
  }

  const knownRefs = new Set(projection.tables.map((table) => table.ref));
  const primaryTableRefs = value.primaryTableRefs as string[];
  if (
    new Set(primaryTableRefs).size !== primaryTableRefs.length ||
    primaryTableRefs.some((ref) => !knownRefs.has(ref))
  ) {
    return invalidResult();
  }

  return buildFocusedResolution(
    projection,
    typeof value.featureLabel === "string" && value.featureLabel.trim()
      ? value.featureLabel
      : featureQuery,
    primaryTableRefs,
    value.confidence as "high" | "medium" | "low",
    "llm"
  );
}

function buildFocusedResolution(
  projection: SqlErdAgentSchemaProjection,
  featureLabel: string,
  primaryTableRefs: string[],
  confidence: "high" | "medium" | "low",
  source: "deterministic" | "llm"
): SqlErdFocusResolution {
  const primarySet = new Set(primaryTableRefs);
  const relatedTableRefs: string[] = [];
  for (const [fromRef, toRef] of projection.edges) {
    if (primarySet.has(fromRef) && !primarySet.has(toRef)) {
      relatedTableRefs.push(toRef);
    } else if (primarySet.has(toRef) && !primarySet.has(fromRef)) {
      relatedTableRefs.push(fromRef);
    }
  }
  return {
    kind: "focused",
    featureLabel: [...featureLabel.trim()].slice(0, 100).join(""),
    primaryTableRefs,
    relatedTableRefs: [...new Set(relatedTableRefs)].slice(0, 30),
    confidence,
    source
  };
}

function resolveExactTableNameRefs(
  projection: SqlErdAgentSchemaProjection,
  featureQuery: string
): string[] {
  const queryTerms = exactTokens(featureQuery);
  const truncatedTableRefs = new Set(projection.truncatedTableRefs ?? []);
  const qualifiedMatches = projection.tables
    .filter((table) => !truncatedTableRefs.has(table.ref))
    .flatMap((table) => {
      if (!table.schemaName) return [];
      const nameTerms = exactTokens(`${table.schemaName}.${table.name}`);
      const ranges = findPhraseRanges(queryTerms, nameTerms);
      return ranges.length > 0 ? [{ ref: table.ref, nameTerms, ranges }] : [];
    });
  const qualified = selectSingleStrictPositiveMatch(
    queryTerms,
    qualifiedMatches
  );
  if (qualified) return [qualified];
  if (qualifiedMatches.length > 0) return [];

  const unqualifiedMatches = projection.tables
    .filter((table) => !truncatedTableRefs.has(table.ref))
    .map((table) => {
      const nameTerms = exactTokens(table.name);
      return {
        ref: table.ref,
        nameTerms,
        ranges: findPhraseRanges(queryTerms, nameTerms)
      };
    })
    .filter((candidate) => candidate.ranges.length > 0);
  const mostSpecificMatches = unqualifiedMatches
    .filter((candidate) =>
      candidate.ranges.some(
        ([start, end]) =>
          !unqualifiedMatches.some(
            (other) =>
              other.ref !== candidate.ref &&
              other.nameTerms.length > candidate.nameTerms.length &&
              other.ranges.some(
                ([otherStart, otherEnd]) =>
                  otherStart <= start && otherEnd >= end
              )
          )
      )
    );
  const unqualified = selectSingleStrictPositiveMatch(
    queryTerms,
    mostSpecificMatches
  );
  return unqualified ? [unqualified] : [];
}

function selectSingleStrictPositiveMatch(
  queryTerms: string[],
  matches: Array<{
    ref: string;
    nameTerms: string[];
    ranges: Array<[number, number]>;
  }>
): string | null {
  if (matches.length !== 1) return null;
  const match = matches[0];
  const directRange = match.ranges.find((range) =>
    isStrictPositiveDirectRequest(queryTerms, range)
  );
  return directRange ? match.ref : null;
}

function isStrictPositiveDirectRequest(
  queryTerms: string[],
  [start, end]: [number, number]
): boolean {
  return queryTerms.every(
    (term, index) =>
      (index >= start && index < end) || DIRECT_FOCUS_TERMS.has(term)
  );
}

function findPhraseRanges(
  queryTerms: string[],
  nameTerms: string[]
): Array<[number, number]> {
  if (nameTerms.length === 0 || nameTerms.length > queryTerms.length) return [];
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start <= queryTerms.length - nameTerms.length; start += 1) {
    const matches = nameTerms.every((term, offset) => {
      const queryTerm = queryTerms[start + offset];
      return (
        queryTerm === term ||
        (offset === nameTerms.length - 1 &&
          stripKoreanParticle(queryTerm) === term)
      );
    });
    if (matches) ranges.push([start, start + nameTerms.length]);
  }
  return ranges;
}

function exactTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((term) => term.length >= 2);
}

function stripKoreanParticle(value: string): string {
  return value.replace(/(이랑|랑|와|과)$/u, "");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function invalidResult(): SqlErdFocusResolution {
  return {
    kind: "needs_clarification",
    reason: "invalid_resolver_result",
    question:
      "집중해서 볼 테이블을 안전하게 확정하지 못했습니다. 테이블 이름이나 기능 범위를 더 구체적으로 알려주세요."
  };
}

function boundedQuestion(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "관련 테이블 후보가 여러 개입니다. 테이블 이름이나 기능 범위를 더 구체적으로 알려주세요.";
  }
  return [...value.trim()].slice(0, 240).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
