import { HttpException, Injectable, Logger } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { agentStorageUnavailable } from "./agent-api-error";
import { AgentCanvasDelegationCompletionService } from "./agent-canvas-delegation-completion.service";
import { AGENT_CANDIDATE_SELECTION_KIND } from "./agent-candidate-input";
import {
  CreateAgentRunResult as StoredCreateAgentRunResult,
  AgentLoggingService,
  AgentRunPayload as StoredAgentRunPayload,
  AgentRunStatus,
  AgentStepPayload as StoredAgentStepPayload
} from "./agent-logging.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { AgentCandidateSelectionService } from "./agent-candidate-selection.service";
import {
  buildStoredMeetingCandidateSelectionMessage,
  MEETING_CANDIDATE_SELECTION_KIND,
  toPublicMeetingCandidateSelectionMessage
} from "./meeting-candidate-selection";
import {
  containsReservedAgentSelectionMarker,
  toPublicAgentMessageContent
} from "./sql-erd-session-selection";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentResourceRef,
  AgentRiskLevel,
  AgentRunRequestContext
} from "./types/agent-tool.types";

const PUBLIC_AGENT_FAILURE_MESSAGE =
  "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";

export interface AgentRunListQuery {
  status?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface AgentRunCreateInput {
  prompt: string;
  timezone?: string;
  clientRequestId?: string | null;
  requestContext: AgentRunRequestContext;
}

export interface AgentRunInput {
  message: string;
  selection?:
    | {
        kind: typeof MEETING_CANDIDATE_SELECTION_KIND;
        candidateSelectionId: string;
      }
    | {
        kind: typeof AGENT_CANDIDATE_SELECTION_KIND;
        candidateSelectionId: string;
      };
}

export interface AgentRunApiPayload {
  id: string;
  workspaceId: string;
  requestedByUserId: string | null;
  clientRequestId: string | null;
  requestContext: AgentRunRequestContext;
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

export interface AgentRunMessageApiPayload {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentConfirmationApiPayload
  extends AgentConfirmationSummaryPayload {
  runId: string;
  plan: AgentConfirmationPlan;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  selectedChoiceId: string | null;
}

export interface AgentRunListItemPayload extends AgentRunApiPayload {
  confirmation: AgentConfirmationSummaryPayload | null;
}

export interface AgentRunDetailItemPayload extends AgentRunApiPayload {
  steps: AgentStepApiPayload[];
  messages: AgentRunMessageApiPayload[];
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
  request_context_json: AgentRunRequestContext;
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
  selected_choice_id: string | null;
}

interface AgentRunMessageRow extends QueryResultRow {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  created_at: Date | string;
}

interface AgentLatestToolStepRow extends QueryResultRow {
  tool_name: string | null;
  output_json: AgentJsonObject;
}

interface AgentRunWithConfirmationRow extends AgentRunRow {
  confirmation_id: string | null;
  confirmation_status: AgentConfirmationStatus | null;
  confirmation_risk_level: AgentRiskLevel | null;
  confirmation_expires_at: Date | string | null;
}

interface SafeStorageErrorLog {
  category: string;
  code?: string;
  constraint?: string;
  name: string;
  schema?: string;
  table?: string;
}

const DEFAULT_TIMEZONE = "Asia/Seoul";
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_PROMPT_BYTES = 32768;
const MAX_RUN_INPUT_BYTES = 4000;
const MAX_CLIENT_REQUEST_ID_BYTES = 128;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_REQUEST_CONTEXT_BYTES = 196_608;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ORDINAL_PATTERN =
  /^\s*([1-5])\s*번(?:\s*후보)?(?:\s*(?:을|를)?\s*(?:선택(?:할게요|합니다|했어요)?|골라(?:주세요|줘|요)?))?\s*[.!?]*\s*$/;
const MAX_CANDIDATE_SELECTIONS = 5;
const AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "planning",
  "waiting_user_input",
  "waiting_confirmation",
  "running",
  "completed",
  "failed",
  "cancelled"
];
const RETENTION_CLEANUP_BATCH_SIZE = 100;
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
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly agentOutboxPublisherService: AgentOutboxPublisherService,
    private readonly canvasDelegationCompletionService:
      AgentCanvasDelegationCompletionService,
    private readonly agentCandidateSelectionService: AgentCandidateSelectionService
  ) {}

