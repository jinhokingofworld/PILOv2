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

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
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
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connection = await this.getGithubOAuthConnectionRow(input.currentUserId);
    const accessToken = this.getConnectedGithubOAuthAccess(connection, oauthConfig);

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
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connection = await this.getGithubOAuthConnectionRow(input.currentUserId);
    const accessToken = this.getConnectedGithubOAuthAccess(connection, oauthConfig);

    return this.githubAppClient.addProjectV2ItemByContentId({
      contentNodeId: input.contentNodeId,
      projectNodeId: input.projectNodeId,
      userAccessToken: accessToken
    });
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
  ): string {
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_access_token_encrypted,
      config
    );
  }

  private isActiveGithubOAuthConnection(
    row: GithubOAuthConnectionRow
  ): row is GithubOAuthConnectionRow & {
    github_access_token_encrypted: string;
  } {
    return Boolean(
      row.github_login &&
        row.github_access_token_encrypted &&
        row.github_connected_at &&
        !row.github_revoked_at
    );
  }
}
