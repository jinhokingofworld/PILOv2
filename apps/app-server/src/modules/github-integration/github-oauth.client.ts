import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { GITHUB_API_VERSION } from "./github-api.constants";

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

export interface GithubUserInstallationAccessRequest {
  accessToken: string;
  installationId: number;
}

export interface GithubUserInstallationLookupRequest {
  accessToken: string;
}

export type GithubPullRequestReviewEvent =
  | "COMMENT"
  | "APPROVE"
  | "REQUEST_CHANGES";

export interface GithubPullRequestReviewSubmissionRequest {
  accessToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
  event: GithubPullRequestReviewEvent;
  body: string;
}

export interface GithubPullRequestReviewSubmissionResponse {
  githubReviewId: string | null;
  githubReviewUrl: string | null;
}

interface GithubUserInstallationsApiPayload {
  total_count?: number;
  installations?: Array<{
    id?: number;
  }>;
}

interface GithubPullRequestReviewApiPayload {
  id?: unknown;
  html_url?: unknown;
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
        "X-GitHub-Api-Version": GITHUB_API_VERSION
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

  async hasUserInstallationAccess(
    input: GithubUserInstallationAccessRequest
  ): Promise<boolean> {
    const perPage = 100;
    let page = 1;

    while (true) {
      const payload = await this.fetchUserInstallationsPage(
        input.accessToken,
        page,
        perPage
      );

      if (
        payload.installations.some(
          (installation) => installation.id === input.installationId
        )
      ) {
        return true;
      }

      const totalCount = payload.total_count ?? 0;
      if (page * perPage >= totalCount || payload.installations.length < perPage) {
        return false;
      }

      page += 1;
    }
  }

  async assertUserInstallationLookupSupported(
    input: GithubUserInstallationLookupRequest
  ): Promise<void> {
    await this.fetchUserInstallationsPage(input.accessToken, 1, 1);
  }

  async submitPullRequestReview(
    input: GithubPullRequestReviewSubmissionRequest
  ): Promise<GithubPullRequestReviewSubmissionResponse> {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}/reviews`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        },
        body: JSON.stringify({
          event: input.event,
          body: input.body
        })
      });
    } catch {
      throw badRequest("GitHub Review submission failed");
    }

    if (response.status === 401) {
      throw badRequest("GitHub OAuth connection is invalid");
    }

    if (!response.ok) {
      throw badRequest("GitHub Review submission failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub Review submission failed"
    );
    if (!this.isPullRequestReviewPayload(payload)) {
      throw badRequest("GitHub Review submission failed");
    }

    return {
      githubReviewId:
        typeof payload.id === "number" || typeof payload.id === "string"
          ? String(payload.id)
          : null,
      githubReviewUrl:
        typeof payload.html_url === "string" && payload.html_url.length > 0
          ? payload.html_url
          : null
    };
  }

  private async fetchUserInstallationsPage(
    accessToken: string,
    page: number,
    perPage: number
  ): Promise<Required<GithubUserInstallationsApiPayload>> {
    const url = new URL("https://api.github.com/user/installations");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      });
    } catch {
      throw badRequest("GitHub OAuth installation lookup failed");
    }

    if (response.status === 401 || response.status === 403) {
      throw badRequest(
        "GitHub App user access token is required for installation lookup"
      );
    }

    if (!response.ok) {
      throw badRequest("GitHub OAuth installation lookup failed");
    }

    const payload = await this.readInstallationJson(response);
    if (!this.isUserInstallationsPayload(payload)) {
      throw badRequest("GitHub OAuth installation lookup failed");
    }

    return payload;
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

  private async readInstallationJson(response: Response): Promise<unknown> {
    return this.readJson(response, "GitHub OAuth installation lookup failed");
  }

  private async readJson(response: Response, message: string): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw badRequest(message);
    }
  }

  private isPullRequestReviewPayload(
    value: unknown
  ): value is GithubPullRequestReviewApiPayload {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isUserInstallationsPayload(
    value: unknown
  ): value is Required<GithubUserInstallationsApiPayload> {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const payload = value as GithubUserInstallationsApiPayload;
    return (
      typeof payload.total_count === "number" &&
      Array.isArray(payload.installations) &&
      payload.installations.every(
        (installation) =>
          typeof installation === "object" &&
          installation !== null &&
          typeof installation.id === "number"
      )
    );
  }
}
