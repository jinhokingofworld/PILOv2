import { HttpException, Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { SqlErdService } from "../sql-erd/sql-erd.service";
import type { AgentToolContext } from "./types/agent-tool.types";
import {
  type MeetingAgentResourceCandidate,
  type MeetingAgentResourceReference,
  type MeetingAgentResourceType,
  MeetingAgentResourceResolver
} from "./tools/meeting-agent-resource-resolver.service";

const CANDIDATE_TTL_MINUTES = 15;
const MEETING_RESOURCE_TYPES = new Set<MeetingAgentResourceType>([
  "meeting_room",
  "meeting",
  "meeting_report",
  "workspace_member",
  "meeting_report_action_item"
]);

interface CandidateRow extends QueryResultRow {
  id: string;
  tool_step_id: string;
  domain: string;
  resource_type: string;
  resource_id: string;
  report_id: string | null;
  candidate_ordinal: number | null;
  label: string;
  description: string | null;
  status: string | null;
}

export interface AgentCandidateSelection {
  candidateSelectionId: string;
  resourceType: string;
  label: string;
  description: string | null;
  status: string | null;
}

export interface AgentCandidateResourceReference {
  domain: string;
  resourceType: string;
  resourceId: string;
  reportId?: string;
}

export interface AgentCandidateResource {
  reference: AgentCandidateResourceReference;
  candidate: {
    label: string;
    description: string | null;
    status: string | null;
  };
}

@Injectable()
export class AgentCandidateSelectionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly meetingAgentResourceResolver: MeetingAgentResourceResolver,
    private readonly sqlErdService?: SqlErdService
  ) {}

  async createCandidates(
    context: AgentToolContext,
    toolStepId: string,
    candidates: AgentCandidateResource[]
  ): Promise<AgentCandidateSelection[]> {
    return Promise.all(
      candidates.map(async ({ reference, candidate }, index) => {
        const row = await this.database.queryOne<CandidateRow>(
          `
            INSERT INTO agent_candidate_selections (
              workspace_id, requested_by_user_id, run_id,
              tool_step_id, domain, candidate_ordinal,
              resource_type, resource_id, report_id,
              label, description, status, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + INTERVAL '${CANDIDATE_TTL_MINUTES} minutes')
            RETURNING id, tool_step_id, domain, candidate_ordinal, resource_type, resource_id, report_id, label, description, status
          `,
          [
            context.workspaceId,
            context.currentUserId,
            context.runId,
            toolStepId,
            reference.domain,
            index + 1,
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

  async createMeetingCandidates(
    context: AgentToolContext,
    toolStepId: string,
    candidates: Array<{
      reference: MeetingAgentResourceReference;
      candidate: MeetingAgentResourceCandidate;
    }>
  ): Promise<AgentCandidateSelection[]> {
    return this.createCandidates(
      context,
      toolStepId,
      candidates.map(({ reference, candidate }) => ({
        reference: {
          domain: "meeting",
          resourceType: reference.resourceType,
          resourceId: reference.resourceId,
          ...(reference.reportId ? { reportId: reference.reportId } : {})
        },
        candidate: {
          label: candidate.label,
          description: candidate.description,
          status: candidate.status
        }
      }))
    );
  }

  async getLatestCandidateSelectionIdByOrdinalInTransaction(
    transaction: DatabaseTransaction,
    context: AgentToolContext,
    ordinal: number
  ): Promise<string | null> {
    const row = await transaction.queryOne<{ id: string }>(
      `
        SELECT candidate.id
        FROM agent_candidate_selections AS candidate
        WHERE candidate.workspace_id = $1
          AND candidate.requested_by_user_id = $2
          AND candidate.run_id = $3
          AND candidate.tool_step_id = (
            SELECT step.id
            FROM agent_steps AS step
            WHERE step.run_id = $3
              AND step.step_type = 'tool'
              AND step.status = 'completed'
            ORDER BY step.step_order DESC
            LIMIT 1
          )
          AND candidate.candidate_ordinal = $4
          AND candidate.consumed_at IS NULL
          AND candidate.expires_at > now()
      `,
      [context.workspaceId, context.currentUserId, context.runId, ordinal]
    );
    return row?.id ?? null;
  }

  async consumeCandidateInTransaction(
    transaction: DatabaseTransaction,
    context: AgentToolContext,
    candidateSelectionId: string
  ): Promise<{ label: string; reference: AgentCandidateResourceReference }> {
    const candidate = await transaction.queryOne<CandidateRow>(
      `
        SELECT id, tool_step_id, domain, candidate_ordinal, resource_type, resource_id, report_id, label, description, status
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
      throw badRequest("Agent candidate selection is invalid, expired, or already used");
    }
    const reference = await this.revalidateReference(context, candidate);
    if (!reference) {
      throw badRequest("Agent candidate is no longer available");
    }
    const consumed = await transaction.queryOne<{ id: string }>(
      `UPDATE agent_candidate_selections SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [candidate.id]
    );
    if (!consumed) throw badRequest("Agent candidate selection was already used");
    return { label: candidate.label, reference };
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
    const selected = await this.consumeCandidateInTransaction(
      transaction,
      context,
      candidateSelectionId
    );
    if (selected.reference.domain !== "meeting") {
      throw badRequest("Meeting candidate selection has an invalid domain");
    }
    return {
      label: selected.label,
      reference: this.toMeetingReference(selected.reference)
    };
  }

  async getLatestConsumedMeetingReference(
    context: AgentToolContext,
    resourceType: MeetingAgentResourceType
  ): Promise<MeetingAgentResourceReference | null> {
    const row = await this.database.queryOne<CandidateRow>(
      `
        SELECT id, tool_step_id, domain, candidate_ordinal, resource_type, resource_id, report_id, label, description, status
        FROM agent_candidate_selections
        WHERE workspace_id = $1
          AND requested_by_user_id = $2
          AND run_id = $3
          AND domain = 'meeting'
          AND resource_type = $4
          AND consumed_at IS NOT NULL
          AND expires_at > now()
        ORDER BY consumed_at DESC
        LIMIT 1
      `,
      [context.workspaceId, context.currentUserId, context.runId, resourceType]
    );
    if (!row) return null;
    const reference = await this.revalidateReference(context, row);
    return reference?.domain === "meeting"
      ? this.toMeetingReference(reference)
      : null;
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

  private async revalidateReference(
    context: AgentToolContext,
    row: CandidateRow
  ): Promise<AgentCandidateResourceReference | null> {
    if (row.domain === "meeting") {
      if (!MEETING_RESOURCE_TYPES.has(row.resource_type as MeetingAgentResourceType)) {
        return null;
      }
      const reference = await this.meetingAgentResourceResolver.revalidateReference(
        context,
        {
          resourceType: row.resource_type as MeetingAgentResourceType,
          resourceId: row.resource_id,
          ...(row.report_id ? { reportId: row.report_id } : {})
        }
      );
      return reference
        ? {
            domain: "meeting",
            resourceType: reference.resourceType,
            resourceId: reference.resourceId,
            ...(reference.reportId ? { reportId: reference.reportId } : {})
          }
        : null;
    }
    if (row.domain === "sqltoerd" && row.resource_type === "session") {
      if (!this.sqlErdService) return null;
      try {
        await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          row.resource_id
        );
        return {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: row.resource_id
        };
      } catch (error) {
        if (
          error instanceof HttpException &&
          (error.getStatus() === 403 || error.getStatus() === 404)
        ) {
          return null;
        }
        throw error;
      }
    }
    return null;
  }

  private toMeetingReference(
    reference: AgentCandidateResourceReference
  ): MeetingAgentResourceReference {
    if (!MEETING_RESOURCE_TYPES.has(reference.resourceType as MeetingAgentResourceType)) {
      throw badRequest("Meeting candidate resource type is invalid");
    }
    return {
      resourceType: reference.resourceType as MeetingAgentResourceType,
      resourceId: reference.resourceId,
      ...(reference.reportId ? { reportId: reference.reportId } : {})
    };
  }
}