  async createRun(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<AgentRunCreateResult> {
    const input = this.normalizeCreateRunInput(body);
    if (input.requestContext) {
      await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
      await this.assertRequestContextAccess(workspaceId, input.requestContext);
    }
    const result = await this.createStoredRun(currentUserId, workspaceId, input);

    if (result.created) {
      await this.agentOutboxPublisherService.publishCreatedRun(result.run.id);
    }

    return {
      run: {
        ...this.mapStoredRun(result.run),
        steps: [],
        messages: [],
        confirmation: null
      },
      created: result.created
    };
  }

  async submitRunInput(
    currentUserId: string,
    workspaceId: string,
    runId: string,
    body: unknown
  ): Promise<AgentRunDetailPayload> {
    const input = this.normalizeRunInput(body);
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const outcome = await this.database.transaction((transaction) =>
      this.resumeRunInputInTransaction(
        transaction,
        currentUserId,
        workspaceId,
        runId,
        input
      )
    );
    if (outcome === "expired") {
      throw badRequest("Agent run input wait has expired");
    }
    await this.agentOutboxPublisherService.publishCreatedRun(runId);
    return this.getRun(currentUserId, workspaceId, runId);
  }

  normalizeRunInputBody(body: unknown): AgentRunInput {
    return this.normalizeRunInput(body);
  }

  async isDeterministicCandidateContinuationInTransaction(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    runId: string,
    requestContext: AgentRunRequestContext,
    input: AgentRunInput
  ): Promise<boolean> {
    if (input.selection) return true;
    return Boolean(
      await this.resolveOrdinalCandidateSelection(
        transaction,
        { currentUserId, workspaceId, runId, requestContext },
        runId,
        input.message
      )
    );
  }

  async resumeRunInputInTransaction(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    runId: string,
    input: AgentRunInput
  ): Promise<"accepted" | "expired"> {
    const run = await transaction.queryOne<AgentRunRow>(
      `
          SELECT *
          FROM agent_runs
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
          FOR UPDATE
      `,
      [runId, workspaceId, currentUserId]
    );
    if (!run) throw notFound("Agent run not found");
    if (run.status !== "waiting_user_input") {
      throw badRequest("Agent run is not waiting for user input");
    }
    const stillWaiting = await transaction.queryOne<{ id: string }>(
      `SELECT id FROM agent_runs WHERE id = $1 AND updated_at > now() - INTERVAL '24 hours'`,
      [runId]
    );
    if (!stillWaiting) {
      await transaction.execute(
        `UPDATE agent_runs SET status = 'cancelled', message = '추가 정보 입력 대기 시간이 만료되었습니다.', completed_at = now(), updated_at = now() WHERE id = $1`,
        [runId]
      );
      return "expired";
    }
    const selection =
      input.selection ??
      (await this.resolveOrdinalCandidateSelection(
        transaction,
        {
          currentUserId,
          workspaceId,
          runId,
          requestContext: run.request_context_json
        },
        runId,
        input.message
      ));
    let storedMessage = input.message;
    if (selection?.kind === AGENT_CANDIDATE_SELECTION_KIND) {
      const selected =
        await this.agentCandidateSelectionService.consumeCandidateInTransaction(
          transaction,
          {
            currentUserId,
            workspaceId,
            runId,
            requestContext: run.request_context_json
          },
          selection.candidateSelectionId
        );
      if (selected.reference.domain === "meeting") {
        storedMessage = buildStoredMeetingCandidateSelectionMessage(selected.label);
      } else {
        throw badRequest("Agent candidate domain cannot resume this run");
      }
    }
    if (selection?.kind === MEETING_CANDIDATE_SELECTION_KIND) {
      const selected =
        await this.agentCandidateSelectionService.consumeMeetingCandidateInTransaction(
          transaction,
          {
            currentUserId,
            workspaceId,
            runId,
            requestContext: run.request_context_json
          },
          selection.candidateSelectionId
        );
      storedMessage = buildStoredMeetingCandidateSelectionMessage(selected.label);
    }
    const next = await transaction.queryOne<{ sequence: number | string }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_messages WHERE run_id = $1`,
      [runId]
    );
    await transaction.execute(
      `INSERT INTO agent_run_messages (run_id, sequence, role, content) VALUES ($1, $2, 'user', $3)`,
      [runId, Number(next?.sequence ?? 1), storedMessage]
    );
    const resumed = await transaction.queryOne<{ id: string }>(
      `
        UPDATE agent_runs
        SET status = 'planning',
            message = '추가 정보를 반영하고 있습니다.',
            final_answer = NULL,
            error_code = NULL,
            error_message = NULL,
            completed_at = NULL,
            planner_turn_count = 0,
            tool_call_count = 0,
            updated_at = now()
        WHERE id = $1
          AND status = 'waiting_user_input'
        RETURNING id
      `,
      [runId]
    );
    if (!resumed) {
      throw new Error("Agent run could not resume from user input");
    }
    const outbox = await transaction.queryOne<{ id: string }>(
      `
        UPDATE agent_run_outbox
        SET status = 'pending', attempt_count = 0, next_attempt_at = now(),
            claim_token = NULL, claimed_at = NULL, delivered_at = NULL,
            error_code = NULL, error_message = NULL,
            turn_sequence = turn_sequence + 1,
            planning_started_at = now(),
            reason = 'user_input'
        WHERE run_id = $1
        RETURNING id
      `,
      [runId]
    );
    if (!outbox) {
      throw new Error("Agent run outbox could not be re-armed");
    }
    return "accepted";
  }

  private async createStoredRun(
    currentUserId: string,
    workspaceId: string,
    input: AgentRunCreateInput
  ): Promise<StoredCreateAgentRunResult> {
    try {
      return await this.agentLoggingService.createRun(
        currentUserId,
        workspaceId,
        input
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Agent run storage failed: ${JSON.stringify(
          this.toSafeStorageErrorLog(error)
        )}`
      );
      throw agentStorageUnavailable("Agent run storage is unavailable");
    }
  }

  private toSafeStorageErrorLog(error: unknown): SafeStorageErrorLog {
    const record = this.isPlainObject(error) ? error : {};

    return {
      category: this.categorizeStorageError(error),
      code: this.readStringProperty(record, "code"),
      constraint: this.readStringProperty(record, "constraint"),
      name: error instanceof Error ? error.name : typeof error,
      schema: this.readStringProperty(record, "schema"),
      table: this.readStringProperty(record, "table")
    };
  }

  private categorizeStorageError(error: unknown): string {
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (message.includes("row-level security")) {
      return "row_level_security";
    }

    if (message.includes("permission denied")) {
      return "permission_denied";
    }

    if (message.includes("does not exist")) {
      return "relation_missing";
    }

    if (message.includes("foreign key")) {
      return "foreign_key";
    }

    if (message.includes("duplicate key")) {
      return "duplicate_key";
    }

    if (
      message.includes("econnrefused") ||
      message.includes("timeout") ||
      message.includes("connection")
    ) {
      return "connection";
    }

    return "unknown";
  }

  private readStringProperty(
    record: AgentJsonObject,
    key: string
  ): string | undefined {
    const value = record[key];
    return typeof value === "string" ? value : undefined;
  }

  async listRuns(
    currentUserId: string,
    workspaceId: string,
    query: AgentRunListQuery
  ): Promise<AgentRunListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.applyRequestTimeLifecycle(currentUserId, workspaceId);

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
    await this.applyRequestTimeLifecycle(currentUserId, workspaceId);
    let run = await this.database.queryOne<AgentRunRow>(
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

    if (run.status === "running" && this.canvasDelegationCompletionService) {
      await this.canvasDelegationCompletionService.reconcileRun({
        agentRunId: runId,
        workspaceId,
        requestedByUserId: currentUserId
      });
      run = await this.database.queryOne<AgentRunRow>(
        `
          SELECT *
          FROM agent_runs
          WHERE id = $1
            AND workspace_id = $2
            AND requested_by_user_id = $3
        `,
        [runId, workspaceId, currentUserId]
      ) ?? run;
    }

    const [steps, messages, confirmation] = await Promise.all([
      this.database.query<AgentStepRow>(
        `
          SELECT *
          FROM agent_steps
          WHERE run_id = $1
          ORDER BY step_order ASC
        `,
        [runId]
      ),
      this.database.query<AgentRunMessageRow>(
        `
          SELECT id, sequence, role, content, created_at
          FROM agent_run_messages
          WHERE run_id = $1
          ORDER BY sequence ASC
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
        messages: messages.map((message) => this.mapMessage(message)),
        confirmation: confirmation
          ? this.mapConfirmation(confirmation)
          : null
      }
    };
  }

  private async applyRequestTimeLifecycle(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          WITH expired_confirmations AS (
            UPDATE agent_confirmations AS confirmation
            SET status = 'expired'
            FROM agent_runs AS run
            WHERE confirmation.run_id = run.id
              AND confirmation.status = 'pending'
              AND confirmation.expires_at <= now()
              AND run.workspace_id = $1
              AND run.requested_by_user_id = $2
            RETURNING confirmation.run_id
          )
          UPDATE agent_runs AS run
          SET status = 'cancelled',
              message = '승인 대기 시간이 만료되었습니다.',
              completed_at = now()
          WHERE run.id IN (SELECT run_id FROM expired_confirmations)
            AND run.status = 'waiting_confirmation'
        `,
        [workspaceId, currentUserId]
      );

      await transaction.execute(
        `
          UPDATE agent_runs
          SET status = 'cancelled',
              message = '추가 정보 입력 대기 시간이 만료되었습니다.',
              completed_at = now(),
              updated_at = now()
          WHERE workspace_id = $1
            AND requested_by_user_id = $2
            AND status = 'waiting_user_input'
            AND updated_at <= now() - INTERVAL '24 hours'
        `,
        [workspaceId, currentUserId]
      );

      await transaction.execute(
        `
          WITH expired_runs AS (
            SELECT id
            FROM agent_runs
            WHERE workspace_id = $1
              AND requested_by_user_id = $2
              AND expires_at <= now()
            ORDER BY expires_at ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM agent_runs AS run
          USING expired_runs
          WHERE run.id = expired_runs.id
        `,
        [workspaceId, currentUserId, RETENTION_CLEANUP_BATCH_SIZE]
      );

      await transaction.execute(
        `
          DELETE FROM agent_threads AS thread
          WHERE thread.workspace_id = $1
            AND thread.requested_by_user_id = $2
            AND thread.expires_at <= now()
            AND NOT EXISTS (
              SELECT 1
              FROM agent_runs AS run
              JOIN agent_confirmations AS confirmation
                ON confirmation.run_id = run.id
              WHERE run.thread_id = thread.id
                AND confirmation.status = 'pending'
                AND confirmation.expires_at > now()
            )
        `,
        [workspaceId, currentUserId]
      );
    });
  }

  normalizeCreateRunBody(body: unknown): AgentRunCreateInput {
    return this.normalizeCreateRunInput(body);
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
      ),
      requestContext: this.readRequestContext(body.requestContext)
    };
  }

  private readRequestContext(value: unknown): AgentRunRequestContext {
    if (value === undefined || value === null) {
      return null;
    }

    if (!this.isPlainObject(value)) {
      throw badRequest("requestContext must be a valid Agent request context");
    }

    if (value.surface === "canvas") {
      if (
        Object.keys(value).length !== 3 ||
        typeof value.canvasId !== "string" ||
        !UUID_PATTERN.test(value.canvasId) ||
        !this.isPlainObject(value.canvasContext) ||
        Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REQUEST_CONTEXT_BYTES
      ) {
        throw badRequest("requestContext must be a valid Agent request context");
      }
      if (this.containsForbiddenJsonKey(value.canvasContext)) {
        throw badRequest("requestContext.canvasContext contains a forbidden field");
      }
      return {
        surface: "canvas",
        canvasId: value.canvasId,
        canvasContext: value.canvasContext
      };
    }

    if (
      Object.keys(value).length !== 2 ||
      (value.surface !== "sql_erd" && value.surface !== "pr_review") ||
      typeof value.sessionId !== "string" ||
      !UUID_PATTERN.test(value.sessionId) ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REQUEST_CONTEXT_BYTES
    ) {
      throw badRequest("requestContext must be a valid Agent request context");
    }

    return {
      surface: value.surface,
      sessionId: value.sessionId
    };
  }

  async assertRequestContextAccess(
    workspaceId: string,
    requestContext: AgentRunRequestContext
  ): Promise<void> {
    if (!requestContext) {
      return;
    }

    if (requestContext.surface === "sql_erd") {
      const session = await this.database.queryOne<{ id: string }>(
        `
          SELECT id
          FROM sql_erd_sessions
          WHERE id = $1
            AND workspace_id = $2
            AND deleted_at IS NULL
        `,
        [requestContext.sessionId, workspaceId]
      );

      if (!session) {
        throw notFound("SQLtoERD session not found");
      }
      return;
    }

    if (requestContext.surface === "canvas") {
      const canvas = await this.database.queryOne<{ id: string }>(
        `
          SELECT id
          FROM canvas
          WHERE id = $1
            AND workspace_id = $2
            AND board_type = 'freeform'
        `,
        [requestContext.canvasId, workspaceId]
      );
      if (!canvas) {
        throw notFound("Canvas not found");
      }
      return;
    }

    const session = await this.database.queryOne<{ id: string }>(
      `
        SELECT review_session.id
        FROM pr_review_sessions AS review_session
        JOIN pr_review_rooms AS review_room
          ON review_room.id = review_session.room_id
        WHERE review_session.id = $1
          AND review_room.workspace_id = $2
      `,
      [requestContext.sessionId, workspaceId]
    );

    if (!session) {
      throw notFound("PR Review session not found");
    }
  }

  private normalizeRunInput(body: unknown): AgentRunInput {
    if (!this.isPlainObject(body)) throw badRequest("Request body must be an object");
    if (Object.keys(body).some((key) => !["message", "selection"].includes(key))) {
      throw badRequest("Only message and selection may be provided");
    }
    const message = this.readRequiredText(
      body.message,
      "message",
      MAX_RUN_INPUT_BYTES
    );
    if (containsReservedAgentSelectionMarker(message)) {
      throw badRequest("message contains a reserved Agent selection marker");
    }
    if (body.selection === undefined) return { message };
    if (!this.isPlainObject(body.selection)) {
      throw badRequest("selection must be a valid Agent selection");
    }
    if (
      body.selection.kind === AGENT_CANDIDATE_SELECTION_KIND &&
      Object.keys(body.selection).every((key) =>
        ["kind", "candidateSelectionId"].includes(key)
      ) &&
      typeof body.selection.candidateSelectionId === "string" &&
      UUID_PATTERN.test(body.selection.candidateSelectionId)
    ) {
      return {
        message,
        selection: {
          kind: AGENT_CANDIDATE_SELECTION_KIND,
          candidateSelectionId: body.selection.candidateSelectionId
        }
      };
    }
    if (
      body.selection.kind === MEETING_CANDIDATE_SELECTION_KIND &&
      Object.keys(body.selection).every((key) =>
        ["kind", "candidateSelectionId"].includes(key)
      ) &&
      typeof body.selection.candidateSelectionId === "string" &&
      UUID_PATTERN.test(body.selection.candidateSelectionId)
    ) {
      return {
        message,
        selection: {
          kind: MEETING_CANDIDATE_SELECTION_KIND,
          candidateSelectionId: body.selection.candidateSelectionId
        }
      };
    }
    throw badRequest("selection must be a valid Agent selection");
  }

  private async resolveOrdinalCandidateSelection(
    transaction: DatabaseTransaction,
    context: {
      currentUserId: string;
      workspaceId: string;
      runId: string;
      requestContext: AgentRunRequestContext;
    },
    runId: string,
    message: string
  ): Promise<AgentRunInput["selection"] | undefined> {
    const ordinal = this.parseCandidateOrdinal(message);
    if (ordinal === null) return undefined;
    const generatedCandidateSelectionId =
      await this.agentCandidateSelectionService?.getLatestCandidateSelectionIdByOrdinalInTransaction?.(
        transaction,
        context,
        ordinal
      );
    if (generatedCandidateSelectionId) {
      return {
        kind: AGENT_CANDIDATE_SELECTION_KIND,
        candidateSelectionId: generatedCandidateSelectionId
      };
    }
    const latestToolStep = await this.getLatestCompletedToolStep(transaction, runId);
    if (!latestToolStep) return undefined;

    const rawCandidates = latestToolStep.output_json.candidateSelections;
    if (!Array.isArray(rawCandidates)) return undefined;
    const candidateSelectionIds = this.parseMeetingCandidateSelectionIds(rawCandidates);
    const candidateSelectionId = candidateSelectionIds[ordinal - 1];
    if (!candidateSelectionId) {
      throw badRequest("Candidate ordinal is invalid, expired, or unavailable");
    }
    return {
      kind: MEETING_CANDIDATE_SELECTION_KIND,
      candidateSelectionId
    };
  }

  private async getLatestCompletedToolStep(
    transaction: DatabaseTransaction,
    runId: string
  ): Promise<AgentLatestToolStepRow | null> {
    return transaction.queryOne<AgentLatestToolStepRow>(
      `
        SELECT tool_name, output_json
        FROM agent_steps
        WHERE run_id = $1
          AND step_type = 'tool'
          AND status = 'completed'
        ORDER BY step_order DESC
        LIMIT 1
      `,
      [runId]
    );
  }

  private parseCandidateOrdinal(message: string): number | null {
    const matched = CANDIDATE_ORDINAL_PATTERN.exec(message);
    return matched ? Number(matched[1]) : null;
  }

  private parseMeetingCandidateSelectionIds(rawCandidates: unknown[]): string[] {
    if (
      rawCandidates.length === 0 ||
      rawCandidates.length > MAX_CANDIDATE_SELECTIONS
    ) {
      return [];
    }
    const candidateSelectionIds = rawCandidates.map((candidate) =>
      this.isPlainObject(candidate) &&
      typeof candidate.candidateSelectionId === "string" &&
      UUID_PATTERN.test(candidate.candidateSelectionId)
        ? candidate.candidateSelectionId
        : null
    );
    if (
      candidateSelectionIds.some((candidateSelectionId) => !candidateSelectionId) ||
      new Set(candidateSelectionIds).size !== candidateSelectionIds.length
    ) {
      return [];
    }
    return candidateSelectionIds as string[];
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
      requestContext: run.requestContext,
      status: run.status,
      riskLevel: run.riskLevel,
      prompt: run.prompt,
      timezone: run.timezone,
      message: run.message,
      finalAnswer: run.finalAnswer,
      errorMessage: run.errorMessage ? PUBLIC_AGENT_FAILURE_MESSAGE : null,
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
      requestContext: row.request_context_json,
      status: row.status,
      riskLevel: row.risk_level,
      prompt: row.prompt,
      timezone: row.timezone,
      message: row.message,
      finalAnswer: row.final_answer,
      errorMessage: row.error_message ? PUBLIC_AGENT_FAILURE_MESSAGE : null,
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
      errorMessage: row.error_message ? PUBLIC_AGENT_FAILURE_MESSAGE : null,
      startedAt: this.toIsoOrNull(row.started_at),
      completedAt: this.toIsoOrNull(row.completed_at)
    };
  }

  private mapMessage(row: AgentRunMessageRow): AgentRunMessageApiPayload {
    return {
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      content: toPublicMeetingCandidateSelectionMessage(
        toPublicAgentMessageContent(row.content)
      ),
      createdAt: this.toIso(row.created_at)
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
      updatedAt: this.toIso(row.updated_at),
      selectedChoiceId: row.selected_choice_id
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
        if (
          this.isForbiddenJsonKey(key) &&
          !this.isSafeSelectionToken(key, child)
        ) {
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

  private isSafeSelectionToken(key: string, value: unknown): boolean {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    return (
      normalized === "selectiontoken" &&
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    );
  }

  private containsForbiddenJsonKey(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some((item) => this.containsForbiddenJsonKey(item));
    }
    if (!this.isPlainObject(value)) {
      return false;
    }
    return Object.entries(value).some(
      ([key, child]) =>
        (this.isForbiddenJsonKey(key) && !this.isSafeSelectionToken(key, child)) ||
        this.containsForbiddenJsonKey(child)
    );
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
