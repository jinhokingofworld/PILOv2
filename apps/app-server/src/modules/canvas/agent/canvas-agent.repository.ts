import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import type {
  CanvasAgentDraftRow,
  CanvasAgentRunRow,
  CanvasAgentShapeRow,
  CanvasAgentStepRow,
  CanvasDraftSpec,
  CanvasAgentActionName,
  CanvasAgentRequestContext,
  CanvasAgentRunStatus
} from "./canvas-agent.types";
import {
  CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE,
  CANVAS_AGENT_GENERIC_FAILURE_MESSAGE
} from "./canvas-agent.constants";

@Injectable()
export class CanvasAgentRepository {
  constructor(private readonly database: DatabaseService) {}

  async findRunByClientRequestId(
    workspaceId: string,
    canvasId: string,
    currentUserId: string,
    clientRequestId: string
  ): Promise<CanvasAgentRunRow | null> {
    return this.database.queryOne<CanvasAgentRunRow>(
      `
        SELECT *
        FROM canvas_agent_runs
        WHERE workspace_id = $1
          AND canvas_id = $2
          AND requested_by_user_id = $3
          AND client_request_id = $4
        LIMIT 1
      `,
      [workspaceId, canvasId, currentUserId, clientRequestId]
    );
  }

  async createRun(input: {
    canvasRevision: number;
    canvasId: string;
    clientRequestId: string | null;
    context: CanvasAgentRequestContext;
    currentUserId: string;
    parentAgentRunId: string | null;
    prompt: string;
    source: "canvas_chat" | "general_agent_delegate";
    workspaceId: string;
  }): Promise<CanvasAgentRunRow> {
    const run = await this.database.queryOne<CanvasAgentRunRow>(
      `
        INSERT INTO canvas_agent_runs (
          workspace_id,
          canvas_id,
          requested_by_user_id,
          parent_agent_run_id,
          source,
          status,
          prompt,
          context_json,
          canvas_revision,
          client_request_id,
          result_json
        )
        VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7::jsonb, $8, $9, '{}'::jsonb)
        RETURNING *
      `,
      [
        input.workspaceId,
        input.canvasId,
        input.currentUserId,
        input.parentAgentRunId,
        input.source,
        input.prompt,
        JSON.stringify(input.context),
        input.canvasRevision,
        input.clientRequestId
      ]
    );

    if (!run) {
      throw new Error("Canvas Agent run could not be created");
    }

    return run;
  }

  async isOwnedParentAgentRun(
    parentAgentRunId: string,
    workspaceId: string,
    currentUserId: string
  ): Promise<boolean> {
    const row = await this.database.queryOne<{ id: string }>(
      `
        SELECT id
        FROM agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND requested_by_user_id = $3
      `,
      [parentAgentRunId, workspaceId, currentUserId]
    );
    return Boolean(row);
  }

