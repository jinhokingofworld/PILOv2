import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_RESULTS = 5;
const DIRECT_REFERENCE_DISTANCE_BOOST = 0.08;
const SEMANTIC_DUPLICATE_DISTANCE = 0.12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MeetingTranscriptSearchInput { query: string; reportId?: string }
export type MeetingEvidenceSourceType = "transcript" | "activity";
export interface MeetingEvidenceSource {
  sourceId: string;
  sourceType: MeetingEvidenceSourceType;
  reportId: string;
  content: string;
  startedAtMs?: number;
  endedAtMs?: number;
  occurredAt?: string;
  action?: string;
  summary?: string;
  directlyReferenced: boolean;
}
export type MeetingTranscriptSource = MeetingEvidenceSource;

type CandidateSource = MeetingEvidenceSource & { distance: number };

@Injectable()
export class MeetingTranscriptRagService {
  constructor(private readonly database: DatabaseService, private readonly workspaceService: WorkspaceService) {}

  async search(currentUserId: string, workspaceId: string, input: MeetingTranscriptSearchInput): Promise<MeetingEvidenceSource[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const query = input.query.trim();
    if (!query || query.length > 1000 || (input.reportId && !UUID.test(input.reportId))) throw badRequest("Invalid Meeting evidence search input");
    const embedding = await this.embed(query);
    const vector = `[${embedding.join(",")}]`;
    const [transcriptRows, activityRows] = await Promise.all([
      this.database.query<{ id: string; meeting_report_id: string; started_at_ms: number; ended_at_ms: number; content: string; distance: number }>(`
        SELECT chunk.id, chunk.meeting_report_id, chunk.started_at_ms, chunk.ended_at_ms, chunk.content,
          chunk.embedding <=> $4::extensions.vector AS distance
        FROM meeting_report_transcript_chunks chunk
        JOIN meeting_reports report ON report.id = chunk.meeting_report_id
        JOIN meetings meeting ON meeting.id = report.meeting_id
        WHERE ${this.authorizedReportWhere("chunk.embedding IS NOT NULL")}
        ORDER BY chunk.embedding <=> $4::extensions.vector
        LIMIT $5
      `, [workspaceId, input.reportId ?? null, currentUserId, vector, MAX_RESULTS]),
      this.database.query<{ id: string; meeting_report_id: string; occurred_at: Date | string; action: string; summary: string; content: string; distance: number; directly_referenced: boolean }>(`
        SELECT chunk.id, chunk.meeting_report_id, chunk.occurred_at, chunk.action, chunk.summary, chunk.content,
          chunk.embedding <=> $4::extensions.vector AS distance,
          EXISTS (
            SELECT 1
            FROM meeting_report_activity_evidence_references reference
            WHERE reference.meeting_report_id = chunk.meeting_report_id
              AND reference.activity_evidence_id = chunk.activity_evidence_id
              AND reference.source_type IN ('decision', 'action_item')
          ) AS directly_referenced
        FROM meeting_report_activity_evidence_chunks chunk
        JOIN meeting_reports report ON report.id = chunk.meeting_report_id
        JOIN meetings meeting ON meeting.id = report.meeting_id
        WHERE ${this.authorizedReportWhere("chunk.embedding IS NOT NULL")}
        ORDER BY chunk.embedding <=> $4::extensions.vector
        LIMIT $5
      `, [workspaceId, input.reportId ?? null, currentUserId, vector, MAX_RESULTS])
    ]);
    const candidates: CandidateSource[] = [
      ...transcriptRows.map((row) => ({ sourceId: `transcript:${row.id}`, sourceType: "transcript" as const, reportId: row.meeting_report_id, startedAtMs: Number(row.started_at_ms), endedAtMs: Number(row.ended_at_ms), content: row.content.slice(0, 600), directlyReferenced: false, distance: Number(row.distance) })),
      ...activityRows.map((row) => ({ sourceId: `activity:${row.id}`, sourceType: "activity" as const, reportId: row.meeting_report_id, occurredAt: this.toIso(row.occurred_at), action: row.action, summary: row.summary.slice(0, 500), content: row.content.slice(0, 600), directlyReferenced: Boolean(row.directly_referenced), distance: Number(row.distance) }))
    ];
    const duplicatePairs = await this.findSemanticDuplicatePairs(
      transcriptRows.map((row) => row.id),
      activityRows.map((row) => row.id)
    );
    return this.selectSources(candidates, duplicatePairs);
  }

