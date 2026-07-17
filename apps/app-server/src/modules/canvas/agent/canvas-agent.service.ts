import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { notFound } from "../../../common/api-error";
import { CanvasService } from "../canvas.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import {
  canvasAgentClientRequestIdConflict,
  canvasAgentDraftNotPreview,
  canvasAgentDraftStale
} from "./canvas-agent.error";
import { CanvasAgentActionService } from "./canvas-agent-action.service";
import { CanvasAgentDraftService } from "./canvas-agent-draft.service";
import { CANVAS_AGENT_SCHEMA_VERSION, CanvasAgentJobService } from "./canvas-agent-job.service";
import { CanvasAgentRepository } from "./canvas-agent.repository";
import {
  readCanvasAgentToolHelpOverview,
  resolveCanvasAgentToolTarget
} from "./canvas-agent-tool-targets";
import type {
  ApplyCanvasAgentDraftRequest,
  CanvasAgentDraftApplyPayload,
  CanvasAgentDraftPayload,
  CanvasAgentDraftRow,
  CanvasAgentPlannedAction,
  CanvasAgentProgressPayload,
  CanvasAgentRunDetailPayload,
  CanvasAgentRunPayload,
  CanvasAgentRunRow,
  CanvasAgentStepPayload,
  CanvasAgentStepRow,
  CreateCanvasAgentRunRequest
} from "./canvas-agent.types";
import { validateApplyClientOperationId, validateCanvasAgentRunRequest } from "./canvas-agent.validation";

const ACTION_POLL_INTERVAL_MS = 400;
const ACTIVE_RUN_SWEEP_INTERVAL_MS = 60_000;
const ACTIVE_RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_CANVAS_AGENT_STEPS = 3;

@Injectable()
export class CanvasAgentService implements OnModuleDestroy, OnModuleInit {
  private actionTimer: ReturnType<typeof setInterval> | null = null;
  private activeRunSweepTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private isSweepingActiveRuns = false;

  constructor(
    private readonly actions: CanvasAgentActionService,
    private readonly canvasService: CanvasService,
    private readonly drafts: CanvasAgentDraftService,
    private readonly jobs: CanvasAgentJobService,
    private readonly repository: CanvasAgentRepository,
    private readonly workspaceService: WorkspaceService
  ) {}

  onModuleInit(): void {
    this.actionTimer = setInterval(() => void this.processNextAction(), ACTION_POLL_INTERVAL_MS);
    this.activeRunSweepTimer = setInterval(() => void this.expireStaleActiveRuns(), ACTIVE_RUN_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.actionTimer) clearInterval(this.actionTimer);
    if (this.activeRunSweepTimer) clearInterval(this.activeRunSweepTimer);
    this.actionTimer = null;
    this.activeRunSweepTimer = null;
  }

  async createRun(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: CreateCanvasAgentRunRequest
  ): Promise<CanvasAgentRunPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const values = validateCanvasAgentRunRequest(input);
    const canvasRevision = await this.repository.getCanvasLatestOpSeq(workspaceId, canvasId);
    if (canvasRevision === null) throw notFound("Canvas not found");

    if (values.clientRequestId) {
      const existing = await this.repository.findRunByClientRequestId(workspaceId, canvasId, currentUserId, values.clientRequestId);
      if (existing) {
        if (existing.prompt !== values.prompt || JSON.stringify(this.normalizeContext(existing.context_json)) !== JSON.stringify(values.context)) {
          throw canvasAgentClientRequestIdConflict("Canvas Agent clientRequestId was already used for a different request");
        }
        return this.mapRun(existing);
      }
    }

    const run = await this.repository.createRun({
      canvasRevision,
      canvasId,
      clientRequestId: values.clientRequestId,
      context: values.context,
      currentUserId,
      prompt: values.prompt,
      workspaceId
    });

