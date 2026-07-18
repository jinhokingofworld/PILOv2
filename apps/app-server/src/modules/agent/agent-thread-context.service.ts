import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import type {
  AgentJsonObject,
  AgentToolContext
} from "./types/agent-tool.types";

const CONTEXT_REF_PATTERN = /^ctx_[0-9a-f]{24}$/;
const THREAD_CONTEXT_MAX_RUNS = 6;
const THREAD_CONTEXT_MAX_RESOURCE_REFS = 12;
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
    if (!CONTEXT_REF_PATTERN.test(contextRef)) return null;
    const rows = await this.database.query<ThreadResourceStepRow>(
      `
        WITH current_run AS (
          SELECT thread_id
          FROM agent_runs
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
            AND thread_id IS NOT NULL
        ), recent_runs AS (
          SELECT prior_run.id, prior_run.created_at, current_run.thread_id
          FROM agent_runs AS prior_run
          INNER JOIN current_run
            ON current_run.thread_id = prior_run.thread_id
          WHERE prior_run.id <> $1
            AND prior_run.workspace_id = $2
            AND prior_run.requested_by_user_id = $3
            AND prior_run.status = 'completed'
            AND prior_run.final_answer IS NOT NULL
          ORDER BY prior_run.created_at DESC, prior_run.id DESC
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
          step.step_order ASC,
          step.id ASC
      `,
      [
        context.runId,
        context.workspaceId,
        context.currentUserId,
        THREAD_CONTEXT_MAX_RUNS
      ]
    );

    let acceptedRefs = 0;
    let resolved: AgentThreadMeetingReference | null = null;
    for (const row of rows) {
      if (!Array.isArray(row.resource_refs)) continue;
      for (const [index, candidate] of row.resource_refs.entries()) {
        if (acceptedRefs >= THREAD_CONTEXT_MAX_RESOURCE_REFS) return resolved;
        const reference = this.readMeetingReference(candidate);
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
