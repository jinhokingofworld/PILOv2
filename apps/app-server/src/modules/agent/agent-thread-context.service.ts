import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import type {
  AgentJsonObject,
  AgentResourceRef,
  AgentToolContext
} from "./types/agent-tool.types";

const CONTEXT_REF_PATTERN = /^ctx_[0-9a-f]{24}$/;
const THREAD_CONTEXT_MAX_RUNS = 6;
const THREAD_CONTEXT_MAX_RESOURCE_REFS = 12;
const SAFE_CONTEXT_DOMAINS = new Set([
  "meeting",
  "calendar",
  "board",
  "drive",
  "sqltoerd",
  "pr_review"
]);
const SAFE_MEETING_RESOURCE_TYPES = new Set([
  "meeting",
  "meeting_report",
  "meeting_report_action_item"
]);

interface ThreadResourceStepRow {
  thread_id: string;
  run_id: string;
  step_id: string;
  resource_refs: unknown;
}

interface ThreadStepScopeRow {
  thread_id: string;
  run_id: string;
  step_id: string;
  step_order: number | string;
  turn_sequence: number | string;
}

interface StoredContextStateRow {
  context_state: unknown;
}

interface ContextCandidateRow {
  id: string;
  domain: string;
  resource_type: string;
  resource_id: string;
  report_id: string | null;
  label: string;
  status: string | null;
}

export interface AgentSafeContextReference {
  domain: string;
  resourceType: string;
  contextRef: string;
  label: string;
  ordinal: number;
  generation: number;
  source: "tool_result" | "candidate";
  status?: string;
}

export interface AgentPublicResourceReference {
  domain: string;
  resourceType: string;
  contextRef: string;
  label?: string;
  status?: string;
}

export interface AgentContextState {
  version: 1;
  provenance: {
    turnSequence: number;
    stepOrder: number;
  };
  activeDomain?: string;
  resultSets: AgentSafeContextReference[];
  selectedTarget?: {
    contextRef: string;
    generation: number;
    source: "candidate_button" | "resolved_follow_up";
  };
  lastToolState: {
    toolName: string;
    outcome: "completed" | "clarification" | "confirmation";
  };
  pendingState?: {
    kind: "clarification" | "confirmation";
  };
}

export interface AgentThreadMeetingReference {
  resourceType:
    | "meeting"
    | "meeting_report"
    | "meeting_report_action_item";
  resourceId: string;
  reportId?: string;
}

@Injectable()
export class AgentThreadContextService {
  constructor(private readonly database: DatabaseService) {}

  async resolveMeetingReference(
    context: AgentToolContext,
    contextRef: string
  ): Promise<AgentThreadMeetingReference | null> {
    const reference = await this.resolveReference(context, contextRef);
    return reference ? this.readMeetingReference(reference) : null;
  }

  async resolveReference(
    context: AgentToolContext,
    contextRef: string
  ): Promise<AgentResourceRef | null> {
    if (!CONTEXT_REF_PATTERN.test(contextRef)) return null;
    const rows = await this.database.query<ThreadResourceStepRow>(
      `
        WITH current_run AS (
          SELECT run.thread_id
          FROM agent_runs AS run
          INNER JOIN agent_threads AS thread
            ON thread.id = run.thread_id
           AND thread.workspace_id = run.workspace_id
           AND thread.requested_by_user_id = run.requested_by_user_id
           AND thread.expires_at > now()
          WHERE run.id = $1
            AND run.workspace_id = $2
            AND run.requested_by_user_id = $3
            AND run.expires_at > now()
        ), recent_runs AS (
          SELECT scoped_run.id, scoped_run.created_at, current_run.thread_id
          FROM agent_runs AS scoped_run
          INNER JOIN current_run
            ON current_run.thread_id = scoped_run.thread_id
          WHERE scoped_run.workspace_id = $2
            AND scoped_run.requested_by_user_id = $3
            AND scoped_run.expires_at > now()
            AND (scoped_run.id = $1 OR scoped_run.status = 'completed')
          ORDER BY scoped_run.created_at DESC, scoped_run.id DESC
          LIMIT $4
        )
        SELECT
          recent_run.thread_id,
          recent_run.id AS run_id,
          step.id AS step_id,
          step.resource_refs
        FROM recent_runs AS recent_run
        INNER JOIN agent_steps AS step
          ON step.run_id = recent_run.id
         AND step.step_type = 'tool'
         AND step.status = 'completed'
        ORDER BY
          recent_run.created_at DESC,
          recent_run.id DESC,
          step.step_order DESC,
          step.id DESC
      `,
      [
        context.runId,
        context.workspaceId,
        context.currentUserId,
        THREAD_CONTEXT_MAX_RUNS
      ]
    );

    let acceptedRefs = 0;
    let resolved: AgentResourceRef | null = null;
    for (const row of rows) {
      if (!Array.isArray(row.resource_refs)) continue;
      for (const [index, candidate] of row.resource_refs.entries()) {
        if (acceptedRefs >= THREAD_CONTEXT_MAX_RESOURCE_REFS) return resolved;
        const reference = this.readResourceReference(candidate);
        if (!reference) continue;
        acceptedRefs += 1;
        if (this.contextRef(row.thread_id, row.run_id, row.step_id, index) !== contextRef) {
          continue;
        }
        if (resolved) return null;
        resolved = reference;
      }
    }
    return resolved;
  }

