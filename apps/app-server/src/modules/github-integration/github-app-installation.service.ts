import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  GithubAppInstallationCallbackQuery,
  StartGithubAppInstallationRequest
} from "./dto";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import { GithubCallbackStateService } from "./github-callback-state.service";
import {
  type GithubAppRuntimeConfig,
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { githubCallbackBadRequest } from "./github-oauth-callback-error";
import { validateGithubCallbackReturnUrl } from "./github-return-url";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubSyncJobEnqueueError } from "./github-sync-job.service";
import { GithubSyncRunService } from "./github-sync-run.service";
import type {
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationDeletePayload,
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

type GithubAppInstallationStartResult = GithubAppInstallationStartPayload & {
  stateCookie: string;
};

@Injectable()
export class GithubAppInstallationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly installationStateService: GithubAppInstallationStateService,
    private readonly callbackStateService: GithubCallbackStateService,
    private readonly githubAppClient: GithubAppClient,
    private readonly syncRunService: GithubSyncRunService
  ) {}

  async startGithubAppInstallation(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubAppInstallationRequest | undefined
  ): Promise<GithubAppInstallationStartResult> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const config = this.configService.getGithubAppConfig();
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const accessToken = await this.getConnectedGithubOAuthAccessToken(
      currentUserId,
      oauthConfig
    );
    await this.githubOAuthClient.assertUserInstallationLookupSupported({
      accessToken
    });
    const returnUrl = validateGithubCallbackReturnUrl(
      input?.returnUrl,
      config.frontendUrl
    );
    const state = this.installationStateService.createState(
      {
        userId: currentUserId,
        workspaceId,
        returnUrl
      },
      config
    );
    const statePayload = this.installationStateService.verifyState(state, config);
    const bindingToken = this.callbackStateService.createBindingToken();
    await this.callbackStateService.storeState({
      flow: "app_installation",
      stateNonce: statePayload.nonce,
      userId: currentUserId,
      workspaceId,
      returnUrl,
      bindingTokenHash: this.callbackStateService.hashBindingToken(bindingToken),
      expiresAt: new Date(statePayload.expiresAt)
    });

    const installUrl = new URL(
      `https://github.com/apps/${config.appSlug}/installations/new`
    );
    installUrl.searchParams.set("state", state);

    return {
      installUrl: installUrl.toString(),
      state,
      stateCookie: this.callbackStateService.buildSetCookieHeader(
        "app_installation",
        bindingToken,
        config
      )
    };
  }

  async completeGithubAppInstallationCallback(
    query: GithubAppInstallationCallbackQuery,
    cookieHeader?: string | null
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
    const storedState = await this.callbackStateService.consumeState({
      flow: "app_installation",
      stateNonce: statePayload.nonce,
      cookieHeader
    });
    if (!storedState.workspaceId) {
      throw badRequest("Invalid GitHub App installation state");
    }

    const oauthConfig = this.configService.getGithubOAuthConfig();
    const accessToken = await this.getConnectedGithubOAuthAccessTokenForCallback(
      storedState.userId,
      oauthConfig,
      storedState.returnUrl
    );
    const hasInstallationAccess = await this.hasUserInstallationAccessForCallback(
      accessToken,
      githubInstallationId,
      storedState.returnUrl
    );
    if (!hasInstallationAccess) {
      throw githubCallbackBadRequest(
        "GitHub App installation is not accessible to the connected GitHub user",
        storedState.returnUrl,
        "installation_not_accessible"
      );
    }

    const installation = await this.getInstallationForCallback(
      githubInstallationId,
      config,
      storedState.returnUrl
    );

    let row: GithubInstallationRow | null;
    try {
      row = await this.database.queryOne<GithubInstallationRow>(
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
          ON CONFLICT (workspace_id, github_installation_id)
          DO UPDATE SET
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
          storedState.workspaceId,
          installation.githubInstallationId,
          installation.accountLogin,
          installation.accountType,
          installation.repositorySelection,
          installation.permissions,
          storedState.userId,
          installation.installedAt,
          installation.suspendedAt
        ]
      );
    } catch {
      throw githubCallbackBadRequest(
        "GitHub App installation could not be saved",
        storedState.returnUrl,
        "installation_failed"
      );
    }

    if (!row) {
      throw githubCallbackBadRequest(
        "GitHub App installation could not be saved",
        storedState.returnUrl,
        "installation_failed"
      );
    }

    let syncRunId: string | null = null;
    try {
      const syncRun = await this.syncRunService.startGithubSyncRun(
        storedState.userId,
        storedState.workspaceId,
        { installationId: row.id, target: "source" }
      );
      syncRunId = syncRun.id;
    } catch (error) {
      if (error instanceof GithubSyncJobEnqueueError) {
        syncRunId = error.syncRunId;
      } else {
        throw error;
      }
    }

    const { id, ...payload } = this.mapGithubInstallation(row);
    return {
      ...payload,
      installationId: id,
      syncRunId,
      returnUrl: this.appendInstallationId(storedState.returnUrl, id)
    };
  }

  private appendInstallationId(returnUrl: string | null, installationId: string): string | null {
    if (!returnUrl) return null;
    const url = new URL(returnUrl);
    url.searchParams.set("github_installation_id", installationId);
    return url.toString();
  }

  private async getConnectedGithubOAuthAccessTokenForCallback(
    currentUserId: string,
    config: GithubOAuthRuntimeConfig,
    returnUrl: string | null
  ): Promise<string> {
    try {
      return await this.getConnectedGithubOAuthAccessToken(currentUserId, config);
    } catch {
      throw githubCallbackBadRequest(
        "GitHub OAuth connection is required",
        returnUrl,
        "connection_failed"
      );
    }
  }

  private async hasUserInstallationAccessForCallback(
    accessToken: string,
    installationId: number,
    returnUrl: string | null
  ): Promise<boolean> {
    try {
      return await this.githubOAuthClient.hasUserInstallationAccess({
        accessToken,
        installationId
      });
    } catch {
      throw githubCallbackBadRequest(
        "GitHub OAuth installation lookup failed",
        returnUrl,
        "installation_lookup_failed"
      );
    }
  }

  private async getInstallationForCallback(
    installationId: number,
    config: GithubAppRuntimeConfig,
    returnUrl: string | null
  ) {
    try {
      return await this.githubAppClient.getInstallation({
        installationId,
        appId: config.appId,
        privateKey: config.privateKey,
        now: config.now
      });
    } catch {
      throw githubCallbackBadRequest(
        "GitHub App installation lookup failed",
        returnUrl,
        "installation_lookup_failed"
      );
    }
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

  async deleteGithubAppInstallation(
    currentUserId: string,
    workspaceId: string,
    installationId: string
  ): Promise<GithubAppInstallationDeletePayload> {
    await this.workspaceService.assertWorkspaceOwnerAccess(
      currentUserId,
      workspaceId
    );

    const row = await this.database.queryOne<GithubInstallationRow>(
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
          AND id = $2
      `,
      [workspaceId, installationId]
    );

    if (!row) {
      throw notFound("GitHub App installation not found");
    }

    const config = this.configService.getGithubAppConfig();
    const githubInstallationId = this.toNumber(row.github_installation_id);
    const deleteResult = await this.githubAppClient.deleteInstallation({
      installationId: githubInstallationId,
      appId: config.appId,
      privateKey: config.privateKey,
      now: config.now
    });

    const deleted = await this.database.queryOne<QueryResultRow>(
      `
        DELETE FROM github_installations
        WHERE workspace_id = $1
          AND id = $2
        RETURNING id
      `,
      [workspaceId, installationId]
    );

    if (!deleted) {
      throw notFound("GitHub App installation not found");
    }

    return {
      deleted: true,
      alreadyDeleted: deleteResult.alreadyDeleted,
      installationId: row.id,
      githubInstallationId,
      accountLogin: row.account_login
    };
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
