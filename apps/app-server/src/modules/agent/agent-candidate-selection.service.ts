import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import type { AgentToolContext } from "./types/agent-tool.types";
import {
  type MeetingAgentResourceCandidate,
  type MeetingAgentResourceReference,
  type MeetingAgentResourceType,
  MeetingAgentResourceResolver
} from "./tools/meeting-agent-resource-resolver.service";

const CANDIDATE_TTL_MINUTES = 15;

interface CandidateRow extends QueryResultRow {
  id: string;
  resource_type: MeetingAgentResourceType;
  resource_id: string;
  report_id: string | null;
  label: string;
  description: string | null;
  status: string | null;
}

export interface AgentCandidateSelection {
  candidateSelectionId: string;
  resourceType: MeetingAgentResourceType;
  label: string;
  description: string | null;
  status: string | null;
}

@Injectable()
export class AgentCandidateSelectionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly meetingAgentResourceResolver: MeetingAgentResourceResolver
  ) {}

  async createMeetingCandidates(
    context: AgentToolContext,
    candidates: Array<{
      reference: MeetingAgentResourceReference;
      candidate: MeetingAgentResourceCandidate;
    }>
  ): Promise<AgentCandidateSelection[]> {
    return Promise.all(
      candidates.map(async ({ reference, candidate }) => {
        const row = await this.database.queryOne<CandidateRow>(
          `
            INSERT INTO agent_candidate_selections (
              workspace_id, requested_by_user_id, run_id,
              resource_type, resource_id, report_id,
              label, description, status, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + INTERVAL '${CANDIDATE_TTL_MINUTES} minutes')
            RETURNING id, resource_type, resource_id, report_id, label, description, status
          `,
          [
            context.workspaceId,
            context.currentUserId,
            context.runId,
            reference.resourceType,
            reference.resourceId,
            reference.reportId ?? null,
            candidate.label,
            candidate.description,
            candidate.status
          ]
        );
        if (!row) throw new Error("Agent candidate selection could not be stored");
        return this.toPublicCandidate(row);
      })
    );
  }

  async consumeMeetingCandidate(
    context: AgentToolContext,
    candidateSelectionId: string
  ): Promise<{ label: string; reference: MeetingAgentResourceReference }> {
    return this.database.transaction((transaction) =>
      this.consumeMeetingCandidateInTransaction(
        transaction,
        context,
        candidateSelectionId
      )
    );
  }

  async consumeMeetingCandidateInTransaction(
    transaction: DatabaseTransaction,
    context: AgentToolContext,
    candidateSelectionId: string
  ): Promise<{ label: string; reference: MeetingAgentResourceReference }> {
      const candidate = await transaction.queryOne<CandidateRow>(
        `
          SELECT id, resource_type, resource_id, report_id, label, description, status
          FROM agent_candidate_selections
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
            AND run_id = $4
            AND consumed_at IS NULL
            AND expires_at > now()
          FOR UPDATE
        `,
        [candidateSelectionId, context.workspaceId, context.currentUserId, context.runId]
      );
      if (!candidate) {
        throw badRequest("Meeting candidate selection is invalid, expired, or already used");
      }
      const reference = this.toReference(candidate);
      const revalidated = await this.meetingAgentResourceResolver.revalidateReference(
        context,
        reference
      );
      if (!revalidated) {
        throw badRequest("Meeting candidate is no longer available");
      }
      const consumed = await transaction.queryOne<{ id: string }>(
        `UPDATE agent_candidate_selections SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
        [candidate.id]
      );
      if (!consumed) throw badRequest("Meeting candidate selection was already used");
      return { label: candidate.label, reference: revalidated };
  }

  private toPublicCandidate(row: CandidateRow): AgentCandidateSelection {
    return {
      candidateSelectionId: row.id,
      resourceType: row.resource_type,
      label: row.label,
      description: row.description,
      status: row.status
    };
  }

  private toReference(row: CandidateRow): MeetingAgentResourceReference {
    return {
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ...(row.report_id ? { reportId: row.report_id } : {})
    };
  }
}
