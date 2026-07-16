import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../../database/database.service";
import { badRequest } from "../../../common/api-error";
import { serializeGithubJsonb } from "../../github-integration/github-jsonb";
import type { GithubIssueApiItem } from "../../github-integration/github-app.client";
import type { BoardIssueState } from "../types";
import type { BoardIssueCreateTarget } from "../board-issue-create-target";

export interface BoardIssueCreateTargetRow
  extends QueryResultRow,
    BoardIssueCreateTarget {
  board_id: string;
  board_name: string;
  status_field_name: string | null;
  target_column_id: string;
  target_column_name: string;
  target_status_name: string | null;
  target_status_normalized_name: string | null;
}

export interface BoardIssueCreateIssueRow extends QueryResultRow {
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

export interface UpsertCreatedGithubIssueInput {
  issue: GithubIssueApiItem;
  repositoryId: string;
  workspaceId: string;
}

export interface UpsertCreatedProjectItemInput {
  githubIssueId: string;
  itemNodeId: string;
  projectV2Id: string;
  statusFieldId: string;
  statusOptionGithubId: string | null;
  statusOptionId: string | null;
  statusName: string | null;
  statusNormalizedName: string | null;
  workspaceId: string;
}

export interface UpsertProjectItemStatusFieldValueInput {
  projectItemId: string;
  statusFieldId: string;
  statusFieldName: string;
  statusOptionGithubId: string;
  statusName: string;
}

export interface InsertPiloIssueInput {
  boardId: string;
  columnId: string;
  githubIssueId: string;
  issue: GithubIssueApiItem;
  projectItemId: string;
  repositoryId: string;
  workspaceId: string;
}

@Injectable()
export class BoardIssueCreateQueries {
  constructor(private readonly database: DatabaseService) {}

  async transaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    return this.database.transaction(callback);
  }

  async findIssueCreateTarget(
    workspaceId: string,
    boardId: string,
    columnId: string
  ): Promise<BoardIssueCreateTargetRow | null> {
    return this.database.queryOne<BoardIssueCreateTargetRow>(
      this.issueCreateTargetQuery(`
        target_col.id = $3::bigint
        AND b.workspace_id = $1
        AND b.id = $2::bigint
      `),
      [workspaceId, boardId, columnId]
    );
  }

  async listIssueCreateTargets(
    workspaceId: string
  ): Promise<BoardIssueCreateTargetRow[]> {
    return this.database.query<BoardIssueCreateTargetRow>(
      `${this.issueCreateTargetQuery("b.workspace_id = $1")}
       ORDER BY b.updated_at DESC, b.id ASC, target_col.position ASC, target_col.id ASC`,
      [workspaceId]
    );
  }

  private issueCreateTargetQuery(whereSql: string): string {
    return `
      SELECT
        b.id::text AS board_id,
        b.name AS board_name,
        b.repository_id,
        gr.installation_id AS repository_installation_id,
        gr.owner_login AS repository_owner_login,
        gr.name AS repository_name,
        b.project_v2_id,
        gp.installation_id AS project_installation_id,
        gp.github_project_node_id,
        b.status_field_id,
        sf.github_field_node_id,
        sf.field_name AS status_field_name,
        target_col.id::text AS target_column_id,
        target_col.name AS target_column_name,
        target_col.status_option_id::text AS target_status_option_id,
        target_col.status_option_github_id AS target_status_option_github_id,
        target_col.name AS target_status_name,
        target_col.normalized_name AS target_status_normalized_name
      FROM boards b
      JOIN board_columns target_col
        ON target_col.board_id = b.id
      JOIN github_repositories gr
        ON gr.id = b.repository_id
       AND gr.workspace_id = b.workspace_id
      LEFT JOIN github_projects_v2 gp
        ON gp.id = b.project_v2_id
       AND gp.workspace_id = b.workspace_id
      LEFT JOIN github_project_v2_fields sf
        ON sf.id = b.status_field_id
       AND sf.project_v2_id = b.project_v2_id
      WHERE ${whereSql}
    `;
  }

  async upsertGithubIssueCache(
    transaction: DatabaseTransaction,
    input: UpsertCreatedGithubIssueInput
  ): Promise<string> {
    const row = await transaction.queryOne<{ id: string }>(
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
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::github_issue_state,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          $14::jsonb,
          $15::jsonb,
          $16::timestamptz,
          $17::timestamptz,
          $18::timestamptz,
          now(),
          $19::jsonb
        )
        ON CONFLICT (workspace_id, github_issue_id)
        DO UPDATE SET
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
        RETURNING id
      `,
      [
        input.workspaceId,
        input.repositoryId,
        input.issue.id,
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

    if (!row) {
      throw badRequest("GitHub issue cache could not be updated");
    }

    return row.id;
  }

  async upsertProjectItemCache(
    transaction: DatabaseTransaction,
    input: UpsertCreatedProjectItemInput
  ): Promise<string> {
    const row = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO github_project_v2_items (
          workspace_id,
          project_v2_id,
          github_project_item_node_id,
          content_type,
          issue_id,
          is_archived,
          status_field_id,
          status_option_id,
          status_option_github_id,
          status_name,
          status_normalized_name,
          last_synced_at,
          raw
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::text,
          'ISSUE',
          $4::uuid,
          false,
          $5::uuid,
          $6::uuid,
          $7::text,
          $8::text,
          $9::text,
          now(),
          jsonb_build_object(
            'id',
            $3::text,
            'contentType',
            'ISSUE',
            'statusOptionId',
            $7::text,
            'statusName',
            $8::text
          )
        )
        ON CONFLICT (project_v2_id, github_project_item_node_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          issue_id = EXCLUDED.issue_id,
          content_type = EXCLUDED.content_type,
          is_archived = EXCLUDED.is_archived,
          status_field_id = EXCLUDED.status_field_id,
          status_option_id = EXCLUDED.status_option_id,
          status_option_github_id = EXCLUDED.status_option_github_id,
          status_name = EXCLUDED.status_name,
          status_normalized_name = EXCLUDED.status_normalized_name,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id
      `,
      [
        input.workspaceId,
        input.projectV2Id,
        input.itemNodeId,
        input.githubIssueId,
        input.statusFieldId,
        input.statusOptionId,
        input.statusOptionGithubId,
        input.statusName,
        input.statusNormalizedName
      ]
    );

