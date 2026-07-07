import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ListGithubProjectsV2Query } from "./dto";
import type {
  GithubPaginatedPayload,
  GithubProjectV2DetailPayload,
  GithubProjectV2FieldPayload,
  GithubProjectV2ItemContentType,
  GithubProjectV2ItemPayload,
  GithubProjectV2KanbanItemPayload,
  GithubProjectV2KanbanPayload,
  GithubProjectV2ListItemPayload,
  GithubProjectV2OwnerType,
  GithubProjectV2StatusOptionPayload
} from "./types";

interface GithubProjectV2Row extends QueryResultRow {
  id: string;
  installation_id: string;
  github_project_node_id: string;
  github_project_full_database_id: string | number | null;
  owner_login: string;
  owner_type: GithubProjectV2OwnerType;
  project_number: string | number;
  title: string;
  short_description: string | null;
  readme: string | null;
  url: string;
  resource_path: string | null;
  public: boolean;
  closed: boolean;
  template: boolean;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  github_closed_at: Date | string | null;
  last_synced_at: Date | string | null;
  repository_ids: unknown;
  raw: unknown;
}

interface GithubProjectV2FieldRow extends QueryResultRow {
  id: string;
  project_v2_id: string;
  github_field_node_id: string;
  field_name: string;
  data_type: string;
  is_status_field: boolean;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  raw: unknown;
}

interface GithubProjectV2FieldOptionRow extends QueryResultRow {
  id: string;
  field_id: string;
  github_option_id: string;
  option_name: string;
  normalized_name: string;
  color: string | null;
  description: string | null;
  position: string | number | null;
}

interface GithubProjectV2ItemRow extends QueryResultRow {
  id: string;
  project_v2_id: string;
  github_project_item_node_id: string;
  github_project_item_full_database_id: string | number | null;
  content_type: GithubProjectV2ItemContentType;
  issue_id: string | null;
  pull_request_id: string | null;
  is_archived: boolean;
  status_field_id: string | null;
  status_option_id: string | null;
  status_option_github_id: string | null;
  status_name: string | null;
  status_normalized_name: string | null;
  position: string | number | null;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  last_synced_at: Date | string | null;
  raw: unknown;
  issue_number: string | number | null;
  issue_title: string | null;
  issue_state: string | null;
  issue_html_url: string | null;
  issue_labels: unknown;
  issue_assignees: unknown;
  pr_number: string | number | null;
  pr_title: string | null;
  pr_state: string | null;
  pr_html_url: string | null;
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

const MAX_PAGE_LIMIT = 100;

@Injectable()
export class GithubProjectV2Service {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listGithubProjectsV2(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubProjectsV2Query
  ): Promise<GithubPaginatedPayload<GithubProjectV2ListItemPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pagination = this.normalizePagination(query, 20);
    const ownerLogin = this.readOptionalSearch(query.ownerLogin, "ownerLogin");
    const search = this.readOptionalSearch(query.q, "q");
    const includeClosed =
      this.readOptionalBoolean(query.closed, "closed") ?? false;
    const { whereSql, values } = this.buildGithubProjectV2Filters(
      workspaceId,
      ownerLogin,
      includeClosed,
      search
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_projects_v2 WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubProjectV2Row>(
      `
        ${this.githubProjectV2SelectSql()}
        WHERE ${whereSql}
        ORDER BY owner_login ASC, project_number ASC, id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pagination.limit, pagination.offset]
    );

    return {
      data: rows.map((row) => this.mapGithubProjectV2ListItem(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getGithubProjectV2(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2DetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.findGithubProjectV2(workspaceId, projectV2Id);
    if (!row) {
      throw notFound("GitHub ProjectV2 not found");
    }

    return this.mapGithubProjectV2Detail(row);
  }

  async listGithubProjectV2Fields(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2FieldPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubProjectV2Exists(workspaceId, projectV2Id);

    const rows = await this.database.query<GithubProjectV2FieldRow>(
      `
        ${this.githubProjectV2FieldSelectSql()}
        WHERE project_v2_id = $1
        ORDER BY is_status_field DESC, field_name ASC, id ASC
      `,
      [projectV2Id]
    );

    return rows.map((row) => this.mapGithubProjectV2Field(row));
  }

  async listGithubProjectV2StatusOptions(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2StatusOptionPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubProjectV2Exists(workspaceId, projectV2Id);

    const rows = await this.database.query<GithubProjectV2FieldOptionRow>(
      `
        ${this.githubProjectV2StatusOptionsSelectSql()}
        WHERE f.project_v2_id = $1
          AND f.is_status_field = true
        ORDER BY o.position ASC NULLS LAST, o.option_name ASC, o.id ASC
      `,
      [projectV2Id]
    );

    return rows.map((row) => this.mapGithubProjectV2StatusOption(row));
  }

  async getGithubProjectV2Kanban(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2KanbanPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const project = await this.findGithubProjectV2(workspaceId, projectV2Id);
    if (!project) {
      throw notFound("GitHub ProjectV2 not found");
    }

    const statusField = await this.findGithubProjectV2StatusField(projectV2Id);
    const options = statusField
      ? await this.listGithubProjectV2StatusOptionRowsForField(statusField.id)
      : [];
    const items = await this.listGithubProjectV2ItemRows(workspaceId, projectV2Id);
    const itemPayloads = items.map((row) => this.mapGithubProjectV2Item(row));
    const itemsByOption = new Map<string, GithubProjectV2KanbanItemPayload[]>();
    const unmappedItems: GithubProjectV2KanbanItemPayload[] = [];

    for (const item of itemPayloads) {
      const kanbanItem = this.mapGithubProjectV2KanbanItem(item);
      if (item.statusOptionId) {
        const existing = itemsByOption.get(item.statusOptionId) ?? [];
        existing.push(kanbanItem);
        itemsByOption.set(item.statusOptionId, existing);
      } else {
        unmappedItems.push(kanbanItem);
      }
    }

    const columns = options.map((option) => ({
      id: option.id,
      fieldId: option.fieldId,
      githubOptionId: option.githubOptionId,
      name: option.optionName,
      key: option.normalizedName,
      color: option.color,
      description: option.description,
      position: option.position,
      items: itemsByOption.get(option.id) ?? []
    }));
    const mappedOptionIds = new Set(options.map((option) => option.id));

    for (const [optionId, optionItems] of itemsByOption.entries()) {
      if (!mappedOptionIds.has(optionId)) {
        unmappedItems.push(...optionItems);
      }
    }

    return {
      project: {
        id: project.id,
        title: project.title
      },
      statusField: statusField
        ? this.mapGithubProjectV2Field(statusField)
        : null,
      columns,
      unmappedItems
    };
  }

  async listGithubProjectV2Items(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2ItemPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubProjectV2Exists(workspaceId, projectV2Id);

    const rows = await this.listGithubProjectV2ItemRows(workspaceId, projectV2Id);
    return rows.map((row) => this.mapGithubProjectV2Item(row));
  }

  private async findGithubProjectV2(
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2Row | null> {
    return this.database.queryOne<GithubProjectV2Row>(
      `
        ${this.githubProjectV2SelectSql()}
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, projectV2Id]
    );
  }

