import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GithubOAuthTokenRequest {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GithubOAuthTokenResponse {
  accessToken: string;
  scope: string | null;
}

export interface GithubAuthenticatedUser {
  id: number;
  login: string;
}

@Injectable()
export class GithubOAuthClient {
  async exchangeCodeForAccessToken(
    input: GithubOAuthTokenRequest
  ): Promise<GithubOAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri
    });

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      throw badRequest("GitHub OAuth token exchange failed");
    }

    const payload = (await response.json()) as unknown;
    if (!this.isTokenPayload(payload)) {
      throw badRequest("GitHub OAuth token exchange failed");
    }

    return {
      accessToken: payload.access_token,
      scope: typeof payload.scope === "string" ? payload.scope : null
    };
  }

  async getAuthenticatedUser(accessToken: string): Promise<GithubAuthenticatedUser> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      throw badRequest("GitHub OAuth user lookup failed");
    }

    const payload = (await response.json()) as unknown;
    if (!this.isUserPayload(payload)) {
      throw badRequest("GitHub OAuth user lookup failed");
    }

    return {
      id: payload.id,
      login: payload.login
    };
  }

  private isTokenPayload(value: unknown): value is {
    access_token: string;
    scope?: string;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      "access_token" in value &&
      typeof value.access_token === "string" &&
      value.access_token.length > 0
    );
  }

  private isUserPayload(value: unknown): value is GithubAuthenticatedUser {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "number" &&
      "login" in value &&
      typeof value.login === "string" &&
      value.login.length > 0
    );
  }
}
