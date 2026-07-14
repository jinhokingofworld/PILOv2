import { Injectable, Logger } from "@nestjs/common";
import type { PrReviewConflictHunkPayload } from "./pr-review-conflict-analyzer";
import {
  buildResolvedFileContent,
  normalizeConflictContent,
  type PrReviewResolvedHunkPayload
} from "./pr-review-conflict-resolution";
import type {
  PrReviewGithubChangedFile,
  PrReviewGithubPullRequestDetail,
  PrReviewFileRiskLevel
} from "./types";
import type { PrReviewValidatedSemanticGraph } from "./pr-review-semantic-validator";

const DEFAULT_OPENAI_MODEL = "gpt-5.1-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PR_BODY_CHARS = 4000;
const MAX_PATCH_CHARS_PER_FILE = 4000;
const MAX_TOTAL_PATCH_CHARS = 32000;
const MAX_CONFLICT_HUNKS = 8;
const MAX_CONFLICT_TEXT_CHARS_PER_HUNK = 3000;
const MAX_RESOLVED_CONTENT_CHARS = 200 * 1024;
const CONFLICT_MARKER_PATTERN = /(^|\n)(<<<<<<<|=======|>>>>>>>)(?:\s|$)/;

export interface ReviewFileMetadata {
  filePath: string;
  fileRole: string;
  riskLevel: PrReviewFileRiskLevel;
  changeReason: string;
  changeSummary: string;
  reviewPoints: string[];
}

export interface PrReviewAnalysisResult {
  prPurpose: string;
  changeSummary: string[];
  recommendedReviewOrder: string;
  cautionPoints: string[];
  flowTitle: string;
  flowDescription: string;
  files: ReviewFileMetadata[];
  semanticGraph?: PrReviewValidatedSemanticGraph;
}

export interface PrReviewConflictSuggestionInput {
  filePath: string;
  previousFilePath: string | null;
  headContent: string;
  hunks: PrReviewConflictHunkPayload[];
  currentDraft: PrReviewConflictSuggestionCurrentDraft | null;
}

export type PrReviewConflictSuggestionDraftSource =
  | "ai"
  | "pr"
  | "target"
  | "both"
  | "manual";

export interface PrReviewConflictSuggestionCurrentDraft {
  resolvedContent: string;
  hunks: Array<{
    hunkId: string;
    source: PrReviewConflictSuggestionDraftSource;
    resolvedText: string;
  }>;
}

export type PrReviewConflictSuggestionValidationStatus = "valid" | "invalid";

export interface PrReviewConflictSuggestionResult {
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: PrReviewResolvedHunkPayload[];
  resolvedContent: string;
  validationStatus: PrReviewConflictSuggestionValidationStatus;
  validationMessages: string[];
}

interface PrReviewConflictSuggestionDraft {
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: PrReviewResolvedHunkPayload[];
}

interface OpenAiResponseBody {
  output_text?: unknown;
  output?: unknown;
  error?: {
    message?: unknown;
  };
}

const PR_REVIEW_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "prPurpose",
    "changeSummary",
    "recommendedReviewOrder",
    "cautionPoints",
    "flowTitle",
    "flowDescription",
    "files"
  ],
  properties: {
    prPurpose: { type: "string" },
    changeSummary: {
      type: "array",
      items: { type: "string" }
    },
    recommendedReviewOrder: { type: "string" },
    cautionPoints: {
      type: "array",
      items: { type: "string" }
    },
    flowTitle: { type: "string" },
    flowDescription: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "filePath",
          "fileRole",
          "riskLevel",
          "changeReason",
          "changeSummary",
          "reviewPoints"
        ],
        properties: {
          filePath: { type: "string" },
          fileRole: { type: "string" },
          riskLevel: {
            type: "string",
            enum: ["high", "medium", "low", "unknown"]
          },
          changeReason: { type: "string" },
          changeSummary: { type: "string" },
          reviewPoints: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    }
  }
} as const;

const PR_REVIEW_CONFLICT_SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aiSummary", "aiSuggestion", "resolvedHunks"],
  properties: {
    aiSummary: { type: "string" },
    aiSuggestion: { type: "string" },
    resolvedHunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hunkId", "resolvedText"],
        properties: {
          hunkId: { type: "string" },
          resolvedText: { type: "string" }
        }
      }
    }
  }
} as const;

