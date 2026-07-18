import { Injectable } from "@nestjs/common";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubOAuthCallbackQuery, StartGithubOAuthRequest } from "./dto";
import { GithubCallbackStateService } from "./github-callback-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import {
  GithubOAuthAccountAlreadyConnectedError,
  githubCallbackBadRequest,
  isGithubOAuthAccountUniqueViolation
} from "./github-oauth-callback-error";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import { GithubOAuthInstallationLookupError } from "./github-oauth-installation-lookup.error";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { validateGithubCallbackReturnUrl } from "./github-return-url";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload
} from "./types";

type GithubOAuthStartResult = GithubOAuthStartPayload & {
  stateCookie: string;
};

@Injectable()
export class GithubOAuthIntegrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly stateService: GithubOAuthStateService,
    private readonly callbackStateService: GithubCallbackStateService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async getGithubOAuthStatus(
    currentUserId: string
  ): Promise<GithubOAuthStatusPayload> {
    const connection = await this.connectionService.getOptionalActiveConnection(currentUserId, "app_user");
    if (!connection) {
      const status = await this.connectionService.getStatus(currentUserId, "app_user");
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

  async startGithubOAuth(
    currentUserId: string,
    input: StartGithubOAuthRequest | undefined
  ): Promise<GithubOAuthStartResult> {
    const config = this.configService.getGithubOAuthConfig();
    const returnUrl = validateGithubCallbackReturnUrl(
      input?.returnUrl,
      config.frontendUrl
    );
    const expectedConnectionGeneration = await this.connectionService.getConnectionGeneration(
      currentUserId,
      "app_user",
      config.stateSecret
    );
    const state = this.stateService.createState(
      {
        userId: currentUserId,
        returnUrl,
        expectedConnectionGeneration
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
    this.throwIfProviderCancelled(query.error, storedState.returnUrl);
    const code = this.validateCallbackCode(query.code, storedState.returnUrl);
    const token = await this.exchangeCodeForAccessToken(
      code,
      config,
      storedState.returnUrl
    );
    const githubUser = await this.getAuthenticatedUser(
      token.accessToken,
      storedState.returnUrl
    );
    try {
      await this.githubOAuthClient.assertUserInstallationLookupSupported({ accessToken: token.accessToken });
    } catch (error) {
      if (error instanceof GithubOAuthInstallationLookupError) {
        throw githubCallbackBadRequest(error.message, storedState.returnUrl, "connection_failed");
      }
      throw githubCallbackBadRequest("GitHub OAuth installation lookup failed", storedState.returnUrl, "connection_failed");
    }
    const encryptedToken = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    const encryptedRefreshToken = token.refreshToken
      ? this.tokenEncryptionService.encryptToken(token.refreshToken, config)
      : null;
    try {
      const row = await this.connectionService.saveConnection({
        userId: storedState.userId,
        purpose: "app_user",
        githubUserId: githubUser.id,
        githubLogin: githubUser.login,
        encryptedToken,
        encryptedRefreshToken,
        tokenScope: token.scope,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        expectedConnectionGeneration: statePayload.expectedConnectionGeneration,
        generationSecret: config.stateSecret
      });
      const githubConnectedAt = this.toNullableIsoString(row.connected_at);
      if (!githubConnectedAt) throw new Error("missing connection time");
      return { connected: true, githubUserId: githubUser.id, githubLogin: githubUser.login, tokenScope: row.token_scope, githubConnectedAt, returnUrl: storedState.returnUrl };
    } catch (error) {
      if (isGithubOAuthAccountUniqueViolation(error) || this.isDuplicateAccountError(error)) {
        throw new GithubOAuthAccountAlreadyConnectedError(storedState.returnUrl);
      }
      if (this.getApiErrorMessage(error) === "GitHub OAuth callback is stale") {
        throw githubCallbackBadRequest(
          "GitHub OAuth callback is stale",
          storedState.returnUrl,
          "stale_callback"
        );
      }

      throw githubCallbackBadRequest(
        "GitHub OAuth callback failed",
        storedState.returnUrl,
        "connection_failed"
      );
    }

  }

  async disconnectGithubOAuth(
    currentUserId: string
  ): Promise<GithubOAuthDisconnectPayload> {
    await this.connectionService.disconnectConnection(currentUserId, "app_user");

    return {
      disconnected: true
    };
  }

  private getCallbackUrl(config: {
    apiPublicOrigin: string;
    apiBasePath: string;
  }): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/github/oauth/callback`;
  }

  private async exchangeCodeForAccessToken(
    code: string,
    config: ReturnType<GithubIntegrationConfigService["getGithubOAuthConfig"]>,
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
      return this.validateRequiredString(value, "GitHub OAuth code is required");
    } catch {
      throw githubCallbackBadRequest(
        "GitHub OAuth code is required",
        returnUrl,
        "callback_failed"
      );
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

  private isDuplicateAccountError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "response" in error &&
      (error as { response?: { error?: { message?: string } } }).response?.error?.message ===
        "GitHub account is already connected to another PILO account";
  }

  private getApiErrorMessage(error: unknown): string | null {
    if (typeof error !== "object" || error === null || !("response" in error)) return null;
    const response = (error as { response?: { error?: { message?: unknown } } }).response;
    return typeof response?.error?.message === "string" ? response.error.message : null;
  }
}
