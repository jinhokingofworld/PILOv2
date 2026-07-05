import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  GithubAppClient,
  type GithubInstallationRepositoryApiItem,
  type GithubIssueApiItem,
  type GithubPullRequestApiItem,
  type GithubPullRequestFileApiItem
} from "./github-app.client";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import {
  type GithubAppRuntimeConfig,
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubAppInstallationCallbackQuery,
  GithubOAuthCallbackQuery,
  ListGithubSyncRunsQuery,
  ListGithubPullRequestFilesQuery,
  ListGithubPullRequestsQuery,
  ListGithubProjectsV2Query,
  ListGithubRepositoriesQuery,
  StartGithubAppInstallationRequest,
  StartGithubSyncRunRequest,
  StartGithubOAuthRequest
} from "./dto";
import type {
  GitHubIntegrationModuleInfo,
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationPayload,
  GithubAppInstallationStartPayload,
  GithubIssuePayload,
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload,
  GithubPaginatedPayload,
  GithubProjectV2DetailPayload,
  GithubProjectV2FieldPayload,
  GithubProjectV2ItemContentType,
  GithubProjectV2ItemPayload,
  GithubProjectV2KanbanItemPayload,
  GithubProjectV2KanbanPayload,
  GithubProjectV2ListItemPayload,
  GithubProjectV2OwnerType,
  GithubProjectV2StatusOptionPayload,
  GithubPullRequestConflictStatus,
  GithubPullRequestConflictStatusPayload,
  GithubPullRequestDetailPayload,
  GithubPullRequestFilePayload,
  GithubPullRequestListItemPayload,
  GithubRepositoryDetailPayload,
  GithubRepositoryListItemPayload,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload,
  GithubSyncStatus,
  GithubSyncTarget
} from "./types";

interface GithubOAuthStatusRow extends QueryResultRow {
  github_user_id: string | number | null;
  github_login: string | null;
  github_token_scope: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

interface GithubInstallationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  github_installation_id: string | number;
  account_login: string;
  account_type: "User" | "Organization";
  repository_selection: string | null;
  permissions: unknown;
  installed_by_user_id: string | null;
  installed_at: Date | string | null;
  suspended_at: Date | string | null;
  last_synced_at: Date | string | null;
}

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

interface GithubRepositoryRow extends QueryResultRow {
  id: string;
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

interface GithubPullRequestRemoteContextRow extends QueryResultRow {
  id: string;
  repository_id: string;
  pr_number: string | number;
  changed_files_count: string | number;
  html_url: string;
  owner_login: string;
  name: string;
  full_name: string;
  github_installation_id: string | number | null;
}

interface GithubSyncInstallationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  github_installation_id: string | number;
}

interface GithubSyncRepositoryContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string | null;
  owner_login: string;
  name: string;
  full_name: string;
}

interface GithubSyncProjectV2ContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string;
}

interface GithubSyncRunRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string | null;
  repository_id: string | null;
  project_v2_id: string | null;
  target: GithubSyncTarget;
  status: GithubSyncStatus;
  started_at: Date | string;
  finished_at: Date | string | null;
  fetched_count: string | number;
  created_count: string | number;
  updated_count: string | number;
  skipped_count: string | number;
  error_message: string | null;
  cursor: unknown;
}

interface GithubSyncUpsertResultRow extends QueryResultRow {
  id: string;
  created: boolean;
}

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

interface GithubSyncRunSummary {
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  cursor: Record<string, unknown>;
}

interface GithubSyncRunContext {
  currentUserId: string;
  workspaceId: string;
  installation: GithubSyncInstallationRow;
  repository: GithubSyncRepositoryContextRow | null;
  projectV2: GithubSyncProjectV2ContextRow | null;
  config: GithubAppRuntimeConfig;
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
const GITHUB_SYNC_TARGETS: readonly GithubSyncTarget[] = [
  "repositories",
  "issues",
  "pull_requests",
  "project_v2",
  "project_v2_fields",
  "project_v2_items",
  "full"
];
const GITHUB_SYNC_STATUSES: readonly GithubSyncStatus[] = [
  "running",
  "success",
  "failed"
];
const LARGE_DIFF_LINE_THRESHOLD = 1000;
const LARGE_DIFF_PATCH_BYTES = 200 * 1024;
const BINARY_FILE_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".psd",
  ".rar",
  ".so",
  ".tar",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip"
]);

