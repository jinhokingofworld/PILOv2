import { randomUUID } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { DocumentSearchService } from "../drive/document-search.service";
import { MeetingTranscriptRagService } from "../meeting/meeting-transcript-rag.service";
import type { AgentExecutionLease } from "./agent-logging.service";
import type {
  AgentGroundingSourceCandidate,
  AgentJsonObject,
  AgentResourceRef
} from "./types/agent-tool.types";

const NO_RELEVANT_SOURCES_MESSAGE =
  "현재 접근 가능한 회의록과 문서에서 질문과 관련된 근거를 찾지 못했습니다. 대상을 조금 더 구체적으로 입력해 주세요.";
const SECURITY_REFUSAL_MESSAGE =
  "요청한 내용은 안전하게 답변할 수 없습니다.";
const CITATION_FAILURE_MESSAGE =
  "답변의 근거 인용을 검증하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const MAX_GROUNDING_SOURCES = 8;

type GroundingSourceType = AgentGroundingSourceCandidate["sourceType"];

interface GroundingCitationRegistryEntry {
  citationId: string;
  sourceType: GroundingSourceType;
  sourceRef: string;
  resourceRef: AgentResourceRef;
}

export interface GroundingContextSource {
  citationId: string;
  sourceType: GroundingSourceType;
  title?: string;
  excerpt: string;
  resourceRef: AgentResourceRef;
}

