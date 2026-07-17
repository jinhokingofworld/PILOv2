import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import {
  PrReviewService,
  type PrReviewAgentFocusData
} from "../../pr-review/pr-review.service";
import type {
  AgentJsonObject,
  AgentResourceRef,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolInputSchema,
  AgentToolPreparationResult
} from "../types/agent-tool.types";

type PrReviewFocus = "api" | "backend" | "frontend" | "test";

type RecommendPrReviewFocusInput = {
  focus: PrReviewFocus | null;
};

const FOCUS_VALUES: PrReviewFocus[] = ["api", "backend", "frontend", "test"];
const FOCUS_INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    focus: {
      type: ["string", "null"],
      enum: [...FOCUS_VALUES, null]
    }
  }
};

const ROLE_PRIORITY = {
  core_logic: 0,
  api_contract: 1,
  entry: 2,
  ui_state: 3,
  verification: 4,
  support: 5,
  unknown: 6
} as const;

const RISK_PRIORITY = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3
} as const;

const REVIEW_STATUS_PRIORITY = {
  discussion_needed: 0,
  unknown: 1,
  not_reviewed: 2,
  approved: 3
} as const;

@Injectable()
export class PrReviewAgentToolsService {
  constructor(private readonly prReviewService: PrReviewService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      {
        name: "recommend_pr_review_focus",
        description:
          "현재 PR Review revision의 저장된 위험도, 역할, 변경 요약, 검토 포인트와 파일 관계만 사용해 먼저 볼 파일을 최대 3개와 관련 파일을 최대 2개 추천합니다. raw diff, 코드, 사용자 comment는 조회하거나 반환하지 않습니다.",
        riskLevel: "low",
        executionMode: "contextual",
        contextRequirement: { surface: "pr_review" },
        inputSchema: FOCUS_INPUT_SCHEMA,
        validateInput: (input) => this.validateInput(input),
        prepareExecution: (context, input) =>
          this.prepareExecution(context, this.validateInput(input)),
        execute: (context, input) =>
          this.execute(context, this.validateInput(input))
      }
    ];
  }

  private validateInput(input: unknown): RecommendPrReviewFocusInput {
    if (!this.isPlainObject(input)) {
      throw badRequest("recommend_pr_review_focus input must be an object");
    }

    const unexpectedField = Object.keys(input).find((key) => key !== "focus");
    if (unexpectedField) {
      throw badRequest(
        `recommend_pr_review_focus input field is invalid: ${unexpectedField}`
      );
    }

    if (input.focus === undefined || input.focus === null) {
      return { focus: null };
    }
    if (!FOCUS_VALUES.includes(input.focus as PrReviewFocus)) {
      throw badRequest("recommend_pr_review_focus focus is invalid");
    }
    return { focus: input.focus as PrReviewFocus };
  }

  private async prepareExecution(
    context: AgentToolContext,
    _input: RecommendPrReviewFocusInput
  ): Promise<AgentToolPreparationResult> {
    const data = await this.loadFocusData(context);
    const guidance = this.statusGuidance(data);
    if (!guidance) {
      return { kind: "execute" };
    }

    return {
      kind: "needs_clarification",
      outputSummary: {
        status: data.status,
        message: guidance
      },
      resourceRefs: []
    };
  }

  private async execute(
    context: AgentToolContext,
    input: RecommendPrReviewFocusInput
  ): Promise<AgentToolExecutionResult> {
    const data = await this.loadFocusData(context);
    const guidance = this.statusGuidance(data);
    if (guidance) {
      return {
        outputSummary: { status: data.status, message: guidance },
        resourceRefs: [],
        status: "needs_clarification"
      };
    }

    const candidates = data.files
      .filter((file) => this.matchesFocus(file.roleType, input.focus))
      .sort((left, right) => this.compareFiles(left, right));
    const mustReview = candidates.slice(0, 3);
    const primaryIds = new Set(mustReview.map((file) => file.id));
    const fileById = new Map(data.files.map((file) => [file.id, file]));
    const relatedIds = new Set<string>();
    for (const relation of data.relations) {
      if (!this.isRelatedRelation(relation.relationType)) {
        continue;
      }
      if (primaryIds.has(relation.fromReviewFileId)) {
        relatedIds.add(relation.toReviewFileId);
      }
      if (primaryIds.has(relation.toReviewFileId)) {
        relatedIds.add(relation.fromReviewFileId);
      }
    }
    const relatedFiles = [...relatedIds]
      .filter((id) => !primaryIds.has(id))
      .map((id) => fileById.get(id))
      .filter((file): file is PrReviewAgentFocusData["files"][number] => Boolean(file))
      .sort((left, right) => this.compareFiles(left, right))
      .slice(0, 2);

    const mustReviewSummary = mustReview.map((file) =>
      this.serializeFile(file, "우선 검토 대상")
    );
    const relatedSummary = relatedFiles.map((file) =>
      this.serializeFile(file, "연관 확인 대상")
    );

    return {
      outputSummary: {
        reviewSessionId: data.reviewSessionId,
        status: data.status,
        focus: input.focus,
        mustReview: mustReviewSummary,
        relatedFiles: relatedSummary,
        relationCount: data.relations.length
      },
      resourceRefs: [...mustReview, ...relatedFiles].map((file) => ({
        domain: "pr_review",
        resourceType: "review_file",
        resourceId: file.id,
        label: file.filePath,
        url: `/pr-review?reviewSessionId=${encodeURIComponent(data.reviewSessionId)}`,
        status: primaryIds.has(file.id) ? "must_review" : "related"
      })),
      status: "recommended"
    };
  }

  private async loadFocusData(
    context: AgentToolContext
  ): Promise<PrReviewAgentFocusData> {
    if (context.requestContext?.surface !== "pr_review") {
      throw badRequest("PR Review context is required");
    }
    return this.prReviewService.getReviewSessionAgentFocusData(
      context.currentUserId,
      context.workspaceId,
      context.requestContext.sessionId
    );
  }

  private statusGuidance(data: PrReviewAgentFocusData): string | null {
    if (data.status === "analyzing") {
      return "PR 분석이 완료된 뒤 핵심 파일을 추천할 수 있습니다.";
    }
    if (data.status === "failed") {
      return "PR 분석이 실패했습니다. 분석을 다시 시도한 뒤 핵심 파일을 추천할 수 있습니다.";
    }
    return null;
  }

  private matchesFocus(
    roleType: PrReviewAgentFocusData["files"][number]["roleType"],
    focus: PrReviewFocus | null
  ): boolean {
    if (!focus) {
      return true;
    }
    const rolesByFocus: Record<PrReviewFocus, readonly string[]> = {
      api: ["api_contract"],
      backend: ["entry", "core_logic", "support"],
      frontend: ["ui_state"],
      test: ["verification"]
    };
    return rolesByFocus[focus].includes(roleType);
  }

  private compareFiles(
    left: PrReviewAgentFocusData["files"][number],
    right: PrReviewAgentFocusData["files"][number]
  ): number {
    return (
      REVIEW_STATUS_PRIORITY[left.reviewStatus] -
        REVIEW_STATUS_PRIORITY[right.reviewStatus] ||
      RISK_PRIORITY[left.riskLevel] - RISK_PRIORITY[right.riskLevel] ||
      ROLE_PRIORITY[left.roleType] - ROLE_PRIORITY[right.roleType] ||
      left.filePath.localeCompare(right.filePath) ||
      left.id.localeCompare(right.id)
    );
  }

  private isRelatedRelation(
    relationType: PrReviewAgentFocusData["relations"][number]["relationType"]
  ): boolean {
    return ["tests", "uses_api", "passes_data_to"].includes(relationType);
  }

  private serializeFile(
    file: PrReviewAgentFocusData["files"][number],
    recommendation: string
  ): AgentJsonObject {
    return {
      filePath: file.filePath,
      riskLevel: file.riskLevel,
      roleType: file.roleType,
      changeSummary: file.changeSummary,
      reviewPoints: file.reviewPoints.slice(0, 5),
      reviewStatus: file.reviewStatus,
      recommendation
    };
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