    const localAction = this.planDeterministicAction(
      values.prompt,
      values.context.selectedShapeIds,
      values.toolHelpMode
    );
    if (localAction) {
      await this.repository.createPlannedStep(run.id, localAction.actionName, localAction.input);
      const progress = localAction.showProgress === false
        ? {}
        : {
            progress: {
              message: localAction.message,
              highlightedShapeIds: values.context.selectedShapeIds,
              targetViewport: null,
              toolTarget: typeof localAction.input.toolTarget === "string" ? localAction.input.toolTarget : null,
              toolTargetLabel: typeof localAction.input.toolTargetLabel === "string" ? localAction.input.toolTargetLabel : null
            }
          };
      await this.repository.markRunExecuting(run.id, localAction.message, {
        ...progress
      });
      return this.mapRun({ ...run, status: "executing", result_summary: localAction.message });
    }

    await this.enqueuePlanning(run);
    return this.mapRun({ ...run, status: "planning", result_summary: "Canvas AI 요청을 분석하고 있습니다." });
  }

  async getRunDetail(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentRunDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const run = await this.repository.findRunForRequester(currentUserId, workspaceId, canvasId, runId);
    if (!run) throw notFound("Canvas Agent run not found");
    const [steps, drafts] = await Promise.all([
      this.repository.listSteps(run.id),
      this.repository.listDrafts(run.id)
    ]);
    return {
      run: this.mapRun(run),
      steps: steps.map((step) => this.mapStep(step)),
      drafts: drafts.map((draft) => this.mapDraft(draft))
    };
  }

  async cancelRun(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentRunPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const cancelled = await this.repository.cancelRun(currentUserId, workspaceId, canvasId, runId);
    if (cancelled) return this.mapRun(cancelled);

    const existing = await this.repository.findRunForRequester(currentUserId, workspaceId, canvasId, runId);
    if (!existing) throw notFound("Canvas Agent run not found");
    return this.mapRun(existing);
  }

  async applyDraft(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    draftId: string,
    input: ApplyCanvasAgentDraftRequest
  ): Promise<CanvasAgentDraftApplyPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const clientOperationId = validateApplyClientOperationId(input.clientOperationId);
    const draft = await this.repository.findDraftForRequester(currentUserId, workspaceId, canvasId, draftId);
    if (!draft) throw notFound("Canvas Agent draft not found");
    if (draft.status !== "preview") throw canvasAgentDraftNotPreview("Canvas Agent draft is no longer a preview");
    await this.assertDraftSourcesCurrent(canvasId, draft);

    const batch = await this.canvasService.syncShapesBatch(
      currentUserId,
      workspaceId,
      canvasId,
      this.drafts.toShapeBatch(draft.draft_spec_json, clientOperationId),
      "agent"
    );
    const shapeIds = batch.shapes.map((shape) => shape.id);
    const applied = await this.repository.markDraftApplied(draft.id, shapeIds);
    if (!applied) throw canvasAgentDraftNotPreview("Canvas Agent draft is no longer a preview");

    const latestOpSeq = Math.max(0, ...batch.shapes.map((shape) => shape.opSeq ?? 0));
    await this.repository.completeRun(draft.run_id, "Canvas AI 초안을 캔버스에 적용했습니다.", {
      progress: {
        message: "Canvas AI 초안을 적용했습니다.",
        highlightedShapeIds: shapeIds,
        targetViewport: null,
        toolTarget: null,
        toolTargetLabel: null
      },
      appliedDraftId: applied.id
    });
    return {
      draft: this.mapDraft(applied),
      latestOpSeq,
      batch
    };
  }

  async discardDraft(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    draftId: string
  ): Promise<CanvasAgentDraftPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const draft = await this.repository.findDraftForRequester(currentUserId, workspaceId, canvasId, draftId);
    if (!draft) throw notFound("Canvas Agent draft not found");
    if (draft.status !== "preview") throw canvasAgentDraftNotPreview("Canvas Agent draft is no longer a preview");
    const discarded = await this.repository.discardDraft(draft.id);
    if (!discarded) throw canvasAgentDraftNotPreview("Canvas Agent draft is no longer a preview");
    await this.repository.completeRun(draft.run_id, "Canvas AI 초안을 폐기했습니다.", {
      progress: {
        message: "Canvas AI 초안을 폐기했습니다.",
        highlightedShapeIds: [],
        targetViewport: null,
        toolTarget: null,
        toolTargetLabel: null
      },
      discardedDraftId: discarded.id
    });
    return this.mapDraft(discarded);
  }

  private async processNextAction(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const claimed = await this.repository.claimNextPendingStep();
      if (!claimed) return;
      const currentStatus = await this.repository.statusForRun(claimed.run.id);
      if (currentStatus !== "executing") return;

      try {
        const result = await this.actions.execute(claimed.run, claimed.step);
        const output = { progress: result.progress, summary: result.summary };
        await this.repository.completeStep(claimed.step.id, output, result.resourceRefs);
        if (result.shouldContinue) {
          const steps = await this.repository.listSteps(claimed.run.id);
          if (steps.length >= MAX_CANVAS_AGENT_STEPS) {
            await this.repository.completeRun(claimed.run.id, result.summary, output);
            return;
          }
          const run = await this.repository.findRun(claimed.run.id);
          if (run) await this.enqueuePlanning(run);
          return;
        }
        await this.repository.completeRun(claimed.run.id, result.summary, output);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Canvas Agent action failed";
        await this.repository.failStep(claimed.step.id, message);
        await this.repository.failRun(claimed.run.id, message);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async expireStaleActiveRuns(): Promise<void> {
    if (this.isSweepingActiveRuns) return;
    this.isSweepingActiveRuns = true;
    try {
      await this.repository.expireActiveRunsOlderThan(ACTIVE_RUN_TIMEOUT_MS);
    } catch (error) {
      console.error("Canvas Agent active run timeout sweep failed", error);
    } finally {
      this.isSweepingActiveRuns = false;
    }
  }

  private async enqueuePlanning(run: CanvasAgentRunRow): Promise<void> {
    await this.repository.markRunPlanning(run.id, "Canvas AI 요청을 분석하고 있습니다.");
    await this.jobs.enqueueStepRequestedJob({
      jobType: "canvas_agent_step_requested",
      runId: run.id,
      workspaceId: run.workspace_id,
      canvasId: run.canvas_id,
      requestedByUserId: run.requested_by_user_id,
      schemaVersion: CANVAS_AGENT_SCHEMA_VERSION
    });
  }

  private planDeterministicAction(
    prompt: string,
    _selectedShapeIds: string[],
    toolHelpMode = false
  ): CanvasAgentPlannedAction | null {
    if (!toolHelpMode) return null;

    const normalized = prompt.trim();
    const toolResolution = resolveCanvasAgentToolTarget(normalized);
    if (!toolResolution) {
      const message = readCanvasAgentToolHelpOverview(normalized)
        ?? "아직 알고 있는 Canvas 기능과 맞지 않습니다. 메모, 도형, 색상, 휴지통처럼 툴바에 있는 기능 이름으로 물어봐 주세요.";
      return {
        actionName: "finish",
        input: { summary: message, suppressProgress: true },
        message,
        showProgress: false
      };
    }
    if (toolResolution?.mode === "explain") {
      return {
        actionName: "finish",
        input: { summary: toolResolution.tool.description, suppressProgress: true },
        message: toolResolution.tool.description,
        showProgress: false
      };
    }
    if (toolResolution?.mode === "guide") {
      return {
        actionName: "find_canvas_tool",
        input: { toolTarget: toolResolution.tool.target, toolTargetLabel: toolResolution.tool.label },
        message: toolResolution.tool.message
      };
    }

    return null;
  }

  private async assertDraftSourcesCurrent(canvasId: string, draft: CanvasAgentDraftRow): Promise<void> {
    const expected = draft.draft_spec_json.sourceRevisions;
    const ids = Object.keys(expected);
    if (!ids.length) return;
    const shapes = await this.repository.findShapesByIds(canvasId, ids);
    if (shapes.length !== ids.length || shapes.some((shape) => expected[shape.id] !== Number(shape.revision))) {
      throw canvasAgentDraftStale("Canvas Agent draft sources changed. Create a new draft from the current Canvas.");
    }
  }

  private mapRun(row: CanvasAgentRunRow): CanvasAgentRunPayload {
    const progress = this.readProgress(row.result_json);
    const presentationMode = this.normalizeContext(row.context_json).presentationMode;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      canvasId: row.canvas_id,
      presentationMode,
      status: row.status,
      prompt: row.prompt,
      message: row.result_summary,
      summary: row.result_summary,
      canvasRevision: row.canvas_revision === null ? null : Number(row.canvas_revision),
      progress,
      createdAt: this.iso(row.created_at),
      completedAt: row.completed_at === null ? null : this.iso(row.completed_at),
      expiresAt: this.iso(row.expires_at)
    };
  }

  private normalizeContext(context: Record<string, unknown>) {
    return {
      conversationContext: this.readContextConversation(context.conversationContext),
      presentationMode: context.presentationMode === "background" ? "background" as const : "interactive" as const,
      selectedShapeIds: Array.isArray(context.selectedShapeIds)
        ? context.selectedShapeIds.filter((item): item is string => typeof item === "string")
        : [],
      toolHelpMode: context.toolHelpMode === true,
      viewport: this.readContextViewport(context.viewport)
    };
  }

  private mapStep(row: CanvasAgentStepRow): CanvasAgentStepPayload {
    return {
      id: row.id,
      order: Number(row.step_order),
      actionName: row.action_name,
      status: row.status,
      resourceRefs: row.resource_refs.filter((item): item is string => typeof item === "string"),
      completedAt: row.completed_at === null ? null : this.iso(row.completed_at)
    };
  }

  private mapDraft(row: CanvasAgentDraftRow): CanvasAgentDraftPayload {
    return {
      id: row.id,
      status: row.status,
      summary: row.draft_spec_json.summary,
      spec: row.draft_spec_json,
      appliedShapeIds: row.applied_shape_ids.filter((item): item is string => typeof item === "string"),
      appliedAt: row.applied_at === null ? null : this.iso(row.applied_at),
      expiresAt: this.iso(row.expires_at)
    };
  }

  private readProgress(value: Record<string, unknown>): CanvasAgentProgressPayload | null {
    const progress = value.progress;
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) return null;
    const payload = progress as Record<string, unknown>;
    if (typeof payload.message !== "string") return null;
    const highlightedShapeIds = Array.isArray(payload.highlightedShapeIds)
      ? payload.highlightedShapeIds.filter((item): item is string => typeof item === "string")
      : [];
    const target = payload.targetViewport;
    const targetViewport = target && typeof target === "object" && !Array.isArray(target)
      && ["x", "y", "width", "height"].every((key) => typeof (target as Record<string, unknown>)[key] === "number")
      ? target as CanvasAgentProgressPayload["targetViewport"]
      : null;
    const toolTarget = typeof payload.toolTarget === "string" && payload.toolTarget.trim()
      ? payload.toolTarget.trim()
      : null;
    const toolTargetLabel = typeof payload.toolTargetLabel === "string" && payload.toolTargetLabel.trim()
      ? payload.toolTargetLabel.trim()
      : null;
    return { message: payload.message, highlightedShapeIds, targetViewport, toolTarget, toolTargetLabel };
  }

  private readContextViewport(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const payload = value as Record<string, unknown>;
    return ["x", "y", "width", "height"].every((key) => typeof payload[key] === "number")
      ? payload as { x: number; y: number; width: number; height: number }
      : null;
  }

  private readContextConversation(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const payload = value as Record<string, unknown>;
    return {
      messages: Array.isArray(payload.messages)
        ? payload.messages
            .filter((item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item)
            )
            .map((item) => ({
              role: item.role === "assistant" ? "assistant" as const : "user" as const,
              content: typeof item.content === "string" ? item.content : ""
            }))
            .filter((item) => item.content)
        : [],
      lastTask: payload.lastTask && typeof payload.lastTask === "object" && !Array.isArray(payload.lastTask)
        ? payload.lastTask
        : null
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
