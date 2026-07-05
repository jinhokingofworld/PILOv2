import { Injectable } from "@nestjs/common";
import { GithubIntegrationService } from "../github-integration/github-integration.service";
import type {
  PrReviewGithubChangedFile,
  PrReviewGithubConflictStatusPayload,
  PrReviewGithubDependency,
  PrReviewGithubOAuthStatus,
  PrReviewGithubPullRequestDetail
} from "./types";

@Injectable()
export class PrReviewGithubDependencyService implements PrReviewGithubDependency {
  constructor(private readonly githubIntegrationService: GithubIntegrationService) {}

  async getCurrentUserGithubOAuthStatus(
    currentUserId: string
  ): Promise<PrReviewGithubOAuthStatus> {
    return this.githubIntegrationService.getGithubOAuthStatus(currentUserId);
  }

  async getPullRequestDetail(
    _currentUserId: string,
    _workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubPullRequestDetail> {
    const prNumber = this.toStablePrNumber(pullRequestId);

    return {
      id: pullRequestId,
      repositoryId: `stub-repository-${prNumber}`,
      prNumber,
      title: "Deterministic PR Review stub",
      body:
        "Temporary PR Review fixture used until GitHub Integration exposes PR detail APIs.",
      state: "open",
      draft: false,
      mergeable: true,
      authorLogin: "pilo-bot",
      authorAvatarUrl: null,
      headBranch: "feat/pr-review-backend-foundation",
      baseBranch: "dev",
      headSha: `stub-${this.toStableHex(pullRequestId, 12)}`,
      baseSha: `base-${this.toStableHex(`base:${pullRequestId}`, 12)}`,
      changedFilesCount: 3,
      additions: 92,
      deletions: 18,
      commitsCount: 1,
      htmlUrl: `https://github.com/pilo-fixture/PILO/pull/${prNumber}`
    };
  }

  async getPullRequestChangedFiles(
    _currentUserId: string,
    _workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubChangedFile[]> {
    const prNumber = this.toStablePrNumber(pullRequestId);
    const fileUrlBase = `https://github.com/pilo-fixture/PILO/pull/${prNumber}/files`;

    return [
      this.createStubChangedFile({
        filePath: "apps/app-server/src/modules/pr-review/pr-review.service.ts",
        fileStatus: "modified",
        additions: 38,
        deletions: 7,
        githubFileUrl: `${fileUrlBase}#diff-pr-review-service`,
        patch: [
          "@@ -1,6 +1,13 @@",
          " import { Injectable } from \"@nestjs/common\";",
          "+import { DatabaseService } from \"../../database/database.service\";",
          "+import { PrReviewGithubDependencyService } from \"./pr-review-github-dependency.service\";",
          " ",
          " @Injectable()",
          " export class PrReviewService {",
          "+  // Session lifecycle orchestration will live here.",
          " }"
        ].join("\n")
      }),
      this.createStubChangedFile({
        filePath: "apps/app-server/src/modules/pr-review/types/index.ts",
        fileStatus: "added",
        additions: 41,
        deletions: 0,
        githubFileUrl: `${fileUrlBase}#diff-pr-review-types`,
        patch: [
          "@@ -0,0 +1,8 @@",
          "+export type PrReviewSessionStatus =",
          "+  | \"analyzing\"",
          "+  | \"reviewing\"",
          "+  | \"ready_to_submit\"",
          "+  | \"submitted\"",
          "+  | \"failed\"",
          "+  | \"archived\";"
        ].join("\n")
      }),
      this.createStubChangedFile({
        filePath: "docs/api/pr-review-api.md",
        fileStatus: "modified",
        additions: 13,
        deletions: 11,
        githubFileUrl: `${fileUrlBase}#diff-pr-review-api`,
        patch: [
          "@@ -10,7 +10,9 @@",
          " ## Review Sessions",
          "-Session endpoints are pending implementation.",
          "+Session endpoints create a review session from a GitHub Pull Request,",
          "+store AI-generated review metadata, and expose ordered file review data."
        ].join("\n")
      })
    ];
  }

  async getPullRequestConflictStatus(
    _currentUserId: string,
    _workspaceId: string,
    _pullRequestId: string
  ): Promise<PrReviewGithubConflictStatusPayload> {
    return {
      conflictStatus: "clean",
      checkedAt: "1970-01-01T00:00:00.000Z"
    };
  }

  private createStubChangedFile(input: {
    filePath: string;
    fileStatus: PrReviewGithubChangedFile["fileStatus"];
    additions: number;
    deletions: number;
    githubFileUrl: string;
    patch: string;
  }): PrReviewGithubChangedFile {
    return {
      filePath: input.filePath,
      previousFilePath: null,
      fileName: this.getFileName(input.filePath),
      fileStatus: input.fileStatus,
      additions: input.additions,
      deletions: input.deletions,
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl: input.githubFileUrl,
      patch: input.patch,
      patchSizeBytes: Buffer.byteLength(input.patch, "utf8")
    };
  }

  private getFileName(filePath: string): string {
    return filePath.split("/").at(-1) ?? filePath;
  }

  private toStablePrNumber(input: string): number {
    return (this.toStableNumber(input) % 9000) + 1000;
  }

  private toStableHex(input: string, length: number): string {
    return this.toStableNumber(input).toString(16).padStart(length, "0").slice(0, length);
  }

  private toStableNumber(input: string): number {
    let hash = 0;

    for (let index = 0; index < input.length; index += 1) {
      hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }

    return hash;
  }
}
