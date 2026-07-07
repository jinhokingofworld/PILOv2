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

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_token_scope: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

const GITHUB_PROJECT_V2_OAUTH_SCOPES = new Set(["read:project", "project"]);

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

    const row = await this.getGithubOAuthConnectionRow(input.currentUserId);
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest(
        "GitHub user OAuth token is required for personal ProjectV2 sync"
      );
    }

    if (row.github_login !== input.installation.account_login) {
      throw badRequest(
        "GitHub user OAuth token cannot access this personal ProjectV2 owner"
      );
    }

    if (!this.hasProjectV2Scope(row.github_token_scope)) {
      throw badRequest(
        "GitHub OAuth connection must be reconnected with read:project scope for personal ProjectV2 sync"
      );
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_access_token_encrypted,
      this.configService.getGithubOAuthConfig()
    );
  }

  private async getGithubOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubOAuthConnectionRow>(
      `
        SELECT
          github_login,
          github_access_token_encrypted,
          github_token_scope,
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

  private hasProjectV2Scope(scope: string | null): boolean {
    if (!scope) {
      return false;
    }

    return scope
      .split(/[,\s]+/)
      .some((item) => GITHUB_PROJECT_V2_OAUTH_SCOPES.has(item.trim()));
  }
}
