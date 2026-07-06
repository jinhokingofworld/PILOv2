import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import type { LoginProvider } from "./types";

export interface AuthProviderRuntimeConfig {
  clientId: string;
  clientSecret: string;
  apiPublicOrigin: string;
  apiBasePath: string;
  frontendUrl: string;
  stateSecret: string;
  stateTtlSeconds: number;
  sessionTtlSeconds: number;
  now?: () => Date;
}

const DEFAULT_API_BASE_PATH = "/api/v1";
const DEFAULT_STATE_TTL_SECONDS = 600;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_FRONTEND_URL = "http://localhost:3000";

@Injectable()
export class AuthConfigService {
  getProviderConfig(provider: LoginProvider): AuthProviderRuntimeConfig {
    const apiPublicOrigin = this.requireConfig(process.env.API_PUBLIC_ORIGIN);
    const frontendUrl = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
    const stateSecret = this.requireConfig(process.env.SESSION_SECRET);
    const apiBasePath = this.normalizeApiBasePath(
      process.env.API_BASE_PATH ?? DEFAULT_API_BASE_PATH
    );
    const stateTtlSeconds = this.parsePositiveInteger(
      process.env.OAUTH_STATE_TTL_SECONDS,
      DEFAULT_STATE_TTL_SECONDS
    );
    const sessionTtlSeconds = this.parsePositiveInteger(
      process.env.AUTH_SESSION_TTL_SECONDS,
      DEFAULT_SESSION_TTL_SECONDS
    );
    const { clientId, clientSecret } = this.getProviderSecret(provider);

    return {
      clientId,
      clientSecret,
      apiPublicOrigin: this.normalizeOrigin(apiPublicOrigin),
      apiBasePath,
      frontendUrl: this.normalizeOrigin(frontendUrl),
      stateSecret,
      stateTtlSeconds,
      sessionTtlSeconds
    };
  }

  getFrontendUrl(): string {
    return this.normalizeOrigin(process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL);
  }

  getCallbackUrl(provider: LoginProvider, config: AuthProviderRuntimeConfig): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/auth/${provider}/callback`;
  }

  private getProviderSecret(provider: LoginProvider): {
    clientId: string;
    clientSecret: string;
  } {
    if (provider === "google") {
      return {
        clientId: this.requireConfig(
          process.env.GOOGLE_OAUTH_CLIENT_ID,
          "Google login is not configured"
        ),
        clientSecret: this.requireConfig(
          process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          "Google login is not configured"
        )
      };
    }

    return {
      clientId: this.requireConfig(
        process.env.GITHUB_LOGIN_CLIENT_ID,
        "GitHub login is not configured"
      ),
      clientSecret: this.requireConfig(
        process.env.GITHUB_LOGIN_CLIENT_SECRET,
        "GitHub login is not configured"
      )
    };
  }

  private requireConfig(
    value: string | undefined,
    message = "OAuth login is not configured"
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
      throw badRequest("OAuth login is not configured");
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
