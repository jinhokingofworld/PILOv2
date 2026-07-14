import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { MeetingTranscriptRagService, type MeetingTranscriptSource } from "../meeting/meeting-transcript-rag.service";
import type { AgentJsonObject, AgentResourceRef } from "./types/agent-tool.types";

@Injectable()
export class AgentGroundedAnswerService {
  constructor(private readonly database: DatabaseService, private readonly meetingTranscriptRagService: MeetingTranscriptRagService) {}

  async completeToolAndQueue(input: { runId: string; workspaceId: string; currentUserId: string; stepId: string; outputSummary: AgentJsonObject; resourceRefs: AgentResourceRef[] }): Promise<void> {
    const sourceIds = Array.isArray(input.outputSummary.sourceIds) ? input.outputSummary.sourceIds.filter((id): id is string => typeof id === "string") : [];
    await this.database.transaction(async (transaction) => {
      const run = await transaction.queryOne<{ id: string }>(`SELECT id FROM agent_runs WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3 AND status = 'running' FOR UPDATE`, [input.runId, input.workspaceId, input.currentUserId]);
      if (!run) return;
      await transaction.execute(`UPDATE agent_steps SET status = 'completed', output_json = $3::jsonb, resource_refs = $4::jsonb, completed_at = now() WHERE id = $1 AND run_id = $2 AND status = 'running'`, [input.stepId, input.runId, JSON.stringify(input.outputSummary), JSON.stringify(input.resourceRefs)]);
      const order = await transaction.queryOne<{ next_order: number | string }>(`SELECT COALESCE(MAX(step_order), 0) + 1 AS next_order FROM agent_steps WHERE run_id = $1`, [input.runId]);
      await transaction.execute(`INSERT INTO agent_steps (workspace_id, run_id, step_order, step_type, status, input_json, output_json, resource_refs) VALUES ($1, $2, $3, 'answer', 'pending', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)`, [input.workspaceId, input.runId, Number(order?.next_order ?? 1)]);
      await transaction.execute(`INSERT INTO agent_grounded_answer_outbox (run_id, workspace_id, source_ids) VALUES ($1, $2, $3::jsonb) ON CONFLICT (run_id) DO NOTHING`, [input.runId, input.workspaceId, JSON.stringify(sourceIds)]);
      await transaction.execute(`UPDATE agent_runs SET message = '회의록 근거를 바탕으로 답변을 생성하고 있습니다.' WHERE id = $1 AND status = 'running'`, [input.runId]);
    });
  }

  async getContext(runId: string): Promise<{ prompt: string; sources: MeetingTranscriptSource[] } | null> {
    const row = await this.database.queryOne<{ workspace_id: string; requested_by_user_id: string; prompt: string; source_ids: string[] }>(`SELECT run.workspace_id, run.requested_by_user_id, run.prompt, outbox.source_ids FROM agent_runs run JOIN agent_grounded_answer_outbox outbox ON outbox.run_id = run.id WHERE run.id = $1 AND run.status = 'running'`, [runId]);
    if (!row) return null;
    return { prompt: row.prompt, sources: await this.meetingTranscriptRagService.loadAuthorizedSources(row.requested_by_user_id, row.workspace_id, Array.isArray(row.source_ids) ? row.source_ids : []) };
  }

  async complete(runId: string, answer: string, citations: string[]): Promise<void> {
    const normalizedAnswer = answer.trim().slice(0, 8000);
    await this.database.transaction(async (transaction) => {
      const row = await transaction.queryOne<{ workspace_id: string; source_ids: string[] }>(`SELECT run.workspace_id, outbox.source_ids FROM agent_runs run JOIN agent_grounded_answer_outbox outbox ON outbox.run_id = run.id WHERE run.id = $1 AND run.status = 'running' FOR UPDATE`, [runId]);
      if (!row || !normalizedAnswer) return;
      const allowed = new Set(Array.isArray(row.source_ids) ? row.source_ids : []);
      if (citations.some((citation) => !allowed.has(citation))) {
        throw new Error("Grounded answer contains an unknown citation");
      }
      const safeCitations = [...new Set(citations.filter((citation) => allowed.has(citation)))];
      await transaction.execute(`UPDATE agent_steps SET status = 'completed', output_json = $3::jsonb, completed_at = now() WHERE run_id = $1 AND step_type = 'answer' AND status = 'pending'`, [runId, row.workspace_id, JSON.stringify({ citationIds: safeCitations, citationCount: safeCitations.length })]);
      await transaction.execute(`UPDATE agent_runs SET status = 'completed', final_answer = $2, message = '요청을 완료했습니다.', completed_at = now() WHERE id = $1 AND status = 'running'`, [runId, normalizedAnswer]);
    });
  }

  async completeWithoutSources(runId: string): Promise<void> {
    await this.complete(runId, "권한이 있는 회의록에서 질문과 관련된 발언을 찾지 못했습니다.", []);
  }
}
