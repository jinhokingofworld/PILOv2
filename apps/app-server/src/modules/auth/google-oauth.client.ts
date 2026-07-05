import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GoogleOAuthTokenRequest {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleUserProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

@Injectable()
export class GoogleOAuthClient {
  async exchangeCodeForAccessToken(input: GoogleOAuthTokenRequest): Promise<string> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      throw badRequest("Google OAuth token exchange failed");
    }

    const payload = (await response.json()) as unknown;
    if (!this.isTokenPayload(payload)) {
      throw badRequest("Google OAuth token exchange failed");
    }

    return payload.access_token;
  }

  async getUserProfile(accessToken: string): Promise<GoogleUserProfile> {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw badRequest("Google OAuth profile lookup failed");
    }

    const payload = (await response.json()) as unknown;
    if (!this.isUserProfilePayload(payload)) {
      throw badRequest("Google OAuth profile lookup failed");
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : null,
      picture: typeof payload.picture === "string" ? payload.picture : null
    };
  }

  private isTokenPayload(value: unknown): value is {
    access_token: string;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      "access_token" in value &&
      typeof value.access_token === "string" &&
      value.access_token.length > 0
    );
  }

  private isUserProfilePayload(value: unknown): value is {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      "sub" in value &&
      typeof value.sub === "string" &&
      value.sub.length > 0 &&
      "email" in value &&
      typeof value.email === "string" &&
      value.email.length > 0
    );
  }
}
