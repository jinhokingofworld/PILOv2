import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import {
  badRequest,
  conflict as conflictError,
  notFound,
  unauthorized
} from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GithubAppClient } from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  ApplyGithubPullRequestFileResolutionInput,
  GithubPullRequestFileResolutionPayload
} from "./types";

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

interface GithubPullRequestFileWriteTargetRow extends QueryResultRow {
  id: string;
  pr_number: string | number;
  owner_login: string;
  name: string;
  github_installation_id: string | number | null;
}

@Injectable()
export class GithubPullRequestFileWriteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async applyGithubPullRequestFileResolution(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: ApplyGithubPullRequestFileResolutionInput
  ): Promise<GithubPullRequestFileResolutionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const oauthConfig = this.configService.getGithubOAuthConfig();
    const appConfig = this.configService.getGithubAppConfig();
    const connection = await this.getGithubOAuthConnectionRow(currentUserId);
    const connectedOAuth = this.getConnectedGithubOAuthAccess(
      connection,
      oauthConfig
    );
    const target = await this.findGithubPullRequestFileWriteTarget(
      workspaceId,
      pullRequestId
    );
    const pullRequest = await this.githubAppClient.getPullRequest({
      installationId: this.readGithubInstallationId(target),
      appId: appConfig.appId,
      privateKey: appConfig.privateKey,
      owner: target.owner_login,
      repo: target.name,
      pullNumber: this.toPositiveInteger(
        target.pr_number,
        "Invalid GitHub pull request number"
      ),
      now: appConfig.now
    });

    if (pullRequest.headSha !== input.expectedHeadSha) {
      throw conflictError("Review session head SHA is stale");
    }

    const update = await this.githubOAuthClient.updateRepositoryFileContent({
      accessToken: connectedOAuth.accessToken,
      owner: pullRequest.headRepositoryOwner,
      repo: pullRequest.headRepositoryName,
      path: input.filePath,
      branch: pullRequest.headRef,
      message: `Resolve conflict in ${input.filePath}`,
      content: input.resolvedContent,
      sha: input.expectedHeadBlobSha
    });

    await this.updateLocalPullRequestHeadSha(
      workspaceId,
      pullRequestId,
      update.commitSha,
      pullRequest.headRef
    );

    return {
      appliedByGithubLogin: connectedOAuth.githubLogin,
      commitSha: update.commitSha,
      commitUrl: update.commitUrl,
      headShaBefore: pullRequest.headSha,
      headShaAfter: update.commitSha,
      headBlobShaBefore: input.expectedHeadBlobSha,
      headBlobShaAfter: update.contentSha
    };
  }

  private async getGithubOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubOAuthConnectionRow>(
      `
        SELECT
          github_login,
          github_access_token_encrypted,
          github_connected_at,
          github_revoked_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return row;
  }

  private getConnectedGithubOAuthAccess(
    row: GithubOAuthConnectionRow,
    config: GithubOAuthRuntimeConfig
  ): { accessToken: string; githubLogin: string } {
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }

    return {
      accessToken: this.tokenEncryptionService.decryptToken(
        row.github_access_token_encrypted,
        config
      ),
      githubLogin: row.github_login
    };
  }

  private isActiveGithubOAuthConnection(
    row: GithubOAuthConnectionRow
  ): row is GithubOAuthConnectionRow & {
    github_access_token_encrypted: string;
    github_login: string;
  } {
    return Boolean(
      row.github_login &&
        row.github_access_token_encrypted &&
        row.github_connected_at &&
        !row.github_revoked_at
    );
  }

  private async findGithubPullRequestFileWriteTarget(
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestFileWriteTargetRow> {
    const row = await this.database.queryOne<GithubPullRequestFileWriteTargetRow>(
      `
        SELECT
          pr.id,
          pr.pr_number,
          repository.owner_login,
          repository.name,
          installation.github_installation_id
        FROM github_pull_requests AS pr
        JOIN github_repositories AS repository
          ON repository.id = pr.repository_id
         AND repository.workspace_id = pr.workspace_id
        LEFT JOIN github_installations AS installation
          ON installation.id = repository.installation_id
         AND installation.workspace_id = pr.workspace_id
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

  private async updateLocalPullRequestHeadSha(
    workspaceId: string,
    pullRequestId: string,
    headSha: string,
    headBranch: string
  ): Promise<void> {
    const row = await this.database.queryOne<{ id: string }>(
      `
        UPDATE github_pull_requests
        SET
          head_sha = $3,
          head_branch = $4,
          raw = jsonb_set(
            COALESCE(raw, '{}'::jsonb),
            '{head,sha}',
            to_jsonb($3::text),
            true
          ),
          last_synced_at = now(),
          updated_at = now()
        WHERE workspace_id = $1
          AND id = $2
        RETURNING id
      `,
      [workspaceId, pullRequestId, headSha, headBranch]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }
  }

  private readGithubInstallationId(
    row: GithubPullRequestFileWriteTargetRow
  ): number {
    if (row.github_installation_id === null) {
      throw badRequest("GitHub App installation is not connected");
    }

    return this.toPositiveInteger(
      row.github_installation_id,
      "Invalid GitHub installation id"
    );
  }

  private toPositiveInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(message);
    }

    return parsed;
  }
}
