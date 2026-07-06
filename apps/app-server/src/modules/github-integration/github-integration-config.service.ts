import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GithubOAuthRuntimeConfig {
  clientId: string;
  clientSecret: string;
  apiPublicOrigin: string;
  apiBasePath: string;
  frontendUrl: string;
  tokenEncryptionKey: string;
  stateSecret: string;
  stateTtlSeconds: number;
  now?: () => Date;
}

export interface GithubAppRuntimeConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
  apiPublicOrigin: string;
  apiBasePath: string;
  frontendUrl: string;
  stateSecret: string;
  stateTtlSeconds: number;
  now?: () => Date;
}

export interface GithubWebhookRuntimeConfig {
  webhookSecret: string;
}

const DEFAULT_API_BASE_PATH = "/api/v1";
const DEFAULT_FRONTEND_URL = "http://localhost:3000";
const DEFAULT_STATE_TTL_SECONDS = 600;
const GITHUB_APP_SLUG_PATTERN = /^[a-zA-Z0-9-]+$/;

@Injectable()
export class GithubIntegrationConfigService {
  getGithubOAuthConfig(): GithubOAuthRuntimeConfig {
    const clientId = this.requireConfig(process.env.GITHUB_USER_OAUTH_CLIENT_ID);
    const clientSecret = this.requireConfig(process.env.GITHUB_USER_OAUTH_CLIENT_SECRET);
    const apiPublicOrigin = this.requireConfig(process.env.API_PUBLIC_ORIGIN);
    const frontendUrl = this.normalizeOrigin(
      process.env.FRONTEND_URL?.trim() || DEFAULT_FRONTEND_URL
    );
    const tokenEncryptionKey = this.requireConfig(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
    const stateSecret = this.requireConfig(process.env.SESSION_SECRET);
    const apiBasePath = this.normalizeApiBasePath(
      process.env.API_BASE_PATH ?? DEFAULT_API_BASE_PATH
    );
    const stateTtlSeconds = this.parsePositiveInteger(
      process.env.OAUTH_STATE_TTL_SECONDS,
      DEFAULT_STATE_TTL_SECONDS
    );

    return {
      clientId,
      clientSecret,
      apiPublicOrigin: this.normalizeOrigin(apiPublicOrigin),
      apiBasePath,
      frontendUrl,
      tokenEncryptionKey,
      stateSecret,
      stateTtlSeconds
    };
  }

  getGithubAppConfig(): GithubAppRuntimeConfig {
    const appId = this.requireConfig(
      process.env.GITHUB_APP_ID,
      "GitHub App is not configured"
    );
    const appSlug = this.normalizeGithubAppSlug(
      this.requireConfig(process.env.GITHUB_APP_SLUG, "GitHub App is not configured")
    );
    const privateKey = this.normalizePrivateKey(
      this.requireConfig(
        process.env.GITHUB_APP_PRIVATE_KEY,
        "GitHub App is not configured"
      )
    );
    const apiPublicOrigin = this.requireConfig(
      process.env.API_PUBLIC_ORIGIN,
      "GitHub App is not configured"
    );
    const frontendUrl = this.normalizeOrigin(
      process.env.FRONTEND_URL?.trim() || DEFAULT_FRONTEND_URL
    );
    const stateSecret = this.requireConfig(
      process.env.SESSION_SECRET,
      "GitHub App is not configured"
    );
    const apiBasePath = this.normalizeApiBasePath(
      process.env.API_BASE_PATH ?? DEFAULT_API_BASE_PATH
    );
    const stateTtlSeconds = this.parsePositiveInteger(
      process.env.OAUTH_STATE_TTL_SECONDS,
      DEFAULT_STATE_TTL_SECONDS
    );

    return {
      appId,
      appSlug,
      privateKey,
      apiPublicOrigin: this.normalizeOrigin(apiPublicOrigin),
      apiBasePath,
      frontendUrl,
      stateSecret,
      stateTtlSeconds
    };
  }

  getGithubWebhookConfig(): GithubWebhookRuntimeConfig {
    return {
      webhookSecret: this.requireConfig(
        process.env.GITHUB_WEBHOOK_SECRET,
        "GitHub App webhook is not configured"
      )
    };
  }

  private requireConfig(
    value: string | undefined,
    message = "GitHub OAuth is not configured"
  ): string {
    if (!value?.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private normalizeOrigin(value: string): string {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported origin protocol");
      }

      return url.origin;
    } catch {
      throw badRequest("GitHub OAuth is not configured");
    }
  }

  private normalizeApiBasePath(value: string): string {
    const path = value.trim() || DEFAULT_API_BASE_PATH;
    return path.startsWith("/") ? path.replace(/\/+$/, "") : `/${path}`;
  }

  private normalizeGithubAppSlug(value: string): string {
    if (!GITHUB_APP_SLUG_PATTERN.test(value)) {
      throw badRequest("GitHub App is not configured");
    }

    return value;
  }

  private normalizePrivateKey(value: string): string {
    return value.replace(/\\n/g, "\n");
  }

  private parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value?.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
