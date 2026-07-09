import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  AgentLoggingService,
  AgentRunPayload as StoredAgentRunPayload,
  AgentRunStatus,
  AgentStepPayload as StoredAgentStepPayload
} from "./agent-logging.service";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentResourceRef,
  AgentRiskLevel
} from "./types/agent-tool.types";

export interface AgentRunListQuery {
  status?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface AgentRunCreateInput {
  prompt: string;
  timezone?: string;
  clientRequestId?: string | null;
}

export interface AgentRunApiPayload {
  id: string;
  workspaceId: string;
  requestedByUserId: string | null;
  clientRequestId: string | null;
  status: AgentRunStatus;
  riskLevel: AgentRiskLevel | null;
  prompt: string;
  timezone: string;
  message: string | null;
  finalAnswer: string | null;
  errorMessage: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentStepApiPayload {
  id: string;
  runId: string;
  order: number;
  type: StoredAgentStepPayload["type"];
  status: StoredAgentStepPayload["status"];
  toolName: string | null;
  riskLevel: AgentRiskLevel | null;
  inputSummary: AgentJsonObject;
  outputSummary: AgentJsonObject;
  resourceRefs: AgentResourceRef[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentConfirmationSummaryPayload {
  id: string;
  status: AgentConfirmationStatus;
  riskLevel: AgentRiskLevel;
  expiresAt: string;
}

export interface AgentConfirmationApiPayload
  extends AgentConfirmationSummaryPayload {
  runId: string;
  plan: AgentConfirmationPlan;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunListItemPayload extends AgentRunApiPayload {
  confirmation: AgentConfirmationSummaryPayload | null;
}

export interface AgentRunDetailItemPayload extends AgentRunApiPayload {
  steps: AgentStepApiPayload[];
  confirmation: AgentConfirmationApiPayload | null;
}

export interface AgentRunListPayload {
  runs: AgentRunListItemPayload[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface AgentRunDetailPayload {
  run: AgentRunDetailItemPayload;
}

export type AgentRunCreatePayload = AgentRunDetailPayload;

interface AgentRunCreateResult {
  run: AgentRunDetailItemPayload;
  created: boolean;
}

interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

type AgentConfirmationStatus = "pending" | "approved" | "rejected" | "expired";

interface AgentRunRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  requested_by_user_id: string | null;
  client_request_id: string | null;
  status: AgentRunStatus;
  risk_level: AgentRiskLevel | null;
  prompt: string;
  timezone: string;
  message: string | null;
  final_answer: string | null;
  error_message: string | null;
  expires_at: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentStepRow extends QueryResultRow {
  id: string;
  run_id: string;
  step_order: number;
  step_type: StoredAgentStepPayload["type"];
  status: StoredAgentStepPayload["status"];
  tool_name: string | null;
  risk_level: AgentRiskLevel | null;
  input_json: AgentJsonObject;
  output_json: AgentJsonObject;
  resource_refs: AgentResourceRef[];
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface AgentConfirmationRow extends QueryResultRow {
  id: string;
  run_id: string;
  status: AgentConfirmationStatus;
  risk_level: AgentRiskLevel;
  plan_json: AgentConfirmationPlan;
  expires_at: Date | string;
  approved_at: Date | string | null;
  rejected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentRunWithConfirmationRow extends AgentRunRow {
  confirmation_id: string | null;
  confirmation_status: AgentConfirmationStatus | null;
  confirmation_risk_level: AgentRiskLevel | null;
  confirmation_expires_at: Date | string | null;
}

const DEFAULT_TIMEZONE = "Asia/Seoul";
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_PROMPT_BYTES = 32768;
const MAX_CLIENT_REQUEST_ID_BYTES = 128;
const MAX_TIMEZONE_LENGTH = 64;
const AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "planning",
  "waiting_confirmation",
  "running",
  "completed",
  "failed",
  "cancelled"
];
const FORBIDDEN_BODY_FIELDS = [
  "workspaceId",
  "userId",
  "createdBy",
  "requestedByUserId"
];
const FORBIDDEN_JSON_KEY_PARTS = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "providerraw",
  "rawresponse",
  "secret",
  "token",
  "transcript",
  "transcripttext"
];

@Injectable()
export class AgentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService
  ) {}

  async createRun(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<AgentRunCreateResult> {
    const input = this.normalizeCreateRunInput(body);
    const result = await this.agentLoggingService.createRun(
      currentUserId,
      workspaceId,
      input
    );

    return {
      run: {
        ...this.mapStoredRun(result.run),
        steps: [],
        confirmation: null
      },
      created: result.created
    };
  }

  async listRuns(
    currentUserId: string,
    workspaceId: string,
    query: AgentRunListQuery
  ): Promise<AgentRunListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const status = this.normalizeOptionalStatus(query.status);
    const pagination = this.normalizePagination(query);
    const countRow = await this.database.queryOne<{ total: string | number }>(
      `
        SELECT COUNT(*) AS total
        FROM agent_runs
        WHERE workspace_id = $1
          AND requested_by_user_id = $2
          AND expires_at > now()
          AND ($3::text IS NULL OR status = $3)
      `,
      [workspaceId, currentUserId, status]
    );
    const rows = await this.database.query<AgentRunWithConfirmationRow>(
      `
        SELECT
          r.*,
          c.id AS confirmation_id,
          c.status AS confirmation_status,
          c.risk_level AS confirmation_risk_level,
          c.expires_at AS confirmation_expires_at
        FROM agent_runs r
        LEFT JOIN LATERAL (
          SELECT id, status, risk_level, expires_at, created_at
          FROM agent_confirmations
          WHERE run_id = r.id
          ORDER BY
            CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 1
        ) c ON true
        WHERE r.workspace_id = $1
          AND r.requested_by_user_id = $2
          AND r.expires_at > now()
          AND ($3::text IS NULL OR r.status = $3)
        ORDER BY r.created_at DESC
        LIMIT $4 OFFSET $5
      `,
      [workspaceId, currentUserId, status, pagination.limit, pagination.offset]
    );

    return {
      runs: rows.map((row) => this.mapRunListItem(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: Number(countRow?.total ?? 0)
      }
    };
  }

  async getRun(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<AgentRunDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const run = await this.database.queryOne<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND requested_by_user_id = $3
      `,
      [runId, workspaceId, currentUserId]
    );

    if (!run) {
      throw notFound("Agent run not found");
    }

    const [steps, confirmation] = await Promise.all([
      this.database.query<AgentStepRow>(
        `
          SELECT *
          FROM agent_steps
          WHERE run_id = $1
          ORDER BY step_order ASC
        `,
        [runId]
      ),
      this.database.queryOne<AgentConfirmationRow>(
        `
          SELECT *
          FROM agent_confirmations
          WHERE run_id = $1
          ORDER BY
            CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 1
        `,
        [runId]
      )
    ]);

    return {
      run: {
        ...this.mapRun(run),
        steps: steps.map((step) => this.mapStep(step)),
        confirmation: confirmation
          ? this.mapConfirmation(confirmation)
          : null
      }
    };
  }

  private normalizeCreateRunInput(body: unknown): AgentRunCreateInput {
    if (!this.isPlainObject(body)) {
      throw badRequest("Request body must be an object");
    }

    for (const field of FORBIDDEN_BODY_FIELDS) {
      if (field in body) {
        throw badRequest(`${field} must not be provided`);
      }
    }

    return {
      prompt: this.readRequiredText(body.prompt, "prompt", MAX_PROMPT_BYTES),
      timezone: this.readTimezone(body.timezone),
      clientRequestId: this.readOptionalText(
        body.clientRequestId,
        "clientRequestId",
        MAX_CLIENT_REQUEST_ID_BYTES
      )
    };
  }

  private normalizePagination(query: AgentRunListQuery): NormalizedPagination {
    const page = this.readPositiveInteger(query.page, "page", 1);
    const limit = this.readPositiveInteger(
      query.limit,
      "limit",
      DEFAULT_PAGE_LIMIT
    );

    if (limit > MAX_PAGE_LIMIT) {
      throw badRequest(`limit must be ${MAX_PAGE_LIMIT} or less`);
    }

    return {
      page,
      limit,
      offset: (page - 1) * limit
    };
  }

  private normalizeOptionalStatus(value: unknown): AgentRunStatus | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest("status must be a valid Agent run status");
    }

    const status = value.trim();
    if (this.isAgentRunStatus(status)) {
      return status;
    }

    throw badRequest("status must be a valid Agent run status");
  }

  private readRequiredText(
    value: unknown,
    field: string,
    maxBytes: number
  ): string {
    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} is required`);
    }

    const normalized = value.trim();
    if (!normalized) {
      throw badRequest(`${field} is required`);
    }

    if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
      throw badRequest(`${field} is too long`);
    }

    return normalized;
  }

  private readOptionalText(
    value: unknown,
    field: string,
    maxBytes: number
  ): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
      throw badRequest(`${field} is too long`);
    }

    return normalized;
  }

