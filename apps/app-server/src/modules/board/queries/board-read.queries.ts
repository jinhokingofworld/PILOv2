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
      filters.push(
        `(pi.title ILIKE $${values.length} OR COALESCE(pi.body, '') ILIKE $${values.length})`
      );
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