  async resolveCandidateReference(
    context: AgentToolContext,
    contextRef: string
  ): Promise<AgentResourceRef | null> {
    if (!CONTEXT_REF_PATTERN.test(contextRef)) return null;
    const rows = await this.database.query<ContextCandidateRow>(
      `
        SELECT
          candidate.id,
          candidate.domain,
          candidate.resource_type,
          candidate.resource_id,
          candidate.report_id,
          candidate.label,
          candidate.status
        FROM agent_candidate_selections AS candidate
        INNER JOIN agent_runs AS run
          ON run.id = candidate.run_id
         AND run.workspace_id = candidate.workspace_id
         AND run.requested_by_user_id = candidate.requested_by_user_id
         AND run.expires_at > now()
        INNER JOIN agent_threads AS thread
          ON thread.id = run.thread_id
         AND thread.workspace_id = run.workspace_id
         AND thread.requested_by_user_id = run.requested_by_user_id
         AND thread.expires_at > now()
        WHERE candidate.run_id = $1
          AND candidate.workspace_id = $2
          AND candidate.requested_by_user_id = $3
          AND candidate.consumed_at IS NOT NULL
          AND candidate.expires_at > now()
          AND NOT EXISTS (
            SELECT 1
            FROM agent_steps AS resumed_step
            WHERE resumed_step.run_id = candidate.run_id
              AND resumed_step.step_type = 'tool'
              AND resumed_step.status = 'completed'
              AND resumed_step.step_order > (
                SELECT source_step.step_order
                FROM agent_steps AS source_step
                WHERE source_step.id = candidate.tool_step_id
              )
          )
        ORDER BY candidate.consumed_at DESC, candidate.id DESC
        LIMIT 10
      `,
      [context.runId, context.workspaceId, context.currentUserId]
    );
    const matches = rows.filter(
      (row) => this.candidateContextRef(row.id) === contextRef
    );
    if (matches.length !== 1) return null;
    const row = matches[0];
    return {
      domain: row.domain,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      label: row.label,
      ...(row.status ? { status: row.status } : {}),
      ...(row.report_id ? { metadata: { reportId: row.report_id } } : {})
    };
  }

  async buildContextState(
    context: AgentToolContext,
    stepId: string,
    toolName: string,
    resourceRefs: AgentResourceRef[],
    candidateSelections: Array<{
      contextRef: string;
      domain: string;
      resourceType: string;
      label: string;
      status: string | null;
      ordinal: number;
      generation: number;
    }> = [],
    outcome: "completed" | "clarification" | "confirmation" = "completed"
  ): Promise<AgentContextState | null> {
    const scope = await this.findStepScope(context, stepId);
    if (!scope) return null;
    const generation = Number(scope.step_order);
    const refs = resourceRefs
      .slice(0, THREAD_CONTEXT_MAX_RESOURCE_REFS)
      .map((reference, index) => this.toSafeContextReference(scope, reference, index))
      .filter((reference): reference is AgentSafeContextReference => reference !== null);
    const candidateRefs = candidateSelections
      .slice(0, THREAD_CONTEXT_MAX_RESOURCE_REFS - refs.length)
      .map((candidate) => this.toSafeCandidateReference(candidate))
      .filter((reference): reference is AgentSafeContextReference => reference !== null);
    const priorRefs = (await this.findPriorContextReferences(scope)).filter(
      (reference) => outcome !== "completed" || reference.source !== "candidate"
    );
    const refsByContextRef = new Map<string, AgentSafeContextReference>();
    for (const reference of [...priorRefs, ...refs, ...candidateRefs]) {
      refsByContextRef.delete(reference.contextRef);
      refsByContextRef.set(reference.contextRef, reference);
    }
    const resultSets = [...refsByContextRef.values()].slice(
      -THREAD_CONTEXT_MAX_RESOURCE_REFS
    );
    const activeDomain = resultSets.at(-1)?.domain;
    return {
      version: 1,
      provenance: {
        turnSequence: Number(scope.turn_sequence),
        stepOrder: generation
      },
      ...(activeDomain ? { activeDomain } : {}),
      resultSets,
      lastToolState: { toolName, outcome },
      ...(outcome === "clarification" || outcome === "confirmation"
        ? { pendingState: { kind: outcome } }
        : {})
    };
  }

