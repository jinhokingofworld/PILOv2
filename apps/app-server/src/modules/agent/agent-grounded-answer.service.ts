import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { MeetingTranscriptRagService, type MeetingEvidenceSource } from "../meeting/meeting-transcript-rag.service";
import type { AgentExecutionLease } from "./agent-logging.service";
import type { AgentGroundingSourceCandidate, AgentJsonObject, AgentResourceRef } from "./types/agent-tool.types";

@Injectable()
export class AgentGroundedAnswerService {
  constructor(private readonly database: DatabaseService, private readonly meetingTranscriptRagService: MeetingTranscriptRagService) {}

  async completeToolAndQueue(input: { runId: string; workspaceId: string; currentUserId: string; stepId: string; outputSummary: AgentJsonObject; resourceRefs: AgentResourceRef[]; groundingSources?: AgentGroundingSourceCandidate[]; executionLease: AgentExecutionLease }): Promise<void> {
    const requestedSourceIds = this.meetingTranscriptRagService.normalizeSourceIds(
      Array.isArray(input.outputSummary.sourceIds)
        ? input.outputSummary.sourceIds.filter((id): id is string => typeof id === "string")
        : []
    );
    const scopedReportIds = new Set(
      input.resourceRefs
        .filter(
          (reference) =>
            reference.domain === "meeting" &&
            reference.resourceType === "meeting_report"
        )
        .map((reference) => reference.resourceId)
    );
    const scopedSources =
      scopedReportIds.size === 0
        ? []
        : (await this.meetingTranscriptRagService.loadAuthorizedSources(
            input.currentUserId,
            input.workspaceId,
            requestedSourceIds
          )).filter((source) => scopedReportIds.has(source.reportId));
    const sourceIds = scopedSources.map((source) => source.sourceId);
    const outputSummary: AgentJsonObject = {
      ...input.outputSummary,
      groundingOutcome:
        sourceIds.length === 0 ? "no_relevant_sources" : "sources_found",
      sourceCount: sourceIds.length,
      sourceTypes: [...new Set(scopedSources.map((source) => source.sourceType))].sort(),
      sourceIds
    };
    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{ id: string; execution_lease_token: string | null; execution_lease_generation: number | string }>(`SELECT id, execution_lease_token, execution_lease_generation FROM agent_runs WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3 AND status = 'running' FOR UPDATE`, [input.runId, input.workspaceId, input.currentUserId]);
      if (!run) return;
      if (run.execution_lease_token !== input.executionLease.token || Number(run.execution_lease_generation) !== input.executionLease.generation) throw new Error("Agent execution lease was fenced");
      const completedStep = await transaction.queryOne<{ id: string }>(`UPDATE agent_steps SET status = 'completed', output_json = $3::jsonb, resource_refs = $4::jsonb, completed_at = now(), updated_at = now() WHERE id = $1 AND run_id = $2 AND status = 'running' RETURNING id`, [input.stepId, input.runId, JSON.stringify(outputSummary), JSON.stringify(input.resourceRefs)]);
      if (!completedStep) throw new Error("Agent grounded tool step could not be completed");
      const order = await transaction.queryOne<{ next_order: number | string }>(`SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order FROM agent_steps WHERE run_id = $1`, [input.runId]);
      await transaction.execute(`INSERT INTO agent_steps (run_id, step_order, step_type, status, input_json, output_json, resource_refs) VALUES ($1, $2, 'answer', 'pending', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)`, [input.runId, Number(order?.next_order ?? 1)]);
      await transaction.execute(`INSERT INTO agent_grounded_answer_outbox (run_id, workspace_id, source_ids) VALUES ($1, $2, $3::jsonb) ON CONFLICT (run_id) DO NOTHING`, [input.runId, input.workspaceId, JSON.stringify(sourceIds)]);
      await transaction.execute(`UPDATE agent_runs SET message = '회의록 근거를 바탕으로 답변을 생성하고 있습니다.', execution_lease_token = NULL, execution_lease_expires_at = NULL, execution_heartbeat_at = NULL, updated_at = now() WHERE id = $1 AND status = 'running' AND execution_lease_token = $2::uuid AND execution_lease_generation = $3`, [input.runId, input.executionLease.token, input.executionLease.generation]);
    });
  }

  async getContext(runId: string): Promise<{ prompt: string; sources: MeetingEvidenceSource[] } | null> {
    const row = await this.database.queryOne<{ workspace_id: string; requested_by_user_id: string; prompt: string; source_ids: string[] }>(`SELECT run.workspace_id, run.requested_by_user_id, run.prompt, outbox.source_ids FROM agent_runs run JOIN agent_grounded_answer_outbox outbox ON outbox.run_id = run.id WHERE run.id = $1 AND run.status = 'running'`, [runId]);
    if (!row) return null;
    return { prompt: row.prompt, sources: await this.meetingTranscriptRagService.loadAuthorizedSources(row.requested_by_user_id, row.workspace_id, Array.isArray(row.source_ids) ? row.source_ids : []) };
  }

  async complete(runId: string, answer: string, citations: string[]): Promise<void> {
    const normalizedAnswer = answer.trim().slice(0, 8000);
    const outbox = await this.database.queryOne<{ workspace_id: string; requested_by_user_id: string; source_ids: string[] }>(`SELECT run.workspace_id, run.requested_by_user_id, outbox.source_ids FROM agent_runs run JOIN agent_grounded_answer_outbox outbox ON outbox.run_id = run.id WHERE run.id = $1 AND run.status = 'running'`, [runId]);
    if (!outbox || !normalizedAnswer) return;
    const allowed = new Set(this.meetingTranscriptRagService.normalizeSourceIds(Array.isArray(outbox.source_ids) ? outbox.source_ids : []));
    if (citations.some((citation) => !allowed.has(citation))) {
      throw new Error("Grounded answer contains an unknown citation");
    }
    const safeCitations = [...new Set(citations.filter((citation) => allowed.has(citation)))];
    const citationSources = (await this.meetingTranscriptRagService.loadAuthorizedSources(outbox.requested_by_user_id, outbox.workspace_id, safeCitations)).map((source) => ({
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      reportId: source.reportId,
      ...(source.sourceType === "transcript" ? { startedAtMs: source.startedAtMs, endedAtMs: source.endedAtMs } : { occurredAt: source.occurredAt, action: source.action, summary: source.summary })
    }));
    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{ workspace_id: string }>(`SELECT workspace_id FROM agent_runs WHERE id = $1 AND status = 'running' FOR UPDATE`, [runId]);
      if (!run) return;
      await transaction.execute(`UPDATE agent_steps SET status = 'completed', output_json = $2::jsonb, completed_at = now(), updated_at = now() WHERE run_id = $1 AND step_type = 'answer' AND status = 'pending'`, [runId, JSON.stringify({ citationIds: safeCitations, citationCount: safeCitations.length, citationSources })]);
      await transaction.execute(`UPDATE agent_runs SET status = 'completed', final_answer = $2, message = '요청을 완료했습니다.', completed_at = now(), execution_lease_token = NULL, execution_lease_expires_at = NULL, execution_heartbeat_at = NULL, updated_at = now() WHERE id = $1 AND status = 'running'`, [runId, normalizedAnswer]);
    });
  }

  async completeWithoutSources(runId: string): Promise<void> {
    await this.complete(runId, "권한이 있는 회의록에서 질문과 관련된 발언 또는 활동 근거를 찾지 못했습니다.", []);
  }
}