  private readTimezone(value: unknown): string {
    if (value === undefined || value === null) {
      return DEFAULT_TIMEZONE;
    }

    const timezone = this.readRequiredText(
      value,
      "timezone",
      MAX_TIMEZONE_LENGTH
    );
    this.assertIanaTimezone(timezone);
    return timezone;
  }

  private assertIanaTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
      throw badRequest("timezone must be a valid IANA timezone");
    }
  }

  private readPositiveInteger(
    value: unknown,
    field: string,
    defaultValue: number
  ): number {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (Array.isArray(value)) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const raw = typeof value === "number" ? String(value) : value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(`${field} must be a positive integer`);
    }

    return parsed;
  }

  private mapRunListItem(
    row: AgentRunWithConfirmationRow
  ): AgentRunListItemPayload {
    return {
      ...this.mapRun(row),
      confirmation: row.confirmation_id
        ? {
            id: row.confirmation_id,
            status: row.confirmation_status ?? "pending",
            riskLevel: row.confirmation_risk_level ?? "medium",
            expiresAt: this.toIso(row.confirmation_expires_at ?? row.expires_at)
          }
        : null
    };
  }

  private mapStoredRun(run: StoredAgentRunPayload): AgentRunApiPayload {
    return {
      id: run.id,
      workspaceId: run.workspaceId,
      requestedByUserId: run.requestedByUserId,
      clientRequestId: run.clientRequestId,
      status: run.status,
      riskLevel: run.riskLevel,
      prompt: run.prompt,
      timezone: run.timezone,
      message: run.message,
      finalAnswer: run.finalAnswer,
      errorMessage: run.errorMessage,
      expiresAt: run.expiresAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    };
  }

  private mapRun(row: AgentRunRow): AgentRunApiPayload {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      requestedByUserId: row.requested_by_user_id,
      clientRequestId: row.client_request_id,
      status: row.status,
      riskLevel: row.risk_level,
      prompt: row.prompt,
      timezone: row.timezone,
      message: row.message,
      finalAnswer: row.final_answer,
      errorMessage: row.error_message,
      expiresAt: this.toIso(row.expires_at),
      completedAt: this.toIsoOrNull(row.completed_at),
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at)
    };
  }

  private mapStep(row: AgentStepRow): AgentStepApiPayload {
    return {
      id: row.id,
      runId: row.run_id,
      order: row.step_order,
      type: row.step_type,
      status: row.status,
      toolName: row.tool_name,
      riskLevel: row.risk_level,
      inputSummary: this.sanitizeJsonObject(row.input_json),
      outputSummary: this.sanitizeJsonObject(row.output_json),
      resourceRefs: this.sanitizeResourceRefs(row.resource_refs),
      errorMessage: row.error_message,
      startedAt: this.toIsoOrNull(row.started_at),
      completedAt: this.toIsoOrNull(row.completed_at)
    };
  }

  private mapConfirmation(
    row: AgentConfirmationRow
  ): AgentConfirmationApiPayload {
    return {
      id: row.id,
      runId: row.run_id,
      status: row.status,
      riskLevel: row.risk_level,
      plan: this.sanitizeJsonValue(row.plan_json) as AgentConfirmationPlan,
      expiresAt: this.toIso(row.expires_at),
      approvedAt: this.toIsoOrNull(row.approved_at),
      rejectedAt: this.toIsoOrNull(row.rejected_at),
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at)
    };
  }

  private sanitizeJsonObject(value: AgentJsonObject): AgentJsonObject {
    return this.sanitizeJsonValue(value) as AgentJsonObject;
  }

  private sanitizeResourceRefs(value: AgentResourceRef[]): AgentResourceRef[] {
    return this.sanitizeJsonValue(value) as AgentResourceRef[];
  }

  private sanitizeJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeJsonValue(item));
    }

    if (this.isPlainObject(value)) {
      const sanitized: AgentJsonObject = {};

      for (const [key, child] of Object.entries(value)) {
        if (this.isForbiddenJsonKey(key)) {
          continue;
        }

        sanitized[key] = this.sanitizeJsonValue(child) as AgentJsonObject[string];
      }

      return sanitized;
    }

    return value;
  }

  private isForbiddenJsonKey(key: string): boolean {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    return FORBIDDEN_JSON_KEY_PARTS.some((part) => normalized.includes(part));
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private isAgentRunStatus(value: string): value is AgentRunStatus {
    return AGENT_RUN_STATUSES.includes(value as AgentRunStatus);
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toIsoOrNull(value: Date | string | null): string | null {
    return value === null ? null : this.toIso(value);
  }
}
