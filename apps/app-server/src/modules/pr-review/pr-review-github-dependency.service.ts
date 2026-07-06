import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { GithubIntegrationService } from "../github-integration/github-integration.service";
import type {
  GithubPullRequestDetailPayload,
  GithubPullRequestFilePayload
} from "../github-integration/types";
import type {
  PrReviewGithubChangedFile,
  PrReviewGithubConflictStatusPayload,
  PrReviewGithubDependency,
  PrReviewGithubOAuthStatus,
  PrReviewGithubPullRequestDetail,
  PrReviewGithubReviewSubmitType,
  PrReviewGithubReviewSubmissionPayload
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
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubPullRequestDetail> {
    const pullRequest = await this.githubIntegrationService.getGithubPullRequest(
      currentUserId,
      workspaceId,
      pullRequestId
    );

    return this.mapPullRequestDetail(pullRequest);
  }

  async getPullRequestChangedFiles(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubChangedFile[]> {
    const files: GithubPullRequestFilePayload[] = [];
    const limit = 100;
    let page = 1;
    let total = Number.POSITIVE_INFINITY;

    while (files.length < total) {
      const result = await this.githubIntegrationService.listGithubPullRequestFiles(
        currentUserId,
        workspaceId,
        pullRequestId,
        { page, limit }
      );

      files.push(...result.data);
      total = result.meta.total;

      if (result.data.length === 0 || result.data.length < limit) {
        break;
      }

      page += 1;
    }

    return files.map((file) => this.mapChangedFile(file));
  }

  async getPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubConflictStatusPayload> {
    const conflict =
      await this.githubIntegrationService.getGithubPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        pullRequestId
      );

    return {
      conflictStatus: conflict.conflictStatus,
      checkedAt: conflict.conflictCheckedAt
    };
  }

  async submitPullRequestReview(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: {
      submitType: PrReviewGithubReviewSubmitType;
      reviewBody: string;
    }
  ): Promise<PrReviewGithubReviewSubmissionPayload> {
    return this.githubIntegrationService.submitGithubPullRequestReview(
      currentUserId,
      workspaceId,
      pullRequestId,
      input
    );
  }

  private mapPullRequestDetail(
    pullRequest: GithubPullRequestDetailPayload
  ): PrReviewGithubPullRequestDetail {
    if (!pullRequest.headSha) {
      throw badRequest("GitHub pull request head SHA is not synced");
    }

    return {
      id: pullRequest.id,
      repositoryId: pullRequest.repositoryId,
      prNumber: pullRequest.githubNumber,
      title: pullRequest.title,
      body: pullRequest.description,
      state: pullRequest.state,
      draft: pullRequest.draft,
      mergeable: pullRequest.mergeable,
      authorLogin: pullRequest.authorName,
      authorAvatarUrl: pullRequest.authorAvatarUrl,
      headBranch: pullRequest.headBranch,
      baseBranch: pullRequest.baseBranch,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha,
      changedFilesCount: pullRequest.changedFilesCount,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      commitsCount: pullRequest.commitsCount,
      htmlUrl: pullRequest.githubUrl
    };
  }

  private mapChangedFile(file: GithubPullRequestFilePayload): PrReviewGithubChangedFile {
    return {
      filePath: file.filePath,
      previousFilePath: file.previousFilePath,
      fileName: file.fileName,
      fileStatus: this.normalizeFileStatus(file.fileStatus),
      additions: file.additions,
      deletions: file.deletions,
      isBinary: file.isBinary,
      isLargeDiff: file.isLargeDiff,
      githubFileUrl: file.githubFileUrl,
      patch: file.patch,
      patchSizeBytes: file.patch ? Buffer.byteLength(file.patch, "utf8") : 0
    };
  }

  private normalizeFileStatus(
    status: string
  ): PrReviewGithubChangedFile["fileStatus"] {
    switch (status) {
      case "added":
      case "modified":
      case "renamed":
        return status;
      case "removed":
      case "deleted":
        return "deleted";
      default:
        return "modified";
    }
  }
}
