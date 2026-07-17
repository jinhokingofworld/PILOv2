import { Injectable, Optional } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService, type DatabaseTransaction } from "../../database/database.service";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubOAuthClient } from "./github-oauth.client";
import {
  GithubOAuthRefreshRejectedError,
  GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE
} from "./github-oauth-refresh.error";

export type GithubOAuthPurpose = "app_user" | "project_v2";

const GITHUB_OAUTH_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

interface GithubOAuthConnectionRow extends QueryResultRow {
  id: string;
  github_user_id: string | number;
  github_login: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_scope: string | null;
  access_token_expires_at: Date | string | null;
  refresh_token_expires_at: Date | string | null;
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
    private readonly configService: GithubIntegrationConfigService,
    @Optional()
    private readonly githubOAuthClient: GithubOAuthClient = new GithubOAuthClient()
  ) {}

  async getActiveConnection(userId: string, purpose: GithubOAuthPurpose): Promise<ActiveGithubOAuthConnection> {
    const row = await this.getOptionalConnectionRow(userId, purpose);
    if (!row || !row.access_token_encrypted || row.revoked_at) {
      throw badRequest("GitHub OAuth connection is required");
    }
    const config = purpose === "project_v2"
      ? this.configService.getGithubProjectOAuthConfig()
      : this.configService.getGithubOAuthConfig();
    if (!this.shouldRefreshAccessToken(row)) {
      return this.mapActive(row, config);
    }

    const refreshedRow = await this.database.transaction(async (transaction) => {
      const lockedRow = await this.getOptionalConnectionRow(
        userId,
        purpose,
        transaction,
        true
      );
      if (!lockedRow || !lockedRow.access_token_encrypted || lockedRow.revoked_at) {
        return null;
      }
      if (!this.shouldRefreshAccessToken(lockedRow)) {
        return lockedRow;
      }

      return this.refreshLockedConnection(transaction, lockedRow, config);
    });
    if (!refreshedRow) {
      throw badRequest(GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE);
    }
    return this.mapActive(refreshedRow, config);
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

  async saveConnection(input: {
    userId: string;
    purpose: GithubOAuthPurpose;
    githubUserId: number;
    githubLogin: string;
    encryptedToken: string;
    encryptedRefreshToken: string | null;
    tokenScope: string | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
  }): Promise<GithubOAuthConnectionRow> {
    try {
      const row = await this.database.transaction(async (transaction) => {
        await transaction.query(
          `UPDATE github_oauth_connections
           SET access_token_encrypted = NULL, refresh_token_encrypted = NULL,
               token_scope = NULL, access_token_expires_at = NULL,
               refresh_token_expires_at = NULL, revoked_at = now()
           WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
          [input.userId, input.purpose]
        );
        return transaction.queryOne<GithubOAuthConnectionRow>(
          `INSERT INTO github_oauth_connections (
             user_id, purpose, github_user_id, github_login,
             access_token_encrypted, refresh_token_encrypted, token_scope,
             access_token_expires_at, refresh_token_expires_at,
             connected_at, revoked_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), NULL)
           RETURNING id, github_user_id, github_login, access_token_encrypted,
                     refresh_token_encrypted, token_scope, access_token_expires_at,
                     refresh_token_expires_at, connected_at, revoked_at`,
          [
            input.userId, input.purpose, input.githubUserId, input.githubLogin,
            input.encryptedToken, input.encryptedRefreshToken, input.tokenScope,
            input.accessTokenExpiresAt, input.refreshTokenExpiresAt
          ]
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
       SET access_token_encrypted = NULL, refresh_token_encrypted = NULL,
           token_scope = NULL, access_token_expires_at = NULL,
           refresh_token_expires_at = NULL, revoked_at = now()
       WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [userId, purpose]
    );
  }

  async disconnectMismatchedConnectionsInTransaction(transaction: DatabaseTransaction, userId: string, githubUserId: number): Promise<void> {
    await transaction.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, refresh_token_encrypted = NULL,
           token_scope = NULL, access_token_expires_at = NULL,
           refresh_token_expires_at = NULL, revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND github_user_id <> $2`,
      [userId, githubUserId]
    );
  }

  private async getOptionalConnectionRow(
    userId: string,
    purpose: GithubOAuthPurpose,
    executor: Pick<DatabaseService | DatabaseTransaction, "queryOne"> = this.database,
    forUpdate = false
  ): Promise<GithubOAuthConnectionRow | null> {
    return executor.queryOne<GithubOAuthConnectionRow>(
      `SELECT id, github_user_id, github_login, access_token_encrypted,
              refresh_token_encrypted, token_scope, access_token_expires_at,
              refresh_token_expires_at, connected_at, revoked_at
       FROM github_oauth_connections
       WHERE user_id = $1 AND purpose = $2
       ORDER BY connected_at DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [userId, purpose]
    );
  }

  private shouldRefreshAccessToken(row: GithubOAuthConnectionRow): boolean {
    if (!row.access_token_expires_at) return false;
    const expiresAt = new Date(row.access_token_expires_at).getTime();
    return Number.isFinite(expiresAt) &&
      expiresAt - Date.now() <= GITHUB_OAUTH_REFRESH_THRESHOLD_MS;
  }

  private isRefreshTokenExpired(row: GithubOAuthConnectionRow): boolean {
    if (!row.refresh_token_expires_at) return false;
    const expiresAt = new Date(row.refresh_token_expires_at).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  }

  private async refreshLockedConnection(
    transaction: DatabaseTransaction,
    row: GithubOAuthConnectionRow,
    config: GithubOAuthRuntimeConfig
  ): Promise<GithubOAuthConnectionRow | null> {
    if (!row.refresh_token_encrypted || this.isRefreshTokenExpired(row)) {
      await this.revokeConnectionInTransaction(transaction, row.id);
      return null;
    }

    let refreshToken: string;
    try {
      refreshToken = this.tokenEncryptionService.decryptToken(
        row.refresh_token_encrypted,
        config
      );
    } catch {
      await this.revokeConnectionInTransaction(transaction, row.id);
      return null;
    }

    let token;
    try {
      token = await this.githubOAuthClient.refreshAccessToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken
      });
    } catch (error) {
      if (error instanceof GithubOAuthRefreshRejectedError) {
        await this.revokeConnectionInTransaction(transaction, row.id);
        return null;
      }
      throw error;
    }

    const accessTokenEncrypted = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    const refreshTokenEncrypted = this.tokenEncryptionService.encryptToken(
      token.refreshToken,
      config
    );
    await transaction.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = $2, refresh_token_encrypted = $3,
           token_scope = $4, access_token_expires_at = $5,
           refresh_token_expires_at = $6, revoked_at = NULL
       WHERE id = $1`,
      [
        row.id, accessTokenEncrypted, refreshTokenEncrypted, token.scope,
        token.accessTokenExpiresAt, token.refreshTokenExpiresAt
      ]
    );

    return {
      ...row,
      access_token_encrypted: accessTokenEncrypted,
      refresh_token_encrypted: refreshTokenEncrypted,
      token_scope: token.scope,
      access_token_expires_at: token.accessTokenExpiresAt,
      refresh_token_expires_at: token.refreshTokenExpiresAt,
      revoked_at: null
    };
  }

  private async revokeConnectionInTransaction(
    transaction: DatabaseTransaction,
    connectionId: string
  ): Promise<void> {
    await transaction.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, refresh_token_encrypted = NULL,
           token_scope = NULL, access_token_expires_at = NULL,
           refresh_token_expires_at = NULL, revoked_at = now()
       WHERE id = $1`,
      [connectionId]
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
