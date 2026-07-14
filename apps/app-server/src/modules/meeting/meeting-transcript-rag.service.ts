import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_RESULTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MeetingTranscriptSearchInput { query: string; reportId?: string }
export interface MeetingTranscriptSource { sourceId: string; reportId: string; startedAtMs: number; endedAtMs: number; content: string }

@Injectable()
export class MeetingTranscriptRagService {
  constructor(private readonly database: DatabaseService, private readonly workspaceService: WorkspaceService) {}

  async search(currentUserId: string, workspaceId: string, input: MeetingTranscriptSearchInput): Promise<MeetingTranscriptSource[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const query = input.query.trim();
    if (!query || query.length > 1000 || (input.reportId && !UUID.test(input.reportId))) throw badRequest("Invalid Meeting transcript search input");
    const embedding = await this.embed(query);
    const rows = await this.database.query<{
      id: string; meeting_report_id: string; started_at_ms: number; ended_at_ms: number; content: string;
    }>(`
      SELECT chunk.id, chunk.meeting_report_id, chunk.started_at_ms, chunk.ended_at_ms, chunk.content
      FROM meeting_report_transcript_chunks chunk
      JOIN meeting_reports report ON report.id = chunk.meeting_report_id
      JOIN meetings meeting ON meeting.id = report.meeting_id
      WHERE meeting.workspace_id = $1::uuid
        AND ($2::uuid IS NULL OR report.id = $2::uuid)
        AND chunk.embedding IS NOT NULL
        AND (
          EXISTS (SELECT 1 FROM workspace_members member WHERE member.workspace_id = meeting.workspace_id AND member.user_id = $3::uuid AND member.role = 'owner')
          OR EXISTS (SELECT 1 FROM meeting_participants participant WHERE participant.meeting_id = meeting.id AND participant.user_id = $3::uuid)
        )
      ORDER BY chunk.embedding <=> $4::extensions.vector
      LIMIT $5
    `, [workspaceId, input.reportId ?? null, currentUserId, `[${embedding.join(",")}]`, MAX_RESULTS]);
    return rows.map((row) => ({ sourceId: row.id, reportId: row.meeting_report_id, startedAtMs: Number(row.started_at_ms), endedAtMs: Number(row.ended_at_ms), content: row.content.slice(0, 600) }));
  }

  async loadAuthorizedSources(currentUserId: string, workspaceId: string, sourceIds: string[]): Promise<MeetingTranscriptSource[]> {
    if (sourceIds.length === 0) return [];
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const rows = await this.database.query<{ id: string; meeting_report_id: string; started_at_ms: number; ended_at_ms: number; content: string }>(`
      SELECT chunk.id, chunk.meeting_report_id, chunk.started_at_ms, chunk.ended_at_ms, chunk.content
      FROM meeting_report_transcript_chunks chunk
      JOIN meeting_reports report ON report.id = chunk.meeting_report_id
      JOIN meetings meeting ON meeting.id = report.meeting_id
      WHERE meeting.workspace_id = $1::uuid AND chunk.id = ANY($2::uuid[])
        AND (
          EXISTS (SELECT 1 FROM workspace_members member WHERE member.workspace_id = meeting.workspace_id AND member.user_id = $3::uuid AND member.role = 'owner')
          OR EXISTS (SELECT 1 FROM meeting_participants participant WHERE participant.meeting_id = meeting.id AND participant.user_id = $3::uuid)
        )
    `, [workspaceId, sourceIds, currentUserId]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return sourceIds.flatMap((id) => { const row = byId.get(id); return row ? [{ sourceId: row.id, reportId: row.meeting_report_id, startedAtMs: Number(row.started_at_ms), endedAtMs: Number(row.ended_at_ms), content: row.content.slice(0, 600) }] : []; });
  }

  private async embed(query: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const response = await fetch(OPENAI_EMBEDDINGS_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }) });
    const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = payload.data?.[0]?.embedding;
    if (!response.ok || !Array.isArray(vector) || vector.length !== 1536 || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Meeting transcript query embedding failed");
    return vector;
  }
}
