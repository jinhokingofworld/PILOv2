import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { notFound } from "../../../common/api-error";
import { CanvasService } from "../canvas.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import {
  canvasAgentClientRequestIdConflict,
  canvasAgentDraftNotPreview,
  canvasAgentDraftStale,
  canvasAgentIntentNotReady,
  canvasAgentIntentNotReviewable
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
  CanvasAgentActionName,
  CanvasAgentPlannedAction,
  CanvasAgentIntentExamplePayload,
  CanvasAgentIntentExampleRow,
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
const EXTERNAL_DOMAIN_TERMS = [
  "calendar",
  "github",
  "issue",
  "meeting",
  "pr",
  "pull request",
  "pull-request",
  "repo",
  "repository",
  "미팅",
  "보드",
  "이슈",
  "일정",
  "캘린더",
  "풀리퀘스트",
  "회의",
  "회의록"
];
const EXTERNAL_DOMAIN_ACTION_TERMS = [
  "가져와",
  "가져오기",
  "긁어와",
  "등록",
  "목록",
  "불러와",
  "불러오기",
  "생성",
  "수정",
  "연동",
  "예약",
  "조회",
  "추가",
  "호출"
];
const FIND_KEYWORDS = [
  "검색",
  "강조",
  "보여줘",
  "보여",
  "어딨어",
  "어디",
  "위치",
  "찾아줘",
  "찾아",
  "찾",
  "하이라이트"
];
const FOCUS_KEYWORDS = [
  "가운데로",
  "가줘",
  "보여줘",
  "보여",
  "어딨어",
  "어디",
  "위치",
  "이동",
  "줌인",
  "포커스",
  "확대"
];
const SELECT_KEYWORDS = [
  "골라줘",
  "선택",
  "잡아줘",
  "체크",
  "하이라이트",
  "강조"
];
const ORGANIZE_KEYWORDS = [
  "그룹",
  "구조",
  "깔끔",
  "묶어",
  "배열",
  "보기 좋게",
  "정돈",
  "정렬",
  "정리",
  "프레임"
];
const DRAFT_HINT_KEYWORDS = [
  "구조도",
  "그려",
  "다이어그램",
  "리디자인",
  "만들어",
  "사용자 여정",
  "설계",
  "와이어프레임",
  "초안",
  "플로우",
  "흐름"
];
const CODE_HINT_KEYWORDS = [
  "api 예시",
  "component",
  "interface",
  "jwt",
  "react",
  "type",
  "구현 예시",
  "샘플 코드",
  "예시 코드",
  "인터페이스",
  "코드",
  "컴포넌트",
  "타입",
  "함수"
];
const SEARCH_QUERY_SUFFIX_PATTERN =
  /(?:\s*(?:관련|있는\s*곳|있는\s*곳으로|쪽으로|메모들|도형들?|내용|카드들?|노트들|프레임|그룹|블록|툴|도구|기능|위치)\s*)+$/;
const SEARCH_QUERY_CANVAS_EXISTING_PREFIX_PATTERN =
  /^(?:캔버스(?:에|에서|위에|위)?\s*)?(?:생성된|있는|이미\s*만든|만들어둔|만든|배치된|작성한|올려둔|그려둔|추가한)\s+/;
