import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import type { BoardIssueState, BoardSyncStatus } from "../types";

export interface BoardRow extends QueryResultRow {
  id: string | number;
  workspace_id: string;
  repository_id: string;
  project_v2_id: string;
  status_field_id: string | null;
  name: string;
  last_sync_status: BoardSyncStatus | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  repository_full_name: string;
  repository_html_url: string;
  github_project_node_id: string;
  project_number: string | number;
  project_title: string;
  project_url: string;
  github_field_node_id: string | null;
  status_field_name: string | null;
}

export interface BoardDetailRow extends BoardRow {
  columns_count: string | number;
  total_cards: string | number;
  open_cards: string | number;
  closed_cards: string | number;
}

export interface BoardColumnRow extends QueryResultRow {
  id: string | number;
  board_id: string | number;
  status_option_id: string | null;
  status_option_github_id: string | null;
  normalized_name: string | null;
  name: string;
  position: string | number;
  color: string | null;
  issue_count: string | number;
}

export interface BoardIssueRow extends QueryResultRow {
  id: string | number;
  board_id: string | number;
  column_id: string | number;
  repository_id: string | null;
  github_issue_id: string | null;
  project_item_id: string | null;
  github_issue_node_id: string | null;
  github_project_item_node_id: string | null;
  github_issue_number: string | number | null;
  issue_number: string;
  title: string;
  html_url: string | null;
  state: BoardIssueState | null;
  labels: unknown;
  assignees: unknown;
  position: string | number;
  github_updated_at: Date | string | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BoardIssueDetailRow extends BoardIssueRow {
  body: string | null;
  milestone: unknown;
}

export interface BoardProjectFieldRow extends QueryResultRow {
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

export interface BoardRelatedPullRequestRow extends QueryResultRow {
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

export interface BoardFilterColumnOptionRow extends QueryResultRow {
  id: string;
  name: string;
  normalized_name: string | null;
  count: string | number;
}

export interface BoardFilterStateOptionRow extends QueryResultRow {
  state: BoardIssueState;
  count: string | number;
}

export interface BoardFilterAssigneeOptionRow extends QueryResultRow {
  login: string;
  avatar_url: string | null;
  count: string | number;
}

export interface BoardFilterLabelOptionRow extends QueryResultRow {
  name: string;
  color: string | null;
  count: string | number;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface BoardFilterInput {
  workspaceId: string;
  repositoryId: string | null;
  projectV2Id: string | null;
}

interface BoardIssueFilterInput {
  boardId: string;
  columnId: string | null;
  state: BoardIssueState | null;
  search: string | null;
  label: string | null;
  assignee: string | null;
}

@Injectable()
export class BoardReadQueries {
  constructor(private readonly database: DatabaseService) {}