  async findRunForRequester(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentRunRow | null> {
    return this.database.queryOne<CanvasAgentRunRow>(
      `
        SELECT *
        FROM canvas_agent_runs
        WHERE id = $1
          AND workspace_id = $2
          AND canvas_id = $3
          AND requested_by_user_id = $4
      `,
      [runId, workspaceId, canvasId, currentUserId]
    );
  }

  async findRun(runId: string): Promise<CanvasAgentRunRow | null> {
    return this.database.queryOne<CanvasAgentRunRow>(
      "SELECT * FROM canvas_agent_runs WHERE id = $1",
      [runId]
    );
  }

  async listSteps(runId: string): Promise<CanvasAgentStepRow[]> {
    return this.database.query<CanvasAgentStepRow>(
      `SELECT * FROM canvas_agent_steps WHERE run_id = $1 ORDER BY step_order ASC`,
      [runId]
    );
  }

  async listDrafts(runId: string): Promise<CanvasAgentDraftRow[]> {
    return this.database.query<CanvasAgentDraftRow>(
      `SELECT * FROM canvas_agent_drafts WHERE run_id = $1 ORDER BY created_at ASC`,
      [runId]
    );
  }

  async getCanvasLatestOpSeq(
    workspaceId: string,
    canvasId: string
  ): Promise<number | null> {
    const row = await this.database.queryOne<{ latest_op_seq: number | string }>(
      `
        SELECT latest_op_seq
        FROM canvas
        WHERE id = $1
          AND workspace_id = $2
          AND board_type = 'freeform'
      `,
      [canvasId, workspaceId]
    );

    return row ? Number(row.latest_op_seq) : null;
  }

  async findShapesByIds(
    canvasId: string,
    shapeIds: string[]
  ): Promise<CanvasAgentShapeRow[]> {
    if (!shapeIds.length) return [];

    return this.database.query<CanvasAgentShapeRow>(
      `
        SELECT id, title, text_content, shape_type, x, y, width, height, revision, raw_shape
        FROM canvas_freeform_shapes
        WHERE canvas_id = $1
          AND id = ANY($2::text[])
          AND deleted_at IS NULL
        ORDER BY array_position($2::text[], id)
      `,
      [canvasId, shapeIds]
    );
  }

  async createPlannedStep(
    runId: string,
    actionName: CanvasAgentActionName,
    input: Record<string, unknown>,
    modelName: string | null = null,
    inputTokens: number | null = null,
    outputTokens: number | null = null
  ): Promise<CanvasAgentStepRow> {
    const step = await this.database.queryOne<CanvasAgentStepRow>(
      `
        WITH next_step AS (
          SELECT COALESCE(MAX(step_order), 0) + 1 AS step_order
          FROM canvas_agent_steps
          WHERE run_id = $1
        )
        INSERT INTO canvas_agent_steps (
          run_id, step_order, action_name, status, input_json, output_json,
          resource_refs, model_name, input_tokens, output_tokens
        )
        SELECT $1, next_step.step_order, $2, 'pending', $3::jsonb, '{}'::jsonb,
          '[]'::jsonb, $4, $5, $6
        FROM next_step
        RETURNING *
      `,
      [runId, actionName, JSON.stringify(input), modelName, inputTokens, outputTokens]
    );

    if (!step) throw new Error("Canvas Agent step could not be created");
    return step;
  }

  async markRunPlanning(runId: string, message: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'planning', result_summary = $2, error_code = NULL, error_message = NULL
        WHERE id = $1
          AND status NOT IN ('completed', 'failed', 'cancelled', 'expired')
      `,
      [runId, message]
    );
  }

  async markRunExecuting(
    runId: string,
    message: string,
    progress: Record<string, unknown>
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'executing', result_summary = $2, result_json = $3::jsonb,
          error_code = NULL, error_message = NULL
        WHERE id = $1
          AND status NOT IN ('completed', 'failed', 'cancelled', 'expired')
      `,
      [runId, message, JSON.stringify(progress)]
    );
  }

  async claimNextPendingStep(runId: string | null = null): Promise<{
    run: CanvasAgentRunRow;
    step: CanvasAgentStepRow;
  } | null> {
    return this.database.transaction(async (transaction) => {
      const step = await transaction.queryOne<CanvasAgentStepRow>(
        `
          WITH candidate AS (
            SELECT s.id
            FROM canvas_agent_steps s
            INNER JOIN canvas_agent_runs r ON r.id = s.run_id
            WHERE s.status = 'pending'
              AND r.status = 'executing'
              AND ($1::uuid IS NULL OR r.id = $1)
            ORDER BY s.created_at ASC
            FOR UPDATE OF s SKIP LOCKED
            LIMIT 1
          )
          UPDATE canvas_agent_steps s
          SET status = 'running', started_at = now()
          FROM candidate
          WHERE s.id = candidate.id
          RETURNING s.*
        `,
        [runId]
      );
      if (!step) return null;

      const run = await transaction.queryOne<CanvasAgentRunRow>(
        "SELECT * FROM canvas_agent_runs WHERE id = $1 FOR UPDATE",
        [step.run_id]
      );
      if (!run || run.status !== "executing") return null;

      return { run, step };
    });
  }

