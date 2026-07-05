import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  GithubAppInstallationCallbackQuery,
  StartGithubAppInstallationRequest
} from "./dto";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationPayload,
  GithubAppInstallationStartPayload
} from "./types";

interface GithubInstallationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  github_installation_id: string | number;
  account_login: string;
  account_type: "User" | "Organization";
  repository_selection: string | null;
  permissions: unknown;
  installed_by_user_id: string | null;
  installed_at: Date | string | null;
  suspended_at: Date | string | null;
  last_synced_at: Date | string | null;
}

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

@Injectable()
export class GithubAppInstallationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly installationStateService: GithubAppInstallationStateService,
    private readonly githubAppClient: GithubAppClient
  ) {}

  async startGithubAppInstallation(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubAppInstallationRequest | undefined
  ): Promise<GithubAppInstallationStartPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubOAuthConnected(currentUserId);

    const config = this.configService.getGithubAppConfig();
    const returnUrl = this.validateReturnUrl(input?.returnUrl);
    const state = this.installationStateService.createState(
      {
        userId: currentUserId,
        workspaceId,
        returnUrl
      },
      config
    );
    const installUrl = new URL(
      `https://github.com/apps/${config.appSlug}/installations/new`
    );
    installUrl.searchParams.set("state", state);

    return {
      installUrl: installUrl.toString(),
      state
    };
  }

  async completeGithubAppInstallationCallback(
    query: GithubAppInstallationCallbackQuery
  ): Promise<GithubAppInstallationCallbackPayload> {
    const config = this.configService.getGithubAppConfig();
    const githubInstallationId = this.parseGithubInstallationId(
      query.installation_id
    );
    this.validateRequiredString(
      query.setup_action,
      "GitHub App setup action is required"
    );
    const state = this.validateRequiredString(
      query.state,
      "GitHub App installation state is required"
    );
    const statePayload = this.installationStateService.verifyState(state, config);
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const accessToken = await this.getConnectedGithubOAuthAccessToken(
      statePayload.userId,
      oauthConfig
    );
    const hasInstallationAccess =
      await this.githubOAuthClient.hasUserInstallationAccess({
        accessToken,
        installationId: githubInstallationId
      });
    if (!hasInstallationAccess) {
      throw badRequest(
        "GitHub App installation is not accessible to the connected GitHub user"
      );
    }

    const installation = await this.githubAppClient.getInstallation({
      installationId: githubInstallationId,
      appId: config.appId,
      privateKey: config.privateKey,
      now: config.now
    });

    const row = await this.database.queryOne<GithubInstallationRow>(
      `
        INSERT INTO github_installations (
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (github_installation_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          account_login = EXCLUDED.account_login,
          account_type = EXCLUDED.account_type,
          repository_selection = EXCLUDED.repository_selection,
          permissions = EXCLUDED.permissions,
          installed_by_user_id = EXCLUDED.installed_by_user_id,
          installed_at = EXCLUDED.installed_at,
          suspended_at = EXCLUDED.suspended_at,
          updated_at = now()
        RETURNING
          id,
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at,
          last_synced_at
      `,
      [
        statePayload.workspaceId,
        installation.githubInstallationId,
        installation.accountLogin,
        installation.accountType,
        installation.repositorySelection,
        installation.permissions,
        statePayload.userId,
        installation.installedAt,
        installation.suspendedAt
      ]
    );

    if (!row) {
      throw badRequest("GitHub App installation could not be saved");
    }

    const { id, ...payload } = this.mapGithubInstallation(row);
    return {
      ...payload,
      installationId: id
    };
  }

  async listGithubAppInstallations(
    currentUserId: string,
    workspaceId: string
  ): Promise<GithubAppInstallationPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const rows = await this.database.query<GithubInstallationRow>(
      `
        SELECT
          id,
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at,
          last_synced_at
        FROM github_installations
        WHERE workspace_id = $1
        ORDER BY installed_at DESC NULLS LAST, created_at DESC
      `,
      [workspaceId]
    );

    return rows.map((row) => this.mapGithubInstallation(row));
  }

  private mapGithubInstallation(
    row: GithubInstallationRow
  ): GithubAppInstallationPayload {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      githubInstallationId: this.toNumber(row.github_installation_id),
      accountLogin: row.account_login,
      accountType: row.account_type,
      repositorySelection: row.repository_selection,
      permissions: this.toRecord(row.permissions),
      installedByUserId: row.installed_by_user_id,
      installedAt: this.toNullableIsoString(row.installed_at),
      suspendedAt: this.toNullableIsoString(row.suspended_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private async assertGithubOAuthConnected(currentUserId: string): Promise<void> {
    const row = await this.getGithubOAuthConnectionRow(currentUserId);
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }
  }

  private async getConnectedGithubOAuthAccessToken(
    currentUserId: string,
    config: GithubOAuthRuntimeConfig
  ): Promise<string> {
    const row = await this.getGithubOAuthConnectionRow(currentUserId);
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_access_token_encrypted,
      config
    );
  }

  private async getGithubOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubOAuthConnectionRow>(
      `
        SELECT
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

  private isActiveGithubOAuthConnection(
    row: GithubOAuthConnectionRow
  ): row is GithubOAuthConnectionRow & { github_access_token_encrypted: string } {
    return Boolean(
      row.github_access_token_encrypted &&
        row.github_connected_at &&
        !row.github_revoked_at
    );
  }

  private validateReturnUrl(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || value.length > 2048) {
      throw badRequest("Invalid returnUrl");
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported returnUrl protocol");
      }

      return url.toString();
    } catch {
      throw badRequest("Invalid returnUrl");
    }
  }

  private validateRequiredString(value: unknown, message: string): string {
    if (Array.isArray(value)) {
      throw badRequest(message);
    }

    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private parseGithubInstallationId(value: unknown): number {
    const raw = this.validateRequiredString(
      value,
      "GitHub installation id is required"
    );
    if (!/^\d+$/.test(raw)) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    return parsed;
  }

  private toNumber(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid GitHub installation id");
    }

    return parsed;
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toRecord(parsed);
      } catch {
        return {};
      }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
