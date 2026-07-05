import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import {
  GithubAppClient,
  type GithubInstallationRepositoryApiItem,
  type GithubIssueApiItem,
  type GithubPullRequestApiItem
} from "./github-app.client";
import type { GithubAppRuntimeConfig } from "./github-integration-config.service";
import type { GithubSyncTarget } from "./types";

export interface GithubSyncInstallationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  github_installation_id: string | number;
}

export interface GithubSyncRepositoryContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string | null;
  owner_login: string;
  name: string;
  full_name: string;
}

export interface GithubSyncProjectV2ContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string;
}

interface GithubSyncUpsertResultRow extends QueryResultRow {
  id: string;
  created: boolean;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

export interface GithubSyncRunSummary {
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  cursor: Record<string, unknown>;
}

export interface GithubSyncRunContext {
  currentUserId: string;
  workspaceId: string;
  installation: GithubSyncInstallationRow;
  repository: GithubSyncRepositoryContextRow | null;
  projectV2: GithubSyncProjectV2ContextRow | null;
  config: GithubAppRuntimeConfig;
}

@Injectable()
export class GithubSyncExecutorService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient
  ) {}

  async runGithubSyncTarget(
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

  private async countRows(
    text: string,
    values: readonly unknown[]
  ): Promise<number> {
    const row = await this.database.queryOne<CountRow>(text, values);
    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNumber(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid GitHub installation id");
    }

    return parsed;
  }
}
