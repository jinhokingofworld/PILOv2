import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  ListGithubPullRequestsQuery,
  ListGithubRepositoriesQuery
} from "./dto";
import type {
  GithubIssuePayload,
  GithubPaginatedPayload,
  GithubPullRequestDetailPayload,
  GithubPullRequestListItemPayload,
  GithubRepositoryDetailPayload,
  GithubRepositoryListItemPayload
} from "./types";

interface GithubRepositoryRow extends QueryResultRow {
  id: string;
  installation_id: string;
  github_repository_id: string | number | null;
  github_node_id: string | null;
  owner_login: string;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string | null;
  html_url: string;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  pushed_at: Date | string | null;
  last_synced_at: Date | string | null;
}

interface GithubIssueRow extends QueryResultRow {
  id: string;
  repository_id: string;
  github_issue_id: string | number | null;
  github_node_id: string | null;
  issue_number: string | number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  html_url: string;
  labels: unknown;
  assignees: unknown;
  milestone: unknown;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  github_closed_at: Date | string | null;
  last_synced_at: Date | string | null;
}

interface GithubPullRequestRow extends QueryResultRow {
  id: string;
  repository_id: string;
  github_pull_request_id: string | number | null;
  github_node_id: string | null;
  pr_number: string | number;
  title: string;
  body: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  head_branch: string | null;
  base_branch: string | null;
  changed_files_count: string | number;
  additions: string | number;
  deletions: string | number;
  commits_count: string | number;
  comments_count: string | number;
  review_comments_count: string | number;
  html_url: string;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  github_closed_at: Date | string | null;
  merged_at: Date | string | null;
  last_synced_at: Date | string | null;
  raw: unknown;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface PaginationInput {
  page?: unknown;
  limit?: unknown;
}

interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

type PullRequestState = "open" | "closed";

const MAX_PAGE_LIMIT = 100;

@Injectable()
export class GithubSourceReadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listGithubRepositories(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubRepositoriesQuery
  ): Promise<GithubPaginatedPayload<GithubRepositoryListItemPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pagination = this.normalizePagination(query, 20);
    const search = this.readOptionalSearch(query.q, "q");
    const includeArchived =
      this.readOptionalBoolean(query.includeArchived, "includeArchived") ?? false;
    const { whereSql, values } = this.buildGithubRepositoryFilters(
      workspaceId,
      search,
      includeArchived
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_repositories WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubRepositoryRow>(
      `
        SELECT
          id,
          installation_id,
          github_repository_id,
          github_node_id,
          owner_login,
          name,
          full_name,
          private,
          archived,
          default_branch,
          html_url,
          github_created_at,
          github_updated_at,
          pushed_at,
          last_synced_at
        FROM github_repositories
        WHERE ${whereSql}
        ORDER BY full_name ASC, id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pagination.limit, pagination.offset]
    );

    return {
      data: rows.map((row) => this.mapGithubRepositoryListItem(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getGithubRepository(
    currentUserId: string,
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubRepositoryDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.findGithubRepository(workspaceId, repositoryId);
    if (!row) {
      throw notFound("GitHub repository not found");
    }

    return this.mapGithubRepositoryDetail(row);
  }

  async getGithubIssue(
    currentUserId: string,
    workspaceId: string,
    issueId: string
  ): Promise<GithubIssuePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.database.queryOne<GithubIssueRow>(
      `
        SELECT
          id,
          repository_id,
          github_issue_id,
          github_node_id,
          issue_number,
          title,
          body,
          state,
          state_reason,
          author_login,
          author_avatar_url,
          html_url,
          labels,
          assignees,
          milestone,
          github_created_at,
          github_updated_at,
          github_closed_at,
          last_synced_at
        FROM github_issues
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, issueId]
    );

    if (!row) {
      throw notFound("GitHub issue not found");
    }

