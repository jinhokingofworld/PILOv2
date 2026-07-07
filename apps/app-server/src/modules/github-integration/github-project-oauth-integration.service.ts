import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubOAuthCallbackQuery, StartGithubOAuthRequest } from "./dto";
import { GithubCallbackStateService } from "./github-callback-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { validateGithubCallbackReturnUrl } from "./github-return-url";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubProjectOAuthCallbackPayload,
  GithubProjectOAuthDisconnectPayload,
  GithubProjectOAuthStartPayload,
  GithubProjectOAuthStatusPayload
} from "./types";

interface GithubProjectOAuthStatusRow extends QueryResultRow {
  github_project_user_id: string | number | null;
  github_project_login: string | null;
  github_project_token_scope: string | null;
  github_project_connected_at: Date | string | null;
  github_project_revoked_at: Date | string | null;
}

interface GithubPrimaryOAuthAccountRow extends QueryResultRow {
  github_login: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

type GithubProjectOAuthStartResult = GithubProjectOAuthStartPayload & {
  stateCookie: string;
};

const GITHUB_PROJECT_OAUTH_SCOPE = "read:user user:email project";
const GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project scope";

@Injectable()
export class GithubProjectOAuthIntegrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly stateService: GithubOAuthStateService,
    private readonly callbackStateService: GithubCallbackStateService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async getGithubProjectOAuthStatus(
    currentUserId: string
  ): Promise<GithubProjectOAuthStatusPayload> {
    const row = await this.database.queryOne<GithubProjectOAuthStatusRow>(
      `
        SELECT
          github_project_user_id,
          github_project_login,
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

    return this.mapGithubProjectOAuthStatus(row);
  }

  async startGithubProjectOAuth(
    currentUserId: string,
    input: StartGithubOAuthRequest | undefined
  ): Promise<GithubProjectOAuthStartResult> {
    const config = this.configService.getGithubProjectOAuthConfig();
    const returnUrl = validateGithubCallbackReturnUrl(
      input?.returnUrl,
      config.frontendUrl
    );
    const state = this.stateService.createState(
      {
        userId: currentUserId,
        returnUrl
      },
      config
    );
    const statePayload = this.stateService.verifyState(state, config);
    const bindingToken = this.callbackStateService.createBindingToken();
    await this.callbackStateService.storeState({
      flow: "project_oauth",
      stateNonce: statePayload.nonce,
      userId: currentUserId,
      workspaceId: null,
      returnUrl,
      bindingTokenHash: this.callbackStateService.hashBindingToken(bindingToken),
      expiresAt: new Date(statePayload.expiresAt)
    });

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", this.getCallbackUrl(config));
    authorizeUrl.searchParams.set("scope", GITHUB_PROJECT_OAUTH_SCOPE);
    authorizeUrl.searchParams.set("state", state);

    return {
      authorizeUrl: authorizeUrl.toString(),
      state,
      stateCookie: this.callbackStateService.buildSetCookieHeader(
        "project_oauth",
        bindingToken,
        config
      )
    };
  }

  async completeGithubProjectOAuthCallback(
    query: GithubOAuthCallbackQuery,
    cookieHeader?: string | null
  ): Promise<GithubProjectOAuthCallbackPayload> {
    const config = this.configService.getGithubProjectOAuthConfig();
    const code = this.validateRequiredString(
      query.code,
      "GitHub ProjectV2 OAuth code is required"
    );
    const state = this.validateRequiredString(
      query.state,
      "GitHub ProjectV2 OAuth state is required"
    );
    const statePayload = this.stateService.verifyState(state, config);
    const storedState = await this.callbackStateService.consumeState({
      flow: "project_oauth",
      stateNonce: statePayload.nonce,
      cookieHeader
    });
    const token = await this.githubOAuthClient.exchangeCodeForAccessToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: this.getCallbackUrl(config)
    });

    if (!this.hasProjectScope(token.scope)) {
      throw badRequest(GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE);
    }

    const githubUser = await this.githubOAuthClient.getAuthenticatedUser(
      token.accessToken
    );
    await this.assertMatchesPrimaryGithubAccount(
      storedState.userId,
      githubUser.login
    );

    const encryptedToken = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    const row = await this.database.queryOne<GithubProjectOAuthStatusRow>(
      `
        UPDATE users
        SET
          github_project_user_id = $2,
          github_project_login = $3,
          github_project_access_token_encrypted = $4,
          github_project_token_scope = $5,
          github_project_connected_at = now(),
          github_project_revoked_at = NULL
        WHERE id = $1
        RETURNING
          github_project_user_id,
          github_project_login,
          github_project_token_scope,
          github_project_connected_at,
          github_project_revoked_at
      `,
      [
        storedState.userId,
        githubUser.id,
        githubUser.login,
        encryptedToken,
        token.scope
      ]
    );

    if (!row) {
      throw badRequest("Invalid ProjectV2 OAuth state");
    }

    const githubConnectedAt = this.toNullableIsoString(
      row.github_project_connected_at
    );
    if (!githubConnectedAt) {
      throw badRequest("GitHub ProjectV2 OAuth callback failed");
    }

    return {
      connected: true,
      githubUserId:
        this.toNullableNumber(row.github_project_user_id) ?? githubUser.id,
      githubLogin: row.github_project_login ?? githubUser.login,
      tokenScope: row.github_project_token_scope,
      githubConnectedAt,
      returnUrl: storedState.returnUrl
    };
  }

  async disconnectGithubProjectOAuth(
    currentUserId: string
  ): Promise<GithubProjectOAuthDisconnectPayload> {
    const row = await this.database.queryOne<QueryResultRow>(
      `
        UPDATE users
        SET
          github_project_access_token_encrypted = NULL,
          github_project_token_scope = NULL,
          github_project_revoked_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return {
      disconnected: true
    };
  }

  private async assertMatchesPrimaryGithubAccount(
    currentUserId: string,
    projectGithubLogin: string
  ): Promise<void> {
    const row = await this.database.queryOne<GithubPrimaryOAuthAccountRow>(
      `
        SELECT
          github_login,
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

    if (
      row.github_login &&
      row.github_connected_at &&
      !row.github_revoked_at &&
      row.github_login.toLowerCase() !== projectGithubLogin.toLowerCase()
    ) {
      throw badRequest(
        "GitHub ProjectV2 OAuth account must match GitHub OAuth account"
      );
    }
  }

  private mapGithubProjectOAuthStatus(
    row: GithubProjectOAuthStatusRow
  ): GithubProjectOAuthStatusPayload {
    const connected = Boolean(
      row.github_project_connected_at && !row.github_project_revoked_at
    );

    return {
      connected,
      githubUserId: this.toNullableNumber(row.github_project_user_id),
      githubLogin: row.github_project_login,
      tokenScope: connected ? row.github_project_token_scope : null,
      githubConnectedAt: this.toNullableIsoString(
        row.github_project_connected_at
      ),
      githubRevokedAt: this.toNullableIsoString(row.github_project_revoked_at)
    };
  }

  private getCallbackUrl(config: {
    apiPublicOrigin: string;
    apiBasePath: string;
  }): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/github/project-oauth/callback`;
  }

  private hasProjectScope(scope: string | null): boolean {
    return this.parseScopes(scope).has("project");
  }

  private parseScopes(scope: string | null): Set<string> {
    if (!scope) {
      return new Set();
    }

    return new Set(
      scope
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
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

  private toNullableNumber(value: string | number | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