const SEARCH_QUERY_PARTICLE_PATTERN = /\s*(?:을|를|이|가|은|는|좀|한번|으로|로)\s*$/;
const CANVAS_ONLY_REFUSAL_MESSAGE =
  "Canvas AI는 캔버스 안의 도형 찾기, 선택, 화면 이동, 정리 초안, 코드 블록 초안만 도와줄 수 있습니다. Calendar, Issue, PR, Meeting 같은 외부 도메인 데이터는 조회하거나 캔버스에 표현하지 않습니다.";

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
        if (existing.prompt !== values.prompt || JSON.stringify(existing.context_json) !== JSON.stringify(values.context)) {
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
    const [steps, drafts, intentExamples] = await Promise.all([
      this.repository.listSteps(run.id),
      this.repository.listDrafts(run.id),
      this.repository.listIntentExamples(run.id)
    ]);
    return {
      run: this.mapRun(run),
      steps: steps.map((step) => this.mapStep(step)),
      drafts: drafts.map((draft) => this.mapDraft(draft)),
      intentExamples: intentExamples.map((example) => this.mapIntentExample(example)),
      canRememberIntent: run.status === "completed"
        && intentExamples.length === 0
        && this.canCreateIntentExampleFromSteps(steps)
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
    const intentExample = await this.createIntentExampleForRun(
      currentUserId,
      workspaceId,
      canvasId,
      draft.run_id
    );
    return {
      draft: this.mapDraft(applied),
      intentExample: intentExample ? this.mapIntentExample(intentExample) : null,
      latestOpSeq,
      batch
    };
  }

  async rememberRunIntent(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentIntentExamplePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const run = await this.repository.findRunForRequester(currentUserId, workspaceId, canvasId, runId);
    if (!run) throw notFound("Canvas Agent run not found");
    if (run.status !== "completed") {
      throw canvasAgentIntentNotReviewable("Canvas Agent result must be completed before it can be remembered");
    }

    const example = await this.createIntentExampleForRun(currentUserId, workspaceId, canvasId, run.id);
    if (!example) {
      throw canvasAgentIntentNotReviewable("This Canvas Agent result cannot be remembered safely");
    }
    return this.mapIntentExample(example);
  }

  async approveIntentExample(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    intentExampleId: string
  ): Promise<CanvasAgentIntentExamplePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const existing = await this.repository.findIntentExampleForRequester(
      currentUserId,
      workspaceId,
      canvasId,
      intentExampleId
    );
    if (!existing) throw notFound("Canvas Agent intent example not found");
    if (existing.status !== "pending") {
      throw canvasAgentIntentNotReviewable("Canvas Agent intent example is no longer pending review");
    }
    if (existing.embedding_status !== "completed") {
      throw canvasAgentIntentNotReady("Canvas Agent is preparing this expression for review");
    }

    const approved = await this.repository.approveIntentExample(intentExampleId, currentUserId);
    if (!approved) {
      throw canvasAgentIntentNotReviewable("Canvas Agent intent example is no longer pending review");
    }
    return this.mapIntentExample(approved);
  }

  async rejectIntentExample(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    intentExampleId: string
  ): Promise<CanvasAgentIntentExamplePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const existing = await this.repository.findIntentExampleForRequester(
      currentUserId,
      workspaceId,
      canvasId,
      intentExampleId
    );
    if (!existing) throw notFound("Canvas Agent intent example not found");
    if (existing.status !== "pending") {
      throw canvasAgentIntentNotReviewable("Canvas Agent intent example is no longer pending review");
    }
    const rejected = await this.repository.rejectIntentExample(intentExampleId, currentUserId);
    if (!rejected) {
      throw canvasAgentIntentNotReviewable("Canvas Agent intent example is no longer pending review");
    }
    return this.mapIntentExample(rejected);
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
        const output = { progress: result.progress, summary: result.summary };
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
    const selectedIds = selectedShapeIds.filter((id) => Boolean(id.trim())).slice(0, 40);
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

    if (this.isExternalDomainRequest(normalized)) {
      return {
        actionName: "finish",
        input: { summary: CANVAS_ONLY_REFUSAL_MESSAGE },
        message: CANVAS_ONLY_REFUSAL_MESSAGE
      };
    }

    if (selectedIds.length && this.hasAnyKeyword(normalized, ORGANIZE_KEYWORDS)) {
      return {
        actionName: "create_draft",
        input: { kind: "organize", sourceShapeIds: selectedIds },
        message: "선택한 도형을 정리하는 Canvas AI 초안을 준비하고 있습니다."
      };
    }

    if (selectedIds.length && this.hasAnyKeyword(normalized, FOCUS_KEYWORDS)) {
      return {
        actionName: "focus_viewport",
        input: { shapeIds: selectedIds },
        message: "선택한 도형 위치로 이동하고 있습니다."
      };
    }

    if (selectedIds.length && this.hasAnyKeyword(normalized, SELECT_KEYWORDS)) {
      return {
        actionName: "select_shapes",
        input: { shapeIds: selectedIds },
        message: "선택한 도형을 강조하고 있습니다."
      };
    }

    const query = this.findSearchQuery(normalized);
    if (query) {
      const select = this.hasAnyKeyword(normalized, SELECT_KEYWORDS);
      const focus = this.hasAnyKeyword(normalized, FOCUS_KEYWORDS);
      if (select && !focus) {
        return {
          actionName: "select_shapes",
          input: { query },
          message: `“${query}” 관련 도형을 선택하고 있습니다.`
        };
      }

      return {
        actionName: "find_shapes",
        input: { query, continuePlanning: true, focusResult: focus },
        message: `“${query}” 관련 도형을 찾고 있습니다.`
      };
    }

    if (this.hasAnyKeyword(normalized, DRAFT_HINT_KEYWORDS)
      || this.hasAnyKeyword(normalized, CODE_HINT_KEYWORDS)) {
      return null;
    }

    return null;
  }

  private isExternalDomainRequest(prompt: string): boolean {
    const lowerPrompt = prompt.toLowerCase();
    return this.hasAnyKeyword(lowerPrompt, EXTERNAL_DOMAIN_TERMS)
      && this.hasAnyKeyword(lowerPrompt, EXTERNAL_DOMAIN_ACTION_TERMS);
  }

  private hasAnyKeyword(prompt: string, keywords: string[]): boolean {
    return keywords.some((keyword) => prompt.includes(keyword));
  }

  private findSearchQuery(prompt: string): string | null {
    if (!this.hasAnyKeyword(prompt, [...FIND_KEYWORDS, ...FOCUS_KEYWORDS, ...SELECT_KEYWORDS])) return null;
    const hit = this.firstKeywordIndex(prompt, [...FIND_KEYWORDS, ...FOCUS_KEYWORDS, ...SELECT_KEYWORDS]);
    if (!hit || hit.index <= 0) return null;

    let query = prompt.slice(0, hit.index).trim();
    for (let guard = 0; guard < 4; guard += 1) {
      const withoutExistingPrefix = query
        .replace(SEARCH_QUERY_CANVAS_EXISTING_PREFIX_PATTERN, "")
        .trim();
      const withoutSuffix = withoutExistingPrefix
        .replace(SEARCH_QUERY_SUFFIX_PATTERN, "")
        .replace(SEARCH_QUERY_PARTICLE_PATTERN, "")
        .trim();
      const next = withoutSuffix || withoutExistingPrefix;
      if (!next) break;
      if (next === query) break;
      query = next;
    }
    return query && query.length <= 120 ? query : null;
  }

  private firstKeywordIndex(
    prompt: string,
    keywords: string[]
  ): { index: number; keyword: string } | null {
    return keywords.reduce<{ index: number; keyword: string } | null>((best, keyword) => {
      const index = prompt.indexOf(keyword);
      if (index < 0) return best;
      if (!best || index < best.index || (index === best.index && keyword.length > best.keyword.length)) {
        return { index, keyword };
      }
      return best;
    }, null);
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

  private async createIntentExampleForRun(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    runId: string
  ): Promise<CanvasAgentIntentExampleRow | null> {
    const existing = await this.repository.findIntentExampleForRun(currentUserId, workspaceId, runId);
    if (existing) return existing;

    const run = await this.repository.findRunForRequester(currentUserId, workspaceId, canvasId, runId);
    if (!run || run.status !== "completed") return null;
    const step = await this.repository.findLatestPlannerStep(run.id);
    if (!step) return null;

    const candidate = this.toIntentCandidate(step.action_name, step.input_json);
    if (!candidate) return null;
    return this.repository.createPendingIntentExample({
      actionTemplate: candidate.actionTemplate,
      currentUserId,
      intent: candidate.intent,
      runId: run.id,
      utterance: run.prompt,
      workspaceId
    });
  }

  private toIntentCandidate(
    actionName: CanvasAgentActionName,
    input: Record<string, unknown>
  ): { actionTemplate: Record<string, unknown>; intent: CanvasAgentActionName } | null {
    if (actionName === "find_shapes") {
      return {
        intent: "find_shapes",
        actionTemplate: {
          actionName: "find_shapes",
          focusResult: input.focusResult === true
        }
      };
    }

    if (actionName === "create_draft") {
      const kind = input.kind === "organize" ? "organize" : "diagram";
      const style = typeof input.style === "string" ? input.style.trim().slice(0, 300) : "";
      return {
        intent: "create_draft",
        actionTemplate: {
          actionName: "create_draft",
          kind,
          ...(style ? { style } : {})
        }
      };
    }

    return null;
  }

  private canCreateIntentExampleFromSteps(steps: CanvasAgentStepRow[]): boolean {
    const plannerStep = [...steps].reverse().find((step) =>
      step.status === "completed"
      && Boolean(step.model_name)
      && !step.model_name?.startsWith("local:")
      && step.action_name !== "finish"
    );
    return Boolean(plannerStep && this.toIntentCandidate(plannerStep.action_name, plannerStep.input_json));
  }

  private mapRun(row: CanvasAgentRunRow): CanvasAgentRunPayload {
    const progress = this.readProgress(row.result_json);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      canvasId: row.canvas_id,
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

  private mapIntentExample(row: CanvasAgentIntentExampleRow): CanvasAgentIntentExamplePayload {
    return {
      id: row.id,
      intent: row.intent,
      status: row.status,
      embeddingStatus: row.embedding_status,
      createdAt: this.iso(row.created_at),
      reviewedAt: row.reviewed_at === null ? null : this.iso(row.reviewed_at),
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

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