  async loadAuthorizedSources(currentUserId: string, workspaceId: string, sourceIds: string[]): Promise<MeetingEvidenceSource[]> {
    if (sourceIds.length === 0) return [];
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const parsed = sourceIds.flatMap((sourceId) => this.parseSourceId(sourceId));
    const transcriptIds = parsed.filter((source) => source.type === "transcript").map((source) => source.id);
    const activityIds = parsed.filter((source) => source.type === "activity").map((source) => source.id);
    const [transcriptRows, activityRows] = await Promise.all([
      transcriptIds.length === 0 ? Promise.resolve([]) : this.database.query<{ id: string; meeting_report_id: string; started_at_ms: number; ended_at_ms: number; content: string }>(`
        SELECT chunk.id, chunk.meeting_report_id, chunk.started_at_ms, chunk.ended_at_ms, chunk.content
        FROM meeting_report_transcript_chunks chunk
        JOIN meeting_reports report ON report.id = chunk.meeting_report_id
        JOIN meetings meeting ON meeting.id = report.meeting_id
        WHERE chunk.id = ANY($4::uuid[]) AND ${this.authorizedReportWhere("true")}
      `, [workspaceId, null, currentUserId, transcriptIds]),
      activityIds.length === 0 ? Promise.resolve([]) : this.database.query<{ id: string; meeting_report_id: string; occurred_at: Date | string; action: string; summary: string; content: string; directly_referenced: boolean }>(`
        SELECT chunk.id, chunk.meeting_report_id, chunk.occurred_at, chunk.action, chunk.summary, chunk.content,
          EXISTS (
            SELECT 1 FROM meeting_report_activity_evidence_references reference
            WHERE reference.meeting_report_id = chunk.meeting_report_id
              AND reference.activity_evidence_id = chunk.activity_evidence_id
              AND reference.source_type IN ('decision', 'action_item')
          ) AS directly_referenced
        FROM meeting_report_activity_evidence_chunks chunk
        JOIN meeting_reports report ON report.id = chunk.meeting_report_id
        JOIN meetings meeting ON meeting.id = report.meeting_id
        WHERE chunk.id = ANY($4::uuid[]) AND ${this.authorizedReportWhere("true")}
      `, [workspaceId, null, currentUserId, activityIds])
    ]);
    const bySourceId = new Map<string, MeetingEvidenceSource>();
    for (const row of transcriptRows) {
      bySourceId.set(`transcript:${row.id}`, { sourceId: `transcript:${row.id}`, sourceType: "transcript", reportId: row.meeting_report_id, startedAtMs: Number(row.started_at_ms), endedAtMs: Number(row.ended_at_ms), content: row.content.slice(0, 600), directlyReferenced: false });
    }
    for (const row of activityRows) {
      bySourceId.set(`activity:${row.id}`, { sourceId: `activity:${row.id}`, sourceType: "activity", reportId: row.meeting_report_id, occurredAt: this.toIso(row.occurred_at), action: row.action, summary: row.summary.slice(0, 500), content: row.content.slice(0, 600), directlyReferenced: Boolean(row.directly_referenced) });
    }
    return sourceIds.flatMap((sourceId) => {
      const normalized = this.normalizeSourceId(sourceId);
      const source = normalized ? bySourceId.get(normalized) : undefined;
      return source ? [source] : [];
    });
  }

  normalizeSourceIds(sourceIds: string[]): string[] {
    return [...new Set(sourceIds.flatMap((sourceId) => {
      const normalized = this.normalizeSourceId(sourceId);
      return normalized ? [normalized] : [];
    }))];
  }

  private authorizedReportWhere(indexedCondition: string): string {
    return `meeting.workspace_id = $1::uuid
      AND ($2::uuid IS NULL OR report.id = $2::uuid)
      AND ${indexedCondition}
      AND (
        EXISTS (SELECT 1 FROM workspace_members member WHERE member.workspace_id = meeting.workspace_id AND member.user_id = $3::uuid AND member.role = 'owner')
        OR EXISTS (SELECT 1 FROM meeting_participants participant WHERE participant.meeting_id = meeting.id AND participant.user_id = $3::uuid)
      )`;
  }

  private parseSourceId(sourceId: string): Array<{ type: MeetingEvidenceSourceType; id: string }> {
    const normalized = this.normalizeSourceId(sourceId);
    if (!normalized) return [];
    const [type, id] = normalized.split(":", 2) as [MeetingEvidenceSourceType, string];
    return [{ type, id }];
  }