  toPublicResourceRefs(
    threadId: string | null,
    runId: string,
    stepId: string,
    resourceRefs: AgentResourceRef[]
  ): AgentPublicResourceReference[] {
    if (!threadId) return [];
    return resourceRefs
      .slice(0, THREAD_CONTEXT_MAX_RESOURCE_REFS)
      .map((reference, index) => {
        if (!SAFE_CONTEXT_DOMAINS.has(reference.domain)) return null;
        const resourceType = this.boundText(reference.resourceType, 100);
        if (!resourceType) return null;
        const label = this.boundText(reference.label, 300);
        const status = this.boundText(reference.status, 100);
        return {
          domain: reference.domain,
          resourceType,
          contextRef: this.contextRef(threadId, runId, stepId, index),
          ...(label ? { label } : {}),
          ...(status ? { status } : {})
        };
      })
      .filter(
        (reference): reference is AgentPublicResourceReference => reference !== null
      );
  }

  private async findStepScope(
    context: AgentToolContext,
    stepId: string
  ): Promise<ThreadStepScopeRow | null> {
    return this.database.queryOne<ThreadStepScopeRow>(
      `
        SELECT
          run.thread_id,
          run.id AS run_id,
          step.id AS step_id,
          step.step_order,
          outbox.turn_sequence
        FROM agent_runs AS run
        INNER JOIN agent_threads AS thread
          ON thread.id = run.thread_id
         AND thread.workspace_id = run.workspace_id
         AND thread.requested_by_user_id = run.requested_by_user_id
         AND thread.expires_at > now()
        INNER JOIN agent_steps AS step
          ON step.run_id = run.id
         AND step.id = $4
        INNER JOIN agent_run_outbox AS outbox
          ON outbox.run_id = run.id
        WHERE run.id = $1
          AND run.workspace_id = $2
          AND run.requested_by_user_id = $3
          AND run.expires_at > now()
        LIMIT 1
      `,
      [context.runId, context.workspaceId, context.currentUserId, stepId]
    );
  }

  private async findPriorContextReferences(
    scope: ThreadStepScopeRow
  ): Promise<AgentSafeContextReference[]> {
    const row = await this.database.queryOne<StoredContextStateRow>(
      `
        SELECT output_json->'agentContextState' AS context_state
        FROM agent_steps
        WHERE run_id = $1
          AND step_type = 'tool'
          AND status = 'completed'
          AND step_order < $2
          AND output_json ? 'agentContextState'
        ORDER BY step_order DESC, id DESC
        LIMIT 1
      `,
      [scope.run_id, Number(scope.step_order)]
    );
    if (!row || !this.isPlainObject(row.context_state)) return [];
    const resultSets = row.context_state.resultSets;
    if (!Array.isArray(resultSets)) return [];
    return resultSets
      .slice(0, THREAD_CONTEXT_MAX_RESOURCE_REFS)
      .map((reference) => this.readStoredContextReference(reference))
      .filter((reference): reference is AgentSafeContextReference => reference !== null);
  }

  private readStoredContextReference(
    value: unknown
  ): AgentSafeContextReference | null {
    if (!this.isPlainObject(value)) return null;
    const contextRef = value.contextRef;
    const domain = value.domain;
    const resourceType = value.resourceType;
    const label = value.label;
    const ordinal = value.ordinal;
    const generation = value.generation;
    const source = value.source;
    if (
      typeof contextRef !== "string" ||
      typeof domain !== "string" ||
      typeof resourceType !== "string" ||
      typeof label !== "string" ||
      typeof ordinal !== "number" ||
      !Number.isSafeInteger(ordinal) ||
      typeof generation !== "number" ||
      !Number.isSafeInteger(generation) ||
      (source !== "tool_result" && source !== "candidate")
    ) {
      return null;
    }
    const reference = this.toSafeCandidateReference({
      contextRef,
      domain,
      resourceType,
      label,
      status: typeof value.status === "string" ? value.status : null,
      ordinal,
      generation
    });
    return reference ? { ...reference, source } : null;
  }

