import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import type { GithubRepositoryOwnerType } from "./github-repository-owner";

interface GithubProjectV2SyncInstallation {
  account_login: string;
  account_type: "User" | "Organization";
}

const GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE =
  "GitHub ProjectV2 OAuth connection is required for personal ProjectV2 sync";
const GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project scope";
const GITHUB_PROJECT_OAUTH_OWNER_MISMATCH_MESSAGE =
  "GitHub ProjectV2 OAuth account does not match this personal ProjectV2 owner";

@Injectable()
export class GithubProjectV2SyncTokenService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async resolvePersonalProjectV2UserAccessToken(input: {
    currentUserId: string;
    installation: GithubProjectV2SyncInstallation;
    repositoryOwnerLogin: string | null;
    repositoryOwnerType: GithubRepositoryOwnerType | null;
    requiresProjectV2Access: boolean;
  }): Promise<string | null> {
    const requiresPersonalProjectV2Token =
      input.repositoryOwnerType === "User" ||
      (
        input.repositoryOwnerType === null &&
        input.installation.account_type === "User"
      );
    if (!input.requiresProjectV2Access || !requiresPersonalProjectV2Token) {
      return null;
    }

    const ownerLogin = input.repositoryOwnerLogin ?? input.installation.account_login;
    let connection;
    try { connection = await this.connectionService.getActiveConnection(input.currentUserId, "project_v2"); }
    catch { throw badRequest(GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE); }

    if (
      connection.githubLogin.toLowerCase() !==
      ownerLogin.toLowerCase()
    ) {
      throw badRequest(GITHUB_PROJECT_OAUTH_OWNER_MISMATCH_MESSAGE);
    }

    if (!this.hasProjectScope(connection.tokenScope)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE);
    }

    return connection.accessToken;
  }

  private hasProjectScope(scope: string | null): boolean {
    if (!scope) {
      return false;
    }

    return scope.split(/[,\s]+/).includes("project");
  }
}
