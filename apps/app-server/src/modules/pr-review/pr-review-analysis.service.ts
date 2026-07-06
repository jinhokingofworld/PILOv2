import { Injectable, Logger } from "@nestjs/common";
import type {
  PrReviewGithubChangedFile,
  PrReviewGithubPullRequestDetail
} from "./types";

const DEFAULT_OPENAI_MODEL = "gpt-5.1-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PR_BODY_CHARS = 4000;
const MAX_PATCH_CHARS_PER_FILE = 4000;
const MAX_TOTAL_PATCH_CHARS = 32000;

export interface ReviewFileMetadata {
  filePath: string;
  fileRole: string;
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
          "changeReason",
          "changeSummary",
          "reviewPoints"
        ],
        properties: {
          filePath: { type: "string" },
          fileRole: { type: "string" },
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

  private buildPromptInput(
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): unknown {
    let remainingPatchChars = MAX_TOTAL_PATCH_CHARS;

    return {
      task:
        "Analyze this pull request for an MVP PR review workflow. Keep every file in the response and match each file by filePath.",
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