  private toSafeContextReference(
    scope: ThreadStepScopeRow,
    reference: AgentResourceRef,
    index: number
  ): AgentSafeContextReference | null {
    if (!SAFE_CONTEXT_DOMAINS.has(reference.domain)) return null;
    const resourceType = this.boundText(reference.resourceType, 100);
    if (!resourceType) return null;
    const status = this.boundText(reference.status, 100);
    return {
      domain: reference.domain,
      resourceType,
      contextRef: this.contextRef(
        scope.thread_id,
        scope.run_id,
        scope.step_id,
        index
      ),
      label: this.boundText(reference.label, 300) ?? resourceType,
      ordinal: index + 1,
      generation: Number(scope.step_order),
      source: "tool_result",
      ...(status ? { status } : {})
    };
  }

  private toSafeCandidateReference(candidate: {
    contextRef: string;
    domain: string;
    resourceType: string;
    label: string;
    status: string | null;
    ordinal: number;
    generation: number;
  }): AgentSafeContextReference | null {
    if (!CONTEXT_REF_PATTERN.test(candidate.contextRef)) return null;
    if (!SAFE_CONTEXT_DOMAINS.has(candidate.domain)) return null;
    const resourceType = this.boundText(candidate.resourceType, 100);
    const label = this.boundText(candidate.label, 300);
    const status = this.boundText(candidate.status, 100);
    if (!resourceType || !label) return null;
    return {
      domain: candidate.domain,
      resourceType,
      contextRef: candidate.contextRef,
      label,
      ordinal: candidate.ordinal,
      generation: candidate.generation,
      source: "candidate",
      ...(status ? { status } : {})
    };
  }

  private contextRef(
    threadId: string,
    runId: string,
    stepId: string,
    index: number
  ): string {
    const digest = createHash("sha256")
      .update(`${threadId}:${runId}:${stepId}:${index}`, "utf8")
      .digest("hex");
    return `ctx_${digest.slice(0, 24)}`;
  }

  private candidateContextRef(candidateSelectionId: string): string {
    return `ctx_${createHash("sha256")
      .update(`candidate:${candidateSelectionId}`, "utf8")
      .digest("hex")
      .slice(0, 24)}`;
  }

  private boundText(value: unknown, maxBytes: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized) return null;
    let result = normalized;
    while (Buffer.byteLength(result, "utf8") > maxBytes) {
      result = result.slice(0, -1);
    }
    return result || null;
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readResourceReference(value: unknown): AgentResourceRef | null {
    if (!this.isPlainObject(value)) return null;
    const domain = this.boundText(value.domain, 100);
    const resourceType = this.boundText(value.resourceType, 100);
    const resourceId = this.boundText(value.resourceId, 500);
    if (
      !domain ||
      !SAFE_CONTEXT_DOMAINS.has(domain) ||
      !resourceType ||
      !resourceId
    ) {
      return null;
    }
    const label = this.boundText(value.label, 300);
    const url = this.boundText(value.url, 1000);
    const status = this.boundText(value.status, 100);
    return {
      domain,
      resourceType,
      resourceId,
      ...(label ? { label } : {}),
      ...(url ? { url } : {}),
      ...(status ? { status } : {}),
      ...(this.isPlainObject(value.metadata) ? { metadata: value.metadata } : {})
    };
  }

  private readMeetingReference(
    value: unknown
  ): AgentThreadMeetingReference | null {
    if (!this.isObject(value)) return null;
    if (value.domain !== "meeting") return null;
    if (
      typeof value.resourceType !== "string" ||
      !SAFE_MEETING_RESOURCE_TYPES.has(value.resourceType) ||
      typeof value.resourceId !== "string" ||
      value.resourceId.trim().length === 0
    ) {
      return null;
    }
    const resourceType = value.resourceType as AgentThreadMeetingReference["resourceType"];
    if (resourceType !== "meeting_report_action_item") {
      return { resourceType, resourceId: value.resourceId };
    }
    const metadata = this.isObject(value.metadata)
      ? (value.metadata as AgentJsonObject)
      : null;
    const reportId = metadata?.reportId;
    if (typeof reportId !== "string" || reportId.trim().length === 0) {
      return null;
    }
    return { resourceType, resourceId: value.resourceId, reportId };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
