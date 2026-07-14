import { Injectable, Optional } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ListGithubProjectsV2Query } from "./dto";
import { GithubAppClient } from "./github-app.client";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubProjectV2WriteService } from "./github-project-v2-write.service";
import { GithubProjectV2PollingService } from "./github-project-v2-polling.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { readGithubRepositoryOwnerType } from "./github-repository-owner";
import { GithubSyncExecutorService, type GithubSyncInstallationRow } from "./github-sync-executor.service";
import { GithubSyncJobEnqueueError } from "./github-sync-job.service";
import { GithubSyncRunService } from "./github-sync-run.service";
import { githubProjectV2RepositoryLinkSql } from "./queries";
import type {
  GithubPaginatedPayload,
  GithubProjectV2AccessStatusPayload,
  GithubProjectV2DetailPayload,
  GithubProjectV2FieldPayload,
  GithubProjectV2ItemContentType,
  GithubProjectV2ItemPayload,
  GithubProjectV2KanbanItemPayload,
  GithubProjectV2KanbanPayload,
  GithubProjectV2ListItemPayload,
  GithubProjectV2SelectionPayload,
  GithubProjectV2DiscoveryPayload,
  GithubProjectV2OwnerType,
  GithubProjectV2StatusOptionPayload
} from "./types";

