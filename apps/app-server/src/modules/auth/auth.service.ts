import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { SessionService } from "../../common/session.service";
import { DatabaseService } from "../../database/database.service";
import { GithubTokenEncryptionService } from "../github-integration/github-token-encryption.service";
import { AuthConfigService } from "./auth-config.service";
import { GithubLoginOAuthClient, GithubLoginUserProfile } from "./github-login-oauth.client";
import { GoogleOAuthClient, GoogleUserProfile } from "./google-oauth.client";
import { OAuthStateService } from "./oauth-state.service";
import type {
  LoginCallbackQuery,
  LoginProvider,
  LoginStartPayload,
  StartLoginRequest
} from "./types";

interface UserIdRow extends QueryResultRow {
  id: string;
}

interface SessionRow extends QueryResultRow {
  expires_at: Date | string;
}

interface LoginSessionPayload {
  accessToken: string;
  expiresAt: string;
}

const GOOGLE_LOGIN_SCOPE = "openid email profile";
const GITHUB_LOGIN_SCOPE = "repo read:user user:email";
const ACCESS_TOKEN_BYTE_LENGTH = 32;
const MAX_RETURN_URL_LENGTH = 2048;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessionService: SessionService,
    private readonly configService: AuthConfigService,
    private readonly stateService: OAuthStateService,
    private readonly googleOAuthClient: GoogleOAuthClient,
    private readonly githubOAuthClient: GithubLoginOAuthClient,
    private readonly githubTokenEncryptionService: GithubTokenEncryptionService
  ) {}

  startLogin(
    provider: LoginProvider,
    input: StartLoginRequest | undefined
  ): LoginStartPayload {
    const config = this.configService.getProviderConfig(provider);
    const returnUrl = this.validateReturnUrl(input?.returnUrl, config.frontendUrl);
    const state = this.stateService.createState(
      {
        provider,
        returnUrl
      },
      config
    );
    const authorizeUrl =
      provider === "google"
        ? this.buildGoogleAuthorizeUrl(state, config)
        : this.buildGithubAuthorizeUrl(state, config);

    return {
      authorizeUrl,
      state
    };
  }

  async completeLoginCallback(
    provider: LoginProvider,
    query: LoginCallbackQuery
  ): Promise<string> {
    if (typeof query.error === "string" && query.error) {
      throw badRequest("OAuth login was cancelled");
    }

    const config = this.configService.getProviderConfig(provider);
    const code = this.validateRequiredString(query.code, "OAuth code is required");
    const state = this.validateRequiredString(query.state, "OAuth state is required");
    const statePayload = this.stateService.verifyState(state, provider, config);
    const userId =
      provider === "google"
        ? await this.completeGoogleLogin(code, config)
        : await this.completeGithubLogin(code, config);
    const session = await this.createSession(userId, config.sessionTtlSeconds);

    return this.buildCallbackRedirect({
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      returnUrl: statePayload.returnUrl
    });
  }

  async logout(accessToken: string): Promise<void> {
    await this.sessionService.revokeSessionToken(accessToken);
  }

  buildLoginRedirect(error: string): string {
    const redirectUrl = new URL("/login", this.configService.getFrontendUrl());
    redirectUrl.searchParams.set("error", error);
    return redirectUrl.toString();
  }

  extractBearerToken(authorization: string | string[] | undefined): string {
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!header) {
      throw badRequest("Missing bearer token");
    }

    const parts = header.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      throw badRequest("Invalid bearer token");
    }

    return parts[1];
  }

  private buildGoogleAuthorizeUrl(
    state: string,
    config: ReturnType<AuthConfigService["getProviderConfig"]>
  ): string {
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", this.configService.getCallbackUrl("google", config));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", GOOGLE_LOGIN_SCOPE);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "select_account");

    return authorizeUrl.toString();
  }

  private buildGithubAuthorizeUrl(
    state: string,
    config: ReturnType<AuthConfigService["getProviderConfig"]>
  ): string {
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", this.configService.getCallbackUrl("github", config));
    authorizeUrl.searchParams.set("scope", GITHUB_LOGIN_SCOPE);
    authorizeUrl.searchParams.set("state", state);

    return authorizeUrl.toString();
  }

  private async completeGoogleLogin(
    code: string,
    config: ReturnType<AuthConfigService["getProviderConfig"]>
  ): Promise<string> {
    const accessToken = await this.googleOAuthClient.exchangeCodeForAccessToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: this.configService.getCallbackUrl("google", config)
    });
    const profile = await this.googleOAuthClient.getUserProfile(accessToken);

    return this.upsertGoogleUser(profile);
  }

  private async completeGithubLogin(
    code: string,
    config: ReturnType<AuthConfigService["getProviderConfig"]>
  ): Promise<string> {
    const token = await this.githubOAuthClient.exchangeCodeForAccessToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: this.configService.getCallbackUrl("github", config)
    });
    const profile = await this.githubOAuthClient.getUserProfile(token.accessToken);
    const encryptedToken = this.githubTokenEncryptionService.encryptToken(
      token.accessToken,
      {
        ...config,
        tokenEncryptionKey: this.configService.getGithubTokenEncryptionKey()
      }
    );

    return this.upsertGithubUser(profile, {
      encryptedToken,
      scope: token.scope
    });
  }

  private async upsertGoogleUser(profile: GoogleUserProfile): Promise<string> {
    try {
      const existingUser = await this.database.queryOne<UserIdRow>(
        `
          SELECT id
          FROM users
          WHERE google_user_id = $1
             OR email = $2
          ORDER BY CASE WHEN google_user_id = $1 THEN 0 ELSE 1 END
          LIMIT 1
        `,
        [profile.sub, profile.email]
      );

      if (existingUser) {
        const updatedUser = await this.database.queryOne<UserIdRow>(
          `
            UPDATE users
            SET
              google_user_id = $2,
              google_connected_at = COALESCE(google_connected_at, now()),
              google_revoked_at = NULL,
              name = COALESCE($3, name),
              email = COALESCE(email, $4),
              avatar_url = COALESCE($5, avatar_url)
            WHERE id = $1
            RETURNING id
          `,
          [existingUser.id, profile.sub, profile.name, profile.email, profile.picture]
        );

        if (!updatedUser) {
          throw badRequest("OAuth user could not be saved");
        }

        return updatedUser.id;
      }

      const insertedUser = await this.database.queryOne<UserIdRow>(
        `
          INSERT INTO users (
            name,
            email,
            avatar_url,
            google_user_id,
            google_connected_at
          )
          VALUES ($1, $2, $3, $4, now())
          RETURNING id
        `,
        [profile.name, profile.email, profile.picture, profile.sub]
      );

      if (!insertedUser) {
        throw badRequest("OAuth user could not be saved");
      }

      return insertedUser.id;
    } catch (error) {
      this.throwIfUniqueViolation(error);
      throw error;
    }
  }

  private async upsertGithubUser(
    profile: GithubLoginUserProfile,
    token: {
      encryptedToken: string;
      scope: string | null;
    }
  ): Promise<string> {
    try {
      const existingUser = await this.database.queryOne<UserIdRow>(
        `
          SELECT id
          FROM users
          WHERE github_user_id = $1
             OR ($2::text IS NOT NULL AND email = $2)
          ORDER BY CASE WHEN github_user_id = $1 THEN 0 ELSE 1 END
          LIMIT 1
        `,
        [profile.id, profile.email]
      );

      if (existingUser) {
        const updatedUser = await this.database.queryOne<UserIdRow>(
          `
            UPDATE users
            SET
              github_user_id = $2,
              github_login = $3,
              name = COALESCE($4, $3, name),
              email = COALESCE(email, $5),
              avatar_url = COALESCE($6, avatar_url),
              github_access_token_encrypted = $7,
              github_token_scope = $8,
              github_connected_at = now(),
              github_revoked_at = NULL
            WHERE id = $1
            RETURNING id
          `,
          [
            existingUser.id,
            profile.id,
            profile.login,
            profile.name,
            profile.email,
            profile.avatarUrl,
            token.encryptedToken,
            token.scope
          ]
        );

        if (!updatedUser) {
          throw badRequest("OAuth user could not be saved");
        }

        return updatedUser.id;
      }

      const insertedUser = await this.database.queryOne<UserIdRow>(
        `
          INSERT INTO users (
            name,
            email,
            avatar_url,
            github_user_id,
            github_login,
            github_access_token_encrypted,
            github_token_scope,
            github_connected_at,
            github_revoked_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now(), NULL)
          RETURNING id
        `,
        [
          profile.name ?? profile.login,
          profile.email,
          profile.avatarUrl,
          profile.id,
          profile.login,
          token.encryptedToken,
          token.scope
        ]
      );

      if (!insertedUser) {
        throw badRequest("OAuth user could not be saved");
      }

      return insertedUser.id;
    } catch (error) {
      this.throwIfUniqueViolation(error);
      throw error;
    }
  }

  private async createSession(
    userId: string,
    ttlSeconds: number
  ): Promise<LoginSessionPayload> {
    const accessToken = `pilo_${randomBytes(ACCESS_TOKEN_BYTE_LENGTH).toString("base64url")}`;
    const tokenHash = this.sessionService.hashSessionToken(accessToken);
    const session = await this.database.queryOne<SessionRow>(
      `
        INSERT INTO user_sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + ($3 * interval '1 second'))
        RETURNING expires_at
      `,
      [userId, tokenHash, ttlSeconds]
    );

    if (!session) {
      throw badRequest("Session could not be created");
    }

    return {
      accessToken,
      expiresAt: this.toIsoString(session.expires_at)
    };
  }

  private buildCallbackRedirect(input: {
    accessToken: string;
    expiresAt: string;
    returnUrl: string | null;
  }): string {
    const redirectUrl = new URL("/login/callback", this.configService.getFrontendUrl());
    const fragment = new URLSearchParams({
      access_token: input.accessToken,
      expires_at: input.expiresAt
    });

    if (input.returnUrl) {
      fragment.set("return_to", input.returnUrl);
    }

    redirectUrl.hash = fragment.toString();
    return redirectUrl.toString();
  }

  private validateReturnUrl(value: unknown, frontendUrl: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string") {
      throw badRequest("returnUrl must be a string");
    }

    if (value.length > MAX_RETURN_URL_LENGTH) {
      throw badRequest("returnUrl is too long");
    }

    if (value.startsWith("/") && !value.startsWith("//")) {
      return value;
    }

    try {
      const url = new URL(value);
      if (url.origin !== frontendUrl) {
        throw new Error("Invalid origin");
      }

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      throw badRequest("returnUrl must be a frontend path");
    }
  }

  private validateRequiredString(value: unknown, message: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private throwIfUniqueViolation(error: unknown): never | void {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw badRequest("OAuth account already belongs to another user");
    }
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
