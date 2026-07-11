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
import { resolveCanvasAgentToolTarget } from "./canvas-agent-tool-targets";
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
const MAX_CANVAS_AGENT_STEPS = 3;

@Injectable()
export class CanvasAgentService implements OnModuleDestroy, OnModuleInit {
  private actionTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

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
  }

  onModuleDestroy(): void {
    if (this.actionTimer) clearInterval(this.actionTimer);
    this.actionTimer = null;
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
      this.drafts.toShapeBatch(draft.draft_spec_json, clientOperationId)
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
        let resourceRefs = result.resourceRefs;
        if (result.draftSpec) {
          const draft = await this.repository.createDraft({
            runId: claimed.run.id,
            canvasId: claimed.run.canvas_id,
            currentUserId: claimed.run.requested_by_user_id,
            spec: result.draftSpec
          });
          resourceRefs = [...resourceRefs, draft.id];
        }
        let createdShapeIds: string[] = [];
        let latestOpSeq: number | null = null;
        if (result.shapeBatch) {
          const batch = await this.canvasService.syncShapesBatch(
            claimed.run.requested_by_user_id,
            claimed.run.workspace_id,
            claimed.run.canvas_id,
            result.shapeBatch
          );
          createdShapeIds = batch.shapes.map((shape) => shape.id);
          latestOpSeq = Math.max(0, ...batch.shapes.map((shape) => shape.opSeq ?? 0));
          resourceRefs = [...resourceRefs, ...createdShapeIds];
        }
        const output = { progress: result.progress, summary: result.summary, createdShapeIds, latestOpSeq };
        await this.repository.completeStep(claimed.step.id, output, resourceRefs);

        if (result.draftSpec) {
          await this.repository.markRunDraftReady(claimed.run.id, result.summary, output);
          return;
        }
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
    selectedShapeIds: string[],
    toolHelpMode = false
  ): CanvasAgentPlannedAction | null {
    const normalized = prompt.trim();
    const toolResolution = toolHelpMode ? resolveCanvasAgentToolTarget(normalized) : null;
    if (toolHelpMode && !toolResolution) {
      const message = "아직 알고 있는 Canvas 기능과 맞지 않습니다. 메모, 도형, 색상, 휴지통처럼 툴바에 있는 기능 이름으로 물어봐 주세요.";
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
    if (!toolHelpMode && selectedShapeIds.length === 2 && this.isConnectPrompt(normalized)) {
      const connectionKind = this.isLineConnectPrompt(normalized) ? "line" : "arrow";
      const message = connectionKind === "line"
        ? "선택한 두 도형을 선으로 연결할게요."
        : "선택한 두 도형을 화살표로 연결할게요.";
      return {
        actionName: "connect_shapes",
        input: {
          fromShapeId: selectedShapeIds[0],
          toShapeId: selectedShapeIds[1],
          connectionKind
        },
        message
      };
    }

    return null;
  }

  private isConnectPrompt(value: string): boolean {
    return /(연결|이어|이어서|화살표|커넥터|선으로|선으?로\s*이어)/.test(value);
  }

  private isLineConnectPrompt(value: string): boolean {
    return /(선으로|선으?로\s*이어|연결선)/.test(value) && !/(화살표)/.test(value);
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
      presentationMode: context.presentationMode === "background" ? "background" as const : "interactive" as const,
      selectedShapeIds: Array.isArray(context.selectedShapeIds)
        ? context.selectedShapeIds.filter((item): item is string => typeof item === "string")
        : [],
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

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