  private async findGithubProjectV2StatusField(
    projectV2Id: string
  ): Promise<GithubProjectV2FieldRow | null> {
    return this.database.queryOne<GithubProjectV2FieldRow>(
      `
        ${this.githubProjectV2FieldSelectSql()}
        WHERE project_v2_id = $1
          AND is_status_field = true
        ORDER BY field_name ASC, id ASC
        LIMIT 1
      `,
      [projectV2Id]
    );
  }

  private async assertGithubProjectV2Exists(
    workspaceId: string,
    projectV2Id: string
  ): Promise<void> {
    const row = await this.database.queryOne<QueryResultRow>(
      `
        SELECT id
        FROM github_projects_v2
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, projectV2Id]
    );

    if (!row) {
      throw notFound("GitHub ProjectV2 not found");
    }
  }

  private async listGithubProjectV2StatusOptionRowsForField(
    fieldId: string
  ): Promise<GithubProjectV2StatusOptionPayload[]> {
    const rows = await this.database.query<GithubProjectV2FieldOptionRow>(
      `
        SELECT
          id,
          field_id,
          github_option_id,
          option_name,
          normalized_name,
          color,
          description,
          position
        FROM github_project_v2_field_options
        WHERE field_id = $1
        ORDER BY position ASC NULLS LAST, option_name ASC, id ASC
      `,
      [fieldId]
    );

    return rows.map((row) => this.mapGithubProjectV2StatusOption(row));
  }

  private async listGithubProjectV2ItemRows(
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2ItemRow[]> {
    return this.database.query<GithubProjectV2ItemRow>(
      `
        ${this.githubProjectV2ItemSelectSql()}
        WHERE pi.workspace_id = $1
          AND pi.project_v2_id = $2
        ORDER BY
          pi.position ASC NULLS LAST,
          pi.github_updated_at DESC NULLS LAST,
          pi.id ASC
      `,
      [workspaceId, projectV2Id]
    );
  }

  private async countRows(
    text: string,
    values: readonly unknown[]
  ): Promise<number> {
    const row = await this.database.queryOne<CountRow>(text, values);
    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  private buildGithubProjectV2Filters(
    workspaceId: string,
    ownerLogin: string | null,
    includeClosed: boolean,
    search: string | null
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId];
    const filters = ["workspace_id = $1"];

    if (ownerLogin) {
      values.push(ownerLogin);
      filters.push(`owner_login = $${values.length}`);
    }

    if (!includeClosed) {
      filters.push("closed = false");
    }

    if (search) {
      values.push(`%${search}%`);
      filters.push(
        `(title ILIKE $${values.length} OR short_description ILIKE $${values.length})`
      );
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private githubProjectV2SelectSql(): string {
    return `
      SELECT
        gp.id,
        gp.installation_id,
        gp.github_project_node_id,
        gp.github_project_full_database_id,
        gp.owner_login,
        gp.owner_type,
        gp.project_number,
        gp.title,
        gp.short_description,
        gp.readme,
        gp.url,
        gp.resource_path,
        gp.public,
        gp.closed,
        gp.template,
        gp.github_created_at,
        gp.github_updated_at,
        gp.github_closed_at,
        gp.last_synced_at,
        (
          SELECT COALESCE(
            ARRAY_AGG(gpr.repository_id::text ORDER BY gr.full_name ASC, gr.id ASC),
            ARRAY[]::text[]
          )
          FROM github_project_v2_repositories gpr
          JOIN github_repositories gr
            ON gr.id = gpr.repository_id
           AND gr.workspace_id = gp.workspace_id
          WHERE gpr.project_v2_id = gp.id
        ) AS repository_ids,
        gp.raw
      FROM github_projects_v2 gp
    `;
  }

  private githubProjectV2FieldSelectSql(): string {
    return `
      SELECT
        id,
        project_v2_id,
        github_field_node_id,
        field_name,
        data_type,
        is_status_field,
        github_created_at,
        github_updated_at,
        raw
      FROM github_project_v2_fields
    `;
  }

  private githubProjectV2StatusOptionsSelectSql(): string {
    return `
      SELECT
        o.id,
        o.field_id,
        o.github_option_id,
        o.option_name,
        o.normalized_name,
        o.color,
        o.description,
        o.position
      FROM github_project_v2_field_options o
      JOIN github_project_v2_fields f
        ON f.id = o.field_id
    `;
  }

  private githubProjectV2ItemSelectSql(): string {
    return `
      SELECT
        pi.id,
        pi.project_v2_id,
        pi.github_project_item_node_id,
        pi.github_project_item_full_database_id,
        pi.content_type,
        pi.issue_id,
        pi.pull_request_id,
        pi.is_archived,
        pi.status_field_id,
        pi.status_option_id,
        pi.status_option_github_id,
        pi.status_name,
        pi.status_normalized_name,
        pi.position,
        pi.github_created_at,
        pi.github_updated_at,
        pi.last_synced_at,
        pi.raw,
        gi.issue_number,
        gi.title AS issue_title,
        gi.state AS issue_state,
        gi.html_url AS issue_html_url,
        gi.labels AS issue_labels,
        gi.assignees AS issue_assignees,
        pr.pr_number,
        pr.title AS pr_title,
        ${this.pullRequestStateSql("pr")} AS pr_state,
        pr.html_url AS pr_html_url
      FROM github_project_v2_items pi
      LEFT JOIN github_issues gi
        ON gi.id = pi.issue_id
       AND gi.workspace_id = pi.workspace_id
      LEFT JOIN github_pull_requests pr
        ON pr.id = pi.pull_request_id
       AND pr.workspace_id = pi.workspace_id
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

  private mapGithubProjectV2ListItem(
    row: GithubProjectV2Row
  ): GithubProjectV2ListItemPayload {
    return {
      id: row.id,
      installationId: row.installation_id,
      githubProjectNodeId: row.github_project_node_id,
      githubProjectFullDatabaseId: this.toNullableNumber(
        row.github_project_full_database_id
      ),
      ownerLogin: row.owner_login,
      ownerType: row.owner_type,
      projectNumber: this.toInteger(
        row.project_number,
        "Invalid GitHub ProjectV2 number"
      ),
      title: row.title,
      shortDescription: row.short_description,
      url: row.url,
      public: row.public,
      closed: row.closed,
      template: row.template,
      repositoryIds: this.toStringArray(row.repository_ids),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubProjectV2Detail(
    row: GithubProjectV2Row
  ): GithubProjectV2DetailPayload {
    return {
      ...this.mapGithubProjectV2ListItem(row),
      readme: row.readme,
      resourcePath: row.resource_path,
      githubCreatedAt: this.toNullableIsoString(row.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at),
      githubClosedAt: this.toNullableIsoString(row.github_closed_at)
    };
  }

  private mapGithubProjectV2Field(
    row: GithubProjectV2FieldRow
  ): GithubProjectV2FieldPayload {
    return {
      id: row.id,
      projectV2Id: row.project_v2_id,
      githubFieldNodeId: row.github_field_node_id,
      fieldName: row.field_name,
      dataType: row.data_type,
      isStatusField: row.is_status_field,
      githubCreatedAt: this.toNullableIsoString(row.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at)
    };
  }

  private mapGithubProjectV2StatusOption(
    row: GithubProjectV2FieldOptionRow
  ): GithubProjectV2StatusOptionPayload {
    return {
      id: row.id,
      fieldId: row.field_id,
      githubOptionId: row.github_option_id,
      optionName: row.option_name,
      normalizedName: row.normalized_name,
      color: row.color,
      description: row.description,
      position: this.toNullableInteger(row.position, "Invalid ProjectV2 option position")
    };
  }

  private mapGithubProjectV2Item(
    row: GithubProjectV2ItemRow
  ): GithubProjectV2ItemPayload {
    const raw = this.toRecord(row.raw);

    return {
      id: row.id,
      projectV2Id: row.project_v2_id,
      githubProjectItemNodeId: row.github_project_item_node_id,
      githubProjectItemFullDatabaseId: this.toNullableNumber(
        row.github_project_item_full_database_id
      ),
      contentType: row.content_type,
      issueId: row.issue_id,
      pullRequestId: row.pull_request_id,
      isArchived: row.is_archived,
      statusFieldId: row.status_field_id,
      statusOptionId: row.status_option_id,
      statusOptionGithubId: row.status_option_github_id,
      statusName: row.status_name,
      statusNormalizedName: row.status_normalized_name,
      position: this.toNullableInteger(row.position, "Invalid ProjectV2 item position"),
      contentNumber: this.getProjectV2ItemContentNumber(row),
      contentTitle: this.getProjectV2ItemContentTitle(row, raw),
      contentState: this.getProjectV2ItemContentState(row),
      contentUrl: this.getProjectV2ItemContentUrl(row, raw),
      labels: row.content_type === "ISSUE" ? this.toArray(row.issue_labels) : [],
      assignees:
        row.content_type === "ISSUE" ? this.toArray(row.issue_assignees) : [],
      githubCreatedAt: this.toNullableIsoString(row.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubProjectV2KanbanItem(
    item: GithubProjectV2ItemPayload
  ): GithubProjectV2KanbanItemPayload {
    return {
      id: item.id,
      contentType: item.contentType,
      issueId: item.issueId,
      pullRequestId: item.pullRequestId,
      title: item.contentTitle,
      url: item.contentUrl,
      assignees: item.assignees,
      labels: item.labels
    };
  }

  private getProjectV2ItemContentNumber(
    row: GithubProjectV2ItemRow
  ): number | null {
    if (row.content_type === "ISSUE") {
      return this.toNullableInteger(row.issue_number, "Invalid GitHub issue number");
    }

    if (row.content_type === "PULL_REQUEST") {
      return this.toNullableInteger(
        row.pr_number,
        "Invalid GitHub pull request number"
      );
    }

    return null;
  }

  private getProjectV2ItemContentTitle(
    row: GithubProjectV2ItemRow,
    raw: Record<string, unknown>
  ): string | null {
    if (row.content_type === "ISSUE") {
      return row.issue_title;
    }

    if (row.content_type === "PULL_REQUEST") {
      return row.pr_title;
    }

    return this.getRawString(raw, "title");
  }

  private getProjectV2ItemContentState(
    row: GithubProjectV2ItemRow
  ): string | null {
    if (row.content_type === "ISSUE") {
      return row.issue_state;
    }

    if (row.content_type === "PULL_REQUEST") {
      return row.pr_state;
    }

    return null;
  }

  private getProjectV2ItemContentUrl(
    row: GithubProjectV2ItemRow,
    raw: Record<string, unknown>
  ): string | null {
    if (row.content_type === "ISSUE") {
      return row.issue_html_url;
    }

    if (row.content_type === "PULL_REQUEST") {
      return row.pr_html_url;
    }

    return this.getRawString(raw, "url");
  }

  private getRawString(
    raw: Record<string, unknown>,
    field: string
  ): string | null {
    const value = raw[field];
    return typeof value === "string" && value ? value : null;
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

  private toNullableInteger(
    value: string | number | null,
    message: string
  ): number | null {
    if (value === null) {
      return null;
    }

    return this.toInteger(value, message);
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

  private toStringArray(value: unknown): string[] {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toStringArray(parsed);
      } catch {
        return value ? [value] : [];
      }
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }
}
