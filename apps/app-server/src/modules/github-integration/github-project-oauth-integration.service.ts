import { Injectable } from "@nestjs/common";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubOAuthCallbackQuery, StartGithubOAuthRequest } from "./dto";
import { GithubCallbackStateService } from "./github-callback-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import { githubCallbackBadRequest } from "./github-oauth-callback-error";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { validateGithubCallbackReturnUrl } from "./github-return-url";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubProjectOAuthCallbackPayload,
  GithubProjectOAuthDisconnectPayload,
  GithubProjectOAuthStartPayload,
  GithubProjectOAuthStatusPayload
} from "./types";

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
    private readonly configService: GithubIntegrationConfigService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async getGithubProjectOAuthStatus(
    currentUserId: string
  ): Promise<GithubProjectOAuthStatusPayload> {
    const connection = await this.connectionService.getOptionalActiveConnection(currentUserId, "project_v2");
    if (!connection) {
      const status = await this.connectionService.getStatus(currentUserId, "project_v2");
      return {
        connected: false,
        githubUserId: status ? this.toNullableNumber(status.github_user_id) : null,
        githubLogin: status?.github_login ?? null,
        tokenScope: null,
        githubConnectedAt: status ? this.toNullableIsoString(status.connected_at) : null,
        githubRevokedAt: status ? this.toNullableIsoString(status.revoked_at) : null
      };
    }
    return { connected: true, githubUserId: connection.githubUserId, githubLogin: connection.githubLogin, tokenScope: connection.tokenScope, githubConnectedAt: connection.connectedAt, githubRevokedAt: null };
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
    this.throwIfProviderCancelled(query.error, storedState.returnUrl);
    const code = this.validateCallbackCode(query.code, storedState.returnUrl);
    const token = await this.exchangeCodeForAccessToken(
      code,
      config,
      storedState.returnUrl
    );

    if (!this.hasProjectScope(token.scope)) {
      throw githubCallbackBadRequest(
        GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE,
        storedState.returnUrl,
        "project_oauth_scope_missing"
      );
    }

    const githubUser = await this.getAuthenticatedUser(
      token.accessToken,
      storedState.returnUrl
    );
    await this.assertMatchesPrimaryGithubAccountForCallback(
      storedState.userId,
      githubUser.id,
      storedState.returnUrl
    );

    const encryptedToken = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    try {
      const row = await this.connectionService.saveConnection({ userId: storedState.userId, purpose: "project_v2", githubUserId: githubUser.id, githubLogin: githubUser.login, encryptedToken, tokenScope: token.scope });
      const githubConnectedAt = this.toNullableIsoString(row.connected_at);
      if (!githubConnectedAt) throw new Error("missing connection time");
      return { connected: true, githubUserId: githubUser.id, githubLogin: githubUser.login, tokenScope: row.token_scope, githubConnectedAt, returnUrl: storedState.returnUrl };
    } catch {
      throw githubCallbackBadRequest(
        "GitHub ProjectV2 OAuth callback failed",
        storedState.returnUrl,
        "connection_failed"
      );
    }

  }

  async disconnectGithubProjectOAuth(
    currentUserId: string
  ): Promise<GithubProjectOAuthDisconnectPayload> {
    await this.connectionService.disconnectConnection(currentUserId, "project_v2");

    return {
      disconnected: true
    };
  }

  private async assertMatchesPrimaryGithubAccount(
    currentUserId: string,
    projectGithubUserId: number
  ): Promise<void> {
    const primary = await this.connectionService.getOptionalActiveConnection(currentUserId, "app_user");
    if (primary && primary.githubUserId !== projectGithubUserId) {
      throw badRequest(
        "GitHub ProjectV2 OAuth account must match GitHub OAuth account"
      );
    }
  }

  private async assertMatchesPrimaryGithubAccountForCallback(
    currentUserId: string,
    projectGithubUserId: number,
    returnUrl: string | null
  ): Promise<void> {
    try {
      await this.assertMatchesPrimaryGithubAccount(
        currentUserId,
        projectGithubUserId
      );
    } catch (error) {
      if (
        this.readApiErrorMessage(error) ===
        "GitHub ProjectV2 OAuth account must match GitHub OAuth account"
      ) {
        throw githubCallbackBadRequest(
          "GitHub ProjectV2 OAuth account must match GitHub OAuth account",
          returnUrl,
          "project_oauth_account_mismatch"
        );
      }

      throw githubCallbackBadRequest(
        "GitHub ProjectV2 OAuth callback failed",
        returnUrl,
        "connection_failed"
      );
    }
  }

  private getCallbackUrl(config: {
    apiPublicOrigin: string;
    apiBasePath: string;
  }): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/github/project-oauth/callback`;
  }

  private async exchangeCodeForAccessToken(
    code: string,
    config: ReturnType<GithubIntegrationConfigService["getGithubProjectOAuthConfig"]>,
    returnUrl: string | null
  ) {
    try {
      return await this.githubOAuthClient.exchangeCodeForAccessToken({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: this.getCallbackUrl(config)
      });
    } catch {
      throw githubCallbackBadRequest(
        "GitHub OAuth token exchange failed",
        returnUrl,
        "token_exchange_failed"
      );
    }
  }

  private async getAuthenticatedUser(
    accessToken: string,
    returnUrl: string | null
  ) {
    try {
      return await this.githubOAuthClient.getAuthenticatedUser(accessToken);
    } catch {
      throw githubCallbackBadRequest(
        "GitHub OAuth user lookup failed",
        returnUrl,
        "connection_failed"
      );
    }
  }

  private throwIfProviderCancelled(
    value: unknown,
    returnUrl: string | null
  ): void {
    if (typeof value === "string" && value.trim()) {
      throw githubCallbackBadRequest(
        "GitHub authorization was cancelled",
        returnUrl,
        "authorization_cancelled"
      );
    }
  }

  private validateCallbackCode(value: unknown, returnUrl: string | null): string {
    try {
      return this.validateRequiredString(
        value,
        "GitHub ProjectV2 OAuth code is required"
      );
    } catch {
      throw githubCallbackBadRequest(
        "GitHub ProjectV2 OAuth code is required",
        returnUrl,
        "callback_failed"
      );
    }
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

  private readApiErrorMessage(error: unknown): string | null {
    if (typeof error !== "object" || error === null) {
      return null;
    }

    const candidate = error as { response?: unknown };
    if (
      typeof candidate.response === "object" &&
      candidate.response !== null &&
      "error" in candidate.response
    ) {
      const response = candidate.response as { error?: unknown };
      if (
        typeof response.error === "object" &&
        response.error !== null &&
        "message" in response.error
      ) {
        const apiError = response.error as { message?: unknown };
        return typeof apiError.message === "string" ? apiError.message : null;
      }
    }

    return null;
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
