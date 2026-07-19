import type {
  AgentRun,
  AgentRunInputSelection
} from "@/features/agent/types";
import type { SqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";

export type AgentResourceLink = {
  focus?: SqlErdAgentTableFocus;
  href: string;
  key: string;
  label: string;
};

type AgentSqlErdRequestContext = {
  surface: string;
  sessionId: string;
};

export type SqlErdSessionCandidate = {
  selectionToken: string;
  title: string;
  updatedAt: string;
  tableCount: number;
  relationCount: number;
};

export type StoredAgentCandidateSelection = {
  candidateSelectionId: string;
  resourceType: string;
  label: string;
  description: string | null;
  status: string | null;
};

export type AgentCandidateSelection = {
  description: string | null;
  key: string;
  label: string;
  selection: AgentRunInputSelection;
  status: string | null;
};

const SQL_ERD_SESSION_PATH = "/sql-erd/session";
const CANVAS_PATH = "/canvas";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGENT_CANDIDATES = 5;
type CandidateToolStep = AgentRun["steps"][number] & {
  outputSummary: Record<string, unknown>;
};

export function getAgentCandidateSelections(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): AgentCandidateSelection[] {
  const latestCompletedToolStep = getLatestCandidateToolStep(run);
  if (!latestCompletedToolStep) return [];

  const output = latestCompletedToolStep.outputSummary;
  if (Array.isArray(output.candidateSelections)) {
    return getStoredAgentCandidateSelections(run).map((candidate) => ({
      key: `candidate:${candidate.candidateSelectionId}`,
      label: candidate.label,
      description: candidate.description,
      status: candidate.status,
      selection: {
        kind: "candidate",
        candidateSelectionId: candidate.candidateSelectionId
      }
    }));
  }
  if (Array.isArray(output.candidates)) {
    return getSqlErdSessionCandidates(run).map((candidate) => ({
      key: `sql-erd:${candidate.selectionToken}`,
      label: candidate.title,
      description: formatSqlErdCandidateDescription(candidate),
      status: null,
      selection: {
        kind: "sql_erd_session",
        token: candidate.selectionToken
      }
    }));
  }
  return [];
}

export function getStoredAgentCandidateSelections(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): StoredAgentCandidateSelection[] {
  if (run?.status !== "waiting_user_input") return [];
  const latestCompletedToolStep = getLatestCandidateToolStep(run);
  if (
    latestCompletedToolStep?.outputSummary?.status !== "needs_clarification" ||
    !Array.isArray(latestCompletedToolStep.outputSummary.candidateSelections)
  ) {
    return [];
  }
  const rawCandidates = latestCompletedToolStep.outputSummary.candidateSelections;
  if (rawCandidates.length === 0 || rawCandidates.length > MAX_AGENT_CANDIDATES) {
    return [];
  }
  const seenIds = new Set<string>();
  const candidates = rawCandidates.map((candidate) => {
    if (!isPlainObject(candidate)) return null;
    const candidateSelectionId = candidate.candidateSelectionId;
    const resourceType = candidate.resourceType;
    const label = normalizeCandidateTitle(candidate.label);
    const description = normalizeOptionalCandidateText(candidate.description, 1000);
    const status = normalizeOptionalCandidateText(candidate.status, 100);
    if (
      typeof candidateSelectionId !== "string" ||
      !UUID_PATTERN.test(candidateSelectionId) ||
      seenIds.has(candidateSelectionId) ||
      !label ||
      typeof resourceType !== "string" ||
      !/^[a-z][a-z0-9_]{0,99}$/.test(resourceType)
    ) {
      return null;
    }
    seenIds.add(candidateSelectionId);
    return {
      candidateSelectionId,
      resourceType,
      label,
      description,
      status
    };
  });
  return candidates.some((candidate) => candidate === null)
    ? []
    : (candidates as StoredAgentCandidateSelection[]);
}

export function getSqlErdSessionCandidates(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): SqlErdSessionCandidate[] {
  if (run?.status !== "waiting_user_input") return [];
  const latestCompletedToolStep = getLatestCandidateToolStep(run);
  if (
    latestCompletedToolStep?.toolName !== "inspect_sql_erd_schema" ||
    latestCompletedToolStep.outputSummary?.status !== "needs_clarification"
  ) {
    return [];
  }
  const rawCandidates = latestCompletedToolStep.outputSummary.candidates;
  if (
    !Array.isArray(rawCandidates) ||
    rawCandidates.length === 0 ||
    rawCandidates.length > MAX_AGENT_CANDIDATES
  ) {
    return [];
  }
  const tokenCounts = new Map<string, number>();
  for (const candidate of rawCandidates) {
    if (
      isPlainObject(candidate) &&
      typeof candidate.selectionToken === "string" &&
      UUID_PATTERN.test(candidate.selectionToken)
    ) {
      tokenCounts.set(
        candidate.selectionToken,
        (tokenCounts.get(candidate.selectionToken) ?? 0) + 1
      );
    }
  }
  const candidates = rawCandidates.map((candidate) => {
    if (!isPlainObject(candidate)) return null;
    const title = normalizeCandidateTitle(candidate.title);
    const updatedAt = normalizeCandidateDate(candidate.updatedAt);
    if (
      typeof candidate.selectionToken !== "string" ||
      !UUID_PATTERN.test(candidate.selectionToken) ||
      !title ||
      !updatedAt ||
      !isNonNegativeSafeInteger(candidate.tableCount) ||
      !isNonNegativeSafeInteger(candidate.relationCount)
    ) {
      return null;
    }
    return {
      selectionToken: candidate.selectionToken,
      title,
      updatedAt,
      tableCount: candidate.tableCount,
      relationCount: candidate.relationCount
    };
  });
  if (
    candidates.some(
      (candidate) =>
        candidate === null || tokenCounts.get(candidate.selectionToken) !== 1
    )
  ) {
    return [];
  }
  return candidates as SqlErdSessionCandidate[];
}

function getLatestCandidateToolStep(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): CandidateToolStep | null {
  if (run?.status !== "waiting_user_input") return null;
  const latestCompletedToolStep = [...run.steps]
    .filter((step) => step.type === "tool" && step.status === "completed")
    .sort((left, right) => right.order - left.order)[0];
  if (
    !latestCompletedToolStep ||
    !latestCompletedToolStep.outputSummary ||
    latestCompletedToolStep.outputSummary.status !== "needs_clarification"
  ) {
    return null;
  }
  return latestCompletedToolStep as CandidateToolStep;
}

function formatSqlErdCandidateDescription(candidate: SqlErdSessionCandidate): string {
  return `수정 ${candidate.updatedAt} · 테이블 ${candidate.tableCount}개 · 관계 ${candidate.relationCount}개`;
}

export function getAgentResourceLinks(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): AgentResourceLink[] {
  if (run?.status !== "completed") {
    return [];
  }

  const links = new Map<string, AgentResourceLink>();
  for (const step of run.steps) {
    if (step.status !== "completed") {
      continue;
    }

    for (const resourceRef of step.resourceRefs) {
      const link =
        toSqlErdSessionLink(resourceRef) ??
        toCanvasLink(resourceRef, step.outputSummary);
      if (link) {
        links.set(link.key, link);
      }
    }
  }

  return [...links.values()];
}

export function applyAgentSqlErdTableFocus(
  run: Pick<AgentRun, "id" | "status" | "steps"> | null | undefined,
  requestContext: AgentSqlErdRequestContext | null | undefined,
  appliedActionKeys: Set<string>,
  applyFocus: (focus: SqlErdAgentTableFocus) => void
): boolean {
  if (
    run?.status !== "completed" ||
    requestContext?.surface !== "sql_erd"
  ) {
    return false;
  }

  for (const step of [...run.steps].reverse()) {
    if (step.status !== "completed") {
      continue;
    }
    for (const resourceRef of [...step.resourceRefs].reverse()) {
      const focus = toSqlErdSessionLink(resourceRef)?.focus;
      if (!focus || focus.sessionId !== requestContext.sessionId) {
        continue;
      }
      const actionKey = `${run.id}:${step.id}:${focus.modelFingerprint}`;
      if (appliedActionKeys.has(actionKey)) {
        return false;
      }
      applyFocus(focus);
      appliedActionKeys.add(actionKey);
      return true;
    }
  }

  return false;
}

function toCanvasLink(
  resourceRef: Record<string, unknown>,
  outputSummary: Record<string, unknown> | null | undefined,
): AgentResourceLink | null {
  const metadata = isPlainObject(resourceRef.metadata) ? resourceRef.metadata : null;
  const canvasId = metadata?.canvasId;
  if (
    resourceRef.domain !== "canvas" ||
    resourceRef.resourceType !== "canvas_agent_run" ||
    typeof resourceRef.resourceId !== "string" ||
    !UUID_PATTERN.test(resourceRef.resourceId) ||
    typeof canvasId !== "string" ||
    !UUID_PATTERN.test(canvasId) ||
    typeof resourceRef.url !== "string"
  ) {
    return null;
  }
  const href = `${CANVAS_PATH}?canvasId=${encodeURIComponent(canvasId)}&canvasAgentRunId=${encodeURIComponent(resourceRef.resourceId)}`;
  if (resourceRef.url !== href) {
    return null;
  }
  return {
    href,
    key: `canvas:agent-run:${resourceRef.resourceId}`,
    label:
      outputSummary?.clientActionType === "insert_drive_file"
        ? "캔버스에 추가하고 열기"
        : "캔버스에서 열기"
  };
}

function normalizeOptionalCandidateText(
  value: unknown,
  maxLength: number
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && [...normalized].length <= maxLength ? normalized : null;
}

function toSqlErdSessionLink(
  resourceRef: Record<string, unknown>
): AgentResourceLink | null {
  if (
    resourceRef.domain !== "sqltoerd" ||
    resourceRef.resourceType !== "session" ||
    typeof resourceRef.resourceId !== "string" ||
    !UUID_PATTERN.test(resourceRef.resourceId) ||
    typeof resourceRef.url !== "string"
  ) {
    return null;
  }

  const rawUrl = resourceRef.url;
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.includes("\\")) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, "https://pilo.local");
  } catch {
    return null;
  }

  const queryKeys = [...parsedUrl.searchParams.keys()];
  const sessionIds = parsedUrl.searchParams.getAll("sessionId");
  if (
    parsedUrl.origin !== "https://pilo.local" ||
    parsedUrl.pathname !== SQL_ERD_SESSION_PATH ||
    parsedUrl.hash !== "" ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "sessionId" ||
    sessionIds.length !== 1 ||
    sessionIds[0] !== resourceRef.resourceId
  ) {
    return null;
  }

  const focus =
    resourceRef.status === "focused"
      ? parseSqlErdAgentTableFocusResource(resourceRef)
      : null;
  return {
    ...(focus ? { focus } : {}),
    href: `${SQL_ERD_SESSION_PATH}?sessionId=${encodeURIComponent(resourceRef.resourceId)}`,
    key: `sqltoerd:session:${resourceRef.resourceId}`,
    label: focus ? "집중 보기 열기" : "ERD 및 DDL 열기"
  };
}