  async completeStep(
    stepId: string,
    output: Record<string, unknown>,
    resourceRefs: string[]
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_steps
        SET status = 'completed', output_json = $2::jsonb, resource_refs = $3::jsonb,
          completed_at = now(), error_code = NULL, error_message = NULL
        WHERE id = $1
          AND status = 'running'
      `,
      [stepId, JSON.stringify(output), JSON.stringify(resourceRefs)]
    );
  }

  async failStep(stepId: string, message: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_steps
        SET status = 'failed', error_code = 'CANVAS_AGENT_ACTION_FAILED',
          error_message = $2, completed_at = now()
        WHERE id = $1
      `,
      [stepId, message.slice(0, 4096)]
    );
  }

  async completeRun(
    runId: string,
    summary: string,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'completed', result_summary = $2, result_json = $3::jsonb,
          completed_at = now(), error_code = NULL, error_message = NULL
        WHERE id = $1
          AND status NOT IN ('cancelled', 'expired')
      `,
      [runId, summary, JSON.stringify(result)]
    );
  }

  async markRunDraftReady(
    runId: string,
    summary: string,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'draft_ready', result_summary = $2, result_json = $3::jsonb,
          error_code = NULL, error_message = NULL
        WHERE id = $1
          AND status NOT IN ('cancelled', 'expired')
      `,
      [runId, summary, JSON.stringify(result)]
    );
  }

  async failRun(runId: string, message: string): Promise<void> {
    const safeMessage = message.slice(0, 4096);
    const userMessage =
      safeMessage === CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE
        ? CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE
        : CANVAS_AGENT_GENERIC_FAILURE_MESSAGE;
    await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'failed', error_code = 'CANVAS_AGENT_FAILED', error_message = $2,
          result_summary = $3,
          result_json = jsonb_set(
            COALESCE(result_json, '{}'::jsonb),
            '{progress}',
            jsonb_build_object(
              'message', $3,
              'highlightedShapeIds', '[]'::jsonb,
              'targetViewport', NULL,
              'toolTarget', NULL,
              'toolTargetLabel', NULL
            ),
            true
          ),
          completed_at = now()
        WHERE id = $1
          AND status NOT IN ('completed', 'cancelled', 'expired')
      `,
      [runId, safeMessage, userMessage]
    );
  }

  async expireActiveRunsOlderThan(timeoutMs: number): Promise<number> {
    const result = await this.database.execute(
      `
        UPDATE canvas_agent_runs
        SET status = 'expired',
          error_code = 'CANVAS_AGENT_RUN_TIMEOUT',
          error_message = 'Canvas Agent run did not finish before the timeout',
          result_summary = 'Canvas AI 작업이 너무 오래 걸려 중단되었습니다.',
          completed_at = now()
        WHERE status IN ('queued', 'planning', 'executing')
          AND created_at < now() - ($1::int * interval '1 millisecond')
      `,
      [Math.max(1, Math.floor(timeoutMs))]
    );
    return result.rowCount ?? 0;
  }

  async cancelRun(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentRunRow | null> {
    return this.database.queryOne<CanvasAgentRunRow>(
      `
        UPDATE canvas_agent_runs
        SET status = 'cancelled', result_summary = 'Canvas AI 작업을 취소했습니다.', completed_at = now()
        WHERE id = $1
          AND workspace_id = $2
          AND canvas_id = $3
          AND requested_by_user_id = $4
          AND status IN ('queued', 'planning', 'executing', 'draft_ready')
        RETURNING *
      `,
      [runId, workspaceId, canvasId, currentUserId]
    );
  }

  async createDraft(input: {
    canvasId: string;
    currentUserId: string;
    runId: string;
    spec: CanvasDraftSpec;
  }): Promise<CanvasAgentDraftRow> {
    const draft = await this.database.queryOne<CanvasAgentDraftRow>(
      `
        INSERT INTO canvas_agent_drafts (
          run_id, canvas_id, created_by_user_id, status, draft_spec_json
        )
        VALUES ($1, $2, $3, 'preview', $4::jsonb)
        RETURNING *
      `,
      [input.runId, input.canvasId, input.currentUserId, JSON.stringify(input.spec)]
    );
    if (!draft) throw new Error("Canvas Agent draft could not be created");
    return draft;
  }

  async findDraftForRequester(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    draftId: string
  ): Promise<CanvasAgentDraftRow | null> {
    return this.database.queryOne<CanvasAgentDraftRow>(
      `
        SELECT d.*
        FROM canvas_agent_drafts d
        INNER JOIN canvas_agent_runs r ON r.id = d.run_id
        WHERE d.id = $1
          AND d.canvas_id = $2
          AND d.created_by_user_id = $3
          AND r.workspace_id = $4
      `,
      [draftId, canvasId, currentUserId, workspaceId]
    );
  }

  async markDraftApplied(
    draftId: string,
    shapeIds: string[]
  ): Promise<CanvasAgentDraftRow | null> {
    return this.database.queryOne<CanvasAgentDraftRow>(
      `
        UPDATE canvas_agent_drafts
        SET status = 'applied', applied_shape_ids = $2::jsonb, applied_at = now()
        WHERE id = $1
          AND status = 'preview'
        RETURNING *
      `,
      [draftId, JSON.stringify(shapeIds)]
    );
  }

  async discardDraft(draftId: string): Promise<CanvasAgentDraftRow | null> {
    return this.database.queryOne<CanvasAgentDraftRow>(
      `
        DELETE FROM canvas_agent_drafts
        WHERE id = $1
          AND status = 'preview'
        RETURNING
          id,
          run_id,
          canvas_id,
          created_by_user_id,
          'discarded'::text AS status,
          draft_spec_json,
          applied_shape_ids,
          created_at,
          applied_at,
          expires_at
      `,
      [draftId]
    );
  }

  async statusForRun(runId: string): Promise<CanvasAgentRunStatus | null> {
    const row = await this.database.queryOne<{ status: CanvasAgentRunStatus }>(
      "SELECT status FROM canvas_agent_runs WHERE id = $1",
      [runId]
    );
    return row?.status ?? null;
  }
}
