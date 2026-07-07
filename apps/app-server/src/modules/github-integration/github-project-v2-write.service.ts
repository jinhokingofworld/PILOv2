import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubAppClient } from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

interface GithubProjectOAuthConnectionRow extends QueryResultRow {
  github_project_login: string | null;
  github_project_access_token_encrypted: string | null;
  github_project_token_scope: string | null;
  github_project_connected_at: Date | string | null;
  github_project_revoked_at: Date | string | null;
}

export interface UpdateGithubProjectV2ItemStatusInput {
  currentUserId: string;
  projectNodeId: string;
  itemNodeId: string;
  fieldNodeId: string;
  singleSelectOptionId: string | null;
}

export interface AddGithubProjectV2ItemInput {
  currentUserId: string;
  projectNodeId: string;
  contentNodeId: string;
}

export interface AddGithubProjectV2ItemResult {
  itemNodeId: string;
}

const GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE =
  "GitHub ProjectV2 OAuth connection is required for ProjectV2 write";
const GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project scope";

@Injectable()
export class GithubProjectV2WriteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async updateProjectV2ItemStatus(
    input: UpdateGithubProjectV2ItemStatusInput
  ): Promise<void> {
    const oauthConfig = this.configService.getGithubProjectOAuthConfig();
    const connection = await this.getGithubProjectOAuthConnectionRow(
      input.currentUserId
    );
    const accessToken = this.getConnectedGithubProjectOAuthAccess(
      connection,
      oauthConfig
    );

    await this.githubAppClient.updateProjectV2ItemStatus({
      userAccessToken: accessToken,
      projectNodeId: input.projectNodeId,
      itemNodeId: input.itemNodeId,
      fieldNodeId: input.fieldNodeId,
      singleSelectOptionId: input.singleSelectOptionId
    });
  }

  async addProjectV2ItemByContentId(
    input: AddGithubProjectV2ItemInput
  ): Promise<AddGithubProjectV2ItemResult> {
    const oauthConfig = this.configService.getGithubProjectOAuthConfig();
    const connection = await this.getGithubProjectOAuthConnectionRow(
      input.currentUserId
    );
    const accessToken = this.getConnectedGithubProjectOAuthAccess(
      connection,
      oauthConfig
    );

    return this.githubAppClient.addProjectV2ItemByContentId({
      contentNodeId: input.contentNodeId,
      projectNodeId: input.projectNodeId,
      userAccessToken: accessToken
    });
  }

  private async getGithubProjectOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubProjectOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubProjectOAuthConnectionRow>(
      `
        SELECT
          github_project_login,
          github_project_access_token_encrypted,
          github_project_token_scope,
          github_project_connected_at,
          github_project_revoked_at
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

  private getConnectedGithubProjectOAuthAccess(
    row: GithubProjectOAuthConnectionRow,
    config: GithubOAuthRuntimeConfig
  ): string {
    if (!this.isActiveGithubProjectOAuthConnection(row)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE);
    }

    if (!this.hasProjectScope(row.github_project_token_scope)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE);
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_project_access_token_encrypted,
      config
    );
  }

  private isActiveGithubProjectOAuthConnection(
    row: GithubProjectOAuthConnectionRow
  ): row is GithubProjectOAuthConnectionRow & {
    github_project_access_token_encrypted: string;
  } {
    return Boolean(
      row.github_project_login &&
        row.github_project_access_token_encrypted &&
        row.github_project_connected_at &&
        !row.github_project_revoked_at
    );
  }

  private hasProjectScope(scope: string | null): boolean {
    if (!scope) {
      return false;
    }

    return scope.split(/[,\s]+/).includes("project");
  }
}
