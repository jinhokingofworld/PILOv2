import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GithubOAuthRuntimeConfig {
  clientId: string;
  clientSecret: string;
  apiPublicOrigin: string;
  apiBasePath: string;
  tokenEncryptionKey: string;
  stateSecret: string;
  stateTtlSeconds: number;
  now?: () => Date;
}

const DEFAULT_API_BASE_PATH = "/api/v1";
const DEFAULT_STATE_TTL_SECONDS = 600;

@Injectable()
export class GithubIntegrationConfigService {
  getGithubOAuthConfig(): GithubOAuthRuntimeConfig {
    const clientId = this.requireConfig(process.env.GITHUB_USER_OAUTH_CLIENT_ID);
    const clientSecret = this.requireConfig(process.env.GITHUB_USER_OAUTH_CLIENT_SECRET);
    const apiPublicOrigin = this.requireConfig(process.env.API_PUBLIC_ORIGIN);
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
      tokenEncryptionKey,
      stateSecret,
      stateTtlSeconds
    };
  }

  private requireConfig(value: string | undefined): string {
    if (!value?.trim()) {
      throw badRequest("GitHub OAuth is not configured");
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

  private parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value?.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
