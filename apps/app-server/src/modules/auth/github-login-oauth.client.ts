import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GithubLoginOAuthTokenRequest {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GithubLoginOAuthTokenResponse {
  accessToken: string;
  scope: string | null;
}

export interface GithubLoginUserProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

interface GithubEmailPayload {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

@Injectable()
export class GithubLoginOAuthClient {
  async exchangeCodeForAccessToken(
    input: GithubLoginOAuthTokenRequest
  ): Promise<GithubLoginOAuthTokenResponse> {
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
      throw badRequest("GitHub login token exchange failed");
    }

    const payload = (await response.json()) as unknown;
    if (!this.isTokenPayload(payload)) {
      throw badRequest("GitHub login token exchange failed");
    }

    return {
      accessToken: payload.access_token,
      scope: typeof payload.scope === "string" ? payload.scope : null
    };
  }

  async getUserProfile(accessToken: string): Promise<GithubLoginUserProfile> {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!userResponse.ok) {
      throw badRequest("GitHub login profile lookup failed");
    }

    const userPayload = (await userResponse.json()) as unknown;
    if (!this.isUserPayload(userPayload)) {
      throw badRequest("GitHub login profile lookup failed");
    }

    return {
      id: userPayload.id,
      login: userPayload.login,
      name: typeof userPayload.name === "string" ? userPayload.name : null,
      email:
        typeof userPayload.email === "string"
          ? userPayload.email
          : await this.getPrimaryEmail(accessToken),
      avatarUrl:
        typeof userPayload.avatar_url === "string" ? userPayload.avatar_url : null
    };
  }

  private async getPrimaryEmail(accessToken: string): Promise<string | null> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return null;
    }

    const emails = payload.filter(this.isEmailPayload);
    const selectedEmail =
      emails.find((email) => email.primary === true && email.verified === true) ??
      emails.find((email) => email.verified === true) ??
      emails[0];

    return typeof selectedEmail?.email === "string" ? selectedEmail.email : null;
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

  private isUserPayload(value: unknown): value is {
    id: number;
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } {
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

  private isEmailPayload(value: unknown): value is {
    email: string;
    primary: boolean;
    verified: boolean;
  } {
    const payload = value as GithubEmailPayload;
    return (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.email === "string" &&
      typeof payload.primary === "boolean" &&
      typeof payload.verified === "boolean"
    );
  }
}
