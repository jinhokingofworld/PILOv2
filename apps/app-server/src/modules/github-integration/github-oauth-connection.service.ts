import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService, type DatabaseTransaction } from "../../database/database.service";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

export type GithubOAuthPurpose = "app_user" | "project_v2";

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_user_id: string | number;
  github_login: string;
  access_token_encrypted: string | null;
  token_scope: string | null;
  connected_at: Date | string;
  revoked_at: Date | string | null;
}

export interface ActiveGithubOAuthConnection {
  githubUserId: number;
  githubLogin: string;
  accessToken: string;
  tokenScope: string | null;
  connectedAt: string;
}

@Injectable()
export class GithubOAuthConnectionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async getActiveConnection(userId: string, purpose: GithubOAuthPurpose): Promise<ActiveGithubOAuthConnection> {
    const row = await this.getOptionalConnectionRow(userId, purpose);
    if (!row || !row.access_token_encrypted || row.revoked_at) {
      throw badRequest("GitHub OAuth connection is required");
    }
    const config = purpose === "project_v2"
      ? this.configService.getGithubProjectOAuthConfig()
      : this.configService.getGithubOAuthConfig();
    return this.mapActive(row, config);
  }

  async getOptionalActiveConnection(userId: string, purpose: GithubOAuthPurpose): Promise<ActiveGithubOAuthConnection | null> {
    const row = await this.getOptionalConnectionRow(userId, purpose);
    if (!row || !row.access_token_encrypted || row.revoked_at) return null;
    const config = purpose === "project_v2"
      ? this.configService.getGithubProjectOAuthConfig()
      : this.configService.getGithubOAuthConfig();
    return this.mapActive(row, config);
  }

  async getStatus(userId: string, purpose: GithubOAuthPurpose): Promise<GithubOAuthConnectionRow | null> {
    const exists = await this.database.queryOne<QueryResultRow>("SELECT id FROM users WHERE id = $1", [userId]);
    if (!exists) throw unauthorized("Current user not found");
    return this.getOptionalConnectionRow(userId, purpose);
  }

  async saveConnection(input: { userId: string; purpose: GithubOAuthPurpose; githubUserId: number; githubLogin: string; encryptedToken: string; tokenScope: string | null }): Promise<GithubOAuthConnectionRow> {
    try {
      const row = await this.database.transaction(async (transaction) => {
        await transaction.query(
          `UPDATE github_oauth_connections
           SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
           WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
          [input.userId, input.purpose]
        );
        return transaction.queryOne<GithubOAuthConnectionRow>(
          `INSERT INTO github_oauth_connections (
             user_id, purpose, github_user_id, github_login, access_token_encrypted, token_scope, connected_at, revoked_at
           ) VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
           RETURNING github_user_id, github_login, access_token_encrypted, token_scope, connected_at, revoked_at`,
          [input.userId, input.purpose, input.githubUserId, input.githubLogin, input.encryptedToken, input.tokenScope]
        );
      });
      if (!row) throw badRequest("GitHub OAuth callback failed");
      return row;
    } catch (error) {
      if (this.isActiveAccountUniqueViolation(error)) {
        throw badRequest("GitHub account is already connected to another PILO account");
      }
      throw error;
    }
  }

  async disconnectConnection(userId: string, purpose: GithubOAuthPurpose): Promise<void> {
    await this.database.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
       WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [userId, purpose]
    );
  }

  async disconnectMismatchedConnectionsInTransaction(transaction: DatabaseTransaction, userId: string, githubUserId: number): Promise<void> {
    await transaction.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND github_user_id <> $2`,
      [userId, githubUserId]
    );
  }

  private async getOptionalConnectionRow(userId: string, purpose: GithubOAuthPurpose): Promise<GithubOAuthConnectionRow | null> {
    return this.database.queryOne<GithubOAuthConnectionRow>(
      `SELECT github_user_id, github_login, access_token_encrypted, token_scope, connected_at, revoked_at
       FROM github_oauth_connections
       WHERE user_id = $1 AND purpose = $2
       ORDER BY connected_at DESC LIMIT 1`,
      [userId, purpose]
    );
  }

  private mapActive(row: GithubOAuthConnectionRow, config: GithubOAuthRuntimeConfig): ActiveGithubOAuthConnection {
    return {
      githubUserId: Number(row.github_user_id), githubLogin: row.github_login,
      accessToken: this.tokenEncryptionService.decryptToken(row.access_token_encrypted!, config),
      tokenScope: row.token_scope,
      connectedAt: row.connected_at instanceof Date ? row.connected_at.toISOString() : new Date(row.connected_at).toISOString()
    };
  }

  private isActiveAccountUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
      (error as { code?: unknown }).code === "23505";
  }
}
