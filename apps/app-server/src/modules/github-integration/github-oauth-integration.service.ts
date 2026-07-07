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
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload
} from "./types";

interface GithubOAuthStatusRow extends QueryResultRow {
  github_user_id: string | number | null;
  github_login: string | null;
  github_token_scope: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

type GithubOAuthStartResult = GithubOAuthStartPayload & {
  stateCookie: string;
};

const GITHUB_OAUTH_SCOPES = ["read:user", "repo", "read:project"] as const;

@Injectable()
export class GithubOAuthIntegrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly stateService: GithubOAuthStateService,
    private readonly callbackStateService: GithubCallbackStateService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async getGithubOAuthStatus(
    currentUserId: string
  ): Promise<GithubOAuthStatusPayload> {
    const row = await this.database.queryOne<GithubOAuthStatusRow>(
      `
        SELECT
          github_user_id,
          github_login,
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

    return this.mapGithubOAuthStatus(row);
  }

  async startGithubOAuth(
    currentUserId: string,
    input: StartGithubOAuthRequest | undefined
  ): Promise<GithubOAuthStartResult> {
    const config = this.configService.getGithubOAuthConfig();
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
      flow: "oauth",
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
    authorizeUrl.searchParams.set("scope", GITHUB_OAUTH_SCOPES.join(" "));
    authorizeUrl.searchParams.set("state", state);

    return {
      authorizeUrl: authorizeUrl.toString(),
      state,
      stateCookie: this.callbackStateService.buildSetCookieHeader(
        "oauth",
        bindingToken,
        config
      )
    };
  }

  async completeGithubOAuthCallback(
    query: GithubOAuthCallbackQuery,
    cookieHeader?: string | null
  ): Promise<GithubOAuthCallbackPayload> {
    const config = this.configService.getGithubOAuthConfig();
    const code = this.validateRequiredString(
      query.code,
      "GitHub OAuth code is required"
    );
    const state = this.validateRequiredString(
      query.state,
      "GitHub OAuth state is required"
    );
    const statePayload = this.stateService.verifyState(state, config);
    const storedState = await this.callbackStateService.consumeState({
      flow: "oauth",
      stateNonce: statePayload.nonce,
      cookieHeader
    });
    const token = await this.githubOAuthClient.exchangeCodeForAccessToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: this.getCallbackUrl(config)
    });
    const githubUser = await this.githubOAuthClient.getAuthenticatedUser(
      token.accessToken
    );
    const encryptedToken = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    const row = await this.database.queryOne<GithubOAuthStatusRow>(
      `
        UPDATE users
        SET
          github_user_id = $2,
          github_login = $3,
          github_access_token_encrypted = $4,
          github_token_scope = $5,
          github_connected_at = now(),
          github_revoked_at = NULL
        WHERE id = $1
        RETURNING
          github_user_id,
          github_login,
          github_token_scope,
          github_connected_at,
          github_revoked_at
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
      throw badRequest("Invalid OAuth state");
    }

    const githubConnectedAt = this.toNullableIsoString(row.github_connected_at);
    if (!githubConnectedAt) {
      throw badRequest("GitHub OAuth callback failed");
    }

    return {
      connected: true,
      githubUserId: this.toNullableNumber(row.github_user_id) ?? githubUser.id,
      githubLogin: row.github_login ?? githubUser.login,
      tokenScope: row.github_token_scope,
      githubConnectedAt,
      returnUrl: storedState.returnUrl
    };
  }

  async disconnectGithubOAuth(
    currentUserId: string
  ): Promise<GithubOAuthDisconnectPayload> {
    const row = await this.database.queryOne<QueryResultRow>(
      `
        UPDATE users
        SET
          github_access_token_encrypted = NULL,
          github_token_scope = NULL,
          github_revoked_at = now()
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

  private mapGithubOAuthStatus(
    row: GithubOAuthStatusRow
  ): GithubOAuthStatusPayload {
    const connected = Boolean(row.github_connected_at && !row.github_revoked_at);

    return {
      connected,
      githubUserId: this.toNullableNumber(row.github_user_id),
      githubLogin: row.github_login,
      tokenScope: connected ? row.github_token_scope : null,
      githubConnectedAt: this.toNullableIsoString(row.github_connected_at),
      githubRevokedAt: this.toNullableIsoString(row.github_revoked_at)
    };
  }

  private getCallbackUrl(config: {
    apiPublicOrigin: string;
    apiBasePath: string;
  }): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/github/oauth/callback`;
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