@Injectable()
export class AgentGroundedAnswerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly meetingTranscriptRagService: MeetingTranscriptRagService,
    @Optional() private readonly documentSearchService?: DocumentSearchService
  ) {}

  async completeToolAndQueue(input: {
    runId: string;
    workspaceId: string;
    currentUserId: string;
    stepId: string;
    outputSummary: AgentJsonObject;
    resourceRefs: AgentResourceRef[];
    groundingSources?: AgentGroundingSourceCandidate[];
    executionLease: AgentExecutionLease;
  }): Promise<void> {
    const candidates = input.groundingSources
      ? this.normalizeCandidates(input.groundingSources)
      : await this.legacyMeetingCandidates(input);
    const registry = candidates.map((source) => ({
      citationId: `citation_${randomUUID()}`,
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      resourceRef: this.boundResourceRef(source.resourceRef)
    }));
    const outputSummary: AgentJsonObject = {
      ...input.outputSummary,
      groundingOutcome:
        registry.length === 0 ? "no_relevant_sources" : "sources_found",
      sourceCount: registry.length,
      sourceTypes: [...new Set(registry.map((source) => source.sourceType))].sort()
    };
    delete outputSummary.sourceIds;

    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{
        id: string;
        execution_lease_token: string | null;
        execution_lease_generation: number | string;
      }>(
        `SELECT id, execution_lease_token, execution_lease_generation
         FROM agent_runs
         WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3
           AND status = 'running'
         FOR UPDATE`,
        [input.runId, input.workspaceId, input.currentUserId]
      );
      if (!run) return;
      if (
        run.execution_lease_token !== input.executionLease.token ||
        Number(run.execution_lease_generation) !== input.executionLease.generation
      ) {
        throw new Error("Agent execution lease was fenced");
      }
      const completedStep = await transaction.queryOne<{ id: string }>(
        `UPDATE agent_steps
         SET status = 'completed', output_json = $3::jsonb, resource_refs = $4::jsonb,
           completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND status = 'running'
         RETURNING id`,
        [input.stepId, input.runId, JSON.stringify(outputSummary), JSON.stringify(input.resourceRefs)]
      );
      if (!completedStep) throw new Error("Agent grounded tool step could not be completed");

      if (registry.length === 0) {
        await transaction.execute(
          `UPDATE agent_runs
           SET status = 'completed', final_answer = $2, message = '요청을 완료했습니다.',
             completed_at = now(), execution_lease_token = NULL,
             execution_lease_expires_at = NULL, execution_heartbeat_at = NULL,
             updated_at = now()
           WHERE id = $1 AND status = 'running'`,
          [input.runId, NO_RELEVANT_SOURCES_MESSAGE]
        );
        return;
      }

      const order = await transaction.queryOne<{ next_order: number | string }>(
        `SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order
         FROM agent_steps WHERE run_id = $1`,
        [input.runId]
      );
      await transaction.execute(
        `INSERT INTO agent_steps
           (run_id, step_order, step_type, status, input_json, output_json, resource_refs)
         VALUES ($1, $2, 'answer', 'pending', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)`,
        [input.runId, Number(order?.next_order ?? 1)]
      );
      await transaction.execute(
        `INSERT INTO agent_grounded_answer_outbox (run_id, workspace_id, source_ids)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (run_id) DO NOTHING`,
        [input.runId, input.workspaceId, JSON.stringify(registry)]
      );
      await transaction.execute(
        `UPDATE agent_runs
         SET message = '근거를 바탕으로 답변을 생성하고 있습니다.',
           execution_lease_token = NULL, execution_lease_expires_at = NULL,
           execution_heartbeat_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'running'
           AND execution_lease_token = $2::uuid
           AND execution_lease_generation = $3`,
        [input.runId, input.executionLease.token, input.executionLease.generation]
      );
    });
  }

  async getContext(runId: string): Promise<{
    prompt: string;
    sources: GroundingContextSource[];
  } | null> {
    const row = await this.database.queryOne<{
      workspace_id: string;
      requested_by_user_id: string;
      prompt: string;
      source_ids: unknown;
    }>(
      `SELECT run.workspace_id, run.requested_by_user_id, run.prompt, outbox.source_ids
       FROM agent_runs run
       JOIN agent_grounded_answer_outbox outbox ON outbox.run_id = run.id
       WHERE run.id = $1 AND run.status = 'running'`,
      [runId]
    );
    if (!row) return null;
    const registry = this.parseRegistry(row.source_ids);
    return {
      prompt: row.prompt,
      sources: await this.loadAuthorizedRegistrySources(
        row.requested_by_user_id,
        row.workspace_id,
        registry
      )
    };
  }

  async complete(runId: string, answer: string, citations: string[]): Promise<void> {
    const normalizedAnswer = answer.trim().slice(0, 8000);
    if (!normalizedAnswer) return;
    const context = await this.getContext(runId);
    if (!context) return;
    const allowed = new Map(context.sources.map((source) => [source.citationId, source]));
    if (citations.length === 0) {
      throw new Error("Grounded answer citation is required");
    }
    if (citations.some((citation) => !allowed.has(citation))) {
      throw new Error("Grounded answer contains an unknown citation");
    }
    const safeCitations = [...new Set(citations)];
    const citationSources = safeCitations.map((citationId) => allowed.get(citationId));
    await this.completeGroundedRun(runId, normalizedAnswer, safeCitations, citationSources);
  }

  async completeWithoutSources(runId: string): Promise<void> {
    await this.completeTerminalRun(runId, NO_RELEVANT_SOURCES_MESSAGE, "no_relevant_sources");
  }

  async completeSecurityRefusal(runId: string): Promise<void> {
    await this.completeTerminalRun(runId, SECURITY_REFUSAL_MESSAGE, "security_refusal");
  }

  async failCitationValidation(runId: string): Promise<void> {
    await this.completeTerminalRun(runId, CITATION_FAILURE_MESSAGE, "citation_validation_failed");
  }

  private async legacyMeetingCandidates(input: {
    workspaceId: string;
    currentUserId: string;
    outputSummary: AgentJsonObject;
    resourceRefs: AgentResourceRef[];
  }): Promise<AgentGroundingSourceCandidate[]> {
    const sourceIds = this.meetingTranscriptRagService.normalizeSourceIds(
      Array.isArray(input.outputSummary.sourceIds)
        ? input.outputSummary.sourceIds.filter((id): id is string => typeof id === "string")
        : []
    );
    const scopedReportIds = new Set(input.resourceRefs
      .filter((reference) => reference.domain === "meeting" && reference.resourceType === "meeting_report")
      .map((reference) => reference.resourceId));
    if (scopedReportIds.size === 0) return [];
    const sources = await this.meetingTranscriptRagService.loadAuthorizedSources(
      input.currentUserId,
      input.workspaceId,
      sourceIds
    );
    return sources.filter((source) => scopedReportIds.has(source.reportId)).map((source) => ({
      sourceType: source.sourceType === "transcript" ? "meeting_transcript" : "meeting_activity",
      sourceRef: source.sourceId,
      excerpt: source.content,
      score: source.score ?? 0,
      resourceRef: {
        domain: "meeting",
        resourceType: "meeting_report",
        resourceId: source.reportId
      }
    }));
  }

  private normalizeCandidates(sources: AgentGroundingSourceCandidate[]): AgentGroundingSourceCandidate[] {
    const bySourceRef = new Map<string, AgentGroundingSourceCandidate>();
    for (const source of sources.slice(0, MAX_GROUNDING_SOURCES)) {
      if (!source.sourceRef.trim() || !Number.isFinite(source.score)) continue;
      if (!bySourceRef.has(source.sourceRef)) bySourceRef.set(source.sourceRef, source);
    }
    return [...bySourceRef.values()];
  }

  private parseRegistry(value: unknown): GroundingCitationRegistryEntry[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_GROUNDING_SOURCES).flatMap((item) => {
      if (typeof item === "string") {
        const sourceRef = this.meetingTranscriptRagService.normalizeSourceIds([item])[0];
        if (!sourceRef) return [];
        return [{
          citationId: sourceRef,
          sourceType: sourceRef.startsWith("activity:") ? "meeting_activity" as const : "meeting_transcript" as const,
          sourceRef,
          resourceRef: { domain: "meeting", resourceType: "meeting_report", resourceId: "" }
        }];
      }
      if (!this.isPlainObject(item)) return [];
      const citationId = typeof item.citationId === "string" ? item.citationId : "";
      const sourceRef = typeof item.sourceRef === "string" ? item.sourceRef : "";
      const sourceType = item.sourceType;
      if (
        !/^citation_[0-9a-f-]{36}$/i.test(citationId) ||
        !sourceRef ||
        !this.isSourceType(sourceType) ||
        !this.isResourceRef(item.resourceRef)
      ) return [];
      return [{ citationId, sourceType, sourceRef, resourceRef: item.resourceRef }];
    });
  }

  private async loadAuthorizedRegistrySources(
    currentUserId: string,
    workspaceId: string,
    registry: GroundingCitationRegistryEntry[]
  ): Promise<GroundingContextSource[]> {
    const meetingEntries = registry.filter((entry) => entry.sourceType !== "drive_document");
    const driveEntries = registry.filter((entry) => entry.sourceType === "drive_document");
    const meetingSources = await this.meetingTranscriptRagService.loadAuthorizedSources(
      currentUserId,
      workspaceId,
      meetingEntries.map((entry) => entry.sourceRef)
    );
    const driveSources = this.documentSearchService
      ? await this.documentSearchService.loadAuthorizedSources(
          currentUserId,
          workspaceId,
          driveEntries.map((entry) => entry.sourceRef)
        )
      : [];
    const meetingByRef = new Map(meetingSources.map((source) => [source.sourceId, source]));
    const driveByRef = new Map(driveSources.map((source) => [source.sourceRef, source]));

    const result: GroundingContextSource[] = [];
    for (const entry of registry) {
      if (entry.sourceType === "drive_document") {
        const source = driveByRef.get(entry.sourceRef);
        if (!source || (entry.resourceRef.resourceId && entry.resourceRef.resourceId !== source.documentId)) continue;
        result.push({
          citationId: entry.citationId,
          sourceType: entry.sourceType,
          title: source.title,
          excerpt: source.excerpt,
          resourceRef: entry.resourceRef
        });
        continue;
      }
      const source = meetingByRef.get(entry.sourceRef);
      if (!source || (entry.resourceRef.resourceId && entry.resourceRef.resourceId !== source.reportId)) continue;
      result.push({
        citationId: entry.citationId,
        sourceType: entry.sourceType,
        excerpt: source.content,
        resourceRef: entry.resourceRef.resourceId
          ? entry.resourceRef
          : { domain: "meeting", resourceType: "meeting_report", resourceId: source.reportId }
      });
    }
    return result;
  }

  private async completeGroundedRun(
    runId: string,
    answer: string,
    citations: string[],
    citationSources: Array<GroundingContextSource | undefined>
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{ workspace_id: string }>(
        `SELECT workspace_id FROM agent_runs
         WHERE id = $1 AND status = 'running' FOR UPDATE`,
        [runId]
      );
      if (!run) return;
      await transaction.execute(
        `UPDATE agent_steps
         SET status = 'completed', output_json = $2::jsonb,
           completed_at = now(), updated_at = now()
         WHERE run_id = $1 AND step_type = 'answer' AND status = 'pending'`,
        [runId, JSON.stringify({
          citationIds: citations,
          citationCount: citations.length,
          citationSources: citationSources.filter((source): source is GroundingContextSource => Boolean(source))
        })]
      );
      await transaction.execute(
        `UPDATE agent_runs
         SET status = 'completed', final_answer = $2, message = '요청을 완료했습니다.',
           completed_at = now(), execution_lease_token = NULL,
           execution_lease_expires_at = NULL, execution_heartbeat_at = NULL,
           updated_at = now()
         WHERE id = $1 AND status = 'running'`,
        [runId, answer]
      );
    });
  }

  private async completeTerminalRun(runId: string, answer: string, outcome: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{ id: string }>(
        `SELECT id FROM agent_runs WHERE id = $1 AND status = 'running' FOR UPDATE`,
        [runId]
      );
      if (!run) return;
      await transaction.execute(
        `UPDATE agent_steps
         SET status = 'completed', output_json = $2::jsonb,
           completed_at = now(), updated_at = now()
         WHERE run_id = $1 AND step_type = 'answer' AND status = 'pending'`,
        [runId, JSON.stringify({ groundingOutcome: outcome, citationIds: [], citationCount: 0 })]
      );
      await transaction.execute(
        `UPDATE agent_runs
         SET status = 'completed', final_answer = $2, message = '요청을 완료했습니다.',
           completed_at = now(), execution_lease_token = NULL,
           execution_lease_expires_at = NULL, execution_heartbeat_at = NULL,
           updated_at = now()
         WHERE id = $1 AND status = 'running'`,
        [runId, answer]
      );
    });
  }

  private boundResourceRef(reference: AgentResourceRef): AgentResourceRef {
    return {
      domain: reference.domain.slice(0, 80),
      resourceType: reference.resourceType.slice(0, 80),
      resourceId: reference.resourceId.slice(0, 200),
      ...(reference.label ? { label: reference.label.slice(0, 160) } : {}),
      ...(reference.url ? { url: reference.url.slice(0, 500) } : {}),
      ...(reference.status ? { status: reference.status.slice(0, 80) } : {})
    };
  }

  private isSourceType(value: unknown): value is GroundingSourceType {
    return value === "meeting_transcript" || value === "meeting_activity" || value === "drive_document";
  }

  private isResourceRef(value: unknown): value is AgentResourceRef {
    return this.isPlainObject(value) &&
      typeof value.domain === "string" &&
      typeof value.resourceType === "string" &&
      typeof value.resourceId === "string";
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
