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
    const resolved = row ?? await this.getLegacyConnectionRow(userId, purpose);
    if (!resolved || resolved.github_user_id === null || !resolved.access_token_encrypted || resolved.revoked_at) {
      throw badRequest("GitHub OAuth connection is required");
    }
    const config = purpose === "project_v2"
      ? this.configService.getGithubProjectOAuthConfig()
      : this.configService.getGithubOAuthConfig();
    return this.mapActive(resolved, config);
  }

  async getOptionalActiveConnection(userId: string, purpose: GithubOAuthPurpose): Promise<ActiveGithubOAuthConnection | null> {
    const row = await this.getOptionalConnectionRow(userId, purpose);
    const resolved = row ?? await this.getLegacyConnectionRow(userId, purpose);
    if (!resolved || resolved.github_user_id === null || !resolved.access_token_encrypted || resolved.revoked_at) return null;
    const config = purpose === "project_v2"
      ? this.configService.getGithubProjectOAuthConfig()
      : this.configService.getGithubOAuthConfig();
    return this.mapActive(resolved, config);
  }

  async getStatus(userId: string, purpose: GithubOAuthPurpose): Promise<GithubOAuthConnectionRow | null> {
    const exists = await this.database.queryOne<QueryResultRow>("SELECT id FROM users WHERE id = $1", [userId]);
    if (!exists) throw unauthorized("Current user not found");
    return (await this.getOptionalConnectionRow(userId, purpose)) ?? this.getLegacyConnectionRow(userId, purpose);
  }

  async saveConnection(input: { userId: string; purpose: GithubOAuthPurpose; githubUserId: number; githubLogin: string; encryptedToken: string; tokenScope: string | null }): Promise<GithubOAuthConnectionRow> {
    try {
      const row = await this.database.transaction(async (transaction) => {
        const legacyConflict = await transaction.queryOne<QueryResultRow>(
          input.purpose === "app_user"
            ? `SELECT id FROM users WHERE id <> $1 AND github_user_id = $2 AND github_access_token_encrypted IS NOT NULL AND github_revoked_at IS NULL LIMIT 1`
            : `SELECT id FROM users WHERE id <> $1 AND github_project_user_id = $2 AND github_project_access_token_encrypted IS NOT NULL AND github_project_revoked_at IS NULL LIMIT 1`,
          [input.userId, input.githubUserId]
        );
        if (legacyConflict) throw Object.assign(new Error("legacy account conflict"), { code: "23505" });
        await transaction.query(
          `UPDATE github_oauth_connections
           SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
           WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
          [input.userId, input.purpose]
        );
        await this.revokeLegacyConnectionInTransaction(transaction, input.userId, input.purpose);
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
    const user = await this.database.queryOne<QueryResultRow>("SELECT id FROM users WHERE id = $1", [userId]);
    if (!user) throw unauthorized("Current user not found");
    await this.database.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
       WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [userId, purpose]
    );
    await this.revokeLegacyConnectionInTransaction(this.database, userId, purpose);
  }

  async disconnectMismatchedConnectionsInTransaction(transaction: DatabaseTransaction, userId: string, githubUserId: number): Promise<void> {
    await transaction.query(
      `UPDATE github_oauth_connections
       SET access_token_encrypted = NULL, token_scope = NULL, revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND github_user_id <> $2`,
      [userId, githubUserId]
    );
    await transaction.query(
      `UPDATE users SET
         github_access_token_encrypted = CASE WHEN github_user_id IS DISTINCT FROM $2 THEN NULL ELSE github_access_token_encrypted END,
         github_token_scope = CASE WHEN github_user_id IS DISTINCT FROM $2 THEN NULL ELSE github_token_scope END,
         github_revoked_at = CASE WHEN github_user_id IS DISTINCT FROM $2 AND github_access_token_encrypted IS NOT NULL THEN now() ELSE github_revoked_at END,
         github_project_access_token_encrypted = CASE WHEN github_project_user_id IS DISTINCT FROM $2 THEN NULL ELSE github_project_access_token_encrypted END,
         github_project_token_scope = CASE WHEN github_project_user_id IS DISTINCT FROM $2 THEN NULL ELSE github_project_token_scope END,
         github_project_revoked_at = CASE WHEN github_project_user_id IS DISTINCT FROM $2 AND github_project_access_token_encrypted IS NOT NULL THEN now() ELSE github_project_revoked_at END
       WHERE id = $1`, [userId, githubUserId]
    );
  }

  private async revokeLegacyConnectionInTransaction(transaction: Pick<DatabaseTransaction, "query">, userId: string, purpose: GithubOAuthPurpose): Promise<void> {
    const fields = purpose === "app_user"
      ? "github_access_token_encrypted = NULL, github_token_scope = NULL, github_revoked_at = now()"
      : "github_project_access_token_encrypted = NULL, github_project_token_scope = NULL, github_project_revoked_at = now()";
    await transaction.query(`UPDATE users SET ${fields} WHERE id = $1`, [userId]);
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

  private async getLegacyConnectionRow(userId: string, purpose: GithubOAuthPurpose): Promise<GithubOAuthConnectionRow | null> {
    const fields = purpose === "app_user"
      ? "github_user_id, github_login, github_access_token_encrypted AS access_token_encrypted, github_token_scope AS token_scope, github_connected_at AS connected_at, github_revoked_at AS revoked_at"
      : "github_project_user_id AS github_user_id, github_project_login AS github_login, github_project_access_token_encrypted AS access_token_encrypted, github_project_token_scope AS token_scope, github_project_connected_at AS connected_at, github_project_revoked_at AS revoked_at";
    return this.database.queryOne<GithubOAuthConnectionRow>(
      `SELECT ${fields} FROM users WHERE id = $1`, [userId]
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