  private normalizeSourceId(sourceId: string): string | null {
    if (UUID.test(sourceId)) return `transcript:${sourceId}`;
    const match = /^(transcript|activity):([0-9a-f-]+)$/i.exec(sourceId);
    if (!match || !UUID.test(match[2])) return null;
    return `${match[1].toLowerCase()}:${match[2]}`;
  }

  private toIso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

  private async findSemanticDuplicatePairs(transcriptIds: string[], activityIds: string[]): Promise<Array<{ transcriptId: string; activityId: string }>> {
    if (transcriptIds.length === 0 || activityIds.length === 0) return [];
    const rows = await this.database.query<{ transcript_id: string; activity_id: string }>(`
      SELECT transcript.id AS transcript_id, activity.id AS activity_id
      FROM meeting_report_transcript_chunks transcript
      JOIN meeting_report_activity_evidence_chunks activity
        ON activity.meeting_report_id = transcript.meeting_report_id
      WHERE transcript.id = ANY($1::uuid[])
        AND activity.id = ANY($2::uuid[])
        AND transcript.embedding IS NOT NULL
        AND activity.embedding IS NOT NULL
        AND transcript.embedding <=> activity.embedding <= $3
    `, [transcriptIds, activityIds, SEMANTIC_DUPLICATE_DISTANCE]);
    return rows.map((row) => ({ transcriptId: row.transcript_id, activityId: row.activity_id }));
  }

  private selectSources(candidates: CandidateSource[], duplicatePairs: Array<{ transcriptId: string; activityId: string }>): MeetingEvidenceSource[] {
    const parent = new Map(candidates.map((candidate) => [candidate.sourceId, candidate.sourceId]));
    const find = (sourceId: string): string => {
      const root = parent.get(sourceId);
      if (!root || root === sourceId) return sourceId;
      const resolved = find(root);
      parent.set(sourceId, resolved);
      return resolved;
    };
    const union = (left: string, right: string) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };
    for (const pair of duplicatePairs) {
      const transcriptSourceId = `transcript:${pair.transcriptId}`;
      const activitySourceId = `activity:${pair.activityId}`;
      if (parent.has(transcriptSourceId) && parent.has(activitySourceId)) union(transcriptSourceId, activitySourceId);
    }

    const groups = new Map<string, CandidateSource[]>();
    for (const candidate of candidates) {
      const group = groups.get(find(candidate.sourceId)) ?? [];
      group.push(candidate);
      groups.set(find(candidate.sourceId), group);
    }
    const compare = (left: CandidateSource, right: CandidateSource) => {
      const relevanceDifference = this.relevanceScore(left) - this.relevanceScore(right);
      return relevanceDifference || left.distance - right.distance || left.sourceId.localeCompare(right.sourceId);
    };
    const representatives = [...groups.values()].flatMap((group) =>
      (["transcript", "activity"] as const).flatMap((sourceType) => {
        const candidatesForType = group.filter((candidate) => candidate.sourceType === sourceType).sort(compare);
        return candidatesForType.length === 0 ? [] : [candidatesForType[0]];
      })
    );
    const selected: CandidateSource[] = [];
    for (const sourceType of ["transcript", "activity"] as const) {
      const bestForType = representatives.filter((candidate) => candidate.sourceType === sourceType).sort(compare)[0];
      if (bestForType) selected.push(bestForType);
    }
    const selectedIds = new Set(selected.map((candidate) => candidate.sourceId));
    for (const candidate of representatives.sort(compare)) {
      if (selected.length === MAX_RESULTS) break;
      if (!selectedIds.has(candidate.sourceId)) {
        selected.push(candidate);
        selectedIds.add(candidate.sourceId);
      }
    }
    return selected.map(({ distance: _distance, ...source }) => source);
  }

  private relevanceScore(candidate: CandidateSource): number {
    return candidate.distance - (candidate.directlyReferenced ? DIRECT_REFERENCE_DISTANCE_BOOST : 0);
  }

  private async embed(query: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const response = await fetch(OPENAI_EMBEDDINGS_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBEDDING_MODEL, input: query, dimensions: 1536, encoding_format: "float" }) });
    const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = payload.data?.[0]?.embedding;
    if (!response.ok || !Array.isArray(vector) || vector.length !== 1536 || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Meeting evidence query embedding failed");
    return vector;
  }
}