    if (!row) {
      throw badRequest("GitHub ProjectV2 item cache could not be updated");
    }

    return row.id;
  }

  async upsertProjectItemStatusFieldValue(
    transaction: DatabaseTransaction,
    input: UpsertProjectItemStatusFieldValueInput
  ): Promise<void> {
    await transaction.execute(
      `
        INSERT INTO github_project_v2_item_field_values (
          project_item_id,
          field_id,
          field_name,
          field_data_type,
          single_select_option_id,
          single_select_name,
          raw,
          github_updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::text,
          'SINGLE_SELECT',
          $4::text,
          $5::text,
          jsonb_build_object(
            'fieldName',
            $3::text,
            'singleSelectOptionId',
            $4::text,
            'singleSelectName',
            $5::text
          ),
          now()
        )
        ON CONFLICT (project_item_id, field_name)
        DO UPDATE SET
          field_id = EXCLUDED.field_id,
          field_data_type = EXCLUDED.field_data_type,
          single_select_option_id = EXCLUDED.single_select_option_id,
          single_select_name = EXCLUDED.single_select_name,
          raw = EXCLUDED.raw,
          github_updated_at = now(),
          updated_at = now()
      `,
      [
        input.projectItemId,
        input.statusFieldId,
        input.statusFieldName,
        input.statusOptionGithubId,
        input.statusName
      ]
    );
  }

  async clearProjectItemStatusFieldValue(
    transaction: DatabaseTransaction,
    projectItemId: string,
    statusFieldId: string
  ): Promise<void> {
    await transaction.execute(
      `
        DELETE FROM github_project_v2_item_field_values
        WHERE project_item_id = $1::uuid
          AND field_id = $2::uuid
      `,
      [projectItemId, statusFieldId]
    );
  }

  async insertPiloIssueCache(
    transaction: DatabaseTransaction,
    input: InsertPiloIssueInput
  ): Promise<string> {
    const row = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO pilo_issues (
          board_id,
          column_id,
          workspace_id,
          repository_id,
          github_issue_id,
          project_item_id,
          github_issue_node_id,
          github_project_item_node_id,
          github_issue_number,
          issue_number,
          title,
          body,
          html_url,
          state,
          labels,
          assignees,
          milestone,
          position,
          github_updated_at,
          last_synced_at,
          raw
        )
        VALUES (
          $1::bigint,
          $2::bigint,
          $3,
          $4::uuid,
          $5::uuid,
          $6::uuid,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::github_issue_state,
          $15::jsonb,
          $16::jsonb,
          $17::jsonb,
          COALESCE(
            (
              SELECT MAX(existing.position) + 1
              FROM pilo_issues existing
              WHERE existing.board_id = $1::bigint
                AND existing.column_id = $2::bigint
            ),
            0
          ),
          $18::timestamptz,
          now(),
          $19::jsonb
        )
        ON CONFLICT (board_id, github_issue_id)
        DO UPDATE SET
          column_id = EXCLUDED.column_id,
          repository_id = EXCLUDED.repository_id,
          project_item_id = EXCLUDED.project_item_id,
          github_issue_node_id = EXCLUDED.github_issue_node_id,
          github_project_item_node_id = EXCLUDED.github_project_item_node_id,
          github_issue_number = EXCLUDED.github_issue_number,
          issue_number = EXCLUDED.issue_number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          html_url = EXCLUDED.html_url,
          state = EXCLUDED.state,
          labels = EXCLUDED.labels,
          assignees = EXCLUDED.assignees,
          milestone = EXCLUDED.milestone,
          position = EXCLUDED.position,
          github_updated_at = EXCLUDED.github_updated_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id
      `,
      [
        input.boardId,
        input.columnId,
        input.workspaceId,
        input.repositoryId,
        input.githubIssueId,
        input.projectItemId,
        input.issue.node_id,
        null,
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

    if (!row) {
      throw badRequest("Board issue cache could not be updated");
    }

    return row.id;
  }

  async updatePiloIssueProjectItemNodeId(
    transaction: DatabaseTransaction,
    boardId: string,
    issueId: string,
    itemNodeId: string
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE pilo_issues
        SET
          github_project_item_node_id = $3,
          updated_at = now()
        WHERE board_id = $1::bigint
          AND id = $2::bigint
      `,
      [boardId, issueId, itemNodeId]
    );
  }

  async findCreatedIssueCard(
    transaction: DatabaseTransaction,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueCreateIssueRow | null> {
    return transaction.queryOne<BoardIssueCreateIssueRow>(
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
        WHERE pi.workspace_id = $1
          AND pi.board_id = $2::bigint
          AND pi.id = $3::bigint
      `,
      [workspaceId, boardId, issueId]
    );
  }
}
