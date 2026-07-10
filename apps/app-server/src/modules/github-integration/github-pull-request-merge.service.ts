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
import {
  GithubAppClient,
  type GithubPullRequestApiDetails
} from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubPullRequestMergePayload,
  MergeGithubPullRequestInput
} from "./types";

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

interface GithubPullRequestMergeTargetRow extends QueryResultRow {
  id: string;
  pr_number: string | number;
  owner_login: string;
  name: string;
  github_installation_id: string | number | null;
}

@Injectable()
export class GithubPullRequestMergeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async mergeGithubPullRequest(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: MergeGithubPullRequestInput
  ): Promise<GithubPullRequestMergePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const expectedHeadSha = this.normalizeExpectedHeadSha(input.expectedHeadSha);
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const appConfig = this.configService.getGithubAppConfig();
    const connection = await this.getGithubOAuthConnectionRow(currentUserId);
    const connectedOAuth = this.getConnectedGithubOAuthAccess(
      connection,
      oauthConfig
    );
    const target = await this.findGithubPullRequestMergeTarget(
      workspaceId,
      pullRequestId
    );
    const pullNumber = this.toPositiveInteger(
      target.pr_number,
      "Invalid GitHub pull request number"
    );
    const installationId = this.readGithubInstallationId(target);
    const pullRequest = await this.githubAppClient.getPullRequest({
      installationId,
      appId: appConfig.appId,
      privateKey: appConfig.privateKey,
      owner: target.owner_login,
      repo: target.name,
      pullNumber,
      now: appConfig.now
    });

    this.assertPullRequestMergeable(pullRequest, expectedHeadSha);

    const merge = await this.githubOAuthClient.mergePullRequest({
      accessToken: connectedOAuth.accessToken,
      owner: target.owner_login,
      repo: target.name,
      pullNumber,
      expectedHeadSha,
      mergeMethod: "merge"
    });
    const refreshedPullRequest = await this.tryGetRefreshedPullRequest({
      installationId,
      pullNumber,
      target,
      now: appConfig.now
    });
    const mergedAt =
      refreshedPullRequest?.mergedAt ?? this.getCurrentIsoString(oauthConfig);
    const updatedAt = refreshedPullRequest?.updatedAt ?? mergedAt;
    const nextPullRequest = {
      ...(refreshedPullRequest ?? pullRequest),
      state: "closed",
      mergedAt,
      updatedAt,
      closedAt: refreshedPullRequest?.closedAt ?? pullRequest.closedAt ?? mergedAt,
      mergeable: refreshedPullRequest?.mergeable ?? false,
      headSha: refreshedPullRequest?.headSha ?? expectedHeadSha
    } satisfies GithubPullRequestApiDetails;

    await this.updateLocalPullRequestAfterMerge(
      workspaceId,
      pullRequestId,
      nextPullRequest
    );

    return {
      mergedByGithubLogin: connectedOAuth.githubLogin,
      mergeMethod: "merge",
      mergeCommitSha: merge.mergeCommitSha,
      mergeCommitUrl: this.buildMergeCommitUrl(
        target.owner_login,
        target.name,
        merge.mergeCommitSha
      ),
      pullRequestState: "closed",
      mergedAt,
      headSha: nextPullRequest.headSha
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

  private async findGithubPullRequestMergeTarget(
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestMergeTargetRow> {
    const row = await this.database.queryOne<GithubPullRequestMergeTargetRow>(
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

  private assertPullRequestMergeable(
    pullRequest: GithubPullRequestApiDetails,
    expectedHeadSha: string
  ): void {
    if (pullRequest.state !== "open") {
      throw badRequest("GitHub pull request is not open");
    }

    if (pullRequest.headSha !== expectedHeadSha) {
      throw conflictError("GitHub pull request head SHA is stale");
    }

    if (pullRequest.mergeable === null) {
      throw badRequest("GitHub pull request mergeability is still checking");
    }

    if (pullRequest.mergeable !== true) {
      throw badRequest("GitHub pull request has conflicts");
    }
  }

  private async tryGetRefreshedPullRequest(input: {
    installationId: number;
    pullNumber: number;
    target: GithubPullRequestMergeTargetRow;
    now?: () => Date;
  }): Promise<GithubPullRequestApiDetails | null> {
    try {
      return await this.githubAppClient.getPullRequest({
        installationId: input.installationId,
        appId: this.configService.getGithubAppConfig().appId,
        privateKey: this.configService.getGithubAppConfig().privateKey,
        owner: input.target.owner_login,
        repo: input.target.name,
        pullNumber: input.pullNumber,
        now: input.now
      });
    } catch {
      return null;
    }
  }

  private async updateLocalPullRequestAfterMerge(
    workspaceId: string,
    pullRequestId: string,
    pullRequest: GithubPullRequestApiDetails
  ): Promise<void> {
    const closedAt = pullRequest.closedAt ?? pullRequest.mergedAt;
    const row = await this.database.queryOne<{ id: string }>(
      `
        UPDATE github_pull_requests
        SET
          state = 'closed',
          draft = $3,
          mergeable = $4,
          head_branch = $5,
          head_sha = $6,
          changed_files_count = $7,
          additions = $8,
          deletions = $9,
          commits_count = $10,
          github_closed_at = $11::timestamptz,
          merged_at = $12::timestamptz,
          github_updated_at = $13::timestamptz,
          raw = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(
                          COALESCE(raw, '{}'::jsonb),
                          '{state}',
                          to_jsonb('closed'::text),
                          true
                        ),
                        '{draft}',
                        to_jsonb($3::boolean),
                        true
                      ),
                      '{mergeable}',
                      COALESCE(to_jsonb($4::boolean), 'null'::jsonb),
                      true
                    ),
                    '{head,ref}',
                    to_jsonb($5::text),
                    true
                  ),
                  '{head,sha}',
                  to_jsonb($6::text),
                  true
                ),
                '{closed_at}',
                COALESCE(to_jsonb($11::text), 'null'::jsonb),
                true
              ),
              '{merged_at}',
              COALESCE(to_jsonb($12::text), 'null'::jsonb),
              true
            ),
            '{updated_at}',
            COALESCE(to_jsonb($13::text), 'null'::jsonb),
            true
          ),
          last_synced_at = now(),
          updated_at = now()
        WHERE workspace_id = $1
          AND id = $2
        RETURNING id
      `,
      [
        workspaceId,
        pullRequestId,
        pullRequest.draft,
        pullRequest.mergeable,
        pullRequest.headRef,
        pullRequest.headSha,
        pullRequest.changed_files,
        pullRequest.additions,
        pullRequest.deletions,
        pullRequest.commits,
        closedAt,
        pullRequest.mergedAt,
        pullRequest.updatedAt
      ]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }
  }

  private readGithubInstallationId(row: GithubPullRequestMergeTargetRow): number {
    if (row.github_installation_id === null) {
      throw badRequest("GitHub App installation is not connected");
    }

    return this.toPositiveInteger(
      row.github_installation_id,
      "Invalid GitHub installation id"
    );
  }

  private normalizeExpectedHeadSha(value: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest("expectedHeadSha must not be empty");
    }

    return value.trim();
  }

  private buildMergeCommitUrl(
    owner: string,
    repo: string,
    mergeCommitSha: string
  ): string | null {
    if (!mergeCommitSha) {
      return null;
    }

    return `https://github.com/${owner}/${repo}/commit/${mergeCommitSha}`;
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