@Injectable()
export class GithubIntegrationService {
  private readonly githubOAuthScope = "repo read:user";

  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly stateService: GithubOAuthStateService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly installationStateService: GithubAppInstallationStateService,
    private readonly githubAppClient: GithubAppClient
  ) {}

  getModuleInfo(): GitHubIntegrationModuleInfo {
    return {
      domain: "github-integration",
      apiContract: "docs/api/github-integration-api.md"
    };
  }

  async getGithubOAuthStatus(currentUserId: string): Promise<GithubOAuthStatusPayload> {
    const row = await this.database.queryOne<GithubOAuthStatusRow>(
      `
        SELECT
          github_user_id,
          github_login,
          github_token_scope,
          github_connected_at,
          github_revoked_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return this.mapGithubOAuthStatus(row);
  }

  startGithubOAuth(
    currentUserId: string,
    input: StartGithubOAuthRequest | undefined
  ): GithubOAuthStartPayload {
    const config = this.configService.getGithubOAuthConfig();
    const returnUrl = this.validateReturnUrl(input?.returnUrl);
    const state = this.stateService.createState(
      {
        userId: currentUserId,
        returnUrl
      },
      config
    );
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", this.getCallbackUrl(config));
    authorizeUrl.searchParams.set("scope", this.githubOAuthScope);
    authorizeUrl.searchParams.set("state", state);

    return {
      authorizeUrl: authorizeUrl.toString(),
      state
    };
  }

  async completeGithubOAuthCallback(
    query: GithubOAuthCallbackQuery
  ): Promise<GithubOAuthCallbackPayload> {
    const config = this.configService.getGithubOAuthConfig();
    const code = this.validateRequiredString(query.code, "GitHub OAuth code is required");
    const state = this.validateRequiredString(query.state, "GitHub OAuth state is required");
    const statePayload = this.stateService.verifyState(state, config);
    const token = await this.githubOAuthClient.exchangeCodeForAccessToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: this.getCallbackUrl(config)
    });
    const githubUser = await this.githubOAuthClient.getAuthenticatedUser(token.accessToken);
    const encryptedToken = this.tokenEncryptionService.encryptToken(
      token.accessToken,
      config
    );
    const row = await this.database.queryOne<GithubOAuthStatusRow>(
      `
        UPDATE users
        SET
          github_user_id = $2,
          github_login = $3,
          github_access_token_encrypted = $4,
          github_token_scope = $5,
          github_connected_at = now(),
          github_revoked_at = NULL
        WHERE id = $1
        RETURNING
          github_user_id,
          github_login,
          github_token_scope,
          github_connected_at,
          github_revoked_at
      `,
      [
        statePayload.userId,
        githubUser.id,
        githubUser.login,
        encryptedToken,
        token.scope
      ]
    );

    if (!row) {
      throw badRequest("Invalid OAuth state");
    }

    const githubConnectedAt = this.toNullableIsoString(row.github_connected_at);
    if (!githubConnectedAt) {
      throw badRequest("GitHub OAuth callback failed");
    }

    return {
      connected: true,
      githubUserId: this.toNullableNumber(row.github_user_id) ?? githubUser.id,
      githubLogin: row.github_login ?? githubUser.login,
      tokenScope: row.github_token_scope,
      githubConnectedAt
    };
  }

  async disconnectGithubOAuth(
    currentUserId: string
  ): Promise<GithubOAuthDisconnectPayload> {
    const row = await this.database.queryOne<QueryResultRow>(
      `
        UPDATE users
        SET
          github_access_token_encrypted = NULL,
          github_token_scope = NULL,
          github_revoked_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return {
      disconnected: true
    };
  }

  async startGithubAppInstallation(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubAppInstallationRequest | undefined
  ): Promise<GithubAppInstallationStartPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertGithubOAuthConnected(currentUserId);

    const config = this.configService.getGithubAppConfig();
    const returnUrl = this.validateReturnUrl(input?.returnUrl);
    const state = this.installationStateService.createState(
      {
        userId: currentUserId,
        workspaceId,
        returnUrl
      },
      config
    );
    const installUrl = new URL(
      `https://github.com/apps/${config.appSlug}/installations/new`
    );
    installUrl.searchParams.set("state", state);

    return {
      installUrl: installUrl.toString(),
      state
    };
  }

  async completeGithubAppInstallationCallback(
    query: GithubAppInstallationCallbackQuery
  ): Promise<GithubAppInstallationCallbackPayload> {
    const config = this.configService.getGithubAppConfig();
    const githubInstallationId = this.parseGithubInstallationId(
      query.installation_id
    );
    this.validateRequiredString(
      query.setup_action,
      "GitHub App setup action is required"
    );
    const state = this.validateRequiredString(
      query.state,
      "GitHub App installation state is required"
    );
    const statePayload = this.installationStateService.verifyState(state, config);
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const accessToken = await this.getConnectedGithubOAuthAccessToken(
      statePayload.userId,
      oauthConfig
    );
    const hasInstallationAccess =
      await this.githubOAuthClient.hasUserInstallationAccess({
        accessToken,
        installationId: githubInstallationId
      });
    if (!hasInstallationAccess) {
      throw badRequest(
        "GitHub App installation is not accessible to the connected GitHub user"
      );
    }

    const installation = await this.githubAppClient.getInstallation({
      installationId: githubInstallationId,
      appId: config.appId,
      privateKey: config.privateKey,
      now: config.now
    });

    const row = await this.database.queryOne<GithubInstallationRow>(
      `
        INSERT INTO github_installations (
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (github_installation_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          account_login = EXCLUDED.account_login,
          account_type = EXCLUDED.account_type,
          repository_selection = EXCLUDED.repository_selection,
          permissions = EXCLUDED.permissions,
          installed_by_user_id = EXCLUDED.installed_by_user_id,
          installed_at = EXCLUDED.installed_at,
          suspended_at = EXCLUDED.suspended_at,
          updated_at = now()
        RETURNING
          id,
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at,
          last_synced_at
      `,
      [
        statePayload.workspaceId,
        installation.githubInstallationId,
        installation.accountLogin,
        installation.accountType,
        installation.repositorySelection,
        installation.permissions,
        statePayload.userId,
        installation.installedAt,
        installation.suspendedAt
      ]
    );

    if (!row) {
      throw badRequest("GitHub App installation could not be saved");
    }

    const { id, ...payload } = this.mapGithubInstallation(row);
    return {
      ...payload,
      installationId: id
    };
  }

  async listGithubAppInstallations(
    currentUserId: string,
    workspaceId: string
  ): Promise<GithubAppInstallationPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const rows = await this.database.query<GithubInstallationRow>(
      `
        SELECT
          id,
          workspace_id,
          github_installation_id,
          account_login,
          account_type,
          repository_selection,
          permissions,
          installed_by_user_id,
          installed_at,
          suspended_at,
          last_synced_at
        FROM github_installations
        WHERE workspace_id = $1
        ORDER BY installed_at DESC NULLS LAST, created_at DESC
      `,
      [workspaceId]
    );

    return rows.map((row) => this.mapGithubInstallation(row));
  }

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

  async listGithubPullRequestFiles(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    query: ListGithubPullRequestFilesQuery
  ): Promise<GithubPaginatedPayload<GithubPullRequestFilePayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const context = await this.findGithubPullRequestRemoteContext(
      workspaceId,
      pullRequestId
    );
    const pagination = this.normalizePagination(query, 20);
    const config = this.configService.getGithubAppConfig();
    const installationId = this.readGithubInstallationId(context);
    const files = await this.githubAppClient.listPullRequestFiles({
      installationId,
      appId: config.appId,
      privateKey: config.privateKey,
      owner: context.owner_login,
      repo: context.name,
      pullNumber: this.toInteger(
        context.pr_number,
        "Invalid GitHub pull request number"
      ),
      page: pagination.page,
      perPage: pagination.limit,
      now: config.now
    });

    return {
      data: files.map((file) => this.mapGithubPullRequestFile(file, context)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: this.toInteger(
          context.changed_files_count,
          "Invalid GitHub pull request file count"
        )
      }
    };
  }

  async getGithubPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestConflictStatusPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const context = await this.findGithubPullRequestRemoteContext(
      workspaceId,
      pullRequestId
    );
    const config = this.configService.getGithubAppConfig();
    let conflictStatus: GithubPullRequestConflictStatus;

    try {
      const pullRequest = await this.githubAppClient.getPullRequest({
        installationId: this.readGithubInstallationId(context),
        appId: config.appId,
        privateKey: config.privateKey,
        owner: context.owner_login,
        repo: context.name,
        pullNumber: this.toInteger(
          context.pr_number,
          "Invalid GitHub pull request number"
        ),
        now: config.now
      });
      conflictStatus = this.mapMergeableToConflictStatus(pullRequest.mergeable);
    } catch {
      conflictStatus = "unknown";
    }

    return {
      conflictStatus,
      conflictCheckedAt: this.getCurrentIsoString(config),
      message: this.getConflictStatusMessage(conflictStatus)
    };
  }

  async startGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubSyncRunRequest | undefined
  ): Promise<GithubSyncRunPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const target = this.readGithubSyncTarget(input?.target, "target");
    const installationId = this.validateRequiredString(
      input?.installationId,
      "GitHub installation id is required"
    );
    const repositoryId = this.readOptionalStringId(
      input?.repositoryId,
      "repositoryId"
    );
    const projectV2Id = this.readOptionalStringId(input?.projectV2Id, "projectV2Id");

    this.assertGithubSyncScope(target, projectV2Id);

    const installation = await this.findGithubSyncInstallation(
      workspaceId,
      installationId
    );
    if (!installation) {
      throw notFound("GitHub App installation not found");
    }

    const repository = repositoryId
      ? await this.findGithubSyncRepository(workspaceId, repositoryId)
      : null;
    if (repositoryId && !repository) {
      throw notFound("GitHub repository not found");
    }
    if (repository && repository.installation_id !== installation.id) {
      throw badRequest("GitHub repository does not belong to the installation");
    }

    const projectV2 = projectV2Id
      ? await this.findGithubSyncProjectV2(workspaceId, projectV2Id)
      : null;
    if (projectV2Id && !projectV2) {
      throw notFound("GitHub ProjectV2 not found");
    }
    if (projectV2 && projectV2.installation_id !== installation.id) {
      throw badRequest("GitHub ProjectV2 does not belong to the installation");
    }

    const syncRun = await this.createGithubSyncRun({
      workspaceId,
      installationId,
      repositoryId,
      projectV2Id,
      target
    });

    try {
      const config = this.configService.getGithubAppConfig();
      const summary = await this.runGithubSyncTarget(target, {
        currentUserId,
        workspaceId,
        installation,
        repository,
        projectV2,
        config
      });
      const completed = await this.completeGithubSyncRunSuccess(syncRun.id, summary);
      return this.mapGithubSyncRun(completed);
    } catch (error) {
      const failed = await this.completeGithubSyncRunFailure(
        syncRun.id,
        this.getGithubSyncErrorMessage(error)
      );
      return this.mapGithubSyncRun(failed);
    }
  }

  async listGithubSyncRuns(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubSyncRunsQuery
  ): Promise<GithubPaginatedPayload<GithubSyncRunPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pagination = this.normalizePagination(query, 20);
    const target = this.readOptionalGithubSyncTarget(query.target, "target");
    const status = this.readOptionalGithubSyncStatus(query.status, "status");
    const repositoryId = this.readOptionalStringId(
      query.repositoryId,
      "repositoryId"
    );
    const projectV2Id = this.readOptionalStringId(query.projectV2Id, "projectV2Id");
    const { whereSql, values } = this.buildGithubSyncRunFilters(
      workspaceId,
      target,
      status,
      repositoryId,
      projectV2Id
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_sync_runs WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubSyncRunRow>(
      `
        ${this.githubSyncRunSelectSql()}
        WHERE ${whereSql}
        ORDER BY started_at DESC NULLS LAST, created_at DESC, id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pagination.limit, pagination.offset]
    );

    return {
      data: rows.map((row) => this.mapGithubSyncRun(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    syncRunId: string
  ): Promise<GithubSyncRunDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        ${this.githubSyncRunSelectSql()}
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, syncRunId]
    );
    if (!row) {
      throw notFound("GitHub sync run not found");
    }

    return this.mapGithubSyncRunDetail(row);
  }

  private mapGithubOAuthStatus(row: GithubOAuthStatusRow): GithubOAuthStatusPayload {
    const connected = Boolean(row.github_connected_at && !row.github_revoked_at);

    return {
      connected,
      githubUserId: this.toNullableNumber(row.github_user_id),
      githubLogin: row.github_login,
      tokenScope: connected ? row.github_token_scope : null,
      githubConnectedAt: this.toNullableIsoString(row.github_connected_at),
      githubRevokedAt: this.toNullableIsoString(row.github_revoked_at)
    };
  }

  private mapGithubInstallation(row: GithubInstallationRow): GithubAppInstallationPayload {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      githubInstallationId: this.toNumber(row.github_installation_id),
      accountLogin: row.account_login,
      accountType: row.account_type,
      repositorySelection: row.repository_selection,
      permissions: this.toRecord(row.permissions),
      installedByUserId: row.installed_by_user_id,
      installedAt: this.toNullableIsoString(row.installed_at),
      suspendedAt: this.toNullableIsoString(row.suspended_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapGithubSyncRun(row: GithubSyncRunRow): GithubSyncRunPayload {
    const startedAt = this.toNullableIsoString(row.started_at);
    if (!startedAt) {
      throw badRequest("Invalid GitHub sync start time");
    }

    return {
      id: row.id,
      target: row.target,
      status: row.status,
      installationId: row.installation_id,
      repositoryId: row.repository_id,
      projectV2Id: row.project_v2_id,
      startedAt,
      finishedAt: this.toNullableIsoString(row.finished_at),
      fetchedCount: this.toInteger(row.fetched_count, "Invalid GitHub sync fetched count"),
      createdCount: this.toInteger(row.created_count, "Invalid GitHub sync created count"),
      updatedCount: this.toInteger(row.updated_count, "Invalid GitHub sync updated count"),
      skippedCount: this.toInteger(row.skipped_count, "Invalid GitHub sync skipped count"),
      errorMessage: row.error_message
    };
  }

  private mapGithubSyncRunDetail(
    row: GithubSyncRunRow
  ): GithubSyncRunDetailPayload {
    return {
      ...this.mapGithubSyncRun(row),
      cursor: this.toRecord(row.cursor)
    };
  }

  private mapGithubRepositoryListItem(
    row: GithubRepositoryRow
  ): GithubRepositoryListItemPayload {
    return {
      id: row.id,
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
      additions: this.toInteger(row.additions, "Invalid GitHub pull request additions"),
      deletions: this.toInteger(row.deletions, "Invalid GitHub pull request deletions"),
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

  private mapGithubPullRequestFile(
    file: GithubPullRequestFileApiItem,
    context: GithubPullRequestRemoteContextRow
  ): GithubPullRequestFilePayload {
    const additions = this.toInteger(
      file.additions,
      "Invalid GitHub pull request file additions"
    );
    const deletions = this.toInteger(
      file.deletions,
      "Invalid GitHub pull request file deletions"
    );
    const changes = this.toInteger(
      file.changes,
      "Invalid GitHub pull request file changes"
    );
    const patch = typeof file.patch === "string" ? file.patch : null;
    const isBinary = this.isBinaryFilePath(file.filename);
    const isLargeDiff =
      !isBinary && this.isLargeDiff({ additions, deletions, patch });

    return {
      filePath: file.filename,
      previousFilePath: file.previous_filename ?? null,
      fileName: this.getFileName(file.filename),
      fileStatus: file.status,
      additions,
      deletions,
      changes,
      isBinary,
      isLargeDiff,
      blobUrl: file.blob_url ?? null,
      rawUrl: file.raw_url ?? null,
      contentsUrl: file.contents_url ?? null,
      githubFileUrl: this.buildGithubFileUrl(context.html_url, file.sha ?? null),
      patch: isBinary || isLargeDiff ? null : patch
    };
  }

  private async findGithubPullRequestRemoteContext(
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestRemoteContextRow> {
    const row = await this.database.queryOne<GithubPullRequestRemoteContextRow>(
      `
        SELECT
          pr.id,
          pr.repository_id,
          pr.pr_number,
          pr.changed_files_count,
          pr.html_url,
          gr.owner_login,
          gr.name,
          gr.full_name,
          gi.github_installation_id
        FROM github_pull_requests pr
        JOIN github_repositories gr
          ON gr.id = pr.repository_id
         AND gr.workspace_id = pr.workspace_id
        LEFT JOIN github_installations gi
          ON gi.id = gr.installation_id
         AND gi.workspace_id = pr.workspace_id
        WHERE pr.workspace_id = $1
          AND pr.id = $2
      `,
      [workspaceId, pullRequestId]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }

    return row;
  }

  private readGithubInstallationId(row: GithubPullRequestRemoteContextRow): number {
    if (row.github_installation_id === null) {
      throw badRequest("GitHub App installation is not connected");
    }

    return this.toNumber(row.github_installation_id);
  }

  private isLargeDiff(input: {
    additions: number;
    deletions: number;
    patch: string | null;
  }): boolean {
    if (input.additions + input.deletions >= LARGE_DIFF_LINE_THRESHOLD) {
      return true;
    }

    if (input.patch === null) {
      return true;
    }

    return Buffer.byteLength(input.patch, "utf8") >= LARGE_DIFF_PATCH_BYTES;
  }

  private isBinaryFilePath(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    const lastDotIndex = lowerPath.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return false;
    }

    return BINARY_FILE_EXTENSIONS.has(lowerPath.slice(lastDotIndex));
  }

  private getFileName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.split("/").pop() ?? normalized;
  }

  private buildGithubFileUrl(pullRequestUrl: string, fileSha: string | null): string {
    const filesUrl = `${pullRequestUrl.replace(/\/+$/, "")}/files`;
    return fileSha ? `${filesUrl}#diff-${encodeURIComponent(fileSha)}` : filesUrl;
  }

  private mapMergeableToConflictStatus(
    mergeable: boolean | null
  ): GithubPullRequestConflictStatus {
    if (mergeable === true) {
      return "clean";
    }

    if (mergeable === false) {
      return "conflicted";
    }

    return "checking";
  }

  private getConflictStatusMessage(status: GithubPullRequestConflictStatus): string {
    switch (status) {
      case "clean":
        return "Conflict가 없는 상태입니다.";
      case "conflicted":
        return "Conflict가 있는 상태입니다.";
      case "checking":
        return "Conflict 상태를 확인 중입니다.";
      case "unknown":
        return "Conflict 상태를 확인할 수 없습니다.";
    }
  }

  private getCurrentIsoString(config: Pick<GithubAppRuntimeConfig, "now">): string {
    return (config.now ? config.now() : new Date()).toISOString();
  }

  private async createGithubSyncRun(input: {
    workspaceId: string;
    installationId: string;
    repositoryId: string | null;
    projectV2Id: string | null;
    target: GithubSyncTarget;
  }): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        INSERT INTO github_sync_runs (
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [
        input.workspaceId,
        input.installationId,
        input.repositoryId,
        input.projectV2Id,
        input.target
      ]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be created");
    }

    return row;
  }

  private async completeGithubSyncRunSuccess(
    syncRunId: string,
    summary: GithubSyncRunSummary
  ): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        UPDATE github_sync_runs
        SET
          status = 'success',
          finished_at = now(),
          fetched_count = $2,
          created_count = $3,
          updated_count = $4,
          skipped_count = $5,
          error_message = NULL,
          cursor = $6::jsonb
        WHERE id = $1
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [
        syncRunId,
        summary.fetchedCount,
        summary.createdCount,
        summary.updatedCount,
        summary.skippedCount,
        summary.cursor
      ]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be completed");
    }

    return row;
  }

  private async completeGithubSyncRunFailure(
    syncRunId: string,
    errorMessage: string
  ): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        UPDATE github_sync_runs
        SET
          status = 'failed',
          finished_at = now(),
          error_message = $2
        WHERE id = $1
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [syncRunId, errorMessage]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be marked failed");
    }

    return row;
  }

  private async runGithubSyncTarget(
    target: GithubSyncTarget,
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    switch (target) {
      case "repositories":
        return this.syncGithubRepositories(context);
      case "issues":
        return this.syncGithubIssues(context);
      case "pull_requests":
        return this.syncGithubPullRequests(context);
      case "project_v2":
        return this.syncGithubProjectV2(context);
      case "project_v2_fields":
        return this.syncGithubProjectV2Fields(context);
      case "project_v2_items":
        return this.syncGithubProjectV2Items(context);
      case "full":
        return this.syncGithubFull(context);
    }
  }

  private async syncGithubFull(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    let summary = this.createGithubSyncSummary();
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubRepositories(context)
    );
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubIssues(context)
    );
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubPullRequests(context)
    );

    if (context.projectV2) {
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2(context)
      );
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2Fields(context)
      );
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2Items(context)
      );
    }

    return summary;
  }

  private async syncGithubRepositories(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.githubAppClient.listInstallationRepositories({
      installationId: this.toNumber(context.installation.github_installation_id),
      appId: context.config.appId,
      privateKey: context.config.privateKey,
      now: context.config.now
    });

    let createdCount = 0;
    let updatedCount = 0;
    for (const repository of repositories) {
      const row = await this.upsertGithubRepository(context, repository);
      if (row.created) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    await this.markGithubInstallationSynced(context.installation.id);

    return this.createGithubSyncSummary({
      fetchedCount: repositories.length,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubIssues(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.getGithubSyncRepositoriesForTarget(context);
    let fetchedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const repository of repositories) {
      const issues = await this.githubAppClient.listRepositoryIssues({
        installationId: this.toNumber(context.installation.github_installation_id),
        appId: context.config.appId,
        privateKey: context.config.privateKey,
        owner: repository.owner_login,
        repo: repository.name,
        now: context.config.now
      });
      fetchedCount += issues.length;

      for (const issue of issues) {
        const row = await this.upsertGithubIssue(context.workspaceId, repository.id, issue);
        if (row.created) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      await this.markGithubRepositorySynced(repository.id);
    }

    return this.createGithubSyncSummary({
      fetchedCount,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubPullRequests(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.getGithubSyncRepositoriesForTarget(context);
    let fetchedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const repository of repositories) {
      const pullRequests = await this.githubAppClient.listRepositoryPullRequests({
        installationId: this.toNumber(context.installation.github_installation_id),
        appId: context.config.appId,
        privateKey: context.config.privateKey,
        owner: repository.owner_login,
        repo: repository.name,
        now: context.config.now
      });
      fetchedCount += pullRequests.length;

      for (const pullRequest of pullRequests) {
        const row = await this.upsertGithubPullRequest(
          context.workspaceId,
          repository.id,
          pullRequest
        );
        if (row.created) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      await this.markGithubRepositorySynced(repository.id);
    }

    return this.createGithubSyncSummary({
      fetchedCount,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubProjectV2(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    await this.database.execute(
      `
        UPDATE github_projects_v2
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: 1,
      updatedCount: 1
    });
  }

  private async syncGithubProjectV2Fields(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    const fieldCount = await this.countRows(
      `
        SELECT COUNT(*)::int AS total
        FROM github_project_v2_fields
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: fieldCount,
      skippedCount: fieldCount
    });
  }

  private async syncGithubProjectV2Items(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    const itemCount = await this.countRows(
      `
        SELECT COUNT(*)::int AS total
        FROM github_project_v2_items
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );
    await this.database.execute(
      `
        UPDATE github_project_v2_items
        SET last_synced_at = now()
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: itemCount,
      updatedCount: itemCount
    });
  }

  private async upsertGithubRepository(
    context: GithubSyncRunContext,
    repository: GithubInstallationRepositoryApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_repositories (
          workspace_id,
          installation_id,
          connected_by_user_id,
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
          last_synced_at,
          raw
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          now(),
          $16::jsonb
        )
        ON CONFLICT (github_repository_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          installation_id = EXCLUDED.installation_id,
          connected_by_user_id = EXCLUDED.connected_by_user_id,
          github_node_id = EXCLUDED.github_node_id,
          owner_login = EXCLUDED.owner_login,
          name = EXCLUDED.name,
          full_name = EXCLUDED.full_name,
          private = EXCLUDED.private,
          archived = EXCLUDED.archived,
          default_branch = EXCLUDED.default_branch,
          html_url = EXCLUDED.html_url,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          pushed_at = EXCLUDED.pushed_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        context.workspaceId,
        context.installation.id,
        context.currentUserId,
        repository.id,
        repository.node_id,
        repository.owner.login,
        repository.name,
        repository.full_name,
        repository.private,
        repository.archived,
        repository.default_branch ?? null,
        repository.html_url,
        repository.created_at ?? null,
        repository.updated_at ?? null,
        repository.pushed_at ?? null,
        repository
      ]
    );

    if (!row) {
      throw badRequest("GitHub repository could not be synced");
    }

    return row;
  }

  private async upsertGithubIssue(
    workspaceId: string,
    repositoryId: string,
    issue: GithubIssueApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_issues (
          workspace_id,
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
          last_synced_at,
          raw
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          $14::jsonb,
          $15::jsonb,
          $16,
          $17,
          $18,
          now(),
          $19::jsonb
        )
        ON CONFLICT (github_issue_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          repository_id = EXCLUDED.repository_id,
          github_node_id = EXCLUDED.github_node_id,
          issue_number = EXCLUDED.issue_number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          state = EXCLUDED.state,
          state_reason = EXCLUDED.state_reason,
          author_login = EXCLUDED.author_login,
          author_avatar_url = EXCLUDED.author_avatar_url,
          html_url = EXCLUDED.html_url,
          labels = EXCLUDED.labels,
          assignees = EXCLUDED.assignees,
          milestone = EXCLUDED.milestone,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          github_closed_at = EXCLUDED.github_closed_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        workspaceId,
        repositoryId,
        issue.id,
        issue.node_id,
        issue.number,
        issue.title,
        issue.body ?? null,
        issue.state,
        issue.state_reason ?? null,
        issue.user?.login ?? null,
        issue.user?.avatar_url ?? null,
        issue.html_url,
        issue.labels ?? [],
        issue.assignees ?? [],
        issue.milestone ?? null,
        issue.created_at ?? null,
        issue.updated_at ?? null,
        issue.closed_at ?? null,
        issue
      ]
    );

    if (!row) {
      throw badRequest("GitHub issue could not be synced");
    }

    return row;
  }

  private async upsertGithubPullRequest(
    workspaceId: string,
    repositoryId: string,
    pullRequest: GithubPullRequestApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_pull_requests (
          workspace_id,
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
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          now(),
          $23::jsonb
        )
        ON CONFLICT (github_pull_request_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          repository_id = EXCLUDED.repository_id,
          github_node_id = EXCLUDED.github_node_id,
          pr_number = EXCLUDED.pr_number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          author_login = EXCLUDED.author_login,
          author_avatar_url = EXCLUDED.author_avatar_url,
          head_branch = EXCLUDED.head_branch,
          base_branch = EXCLUDED.base_branch,
          changed_files_count = EXCLUDED.changed_files_count,
          additions = EXCLUDED.additions,
          deletions = EXCLUDED.deletions,
          commits_count = EXCLUDED.commits_count,
          comments_count = EXCLUDED.comments_count,
          review_comments_count = EXCLUDED.review_comments_count,
          html_url = EXCLUDED.html_url,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          github_closed_at = EXCLUDED.github_closed_at,
          merged_at = EXCLUDED.merged_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        workspaceId,
        repositoryId,
        pullRequest.id,
        pullRequest.node_id,
        pullRequest.number,
        pullRequest.title,
        pullRequest.body ?? null,
        pullRequest.user?.login ?? null,
        pullRequest.user?.avatar_url ?? null,
        pullRequest.head?.ref ?? null,
        pullRequest.base?.ref ?? null,
        pullRequest.changed_files ?? 0,
        pullRequest.additions ?? 0,
        pullRequest.deletions ?? 0,
        pullRequest.commits ?? 0,
        pullRequest.comments ?? 0,
        pullRequest.review_comments ?? 0,
        pullRequest.html_url,
        pullRequest.created_at ?? null,
        pullRequest.updated_at ?? null,
        pullRequest.closed_at ?? null,
        pullRequest.merged_at ?? null,
        pullRequest
      ]
    );

    if (!row) {
      throw badRequest("GitHub pull request could not be synced");
    }

    return row;
  }

  private async markGithubInstallationSynced(installationId: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_installations
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [installationId]
    );
  }

  private async markGithubRepositorySynced(repositoryId: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_repositories
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [repositoryId]
    );
  }

  private async getGithubSyncRepositoriesForTarget(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRepositoryContextRow[]> {
    if (context.repository) {
      return [context.repository];
    }

    return this.listGithubSyncRepositoriesForInstallation(
      context.workspaceId,
      context.installation.id
    );
  }

  private requireGithubSyncProjectV2(
    context: GithubSyncRunContext
  ): GithubSyncProjectV2ContextRow {
    if (!context.projectV2) {
      throw badRequest("projectV2Id is required for this sync target");
    }

    return context.projectV2;
  }

  private createGithubSyncSummary(
    input: Partial<GithubSyncRunSummary> = {}
  ): GithubSyncRunSummary {
    return {
      fetchedCount: input.fetchedCount ?? 0,
      createdCount: input.createdCount ?? 0,
      updatedCount: input.updatedCount ?? 0,
      skippedCount: input.skippedCount ?? 0,
      cursor: input.cursor ?? {}
    };
  }

  private mergeGithubSyncSummaries(
    left: GithubSyncRunSummary,
    right: GithubSyncRunSummary
  ): GithubSyncRunSummary {
    return {
      fetchedCount: left.fetchedCount + right.fetchedCount,
      createdCount: left.createdCount + right.createdCount,
      updatedCount: left.updatedCount + right.updatedCount,
      skippedCount: left.skippedCount + right.skippedCount,
      cursor: {
        ...left.cursor,
        ...right.cursor
      }
    };
  }

  private getGithubSyncErrorMessage(error: unknown): string {
    const fallback = "GitHub sync failed";
    let message: string | null = null;

    if (error instanceof Error && error.message) {
      message = error.message;
    }

    if (!message && typeof error === "object" && error !== null) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      const responseMessage =
        typeof response === "object" && response !== null
          ? (response as { error?: { message?: unknown } }).error?.message
          : null;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        message = responseMessage;
      }
    }

    return (message ?? fallback).slice(0, 1000);
  }

  private async findGithubSyncInstallation(
    workspaceId: string,
    installationId: string
  ): Promise<GithubSyncInstallationRow | null> {
    return this.database.queryOne<GithubSyncInstallationRow>(
      `
        SELECT
          id,
          workspace_id,
          github_installation_id
        FROM github_installations
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, installationId]
    );
  }

  private async findGithubSyncRepository(
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubSyncRepositoryContextRow | null> {
    return this.database.queryOne<GithubSyncRepositoryContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id,
          owner_login,
          name,
          full_name
        FROM github_repositories
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, repositoryId]
    );
  }

  private async listGithubSyncRepositoriesForInstallation(
    workspaceId: string,
    installationId: string
  ): Promise<GithubSyncRepositoryContextRow[]> {
    return this.database.query<GithubSyncRepositoryContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id,
          owner_login,
          name,
          full_name
        FROM github_repositories
        WHERE workspace_id = $1
          AND installation_id = $2
        ORDER BY full_name ASC, id ASC
      `,
      [workspaceId, installationId]
    );
  }

  private async findGithubSyncProjectV2(
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubSyncProjectV2ContextRow | null> {
    return this.database.queryOne<GithubSyncProjectV2ContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id
        FROM github_projects_v2
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, projectV2Id]
    );
  }

  private async findGithubRepository(
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubRepositoryRow | null> {
    return this.database.queryOne<GithubRepositoryRow>(
      `
        SELECT
          id,
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

  private async countRows(text: string, values: readonly unknown[]): Promise<number> {
    const row = await this.database.queryOne<CountRow>(text, values);
    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  private buildGithubSyncRunFilters(
    workspaceId: string,
    target: GithubSyncTarget | null,
    status: GithubSyncStatus | null,
    repositoryId: string | null,
    projectV2Id: string | null
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId];
    const filters = ["workspace_id = $1"];

    if (target) {
      values.push(target);
      filters.push(`target = $${values.length}`);
    }

    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }

    if (repositoryId) {
      values.push(repositoryId);
      filters.push(`repository_id = $${values.length}`);
    }

    if (projectV2Id) {
      values.push(projectV2Id);
      filters.push(`project_v2_id = $${values.length}`);
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private buildGithubRepositoryFilters(
    workspaceId: string,
    search: string | null,
    includeArchived: boolean
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId];
    const filters = ["workspace_id = $1"];

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

  private githubSyncRunSelectSql(): string {
    return `
      SELECT
        id,
        workspace_id,
        installation_id,
        repository_id,
        project_v2_id,
        target,
        status,
        started_at,
        finished_at,
        fetched_count,
        created_count,
        updated_count,
        skipped_count,
        error_message,
        cursor
      FROM github_sync_runs
    `;
  }

  private githubProjectV2SelectSql(): string {
    return `
      SELECT
        id,
        installation_id,
        github_project_node_id,
        github_project_full_database_id,
        owner_login,
        owner_type,
        project_number,
        title,
        short_description,
        readme,
        url,
        resource_path,
        public,
        closed,
        template,
        github_created_at,
        github_updated_at,
        github_closed_at,
        last_synced_at,
        raw
      FROM github_projects_v2
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

  private readGithubSyncTarget(value: unknown, field: string): GithubSyncTarget {
    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be one of ${GITHUB_SYNC_TARGETS.join(", ")}`);
    }

    const target = value.trim();
    if (this.isGithubSyncTarget(target)) {
      return target;
    }

    throw badRequest(`${field} must be one of ${GITHUB_SYNC_TARGETS.join(", ")}`);
  }

  private readOptionalGithubSyncTarget(
    value: unknown,
    field: string
  ): GithubSyncTarget | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.readGithubSyncTarget(value, field);
  }

  private readOptionalGithubSyncStatus(
    value: unknown,
    field: string
  ): GithubSyncStatus | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be one of ${GITHUB_SYNC_STATUSES.join(", ")}`);
    }

    const status = value.trim();
    if (this.isGithubSyncStatus(status)) {
      return status;
    }

    throw badRequest(`${field} must be one of ${GITHUB_SYNC_STATUSES.join(", ")}`);
  }

  private readOptionalStringId(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const id = value.trim();
    return id ? id : null;
  }

  private assertGithubSyncScope(
    target: GithubSyncTarget,
    projectV2Id: string | null
  ): void {
    if (
      (target === "project_v2" ||
        target === "project_v2_fields" ||
        target === "project_v2_items") &&
      !projectV2Id
    ) {
      throw badRequest("projectV2Id is required for this sync target");
    }
  }

  private isGithubSyncTarget(value: string): value is GithubSyncTarget {
    return GITHUB_SYNC_TARGETS.includes(value as GithubSyncTarget);
  }

  private isGithubSyncStatus(value: string): value is GithubSyncStatus {
    return GITHUB_SYNC_STATUSES.includes(value as GithubSyncStatus);
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

  private getCallbackUrl(config: { apiPublicOrigin: string; apiBasePath: string }): string {
    return `${config.apiPublicOrigin}${config.apiBasePath}/github/oauth/callback`;
  }

  private async assertGithubOAuthConnected(currentUserId: string): Promise<void> {
    const row = await this.getGithubOAuthConnectionRow(currentUserId);
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }
  }

  private async getConnectedGithubOAuthAccessToken(
    currentUserId: string,
    config: GithubOAuthRuntimeConfig
  ): Promise<string> {
    const row = await this.getGithubOAuthConnectionRow(currentUserId);
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_access_token_encrypted,
      config
    );
  }

  private async getGithubOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubOAuthConnectionRow>(
      `
        SELECT
          github_access_token_encrypted,
          github_connected_at,
          github_revoked_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return row;
  }

  private isActiveGithubOAuthConnection(
    row: GithubOAuthConnectionRow
  ): row is GithubOAuthConnectionRow & { github_access_token_encrypted: string } {
    return Boolean(
      row.github_access_token_encrypted &&
        row.github_connected_at &&
        !row.github_revoked_at
    );
  }

  private validateReturnUrl(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || value.length > 2048) {
      throw badRequest("Invalid returnUrl");
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported returnUrl protocol");
      }

      return url.toString();
    } catch {
      throw badRequest("Invalid returnUrl");
    }
  }

  private validateRequiredString(value: unknown, message: string): string {
    if (Array.isArray(value)) {
      throw badRequest(message);
    }

    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private parseGithubInstallationId(value: unknown): number {
    const raw = this.validateRequiredString(
      value,
      "GitHub installation id is required"
    );
    if (!/^\d+$/.test(raw)) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    return parsed;
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

  private toNumber(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid GitHub installation id");
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