  async countBoards(input: BoardFilterInput): Promise<number> {
    const { whereSql, values } = this.buildBoardFilters(input);
    const row = await this.database.queryOne<CountRow>(
      `SELECT COUNT(*)::int AS total FROM boards b WHERE ${whereSql}`,
      values
    );

    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  async listBoards(
    input: BoardFilterInput,
    limit: number,
    offset: number
  ): Promise<BoardRow[]> {
    const { whereSql, values } = this.buildBoardFilters(input);

    return this.database.query<BoardRow>(
      `
        SELECT
          ${this.boardFieldsSql()}
        ${this.boardFromSql()}
        WHERE ${whereSql}
        ORDER BY b.updated_at DESC, b.id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, limit, offset]
    );
  }

  async findBoardDetail(
    workspaceId: string,
    boardId: string
  ): Promise<BoardDetailRow | null> {
    return this.database.queryOne<BoardDetailRow>(
      `
        SELECT
          ${this.boardFieldsSql()},
          (
            SELECT COUNT(*)::int
            FROM board_columns
            WHERE board_id = b.id
          ) AS columns_count,
          (
            SELECT COUNT(*)::int
            FROM pilo_issues
            WHERE board_id = b.id
          ) AS total_cards,
          (
            SELECT COUNT(*)::int
            FROM pilo_issues
            WHERE board_id = b.id
              AND state = 'open'
          ) AS open_cards,
          (
            SELECT COUNT(*)::int
            FROM pilo_issues
            WHERE board_id = b.id
              AND state = 'closed'
          ) AS closed_cards
        ${this.boardFromSql()}
        WHERE b.workspace_id = $1
          AND b.id = $2::bigint
      `,
      [workspaceId, boardId]
    );
  }

  async findBoardId(
    workspaceId: string,
    boardId: string
  ): Promise<QueryResultRow | null> {
    return this.database.queryOne<QueryResultRow>(
      `
        SELECT id
        FROM boards
        WHERE workspace_id = $1
          AND id = $2::bigint
      `,
      [workspaceId, boardId]
    );
  }

  async listBoardColumns(boardId: string): Promise<BoardColumnRow[]> {
    return this.database.query<BoardColumnRow>(
      `
        SELECT
          bc.id::text AS id,
          bc.board_id::text AS board_id,
          bc.status_option_id,
          bc.status_option_github_id,
          bc.normalized_name,
          bc.name,
          bc.position,
          bc.color,
          COUNT(pi.id)::int AS issue_count
        FROM board_columns bc
        LEFT JOIN pilo_issues pi
          ON pi.column_id = bc.id
         AND pi.board_id = bc.board_id
        WHERE bc.board_id = $1::bigint
        GROUP BY bc.id
        ORDER BY bc.position ASC, bc.id ASC
      `,
      [boardId]
    );
  }

  async countBoardIssues(input: BoardIssueFilterInput): Promise<number> {
    const { whereSql, values } = this.buildIssueFilters(input);
    const row = await this.database.queryOne<CountRow>(
      `
        SELECT COUNT(*)::int AS total
        FROM pilo_issues pi
        WHERE ${whereSql}
      `,
      values
    );

    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  async listBoardIssues(
    input: BoardIssueFilterInput,
    limit: number,
    offset: number
  ): Promise<BoardIssueRow[]> {
    const { whereSql, values } = this.buildIssueFilters(input);

    return this.database.query<BoardIssueRow>(
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
          pi.html_url,
          pi.state,
          pi.labels,
          pi.assignees,
          pi.position,
          pi.github_updated_at,
          pi.last_synced_at,
          pi.created_at,
          pi.updated_at
        FROM pilo_issues pi
        JOIN board_columns bc
          ON bc.id = pi.column_id
         AND bc.board_id = pi.board_id
        WHERE ${whereSql}
        ORDER BY bc.position ASC, pi.position ASC, pi.id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, limit, offset]
    );
  }

  async findBoardIssueDetail(
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueDetailRow | null> {
    return this.database.queryOne<BoardIssueDetailRow>(
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

  async listProjectFields(projectItemId: string): Promise<BoardProjectFieldRow[]> {
    return this.database.query<BoardProjectFieldRow>(
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

  async listRelatedPullRequests(
    repositoryId: string,
    issueNumber: number,
    issueHtmlUrl: string | null
  ): Promise<BoardRelatedPullRequestRow[]> {
    const issueReferencePattern = `(^|[^0-9])#${issueNumber}([^0-9]|$)`;
    const issuePathPattern = `%issues/${issueNumber}%`;
    const issueUrlPattern = issueHtmlUrl ? `%${issueHtmlUrl}%` : null;

    return this.database.query<BoardRelatedPullRequestRow>(
      `
        SELECT
          pr.id,
          pr.repository_id,
          pr.github_pull_request_id,
          pr.github_node_id,
          pr.pr_number,
          pr.title,
          pr.body,
          pr.author_login,
          pr.author_avatar_url,
          pr.head_branch,
          pr.base_branch,
          pr.changed_files_count,
          pr.additions,
          pr.deletions,
          pr.commits_count,
          pr.comments_count,
          pr.review_comments_count,
          pr.html_url,
          pr.github_created_at,
          pr.github_updated_at,
          pr.github_closed_at,
          pr.merged_at,
          pr.last_synced_at,
          pr.raw
        FROM github_pull_requests pr
        WHERE pr.repository_id = $1
          AND (
            COALESCE(pr.title, '') ~* $2
            OR COALESCE(pr.body, '') ~* $2
            OR pr.raw::text ILIKE $3
            OR ($4::text IS NOT NULL AND pr.raw::text ILIKE $4)
          )
        ORDER BY pr.github_updated_at DESC NULLS LAST, pr.pr_number DESC, pr.id ASC
      `,
      [repositoryId, issueReferencePattern, issuePathPattern, issueUrlPattern]
    );
  }

  async listBoardFilterColumns(
    boardId: string
  ): Promise<BoardFilterColumnOptionRow[]> {
    return this.database.query<BoardFilterColumnOptionRow>(
      `
        SELECT
          bc.id::text AS id,
          bc.name,
          bc.normalized_name,
          COUNT(pi.id)::int AS count
        FROM board_columns bc
        LEFT JOIN pilo_issues pi
          ON pi.column_id = bc.id
         AND pi.board_id = bc.board_id
        WHERE bc.board_id = $1::bigint
        GROUP BY bc.id
        ORDER BY bc.position ASC, bc.id ASC
      `,
      [boardId]
    );
  }

  async listBoardFilterStates(
    boardId: string
  ): Promise<BoardFilterStateOptionRow[]> {
    return this.database.query<BoardFilterStateOptionRow>(
      `
        SELECT
          state,
          COUNT(*)::int AS count
        FROM pilo_issues
        WHERE board_id = $1::bigint
          AND state IN ('open', 'closed')
        GROUP BY state
        ORDER BY state ASC
      `,
      [boardId]
    );
  }

  async listBoardFilterAssignees(
    boardId: string
  ): Promise<BoardFilterAssigneeOptionRow[]> {
    return this.database.query<BoardFilterAssigneeOptionRow>(
      `
        SELECT
          assignee->>'login' AS login,
          COALESCE(assignee->>'avatarUrl', assignee->>'avatar_url') AS avatar_url,
          COUNT(*)::int AS count
        FROM pilo_issues pi
        CROSS JOIN LATERAL jsonb_array_elements(pi.assignees) AS assignee
        WHERE pi.board_id = $1::bigint
          AND COALESCE(assignee->>'login', '') <> ''
        GROUP BY 1, 2
        ORDER BY login ASC
      `,
      [boardId]
    );
  }

  async listBoardFilterLabels(
    boardId: string
  ): Promise<BoardFilterLabelOptionRow[]> {
    return this.database.query<BoardFilterLabelOptionRow>(
      `
        SELECT
          label->>'name' AS name,
          label->>'color' AS color,
          COUNT(*)::int AS count
        FROM pilo_issues pi
        CROSS JOIN LATERAL jsonb_array_elements(pi.labels) AS label
        WHERE pi.board_id = $1::bigint
          AND COALESCE(label->>'name', '') <> ''
        GROUP BY 1, 2
        ORDER BY name ASC
      `,
      [boardId]
    );
  }

  private buildBoardFilters(input: BoardFilterInput): {
    whereSql: string;
    values: unknown[];
  } {
    const values: unknown[] = [input.workspaceId];
    const filters = ["b.workspace_id = $1"];

    if (input.repositoryId) {
      values.push(input.repositoryId);
      filters.push(`b.repository_id = $${values.length}`);
    }

    if (input.projectV2Id) {
      values.push(input.projectV2Id);
      filters.push(`b.project_v2_id = $${values.length}`);
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private buildIssueFilters(input: BoardIssueFilterInput): {
    whereSql: string;
    values: unknown[];
  } {
    const values: unknown[] = [input.boardId];
    const filters = ["pi.board_id = $1::bigint"];

    if (input.columnId) {
      values.push(input.columnId);
      filters.push(`pi.column_id = $${values.length}::bigint`);
    }

    if (input.state) {
      values.push(input.state);
      filters.push(`pi.state = $${values.length}`);
    }

    if (input.search) {
      values.push(`%${input.search}%`);
      filters.push(`pi.title ILIKE $${values.length}`);
    }

    if (input.label) {
      values.push(input.label);
      filters.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(pi.labels) AS label
          WHERE label->>'name' = $${values.length}
        )
      `);
    }

    if (input.assignee) {
      values.push(input.assignee);
      filters.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(pi.assignees) AS assignee
          WHERE assignee->>'login' = $${values.length}
        )
      `);
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private boardFieldsSql(): string {
    return `
      b.id::text AS id,
      b.workspace_id,
      b.repository_id,
      b.project_v2_id,
      b.status_field_id,
      b.name,
      b.last_sync_status,
      b.last_synced_at,
      b.created_at,
      b.updated_at,
      gr.full_name AS repository_full_name,
      gr.html_url AS repository_html_url,
      gp.github_project_node_id,
      gp.project_number,
      gp.title AS project_title,
      gp.url AS project_url,
      sf.github_field_node_id,
      sf.field_name AS status_field_name
    `;
  }

  private boardFromSql(): string {
    return `
      FROM boards b
      JOIN github_repositories gr
        ON gr.id = b.repository_id
       AND gr.workspace_id = b.workspace_id
      JOIN github_projects_v2 gp
        ON gp.id = b.project_v2_id
       AND gp.workspace_id = b.workspace_id
      LEFT JOIN github_project_v2_fields sf
        ON sf.id = b.status_field_id
       AND sf.project_v2_id = b.project_v2_id
    `;
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }
}
