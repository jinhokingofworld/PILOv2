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
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";

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

export interface GithubProjectV2OAuthAccess {
  accessToken: string;
  githubLogin: string;
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
    private readonly configService: GithubIntegrationConfigService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async assertProjectV2WriteAccess(currentUserId: string): Promise<void> {
    await this.getConnection(currentUserId);
  }

  async getConnectedProjectV2OAuthAccess(
    currentUserId: string
  ): Promise<GithubProjectV2OAuthAccess> {
    const connection = await this.getConnection(currentUserId);

    return {
      accessToken: connection.accessToken,
      githubLogin: connection.githubLogin
    };
  }

  async updateProjectV2ItemStatus(
    input: UpdateGithubProjectV2ItemStatusInput
  ): Promise<void> {
    const connection = await this.getConnection(input.currentUserId);

    await this.githubAppClient.updateProjectV2ItemStatus({
      userAccessToken: connection.accessToken,
      projectNodeId: input.projectNodeId,
      itemNodeId: input.itemNodeId,
      fieldNodeId: input.fieldNodeId,
      singleSelectOptionId: input.singleSelectOptionId
    });
  }

  async addProjectV2ItemByContentId(
    input: AddGithubProjectV2ItemInput
  ): Promise<AddGithubProjectV2ItemResult> {
    const connection = await this.getConnection(input.currentUserId);

    return this.githubAppClient.addProjectV2ItemByContentId({
      contentNodeId: input.contentNodeId,
      projectNodeId: input.projectNodeId,
      userAccessToken: connection.accessToken
    });
  }

  private async getConnection(currentUserId: string) {
    let connection;
    try { connection = await this.connectionService.getActiveConnection(currentUserId, "project_v2"); }
    catch { throw badRequest(GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE); }
    if (!this.hasProjectScope(connection.tokenScope)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE);
    }
    return connection;
  }

  private hasProjectScope(scope: string | null): boolean {
    if (!scope) {
      return false;
    }

    return scope.split(/[,\s]+/).includes("project");
  }
}
