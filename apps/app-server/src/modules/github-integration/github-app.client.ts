import { createSign } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { GITHUB_API_VERSION } from "./github-api.constants";

export interface GithubAppInstallationLookupRequest {
  installationId: number;
  appId: string;
  privateKey: string;
  now?: () => Date;
}

export interface GithubAppInstallationTokenRequest
  extends GithubAppInstallationLookupRequest {}

export interface GithubAppInstallationDetails {
  githubInstallationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string | null;
  permissions: Record<string, unknown>;
  installedAt: string | null;
  suspendedAt: string | null;
}

export interface GithubPullRequestFileLookupRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  pullNumber: number;
  page: number;
  perPage: number;
}

export interface GithubPullRequestLookupRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface GithubPullRequestFileApiItem {
  filename: string;
  previous_filename?: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url?: string | null;
  raw_url?: string | null;
  contents_url?: string | null;
  sha?: string | null;
  patch?: string | null;
}

export interface GithubPullRequestApiDetails {
  mergeable: boolean | null;
}

interface GithubInstallationApiPayload {
  id: number;
  account?: {
    login?: string;
    type?: string;
  } | null;
  repository_selection?: string | null;
  permissions?: unknown;
  created_at?: string | null;
  suspended_at?: string | null;
}

interface GithubInstallationTokenApiPayload {
  token?: unknown;
  expires_at?: unknown;
}

@Injectable()
export class GithubAppClient {
  async getInstallation(
    input: GithubAppInstallationLookupRequest
  ): Promise<GithubAppInstallationDetails> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub App installation lookup failed"
    );
    if (!this.isInstallationPayload(payload)) {
      throw badRequest("GitHub App installation lookup failed");
    }

    return {
      githubInstallationId: payload.id,
      accountLogin: payload.account.login,
      accountType: payload.account.type,
      repositorySelection: payload.repository_selection ?? null,
      permissions: this.toObject(payload.permissions),
      installedAt: payload.created_at ?? null,
      suspendedAt: payload.suspended_at ?? null
    };
  }

  async createInstallationAccessToken(
    input: GithubAppInstallationTokenRequest
  ): Promise<{ token: string; expiresAt: string | null }> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation token lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation token lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub App installation token lookup failed"
    );
    if (!this.isInstallationTokenPayload(payload)) {
      throw badRequest("GitHub App installation token lookup failed");
    }

    return {
      token: payload.token,
      expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : null
    };
  }

  async listPullRequestFiles(
    input: GithubPullRequestFileLookupRequest
  ): Promise<GithubPullRequestFileApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}/files`
    );
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", String(input.perPage));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${installationToken.token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      });
    } catch {
      throw badRequest("GitHub pull request files lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub pull request files lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub pull request files lookup failed"
    );
    if (!Array.isArray(payload) || !payload.every((item) => this.isFilePayload(item))) {
      throw badRequest("GitHub pull request files lookup failed");
    }

    return payload;
  }

  async getPullRequest(
    input: GithubPullRequestLookupRequest
  ): Promise<GithubPullRequestApiDetails> {
    const installationToken = await this.createInstallationAccessToken(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${installationToken.token}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub pull request lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const payload = await this.readJson(response, "GitHub pull request lookup failed");
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const mergeable = (payload as { mergeable?: unknown }).mergeable;
    if (mergeable !== true && mergeable !== false && mergeable !== null) {
      throw badRequest("GitHub pull request lookup failed");
    }

    return {
      mergeable
    };
  }

  private async readJson(response: Response, errorMessage: string): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw badRequest(errorMessage);
    }
  }

  private createAppJwt(input: GithubAppInstallationLookupRequest): string {
    try {
      const nowSeconds = Math.floor(
        (input.now ? input.now() : new Date()).getTime() / 1000
      );
      const header = this.encodeJson({
        alg: "RS256",
        typ: "JWT"
      });
      const payload = this.encodeJson({
        iat: nowSeconds - 60,
        exp: nowSeconds + 540,
        iss: input.appId
      });
      const body = `${header}.${payload}`;
      const signature = createSign("RSA-SHA256")
        .update(body)
        .end()
        .sign(input.privateKey, "base64url");

      return `${body}.${signature}`;
    } catch {
      throw badRequest("GitHub App is not configured");
    }
  }

  private encodeJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  private isInstallationPayload(value: unknown): value is GithubInstallationApiPayload & {
    account: { login: string; type: "User" | "Organization" };
  } {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const payload = value as GithubInstallationApiPayload;
    return (
      typeof payload.id === "number" &&
      typeof payload.account?.login === "string" &&
      payload.account.login.length > 0 &&
      (payload.account.type === "User" || payload.account.type === "Organization")
    );
  }

  private isInstallationTokenPayload(
    value: unknown
  ): value is GithubInstallationTokenApiPayload & { token: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationTokenApiPayload;
    return typeof payload.token === "string" && payload.token.length > 0;
  }

  private isFilePayload(value: unknown): value is GithubPullRequestFileApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubPullRequestFileApiItem;
    return (
      typeof payload.filename === "string" &&
      payload.filename.length > 0 &&
      typeof payload.status === "string" &&
      typeof payload.additions === "number" &&
      typeof payload.deletions === "number" &&
      typeof payload.changes === "number" &&
      this.isOptionalString(payload.previous_filename) &&
      this.isOptionalString(payload.blob_url) &&
      this.isOptionalString(payload.raw_url) &&
      this.isOptionalString(payload.contents_url) &&
      this.isOptionalString(payload.sha) &&
      this.isOptionalString(payload.patch)
    );
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || value === null || typeof value === "string";
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
