import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

interface GithubProjectV2SyncInstallation {
  account_login: string;
  account_type: "User" | "Organization";
}

interface GithubProjectOAuthConnectionRow extends QueryResultRow {
  github_project_login: string | null;
  github_project_access_token_encrypted: string | null;
  github_project_token_scope: string | null;
  github_project_connected_at: Date | string | null;
  github_project_revoked_at: Date | string | null;
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
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async resolvePersonalProjectV2UserAccessToken(input: {
    currentUserId: string;
    installation: GithubProjectV2SyncInstallation;
    requiresProjectV2Access: boolean;
  }): Promise<string | null> {
    if (
      !input.requiresProjectV2Access ||
      input.installation.account_type !== "User"
    ) {
      return null;
    }

    const row = await this.getGithubProjectOAuthConnectionRow(input.currentUserId);
    if (!this.isActiveGithubProjectOAuthConnection(row)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_REQUIRED_MESSAGE);
    }

    if (
      row.github_project_login.toLowerCase() !==
      input.installation.account_login.toLowerCase()
    ) {
      throw badRequest(GITHUB_PROJECT_OAUTH_OWNER_MISMATCH_MESSAGE);
    }

    if (!this.hasProjectScope(row.github_project_token_scope)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE);
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_project_access_token_encrypted,
      this.configService.getGithubProjectOAuthConfig()
    );
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

  private isActiveGithubProjectOAuthConnection(
    row: GithubProjectOAuthConnectionRow
  ): row is GithubProjectOAuthConnectionRow & {
    github_project_access_token_encrypted: string;
    github_project_login: string;
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
