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

export interface GithubInstallationRepositoriesRequest
  extends GithubAppInstallationTokenRequest {}

export interface GithubRepositoryIssuesRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
}

export interface GithubRepositoryPullRequestsRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
}

export interface GithubInstallationRepositoryApiItem {
  id: number;
  node_id: string;
  owner: {
    login: string;
  };
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch?: string | null;
  html_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
}

export interface GithubIssueApiItem {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
  } | null;
  html_url: string;
  labels?: unknown[];
  assignees?: unknown[];
  milestone?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
}

export interface GithubPullRequestApiItem {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
  } | null;
  head?: {
    ref?: string | null;
    sha?: string | null;
  } | null;
  base?: {
    ref?: string | null;
    sha?: string | null;
  } | null;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  comments?: number;
  review_comments?: number;
  html_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean;
  mergeable?: boolean | null;
  state?: string;
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

interface GithubInstallationRepositoriesApiPayload {
  repositories?: unknown;
}

const GITHUB_SYNC_PER_PAGE = 100;
const GITHUB_SYNC_MAX_PAGES = 100;

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

  async listInstallationRepositories(
    input: GithubInstallationRepositoriesRequest
  ): Promise<GithubInstallationRepositoryApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const repositories: GithubInstallationRepositoryApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL("https://api.github.com/installation/repositories");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub repositories sync failed"
      );
      if (!this.isInstallationRepositoriesPayload(payload)) {
        throw badRequest("GitHub repositories sync failed");
      }

      repositories.push(...payload.repositories);
      if (payload.repositories.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return repositories;
  }

  async listRepositoryIssues(
    input: GithubRepositoryIssuesRequest
  ): Promise<GithubIssueApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const issues: GithubIssueApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`
      );
      url.searchParams.set("state", "all");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub issues sync failed"
      );
      if (!Array.isArray(payload)) {
        throw badRequest("GitHub issues sync failed");
      }

      const issuePayloads = payload.filter((item) => !this.isPullRequestIssue(item));
      if (!issuePayloads.every((item) => this.isIssuePayload(item))) {
        throw badRequest("GitHub issues sync failed");
      }

      issues.push(...issuePayloads);
      if (payload.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return issues;
  }

  async listRepositoryPullRequests(
    input: GithubRepositoryPullRequestsRequest
  ): Promise<GithubPullRequestApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const pullRequests: GithubPullRequestApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`
      );
      url.searchParams.set("state", "all");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub pull requests sync failed"
      );
      if (!Array.isArray(payload) || !payload.every((item) => this.isPullRequestPayload(item))) {
        throw badRequest("GitHub pull requests sync failed");
      }

      pullRequests.push(...payload);
      if (payload.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return pullRequests;
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

  private async fetchJsonWithToken(
    url: URL,
    token: string,
    errorMessage: string
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      });
    } catch {
      throw badRequest(errorMessage);
    }

    if (!response.ok) {
      throw badRequest(errorMessage);
    }

    return this.readJson(response, errorMessage);
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

  private isInstallationRepositoriesPayload(
    value: unknown
  ): value is { repositories: GithubInstallationRepositoryApiItem[] } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationRepositoriesApiPayload;
    return (
      Array.isArray(payload.repositories) &&
      payload.repositories.every((item) => this.isRepositoryPayload(item))
    );
  }

  private isRepositoryPayload(
    value: unknown
  ): value is GithubInstallationRepositoryApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationRepositoryApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.owner?.login === "string" &&
      payload.owner.login.length > 0 &&
      typeof payload.name === "string" &&
      payload.name.length > 0 &&
      typeof payload.full_name === "string" &&
      payload.full_name.length > 0 &&
      typeof payload.private === "boolean" &&
      typeof payload.archived === "boolean" &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.default_branch) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.pushed_at)
    );
  }

  private isIssuePayload(value: unknown): value is GithubIssueApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubIssueApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.number === "number" &&
      typeof payload.title === "string" &&
      payload.title.length > 0 &&
      (payload.state === "open" || payload.state === "closed") &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.body) &&
      this.isOptionalString(payload.state_reason) &&
      this.isOptionalUserPayload(payload.user) &&
      (payload.labels === undefined || Array.isArray(payload.labels)) &&
      (payload.assignees === undefined || Array.isArray(payload.assignees)) &&
      this.isOptionalObject(payload.milestone) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.closed_at)
    );
  }

  private isPullRequestPayload(value: unknown): value is GithubPullRequestApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubPullRequestApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.number === "number" &&
      typeof payload.title === "string" &&
      payload.title.length > 0 &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.body) &&
      this.isOptionalUserPayload(payload.user) &&
      this.isOptionalRefPayload(payload.head) &&
      this.isOptionalRefPayload(payload.base) &&
      this.isOptionalNumber(payload.changed_files) &&
      this.isOptionalNumber(payload.additions) &&
      this.isOptionalNumber(payload.deletions) &&
      this.isOptionalNumber(payload.commits) &&
      this.isOptionalNumber(payload.comments) &&
      this.isOptionalNumber(payload.review_comments) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.closed_at) &&
      this.isOptionalString(payload.merged_at) &&
      this.isOptionalBoolean(payload.draft) &&
      this.isOptionalBoolean(payload.mergeable, true) &&
      this.isOptionalString(payload.state)
    );
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

  private isOptionalNumber(value: unknown): boolean {
    return value === undefined || typeof value === "number";
  }

  private isOptionalBoolean(value: unknown, allowNull = false): boolean {
    return (
      value === undefined ||
      typeof value === "boolean" ||
      (allowNull && value === null)
    );
  }

  private isOptionalObject(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === "object" && !Array.isArray(value))
    );
  }

  private isOptionalUserPayload(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const payload = value as { login?: unknown; avatar_url?: unknown };
    return (
      this.isOptionalString(payload.login) &&
      this.isOptionalString(payload.avatar_url)
    );
  }

  private isOptionalRefPayload(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const payload = value as { ref?: unknown; sha?: unknown };
    return this.isOptionalString(payload.ref) && this.isOptionalString(payload.sha);
  }

  private isPullRequestIssue(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { pull_request?: unknown }).pull_request === "object" &&
      (value as { pull_request?: unknown }).pull_request !== null
    );
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
