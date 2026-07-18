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
  tool_step_id: string;
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
    toolStepId: string,
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
              tool_step_id,
              resource_type, resource_id, report_id,
              label, description, status, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + INTERVAL '${CANDIDATE_TTL_MINUTES} minutes')
            RETURNING id, tool_step_id, resource_type, resource_id, report_id, label, description, status
          `,
          [
            context.workspaceId,
            context.currentUserId,
            context.runId,
            toolStepId,
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
          SELECT id, tool_step_id, resource_type, resource_id, report_id, label, description, status
          FROM agent_candidate_selections
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
            AND run_id = $4
            AND tool_step_id = (
              SELECT step.id
              FROM agent_steps AS step
              WHERE step.run_id = $4
                AND step.step_type = 'tool'
                AND step.status = 'completed'
              ORDER BY step.step_order DESC
              LIMIT 1
            )
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

  async getLatestConsumedMeetingReference(
    context: AgentToolContext,
    resourceType: MeetingAgentResourceType
  ): Promise<MeetingAgentResourceReference | null> {
    const row = await this.database.queryOne<CandidateRow>(
      `
        SELECT id, tool_step_id, resource_type, resource_id, report_id, label, description, status
        FROM agent_candidate_selections
        WHERE workspace_id = $1
          AND requested_by_user_id = $2
          AND run_id = $3
          AND resource_type = $4
          AND consumed_at IS NOT NULL
          AND expires_at > now()
        ORDER BY consumed_at DESC
        LIMIT 1
      `,
      [context.workspaceId, context.currentUserId, context.runId, resourceType]
    );
    if (!row) return null;
    return this.meetingAgentResourceResolver.revalidateReference(
      context,
      this.toReference(row)
    );
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