    return this.mapGithubIssue(row);
  }

  async listGithubPullRequests(
    currentUserId: string,
    workspaceId: string,
    repositoryId: string,
    query: ListGithubPullRequestsQuery
  ): Promise<GithubPaginatedPayload<GithubPullRequestListItemPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubRepositoryExists(workspaceId, repositoryId);

    const pagination = this.normalizePagination(query, 10);
    const state = this.readOptionalPullRequestState(query.state);
    const search = this.readOptionalSearch(query.query, "query");
    const { whereSql, values } = this.buildGithubPullRequestFilters(
      workspaceId,
      repositoryId,
      state,
      search
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_pull_requests WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubPullRequestRow>(
      `
        ${this.githubPullRequestSelectSql()}
        WHERE ${whereSql}
        ORDER BY github_updated_at DESC NULLS LAST, pr_number DESC, id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pagination.limit, pagination.offset]
    );

    return {
      data: rows.map((row) => this.mapGithubPullRequestListItem(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getGithubPullRequest(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.database.queryOne<GithubPullRequestRow>(
      `
        ${this.githubPullRequestSelectSql()}
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, pullRequestId]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }

    return this.mapGithubPullRequestDetail(row);
  }

  private async findGithubRepository(
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubRepositoryRow | null> {
    return this.database.queryOne<GithubRepositoryRow>(
      `
        SELECT
          id,
          installation_id,
          github_repository_id,
          github_node_id,
          owner_login,
          name,
          full_name,
          private,
          archived,
          default_branch,
          html_url,
          github_created_at,
          github_updated_at,
          pushed_at,
          last_synced_at
        FROM github_repositories
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, repositoryId]
    );
  }

  private async assertGithubRepositoryExists(
    workspaceId: string,
    repositoryId: string
  ): Promise<void> {
    const row = await this.database.queryOne<QueryResultRow>(
      `
        SELECT id
        FROM github_repositories
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, repositoryId]
    );

    if (!row) {
      throw notFound("GitHub repository not found");
    }
  }

  private async countRows(
    text: string,
    values: readonly unknown[]
  ): Promise<number> {
    const row = await this.database.queryOne<CountRow>(text, values);
    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  private buildGithubRepositoryFilters(
    workspaceId: string,
    search: string | null,
    includeArchived: boolean
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId];
    const filters = ["workspace_id = $1", "installation_id IS NOT NULL"];

    if (!includeArchived) {
      filters.push("archived = false");
    }

    if (search) {
      values.push(`%${search}%`);
      filters.push(
        `(owner_login ILIKE $${values.length} OR name ILIKE $${values.length} OR full_name ILIKE $${values.length})`
      );
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private buildGithubPullRequestFilters(
    workspaceId: string,
    repositoryId: string,
    state: PullRequestState | null,
    search: string | null
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId, repositoryId];
    const filters = ["workspace_id = $1", "repository_id = $2"];

    if (state) {
      values.push(state);
      filters.push(`${this.pullRequestStateSql()} = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      filters.push(
        `(title ILIKE $${values.length} OR pr_number::text ILIKE $${values.length})`
      );
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private githubPullRequestSelectSql(): string {
    return `
      SELECT
        id,
        repository_id,
        github_pull_request_id,
        github_node_id,
        pr_number,
        title,
        body,
        author_login,
        author_avatar_url,
        head_branch,
        base_branch,
        changed_files_count,
        additions,
        deletions,
        commits_count,
        comments_count,
        review_comments_count,
        html_url,
        github_created_at,
        github_updated_at,
        github_closed_at,
        merged_at,
        last_synced_at,
        raw
      FROM github_pull_requests
    `;
  }

  private pullRequestStateSql(tableAlias = ""): string {
    const prefix = tableAlias ? `${tableAlias}.` : "";
    return `
      COALESCE(
        ${prefix}raw->>'state',
        CASE
          WHEN ${prefix}merged_at IS NOT NULL OR ${prefix}github_closed_at IS NOT NULL THEN 'closed'
          ELSE 'open'
        END
      )
    `;
  }

  private normalizePagination(
    input: PaginationInput,
    defaultLimit: number
  ): NormalizedPagination {
    const page = this.readPositiveInteger(input.page, "page", 1);
    const limit = this.readPositiveInteger(input.limit, "limit", defaultLimit);

    if (limit > MAX_PAGE_LIMIT) {
      throw badRequest(`limit must be ${MAX_PAGE_LIMIT} or less`);
    }

    return {
      page,
      limit,
      offset: (page - 1) * limit
    };
  }

  private readPositiveInteger(
    value: unknown,
    field: string,
    defaultValue: number
  ): number {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (Array.isArray(value)) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const raw = typeof value === "number" ? String(value) : value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(`${field} must be a positive integer`);
    }

    return parsed;
  }

  private readOptionalSearch(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const search = value.trim();
    return search ? search : null;
  }

  private readOptionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a boolean`);
    }

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    throw badRequest(`${field} must be a boolean`);
  }

  private readOptionalPullRequestState(value: unknown): PullRequestState | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest("state must be open or closed");
    }

    const state = value.trim();
    if (state === "open" || state === "closed") {
      return state;
    }

    throw badRequest("state must be open or closed");
  }

  private mapGithubRepositoryListItem(
    row: GithubRepositoryRow
  ): GithubRepositoryListItemPayload {
    return {
      id: row.id,
      installationId: row.installation_id,
      githubRepositoryId: this.toNullableNumber(row.github_repository_id),
      githubNodeId: row.github_node_id,
      ownerLogin: row.owner_login,
      name: row.name,
      fullName: row.full_name,
      private: row.private,
      archived: row.archived,
      defaultBranch: row.default_branch,
      htmlUrl: row.html_url,
      pushedAt: this.toNullableIsoString(row.pushed_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubRepositoryDetail(
    row: GithubRepositoryRow
  ): GithubRepositoryDetailPayload {
    return {
      ...this.mapGithubRepositoryListItem(row),
      githubCreatedAt: this.toNullableIsoString(row.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at)
    };
  }

  private mapGithubIssue(row: GithubIssueRow): GithubIssuePayload {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      githubIssueId: this.toNullableNumber(row.github_issue_id),
      githubNodeId: row.github_node_id,
      issueNumber: this.toInteger(row.issue_number, "Invalid GitHub issue number"),
      title: row.title,
      body: row.body,
      state: row.state,
      stateReason: row.state_reason,
      authorLogin: row.author_login,
      authorAvatarUrl: row.author_avatar_url,
      htmlUrl: row.html_url,
      labels: this.toArray(row.labels),
      assignees: this.toArray(row.assignees),
      milestone: this.toNullableRecord(row.milestone),
      githubCreatedAt: this.toNullableIsoString(row.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at),
      githubClosedAt: this.toNullableIsoString(row.github_closed_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubPullRequestListItem(
    row: GithubPullRequestRow
  ): GithubPullRequestListItemPayload {
    const raw = this.toRecord(row.raw);

    return {
      id: row.id,
      repositoryId: row.repository_id,
      githubPullRequestId: this.toNullableNumber(row.github_pull_request_id),
      githubNodeId: row.github_node_id,
      githubNumber: this.toInteger(
        row.pr_number,
        "Invalid GitHub pull request number"
      ),
      title: row.title,
      authorName: row.author_login,
      authorAvatarUrl: row.author_avatar_url,
      state: this.getPullRequestState(row, raw),
      draft: this.getRawBoolean(raw, "draft") ?? false,
      mergeable: this.getRawBoolean(raw, "mergeable"),
      createdAtGithub: this.toNullableIsoString(row.github_created_at),
      updatedAtGithub: this.toNullableIsoString(row.github_updated_at),
      headBranch: row.head_branch,
      baseBranch: row.base_branch,
      headSha: this.getPullRequestSha(raw, "head"),
      baseSha: this.getPullRequestSha(raw, "base"),
      changedFilesCount: this.toInteger(
        row.changed_files_count,
        "Invalid GitHub pull request file count"
      ),
      additions: this.toInteger(
        row.additions,
        "Invalid GitHub pull request additions"
      ),
      deletions: this.toInteger(
        row.deletions,
        "Invalid GitHub pull request deletions"
      ),
      commitsCount: this.toInteger(
        row.commits_count,
        "Invalid GitHub pull request commit count"
      ),
      commentsCount: this.toInteger(
        row.comments_count,
        "Invalid GitHub pull request comment count"
      ),
      reviewCommentsCount: this.toInteger(
        row.review_comments_count,
        "Invalid GitHub pull request review comment count"
      ),
      githubUrl: row.html_url,
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubPullRequestDetail(
    row: GithubPullRequestRow
  ): GithubPullRequestDetailPayload {
    return {
      ...this.mapGithubPullRequestListItem(row),
      description: row.body,
      closedAtGithub: this.toNullableIsoString(row.github_closed_at),
      mergedAt: this.toNullableIsoString(row.merged_at)
    };
  }

  private getPullRequestState(
    row: GithubPullRequestRow,
    raw: Record<string, unknown>
  ): PullRequestState {
    const rawState = this.getRawString(raw, "state");
    if (rawState === "open" || rawState === "closed") {
      return rawState;
    }

    return row.merged_at || row.github_closed_at ? "closed" : "open";
  }

  private getPullRequestSha(
    raw: Record<string, unknown>,
    side: "head" | "base"
  ): string | null {
    const nested = this.getNestedRawString(raw, side, "sha");
    if (nested) {
      return nested;
    }

    return (
      this.getRawString(raw, `${side}_sha`) ??
      this.getRawString(raw, `${side}Sha`)
    );
  }

  private getNestedRawString(
    raw: Record<string, unknown>,
    parent: string,
    child: string
  ): string | null {
    const parentValue = raw[parent];
    if (
      typeof parentValue !== "object" ||
      parentValue === null ||
      Array.isArray(parentValue)
    ) {
      return null;
    }

    return this.getRawString(parentValue as Record<string, unknown>, child);
  }

  private getRawString(
    raw: Record<string, unknown>,
    field: string
  ): string | null {
    const value = raw[field];
    return typeof value === "string" && value ? value : null;
  }

  private getRawBoolean(
    raw: Record<string, unknown>,
    field: string
  ): boolean | null {
    const value = raw[field];
    return typeof value === "boolean" ? value : null;
  }

  private toNullableNumber(value: string | number | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toRecord(parsed);
      } catch {
        return {};
      }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private toNullableRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || value === undefined) {
      return null;
    }

    const record = this.toRecord(value);
    return Object.keys(record).length > 0 ? record : null;
  }

  private toArray(value: unknown): unknown[] {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toArray(parsed);
      } catch {
        return [];
      }
    }

    return Array.isArray(value) ? value : [];
  }
}
