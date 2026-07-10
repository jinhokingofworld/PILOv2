import { Injectable } from "@nestjs/common";
import {
  badRequest,
  conflict as conflictError,
  forbidden,
  notFound
} from "../../common/api-error";
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

export type GithubPullRequestMergeMethod = "merge";

export interface GithubPullRequestMergeRequest {
  accessToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
  expectedHeadSha: string;
  mergeMethod: GithubPullRequestMergeMethod;
}

export interface GithubPullRequestMergeResponse {
  mergeCommitSha: string;
}

export interface GithubRepositoryCollaboratorPermissionRequest {
  accessToken: string;
  owner: string;
  repo: string;
  username: string;
}

export interface GithubRepositoryCollaboratorPermissionResponse {
  permission: string | null;
}

export interface GithubRepositoryFileContentUpdateRequest {
  accessToken: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  content: string;
  sha: string;
}

export interface GithubRepositoryFileContentUpdateResponse {
  commitSha: string;
  commitUrl: string | null;
  contentPath: string;
  contentSha: string;
}

interface GithubUserInstallationsApiPayload {
  total_count?: number;
  installations?: Array<{
    id?: number;
  }>;
}

interface GithubRepositoryCollaboratorPermissionApiPayload {
  permission?: unknown;
}

interface GithubPullRequestReviewApiPayload {
  id?: unknown;
  html_url?: unknown;
}

interface GithubPullRequestMergeApiPayload {
  sha?: unknown;
  merged?: unknown;
  message?: unknown;
}

interface GithubRepositoryFileContentUpdateApiPayload {
  content?: {
    path?: unknown;
    sha?: unknown;
  } | null;
  commit?: {
    sha?: unknown;
    html_url?: unknown;
  } | null;
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

    if (response.status === 403) {
      throw forbidden("GitHub App Pull requests write permission is required");
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

  async mergePullRequest(
    input: GithubPullRequestMergeRequest
  ): Promise<GithubPullRequestMergeResponse> {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}/merge`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        },
        body: JSON.stringify({
          sha: input.expectedHeadSha,
          merge_method: input.mergeMethod
        })
      });
    } catch {
      throw badRequest("GitHub pull request merge failed");
    }

    if (response.status === 401) {
      throw badRequest("GitHub OAuth connection is invalid");
    }

    if (response.status === 403) {
      throw forbidden(
        "GitHub pull request merge is blocked by permission or branch protection"
      );
    }

    if (response.status === 404) {
      throw notFound("GitHub pull request not found");
    }

    if (response.status === 405) {
      throw badRequest(
        "GitHub pull request merge is blocked by repository merge rules"
      );
    }

    if (response.status === 409) {
      throw conflictError("GitHub pull request head SHA is stale");
    }

    if (!response.ok) {
      throw badRequest("GitHub pull request merge failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub pull request merge failed"
    );
    if (!this.isPullRequestMergePayload(payload)) {
      throw badRequest("GitHub pull request merge failed");
    }

    return {
      mergeCommitSha: payload.sha
    };
  }

  async getRepositoryCollaboratorPermission(
    input: GithubRepositoryCollaboratorPermissionRequest
  ): Promise<GithubRepositoryCollaboratorPermissionResponse> {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/collaborators/${encodeURIComponent(input.username)}/permission`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.accessToken}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      });
    } catch {
      throw badRequest("GitHub repository collaborator permission lookup failed");
    }

    if (response.status === 404) {
      return {
        permission: null
      };
    }

    if (response.status === 401) {
      throw badRequest("GitHub OAuth connection is invalid");
    }

    if (response.status === 403) {
      throw forbidden("GitHub repository permission lookup is forbidden");
    }

    if (!response.ok) {
      throw badRequest("GitHub repository collaborator permission lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub repository collaborator permission lookup failed"
    );
    if (!this.isRepositoryCollaboratorPermissionPayload(payload)) {
      throw badRequest("GitHub repository collaborator permission lookup failed");
    }

    return {
      permission: payload.permission
    };
  }

  async updateRepositoryFileContent(
    input: GithubRepositoryFileContentUpdateRequest
  ): Promise<GithubRepositoryFileContentUpdateResponse> {
    const encodedPath = input.path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        },
        body: JSON.stringify({
          branch: input.branch,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          message: input.message,
          sha: input.sha
        })
      });
    } catch {
      throw badRequest("GitHub file content update failed");
    }

    if (response.status === 401) {
      throw badRequest("GitHub OAuth connection is invalid");
    }

    if (response.status === 403) {
      throw forbidden("GitHub App Contents write permission is required");
    }

    if (response.status === 409) {
      throw conflictError("GitHub file content is stale");
    }

    if (!response.ok) {
      throw badRequest("GitHub file content update failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub file content update failed"
    );
    if (!this.isRepositoryFileContentUpdatePayload(payload)) {
      throw badRequest("GitHub file content update failed");
    }

    return {
      commitSha: payload.commit.sha,
      commitUrl:
        typeof payload.commit.html_url === "string" &&
        payload.commit.html_url.length > 0
          ? payload.commit.html_url
          : null,
      contentPath: payload.content.path,
      contentSha: payload.content.sha
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

  private isPullRequestMergePayload(
    value: unknown
  ): value is { sha: string; merged: true; message?: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubPullRequestMergeApiPayload;
    return (
      payload.merged === true &&
      typeof payload.sha === "string" &&
      payload.sha.length > 0
    );
  }

  private isRepositoryFileContentUpdatePayload(
    value: unknown
  ): value is {
    content: { path: string; sha: string };
    commit: { sha: string; html_url?: string | null };
  } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubRepositoryFileContentUpdateApiPayload;
    return (
      typeof payload.content === "object" &&
      payload.content !== null &&
      typeof payload.content.path === "string" &&
      payload.content.path.length > 0 &&
      typeof payload.content.sha === "string" &&
      payload.content.sha.length > 0 &&
      typeof payload.commit === "object" &&
      payload.commit !== null &&
      typeof payload.commit.sha === "string" &&
      payload.commit.sha.length > 0
    );
  }

  private isRepositoryCollaboratorPermissionPayload(
    value: unknown
  ): value is { permission: string } {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "permission" in value &&
      typeof (value as GithubRepositoryCollaboratorPermissionApiPayload)
        .permission === "string"
    );
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
