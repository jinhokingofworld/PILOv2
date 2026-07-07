import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../../database/database.service";
import { serializeGithubJsonb } from "../../github-integration/github-jsonb";
import type { GithubIssueApiItem } from "../../github-integration/github-app.client";
import type { BoardIssueState } from "../types";

export interface BoardIssueUpdateTargetRow extends QueryResultRow {
  id: string;
  board_id: string;
  column_id: string;
  repository_id: string | null;
  repository_owner_login: string | null;
  repository_name: string | null;
  github_issue_id: string | null;
  project_item_id: string | null;
  github_issue_node_id: string | null;
  github_project_item_node_id: string | null;
  github_issue_number: string | number | null;
  issue_number: string;
  title: string;
  body: string | null;
  html_url: string | null;
  state: BoardIssueState | null;
  labels: unknown;
  assignees: unknown;
  milestone: unknown;
  position: string | number;
  github_updated_at: Date | string | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BoardIssueUpdateIssueRow extends QueryResultRow {
  id: string;
  board_id: string;
  column_id: string;
  repository_id: string | null;
  github_issue_id: string | null;
  project_item_id: string | null;
  github_issue_node_id: string | null;
  github_project_item_node_id: string | null;
  github_issue_number: string | number | null;
  issue_number: string;
  title: string;
  body: string | null;
  html_url: string | null;
  state: BoardIssueState | null;
  labels: unknown;
  assignees: unknown;
  milestone: unknown;
  position: string | number;
  github_updated_at: Date | string | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BoardIssueUpdateProjectFieldRow extends QueryResultRow {
  field_name: string;
  field_data_type: string | null;
  text_value: string | null;
  number_value: string | number | null;
  date_value: Date | string | null;
  single_select_option_id: string | null;
  single_select_name: string | null;
  iteration_id: string | null;
  iteration_title: string | null;
}

export interface UpdateBoardIssueCacheInput {
  boardId: string;
  githubIssueId: string;
  issue: GithubIssueApiItem;
  issueId: string;
  workspaceId: string;
}

@Injectable()
export class BoardIssueUpdateQueries {
  constructor(private readonly database: DatabaseService) {}

  async transaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    return this.database.transaction(callback);
  }

  async findIssueUpdateTarget(
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueUpdateTargetRow | null> {
    return this.database.queryOne<BoardIssueUpdateTargetRow>(
      `
        SELECT
          pi.id::text AS id,
          pi.board_id::text AS board_id,
          pi.column_id::text AS column_id,
          pi.repository_id,
          gr.owner_login AS repository_owner_login,
          gr.name AS repository_name,
          pi.github_issue_id,
          pi.project_item_id,
          pi.github_issue_node_id,
          pi.github_project_item_node_id,
          pi.github_issue_number,
          pi.issue_number,
          pi.title,
          pi.body,
          pi.html_url,
          pi.state,
          pi.labels,
          pi.assignees,
          pi.milestone,
          pi.position,
          pi.github_updated_at,
          pi.last_synced_at,
          pi.created_at,
          pi.updated_at
        FROM pilo_issues pi
        JOIN boards b
          ON b.id = pi.board_id
         AND b.workspace_id = pi.workspace_id
        LEFT JOIN github_repositories gr
          ON gr.id = pi.repository_id
         AND gr.workspace_id = pi.workspace_id
        WHERE pi.workspace_id = $1
          AND pi.board_id = $2::bigint
          AND pi.id = $3::bigint
      `,
      [workspaceId, boardId, issueId]
    );
  }

  async updateGithubIssueCache(
    transaction: DatabaseTransaction,
    input: UpdateBoardIssueCacheInput
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE github_issues
        SET
          github_node_id = $3,
          issue_number = $4,
          title = $5,
          body = $6,
          state = $7::github_issue_state,
          state_reason = $8,
          author_login = $9,
          author_avatar_url = $10,
          html_url = $11,
          labels = $12::jsonb,
          assignees = $13::jsonb,
          milestone = $14::jsonb,
          github_created_at = $15::timestamptz,
          github_updated_at = $16::timestamptz,
          github_closed_at = $17::timestamptz,
          last_synced_at = now(),
          raw = $18::jsonb,
          updated_at = now()
        WHERE workspace_id = $1
          AND id = $2::uuid
      `,
      [
        input.workspaceId,
        input.githubIssueId,
        input.issue.node_id,
        input.issue.number,
        input.issue.title,
        input.issue.body ?? null,
        input.issue.state,
        input.issue.state_reason ?? null,
        input.issue.user?.login ?? null,
        input.issue.user?.avatar_url ?? null,
        input.issue.html_url,
        serializeGithubJsonb(input.issue.labels ?? []),
        serializeGithubJsonb(input.issue.assignees ?? []),
        serializeGithubJsonb(input.issue.milestone ?? null),
        input.issue.created_at ?? null,
        input.issue.updated_at ?? null,
        input.issue.closed_at ?? null,
        serializeGithubJsonb(input.issue)
      ]
    );
  }

  async updatePiloIssueCache(
    transaction: DatabaseTransaction,
    input: UpdateBoardIssueCacheInput
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE pilo_issues
        SET
          github_issue_node_id = $4,
          github_issue_number = $5,
          issue_number = $6,
          title = $7,
          body = $8,
          html_url = $9,
          state = $10::github_issue_state,
          labels = $11::jsonb,
          assignees = $12::jsonb,
          milestone = $13::jsonb,
          github_updated_at = $14::timestamptz,
          last_synced_at = now(),
          raw = $15::jsonb,
          updated_at = now()
        WHERE workspace_id = $1
          AND board_id = $2::bigint
          AND id = $3::bigint
      `,
      [
        input.workspaceId,
        input.boardId,
        input.issueId,
        input.issue.node_id,
        input.issue.number,
        `#${input.issue.number}`,
        input.issue.title,
        input.issue.body ?? null,
        input.issue.html_url,
        input.issue.state,
        serializeGithubJsonb(input.issue.labels ?? []),
        serializeGithubJsonb(input.issue.assignees ?? []),
        serializeGithubJsonb(input.issue.milestone ?? null),
        input.issue.updated_at ?? null,
        serializeGithubJsonb(input.issue)
      ]
    );
  }

  async findUpdatedIssueDetail(
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueUpdateIssueRow | null> {
    return this.database.queryOne<BoardIssueUpdateIssueRow>(
      `
        SELECT
          pi.id::text AS id,
          pi.board_id::text AS board_id,
          pi.column_id::text AS column_id,
          pi.repository_id,
          pi.github_issue_id,
          pi.project_item_id,
          pi.github_issue_node_id,
          pi.github_project_item_node_id,
          pi.github_issue_number,
          pi.issue_number,
          pi.title,
          pi.body,
          pi.html_url,
          pi.state,
          pi.labels,
          pi.assignees,
          pi.milestone,
          pi.position,
          pi.github_updated_at,
          pi.last_synced_at,
          pi.created_at,
          pi.updated_at
        FROM pilo_issues pi
        WHERE pi.workspace_id = $1
          AND pi.board_id = $2::bigint
          AND pi.id = $3::bigint
      `,
      [workspaceId, boardId, issueId]
    );
  }

  async listProjectFields(
    projectItemId: string
  ): Promise<BoardIssueUpdateProjectFieldRow[]> {
    return this.database.query<BoardIssueUpdateProjectFieldRow>(
      `
        SELECT
          field_name,
          field_data_type,
          text_value,
          number_value,
          date_value,
          single_select_option_id,
          single_select_name,
          iteration_id,
          iteration_title
        FROM github_project_v2_item_field_values
        WHERE project_item_id = $1
        ORDER BY field_name ASC
      `,
      [projectItemId]
    );
  }
}