export function parseSqlErdAgentTableFocusResource(
  resourceRef: Record<string, unknown>
): SqlErdAgentTableFocus | null {
  if (
    typeof resourceRef.resourceId !== "string" ||
    !isPlainObject(resourceRef.metadata)
  ) {
    return null;
  }
  const metadata = resourceRef.metadata;
  if (
    metadata.version !== 1 ||
    metadata.view !== "table_focus" ||
    !Number.isSafeInteger(metadata.sessionRevision) ||
    Number(metadata.sessionRevision) < 1 ||
    typeof metadata.modelFingerprint !== "string" ||
    !/^fnv1a32:[0-9a-f]{8}$/.test(metadata.modelFingerprint) ||
    typeof metadata.featureLabel !== "string" ||
    !isBoundedText(metadata.featureLabel, 100) ||
    typeof metadata.confidence !== "string" ||
    !["high", "medium", "low"].includes(metadata.confidence)
  ) {
    return null;
  }
  const primaryTableIds = readUniqueIds(metadata.primaryTableIds, 20, true);
  const relatedTableIds = readUniqueIds(metadata.relatedTableIds, 30, false);
  const contextTableIds =
    metadata.contextTableIds === undefined
      ? []
      : readUniqueIds(metadata.contextTableIds, 20, false);
  const relationIds = readUniqueIds(metadata.relationIds, 300, false);
  if (!primaryTableIds || !relatedTableIds || !contextTableIds || !relationIds) {
    return null;
  }
  const primarySet = new Set(primaryTableIds);
  const relatedSet = new Set(relatedTableIds);
  if (
    relatedTableIds.some((id) => primarySet.has(id)) ||
    contextTableIds.some((id) => primarySet.has(id) || relatedSet.has(id))
  ) {
    return null;
  }

  return {
    version: 1,
    view: "table_focus",
    sessionId: resourceRef.resourceId,
    sessionRevision: Number(metadata.sessionRevision),
    modelFingerprint: metadata.modelFingerprint,
    featureLabel: metadata.featureLabel.trim().replace(/\s+/g, " "),
    primaryTableIds,
    relatedTableIds,
    contextTableIds,
    relationIds,
    confidence: metadata.confidence as SqlErdAgentTableFocus["confidence"]
  };
}

function readUniqueIds(
  value: unknown,
  maxItems: number,
  requireOne: boolean
): string[] | null {
  if (
    !Array.isArray(value) ||
    (requireOne && value.length === 0) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    return null;
  }
  const ids = value.map((item) => String(item));
  return new Set(ids).size === ids.length ? ids : null;
}

function isBoundedText(value: string, maxLength: number): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && [...normalized].length <= maxLength;
}

function normalizeCandidateTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized && [...normalized].length <= 120 ? normalized : null;
}

function normalizeCandidateDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  return value === normalized ? normalized : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
