import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { ApiError, badRequest, notFound, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import type {
  GithubPullRequestReviewSubmissionPayload,
  GithubPullRequestReviewSubmitType,
  SubmitGithubPullRequestReviewInput
} from "./types";

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

interface GithubReviewTargetRow extends QueryResultRow {
  pr_number: string | number;
  owner_login: string;
  name: string;
}

@Injectable()
export class GithubReviewSubmissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async submitGithubPullRequestReview(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: SubmitGithubPullRequestReviewInput
  ): Promise<GithubPullRequestReviewSubmissionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const submitType = this.normalizeSubmitType(input.submitType);
    const reviewBody = this.normalizeReviewBody(input.reviewBody);
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connectedOAuth = await this.connectionService.getActiveConnection(currentUserId, "app_user");
    const target = await this.findGithubReviewTarget(workspaceId, pullRequestId);

    try {
      const submission = await this.githubOAuthClient.submitPullRequestReview({
        accessToken: connectedOAuth.accessToken,
        owner: target.owner_login,
        repo: target.name,
        pullNumber: this.toPositiveInteger(
          target.pr_number,
          "Invalid GitHub pull request number"
        ),
        event: submitType,
        body: reviewBody
      });

      return {
        submittedByGithubLogin: connectedOAuth.githubLogin,
        githubReviewId: submission.githubReviewId,
        githubReviewUrl: submission.githubReviewUrl,
        submittedAt: this.getCurrentIsoString(oauthConfig)
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw badRequest("GitHub Review submission failed");
    }
  }

  private async findGithubReviewTarget(
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubReviewTargetRow> {
    const row = await this.database.queryOne<GithubReviewTargetRow>(
      `
        SELECT
          pr.pr_number,
          repository.owner_login,
          repository.name
        FROM github_pull_requests AS pr
        JOIN github_repositories AS repository
          ON repository.id = pr.repository_id
         AND repository.workspace_id = pr.workspace_id
        WHERE pr.workspace_id = $1
          AND pr.id = $2
      `,
      [workspaceId, pullRequestId]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }

    return row;
  }

  private normalizeSubmitType(
    submitType: GithubPullRequestReviewSubmitType
  ): GithubPullRequestReviewSubmitType {
    switch (submitType) {
      case "COMMENT":
      case "APPROVE":
      case "REQUEST_CHANGES":
        return submitType;
      default:
        throw badRequest("submitType must be COMMENT, APPROVE, or REQUEST_CHANGES");
    }
  }

  private normalizeReviewBody(value: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest("reviewBody must not be empty");
    }

    return value.trim();
  }

  private toPositiveInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(message);
    }

    return parsed;
  }

  private getCurrentIsoString(config: Pick<GithubOAuthRuntimeConfig, "now">): string {
    return (config.now ? config.now() : new Date()).toISOString();
  }
}