@Injectable()
export class PrReviewAnalysisService {
  private readonly logger = new Logger(PrReviewAnalysisService.name);

  async analyzePullRequest(
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): Promise<PrReviewAnalysisResult> {
    const fallback = this.buildDeterministicAnalysis(detail, files);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return fallback;
    }

    try {
      const rawAnalysis = await this.requestOpenAiAnalysis(apiKey, detail, files);
      return this.normalizeAnalysisResult(rawAnalysis, fallback, files);
    } catch (error) {
      this.logger.warn(
        `PR Review AI analysis fallback used: ${this.getErrorMessage(error)}`
      );
      return fallback;
    }
  }

  async suggestConflictResolution(
    input: PrReviewConflictSuggestionInput
  ): Promise<PrReviewConflictSuggestionResult> {
    const fallback = this.buildDeterministicConflictSuggestion(input);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this.withConflictSuggestionValidation(input, fallback);
    }

    try {
      const rawSuggestion = await this.requestOpenAiConflictSuggestion(
        apiKey,
        input
      );
      return this.normalizeConflictSuggestion(rawSuggestion, fallback, input);
    } catch (error) {
      this.logger.warn(
        `PR Review conflict suggestion fallback used: ${this.getErrorMessage(
          error
        )}`
      );
      return this.withConflictSuggestionValidation(input, fallback);
    }
  }

  private async requestOpenAiAnalysis(
    apiKey: string,
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.getOpenAiTimeoutMs()
    );

    try {
      const response = await fetch(
        process.env.OPENAI_RESPONSES_API_URL ?? OPENAI_RESPONSES_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: process.env.OPENAI_PR_REVIEW_MODEL ?? DEFAULT_OPENAI_MODEL,
            input: [
              {
                role: "system",
                content:
                  "You are PILO's PR review analysis engine. Return concise Korean review planning data only in the requested JSON schema."
              },
              {
                role: "user",
                content: JSON.stringify(this.buildPromptInput(detail, files))
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "pr_review_analysis",
                schema: PR_REVIEW_ANALYSIS_SCHEMA,
                strict: true
              }
            }
          }),
          signal: controller.signal
        }
      );
      const body = await this.readJsonResponse(response);
      if (!response.ok) {
        const message =
          typeof body.error?.message === "string"
            ? body.error.message
            : `OpenAI Responses API returned ${response.status}`;
        throw new Error(message);
      }

      const outputText = this.extractOutputText(body);
      if (!outputText) {
        throw new Error("OpenAI response did not include output text");
      }

      return JSON.parse(outputText);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestOpenAiConflictSuggestion(
    apiKey: string,
    input: PrReviewConflictSuggestionInput
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.getOpenAiTimeoutMs()
    );

    try {
      const response = await fetch(
        process.env.OPENAI_RESPONSES_API_URL ?? OPENAI_RESPONSES_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: process.env.OPENAI_PR_REVIEW_MODEL ?? DEFAULT_OPENAI_MODEL,
            input: [
              {
                role: "system",
                content:
                  "You are PILO's PR conflict resolution assistant. Return concise Korean explanation and one raw resolved code block for every requested conflict hunk in the requested JSON schema."
              },
              {
                role: "user",
                content: JSON.stringify(
                  this.buildConflictSuggestionPromptInput(input)
                )
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "pr_review_conflict_suggestion",
                schema: PR_REVIEW_CONFLICT_SUGGESTION_SCHEMA,
                strict: true
              }
            }
          }),
          signal: controller.signal
        }
      );
      const body = await this.readJsonResponse(response);
      if (!response.ok) {
        const message =
          typeof body.error?.message === "string"
            ? body.error.message
            : `OpenAI Responses API returned ${response.status}`;
        throw new Error(message);
      }

      const outputText = this.extractOutputText(body);
      if (!outputText) {
        throw new Error("OpenAI response did not include output text");
      }

      return JSON.parse(outputText);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPromptInput(
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): unknown {
    let remainingPatchChars = MAX_TOTAL_PATCH_CHARS;

    return {
      task:
        "Analyze this pull request for an MVP PR review workflow. Keep every file in the response and match each file by filePath.",
      riskLevelGuidance: {
        high:
          "Security, auth, payment, data/schema/migration, deletion, or broad runtime impact.",
        medium:
          "Main app/server logic, important feature behavior, or sizeable but reviewable changes.",
        low: "Docs, tests, styling, or isolated low-impact changes.",
        unknown:
          "Binary files, unavailable patch context, or insufficient information to judge."
      },
      pullRequest: {
        number: detail.prNumber,
        title: detail.title,
        body: this.truncateText(detail.body, MAX_PR_BODY_CHARS),
        state: detail.state,
        draft: detail.draft,
        mergeable: detail.mergeable,
        authorLogin: detail.authorLogin,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        headSha: detail.headSha,
        baseSha: detail.baseSha,
        changedFilesCount: detail.changedFilesCount,
        additions: detail.additions,
        deletions: detail.deletions,
        commitsCount: detail.commitsCount
      },
      files: files.map((file, index) => {
        const patchSnippet = this.takePatchSnippet(file.patch, remainingPatchChars);
        remainingPatchChars -= patchSnippet?.length ?? 0;

        return {
          order: index + 1,
          filePath: file.filePath,
          previousFilePath: file.previousFilePath,
          fileName: file.fileName,
          fileStatus: file.fileStatus,
          additions: file.additions,
          deletions: file.deletions,
          isBinary: file.isBinary,
          isLargeDiff: file.isLargeDiff,
          patchSnippet,
          patchOmitted:
            patchSnippet === null
              ? file.patch === null
                ? "patch_unavailable"
                : "patch_budget_exhausted"
              : null
        };
      })
    };
  }

  private buildConflictSuggestionPromptInput(
    input: PrReviewConflictSuggestionInput
  ): unknown {
    return {
      task:
        "Create one draft resolution for every provided content conflict hunk. Match each result by hunkId. Do not claim that the branch was modified or the PR was merged.",
      outputRules: {
        aiSummary:
          "Explain the conflict cause in Korean in one or two concise sentences.",
        aiSuggestion:
          "Describe the resolution direction in Korean without mentioning unsupported write actions.",
        resolvedHunks:
          "Return every requested hunkId exactly once with only the raw resolved code for that hunk. Do not wrap code in Markdown fences and do not include conflict markers."
      },
      validationRules: [
        "Every requested hunkId must appear exactly once.",
        "resolvedText must not contain <<<<<<<, =======, or >>>>>>>.",
        "An empty resolvedText is allowed only when deleting the entire conflict hunk is intentional.",
        "Prefer preserving both current and incoming intent when they do not contradict each other.",
        "Treat currentDraft as user work that should inform every suggestion. Do not discard manual intent without a clear conflict.",
        "currentDraft.resolvedContent may include unresolved conflict markers. Use them only as context and never copy them into resolvedText."
      ],
      file: {
        filePath: input.filePath,
        previousFilePath: input.previousFilePath,
        headContent: this.truncateText(
          input.headContent,
          MAX_RESOLVED_CONTENT_CHARS
        )
      },
      hunks: input.hunks.slice(0, MAX_CONFLICT_HUNKS).map((hunk) => ({
        id: hunk.id,
        header: hunk.header,
        baseStartLine: hunk.baseStartLine,
        currentStartLine: hunk.currentStartLine,
        incomingStartLine: hunk.incomingStartLine,
        baseText: this.truncateText(
          hunk.baseText,
          MAX_CONFLICT_TEXT_CHARS_PER_HUNK
        ),
        currentText: this.truncateText(
          hunk.currentText,
          MAX_CONFLICT_TEXT_CHARS_PER_HUNK
        ),
        incomingText: this.truncateText(
          hunk.incomingText,
          MAX_CONFLICT_TEXT_CHARS_PER_HUNK
        )
      })),
      currentDraft: input.currentDraft
        ? {
            resolvedContent: this.truncateText(
              input.currentDraft.resolvedContent,
              MAX_RESOLVED_CONTENT_CHARS
            ),
            hunks: input.currentDraft.hunks.map((hunk) => ({
              hunkId: hunk.hunkId,
              source: hunk.source,
              resolvedText: this.truncateText(
                hunk.resolvedText,
                MAX_CONFLICT_TEXT_CHARS_PER_HUNK
              )
            }))
          }
        : null
    };
  }

  private takePatchSnippet(patch: string | null, remainingChars: number): string | null {
    if (patch === null || remainingChars <= 0) {
      return null;
    }

    return this.truncateText(
      patch,
      Math.min(MAX_PATCH_CHARS_PER_FILE, remainingChars)
    );
  }

  private normalizeAnalysisResult(
    value: unknown,
    fallback: PrReviewAnalysisResult,
    files: PrReviewGithubChangedFile[]
  ): PrReviewAnalysisResult {
    if (!this.isRecord(value)) {
      throw new Error("AI analysis result must be an object");
    }

    const rawFiles = Array.isArray(value.files) ? value.files : [];
    const normalizedFiles = files.map((file, index) => {
      const fallbackFile = fallback.files[index];
      const rawFile =
        rawFiles.find(
          (candidate) =>
            this.isRecord(candidate) && candidate.filePath === file.filePath
        ) ??
        (this.isRecord(rawFiles[index]) ? rawFiles[index] : null);

      return this.normalizeFileMetadata(rawFile, fallbackFile, file.filePath);
    });

    return {
      prPurpose: this.cleanString(value.prPurpose, fallback.prPurpose),
      changeSummary: this.cleanStringArray(
        value.changeSummary,
        fallback.changeSummary,
        6
      ),
      recommendedReviewOrder: this.cleanString(
        value.recommendedReviewOrder,
        fallback.recommendedReviewOrder
      ),
      cautionPoints: this.cleanStringArray(
        value.cautionPoints,
        fallback.cautionPoints,
        6
      ),
      flowTitle: this.cleanString(value.flowTitle, fallback.flowTitle),
      flowDescription: this.cleanString(
        value.flowDescription,
        fallback.flowDescription
      ),
      files: normalizedFiles
    };
  }

  private normalizeConflictSuggestion(
    value: unknown,
    fallback: PrReviewConflictSuggestionDraft,
    input: PrReviewConflictSuggestionInput
  ): PrReviewConflictSuggestionResult {
    if (!this.isRecord(value)) {
      throw new Error("AI conflict suggestion result must be an object");
    }

    const fallbackByHunkId = new Map(
      fallback.resolvedHunks.map((hunk) => [hunk.hunkId, hunk.resolvedText])
    );
    const rawResolvedHunks = Array.isArray(value.resolvedHunks)
      ? value.resolvedHunks
      : [];
    const resolvedTextByHunkId = new Map<string, string>();

    for (const candidate of rawResolvedHunks) {
      if (
        !this.isRecord(candidate) ||
        typeof candidate.hunkId !== "string" ||
        typeof candidate.resolvedText !== "string"
      ) {
        continue;
      }

      resolvedTextByHunkId.set(
        candidate.hunkId,
        normalizeConflictContent(candidate.resolvedText)
      );
    }

    const resolvedHunks = input.hunks.map((hunk) => ({
      hunkId: hunk.id,
      resolvedText:
        resolvedTextByHunkId.get(hunk.id) ??
        fallbackByHunkId.get(hunk.id) ??
        hunk.incomingText
    }));

    return this.withConflictSuggestionValidation(input, {
      aiSummary: this.cleanString(value.aiSummary, fallback.aiSummary),
      aiSuggestion: this.cleanString(value.aiSuggestion, fallback.aiSuggestion),
      resolvedHunks
    });
  }

  private normalizeFileMetadata(
    value: unknown,
    fallback: ReviewFileMetadata,
    filePath: string
  ): ReviewFileMetadata {
    if (!this.isRecord(value)) {
      return fallback;
    }

    return {
      filePath,
      fileRole: this.cleanString(value.fileRole, fallback.fileRole),
      riskLevel: this.cleanRiskLevel(value.riskLevel, fallback.riskLevel),
      changeReason: this.cleanString(value.changeReason, fallback.changeReason),
      changeSummary: this.cleanString(value.changeSummary, fallback.changeSummary),
      reviewPoints: this.cleanStringArray(
        value.reviewPoints,
        fallback.reviewPoints,
        5
      )
    };
  }

  private buildDeterministicAnalysis(
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): PrReviewAnalysisResult {
    const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const binaryCount = files.filter((file) => file.isBinary).length;
    const largeDiffCount = files.filter((file) => file.isLargeDiff).length;
    const cautionPoints = [
      ...(binaryCount > 0
        ? [`Binary file ${binaryCount}개는 GitHub에서 확인한다.`]
        : []),
      ...(largeDiffCount > 0
        ? [`Large diff file ${largeDiffCount}개는 요약과 GitHub 원문을 함께 확인한다.`]
        : []),
      "제출 전 PR head SHA가 변경되지 않았는지 확인한다."
    ];

    return {
      prPurpose: `#${detail.prNumber} ${detail.title}`,
      changeSummary: [
        `${files.length}개 파일 변경`,
        `추가 ${totalAdditions}줄, 삭제 ${totalDeletions}줄`,
        `base ${detail.baseBranch ?? "unknown"} -> head ${
          detail.headBranch ?? "unknown"
        }`
      ],
      recommendedReviewOrder:
        files.length > 0
          ? "제시된 workflow order 순서대로 변경 범위가 큰 파일부터 확인한다."
          : "변경 파일이 없어 리뷰할 파일이 없다.",
      cautionPoints,
      flowTitle: "PR 변경 파일 리뷰",
      flowDescription:
        "PR Review MVP에서 생성한 기본 workflow로 파일 metadata와 변경 규모를 기준으로 순서를 제공한다.",
      files: files.map((file, index) => ({
        filePath: file.filePath,
        fileRole: this.describeFileRole(file.filePath),
        riskLevel: this.inferFileRiskLevel(file),
        changeReason: `${this.describeFileStatus(file.fileStatus)} 파일이다.`,
        changeSummary: `${file.additions}줄 추가, ${file.deletions}줄 삭제`,
        reviewPoints: [
          `Workflow order ${index + 1}번으로 확인한다.`,
          "변경 의도와 주요 호출부 영향이 일치하는지 확인한다.",
          "리뷰 판단을 approved, discussion_needed, unknown 중 하나로 남긴다."
        ]
      }))
    };
  }

  private buildDeterministicConflictSuggestion(
    input: PrReviewConflictSuggestionInput
  ): PrReviewConflictSuggestionDraft {
    const currentTextByHunkId = new Map(
      (input.currentDraft?.hunks ?? []).map((hunk) => [
        hunk.hunkId,
        hunk.resolvedText
      ])
    );

    return {
      aiSummary: `${input.filePath}에서 ${input.hunks.length}개 content conflict 구간이 발견되었습니다.`,
      aiSuggestion:
        "Current와 Incoming 변경 의도를 모두 보존하는 초안을 먼저 확인한 뒤, 중복되거나 충돌하는 줄은 사용자가 적용 전에 조정해야 합니다.",
      resolvedHunks: input.hunks.map((hunk) => ({
        hunkId: hunk.id,
        resolvedText:
          currentTextByHunkId.get(hunk.id) ??
          this.buildDeterministicResolvedHunkText(hunk)
      }))
    };
  }

  private withConflictSuggestionValidation(
    input: PrReviewConflictSuggestionInput,
    draft: PrReviewConflictSuggestionDraft
  ): PrReviewConflictSuggestionResult {
    const validationMessages: string[] = [];
    const resolvedHunks = input.hunks.map((hunk) => {
      const candidate = draft.resolvedHunks.find(
        (resolvedHunk) => resolvedHunk.hunkId === hunk.id
      );
      const resolvedText = normalizeConflictContent(
        candidate?.resolvedText ?? hunk.incomingText
      );

      if (CONFLICT_MARKER_PATTERN.test(resolvedText)) {
        validationMessages.push(`${hunk.id} resolvedText contains conflict marker`);
      }

      return {
        hunkId: hunk.id,
        resolvedText
      };
    });
    const resolvedContent = buildResolvedFileContent({
      headContent: input.headContent,
      hunks: input.hunks,
      resolvedHunks
    });

    if (!resolvedContent.trim()) {
      validationMessages.push("resolvedContent is empty");
    }

    if (resolvedContent.length > MAX_RESOLVED_CONTENT_CHARS) {
      validationMessages.push("resolvedContent is too large");
    }

    if (CONFLICT_MARKER_PATTERN.test(resolvedContent)) {
      validationMessages.push("resolvedContent contains conflict marker");
    }

    return {
      aiSummary: draft.aiSummary,
      aiSuggestion: draft.aiSuggestion,
      resolvedHunks,
      resolvedContent,
      validationStatus: validationMessages.length ? "invalid" : "valid",
      validationMessages
    };
  }

  private buildDeterministicResolvedHunkText(
    hunk: PrReviewConflictHunkPayload
  ): string {
    const currentText = normalizeConflictContent(hunk.currentText);
    const incomingText = normalizeConflictContent(hunk.incomingText);
    const currentTrimmed = currentText.trim();
    const incomingTrimmed = incomingText.trim();

    if (!currentTrimmed) {
      return incomingText;
    }

    if (!incomingTrimmed || incomingText === currentText) {
      return currentText;
    }

    return [incomingText, currentText]
      .filter((text) => text.trim().length > 0)
      .join("\n");
  }

  private describeFileRole(filePath: string): string {
    if (filePath.endsWith(".md")) {
      return "문서";
    }

    if (filePath.includes("/test") || filePath.includes(".test.")) {
      return "테스트";
    }

    if (filePath.includes("/src/app") || filePath.includes("/src/features")) {
      return "프론트엔드";
    }

    if (filePath.includes("/src/modules") || filePath.includes("app-server")) {
      return "백엔드";
    }

    return "일반 변경 파일";
  }

  private inferFileRiskLevel(
    file: PrReviewGithubChangedFile
  ): PrReviewFileRiskLevel {
    const filePath = file.filePath.toLowerCase().replace(/\\/g, "/");
    const changedLineCount = file.additions + file.deletions;

    if (file.isBinary || file.isLargeDiff || file.patch === null) {
      return "unknown";
    }

    if (
      file.fileStatus === "deleted" ||
      changedLineCount >= 1000 ||
      filePath.includes("/db/migrations/") ||
      filePath.includes("/migrations/") ||
      filePath.endsWith("schema.sql") ||
      filePath.endsWith("package-lock.json") ||
      filePath.endsWith("pnpm-lock.yaml") ||
      filePath.endsWith("yarn.lock") ||
      /\b(auth|oauth|security|permission|billing|payment|checkout|token|secret)\b/.test(
        filePath
      )
    ) {
      return "high";
    }

    if (
      changedLineCount >= 250 ||
      filePath.includes("/src/modules/") ||
      filePath.includes("/src/app/") ||
      filePath.includes("/src/features/") ||
      filePath.includes("app-server")
    ) {
      return "medium";
    }

    return "low";
  }

  private describeFileStatus(
    status: PrReviewGithubChangedFile["fileStatus"]
  ): string {
    switch (status) {
      case "added":
        return "추가된";
      case "deleted":
        return "삭제된";
      case "renamed":
        return "이름이 변경된";
      case "modified":
        return "수정된";
    }
  }

  private async readJsonResponse(response: Response): Promise<OpenAiResponseBody> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    const parsed = JSON.parse(text);
    return this.isRecord(parsed) ? (parsed as OpenAiResponseBody) : {};
  }

  private extractOutputText(response: OpenAiResponseBody): string | null {
    if (typeof response.output_text === "string") {
      return response.output_text;
    }

    if (!Array.isArray(response.output)) {
      return null;
    }

    for (const item of response.output) {
      if (!this.isRecord(item) || !Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (
          this.isRecord(content) &&
          content.type === "output_text" &&
          typeof content.text === "string"
        ) {
          return content.text;
        }
      }
    }

    return null;
  }

  private cleanString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : fallback;
  }

  private cleanStringArray(
    value: unknown,
    fallback: string[],
    maxItems: number
  ): string[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, maxItems);

    return items.length > 0 ? items : fallback;
  }

  private cleanRiskLevel(
    value: unknown,
    fallback: PrReviewFileRiskLevel
  ): PrReviewFileRiskLevel {
    return value === "high" ||
      value === "medium" ||
      value === "low" ||
      value === "unknown"
      ? value
      : fallback;
  }

  private truncateText(value: string | null, maxChars: number): string | null {
    if (value === null) {
      return null;
    }

    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
  }

  private getOpenAiTimeoutMs(): number {
    const parsed = Number(process.env.OPENAI_PR_REVIEW_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