interface GithubProjectV2Row extends QueryResultRow {
  id: string;
  installation_id: string;
  selected: boolean;
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

interface GithubProjectV2SelectionProjectRow extends QueryResultRow {
  id: string;
  installation_id: string;
}

interface GithubProjectV2InstallationRow extends GithubSyncInstallationRow {}

interface GithubProjectV2RepositoryRow extends QueryResultRow {
  id: string;
  installation_id: string | null;
  workspace_id: string;
  github_node_id: string | null;
  owner_login: string;
  name: string;
  full_name: string;
  raw: unknown;
}

interface GithubProjectV2RepositoryLinkRow extends QueryResultRow {
  project_v2_id: string;
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class GithubProjectV2Service {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubAppClient: GithubAppClient,
    private readonly githubProjectV2WriteService: GithubProjectV2WriteService,
    @Optional() private readonly syncExecutor?: GithubSyncExecutorService,
    @Optional() private readonly syncRunService?: GithubSyncRunService,
    @Optional() private readonly tokenService?: GithubProjectV2SyncTokenService,
    @Optional() private readonly configService?: GithubIntegrationConfigService,
    @Optional() private readonly pollingService?: GithubProjectV2PollingService
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
    const management =
      this.readOptionalBoolean(query.management, "management") ?? false;
    const repositoryId = this.readUuid(query.repositoryId, "repositoryId");
    const { whereSql, values } = this.buildGithubProjectV2Filters(
      workspaceId,
      ownerLogin,
      includeClosed,
      search,
      management,
      repositoryId
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_projects_v2 WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubProjectV2Row>(
      `
        ${this.githubProjectV2SelectSql(values.length)}
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

  async replaceGithubProjectV2Selections(
    currentUserId: string,
    workspaceId: string,
    input: {
      installationId?: unknown;
      repositoryId?: unknown;
      projectV2Ids?: unknown;
    } | undefined
  ): Promise<GithubProjectV2SelectionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const installationId = this.readUuid(
      input?.installationId,
      "installationId"
    );
    const repositoryId = this.readUuid(input?.repositoryId, "repositoryId");
    const projectV2Ids = this.readProjectV2SelectionIds(input?.projectV2Ids);

    const selection = await this.database.transaction(async (transaction) => {
      const installation = await transaction.queryOne<QueryResultRow>(
        `
          SELECT id
          FROM github_installations
          WHERE workspace_id = $1
            AND id = $2
          FOR UPDATE
        `,
        [workspaceId, installationId]
      );
      if (!installation) {
        throw notFound("GitHub App installation not found");
      }

      const repository = await transaction.queryOne<GithubProjectV2RepositoryRow>(
        `
          SELECT id, workspace_id, installation_id, github_node_id, owner_login, name, full_name, raw
          FROM github_repositories
          WHERE workspace_id = $1
            AND id = $2
            AND installation_id = $3
          FOR UPDATE
        `,
        [workspaceId, repositoryId, installationId]
      );
      if (!repository) {
        throw badRequest("GitHub repository does not belong to the installation");
      }

      if (projectV2Ids.length > 0) {
        const projects = await transaction.query<GithubProjectV2SelectionProjectRow>(
          `
            SELECT id, installation_id
            FROM github_projects_v2
            WHERE workspace_id = $1
              AND id = ANY($2::uuid[])
          `,
          [workspaceId, projectV2Ids]
        );
        const projectsById = new Map(projects.map((project) => [project.id, project]));

        for (const projectV2Id of projectV2Ids) {
          const project = projectsById.get(projectV2Id);
          if (!project) {
            throw notFound("GitHub ProjectV2 not found");
          }
          if (project.installation_id !== installationId) {
            throw badRequest("GitHub ProjectV2 does not belong to the installation");
          }
        }

        const links = await transaction.query<GithubProjectV2RepositoryLinkRow>(
          githubProjectV2RepositoryLinkSql,
          [repositoryId, projectV2Ids]
        );
        const linkedProjectV2Ids = new Set(links.map((link) => link.project_v2_id));
        for (const projectV2Id of projectV2Ids) {
          if (!linkedProjectV2Ids.has(projectV2Id)) {
            throw badRequest("GitHub ProjectV2 is not linked to the repository");
          }
        }
      }

      await this.pollingService?.terminateDeselectedQueuedRuns(
        { repositoryId, retainedProjectV2Ids: projectV2Ids },
        transaction
      );

      await transaction.execute(
        `
          DELETE FROM github_project_v2_selections
          WHERE installation_id = $1
            AND repository_id = $2
        `,
        [installationId, repositoryId]
      );

      if (projectV2Ids.length > 0) {
        await transaction.execute(
          `
            INSERT INTO github_project_v2_selections (
              installation_id,
              repository_id,
              project_v2_id
            )
            SELECT $1, $2, UNNEST($3::uuid[])
          `,
          [installationId, repositoryId, projectV2Ids]
        );
      }

      await this.pollingService?.syncSelectionSchedules(
        { repositoryId, requestedByUserId: currentUserId },
        transaction
      );

      return { installationId, repositoryId, projectV2Ids };
    });

    if (!selection.projectV2Ids.length || !this.syncRunService) {
      return { ...selection, syncRunId: null, syncStatus: null, syncError: null };
    }
    try {
      const syncRun = await this.syncRunService.startGithubSyncRun(currentUserId, workspaceId, {
        installationId,
        repositoryId,
        target: "full"
      });
      return { ...selection, syncRunId: syncRun.id, syncStatus: "queued", syncError: null };
    } catch (error) {
      if (error instanceof GithubSyncJobEnqueueError) {
        return { ...selection, syncRunId: error.syncRunId, syncStatus: "failed", syncError: error.message };
      }
      throw error;
    }
  }

  async discoverGithubProjectV2(
    currentUserId: string,
    workspaceId: string,
    installationId: string,
    input: { repositoryId?: unknown } | undefined
  ): Promise<GithubProjectV2DiscoveryPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const repositoryId = this.readUuid(input?.repositoryId, "repositoryId");
    const installation = await this.database.queryOne<GithubProjectV2InstallationRow>(
      `SELECT id, workspace_id, github_installation_id, account_login, account_type
       FROM github_installations WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, installationId]
    );
    if (!installation) throw notFound("GitHub App installation not found");
    const repository = await this.database.queryOne<GithubProjectV2RepositoryRow>(
      `
        SELECT id, workspace_id, installation_id, github_node_id, owner_login, name, full_name, raw
        FROM github_repositories
        WHERE workspace_id = $1
          AND id = $2
          AND installation_id = $3
      `,
      [workspaceId, repositoryId, installationId]
    );
    if (!repository) {
      throw badRequest("GitHub repository does not belong to the installation");
    }
    if (!this.syncExecutor || !this.tokenService || !this.configService) {
      throw badRequest("GitHub ProjectV2 discovery is unavailable");
    }

    const repositoryOwnerType = readGithubRepositoryOwnerType(repository.raw);
    let githubUserAccessToken: string | null;
    try {
      githubUserAccessToken = await this.tokenService.resolvePersonalProjectV2UserAccessToken({
        currentUserId,
        installation,
        repositoryOwnerLogin: repository.owner_login,
        repositoryOwnerType,
        requiresProjectV2Access: true
      });
    } catch {
      if (repositoryOwnerType === "User") {
        return { connectionRequired: true, installationId, repositoryId, projects: [] };
      }
      throw badRequest("GitHub ProjectV2 discovery could not be authorized");
    }
    await this.syncExecutor.discoverGithubProjectV2Metadata({
      currentUserId, workspaceId, installation, repository, projectV2: null,
      githubUserAccessToken, config: this.configService.getGithubAppConfig()
    });
    const projects = await this.listGithubProjectsV2(currentUserId, workspaceId, {
      repositoryId, management: true, limit: 100
    });
    return {
      connectionRequired: false,
      installationId,
      repositoryId,
      projects: projects.data.filter((project) => project.installationId === installationId)
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

  async getGithubProjectV2AccessStatus(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2AccessStatusPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.findGithubProjectV2(workspaceId, projectV2Id);
    if (!row) {
      throw notFound("GitHub ProjectV2 not found");
    }

    const { accessToken, githubLogin } =
      await this.githubProjectV2WriteService.getConnectedProjectV2OAuthAccess(
        currentUserId
      );
    const { permission } =
      await this.githubAppClient.getProjectV2PermissionLevel({
        ownerLogin: row.owner_login,
        ownerType: row.owner_type,
        projectNodeId: row.github_project_node_id,
        userAccessToken: accessToken
      });

    return {
      project: {
        id: row.id,
        title: row.title,
        ownerLogin: row.owner_login
      },
      githubLogin,
      permission,
      hasAccess: permission !== null,
      canUpdate: permission === "ADMIN" || permission === "WRITE",
      canManageAccess: permission === "ADMIN",
      checkedAt: new Date().toISOString()
    };
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
    search: string | null,
    management: boolean,
    repositoryId: string | null
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

    values.push(repositoryId);
    filters.push(`EXISTS (
      SELECT 1
      FROM github_project_v2_repositories gpr
      WHERE gpr.project_v2_id = id
        AND gpr.repository_id = $${values.length}
    )`);

    if (!management) {
      filters.push(`EXISTS (
        SELECT 1 FROM github_project_v2_selections gps
          WHERE gps.installation_id = installation_id
            AND gps.project_v2_id = id
            AND gps.repository_id = $${values.length}
      )`);
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private githubProjectV2SelectSql(selectionRepositoryValueIndex: number | null = null): string {
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
        EXISTS (
          SELECT 1
          FROM github_project_v2_selections gps
          WHERE gps.installation_id = gp.installation_id
            AND gps.project_v2_id = gp.id
            ${selectionRepositoryValueIndex ? `AND gps.repository_id = $${selectionRepositoryValueIndex}` : ""}
        ) AS selected,
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

  private readOptionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.readUuid(value, field);
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

  private readRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} is required`);
    }

    return value.trim();
  }

  private readProjectV2SelectionIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw badRequest("projectV2Ids must be an array");
    }

    const projectV2Ids = value.map((projectV2Id) =>
      this.readUuid(projectV2Id, "projectV2Ids must contain UUID strings")
    );

    return [...new Set(projectV2Ids)];
  }

  private readUuid(value: unknown, field: string): string {
    const uuid = this.readRequiredString(value, field);
    if (!UUID_PATTERN.test(uuid)) {
      throw badRequest(`${field} must be a UUID`);
    }

    return uuid;
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
      selected: row.selected,
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
