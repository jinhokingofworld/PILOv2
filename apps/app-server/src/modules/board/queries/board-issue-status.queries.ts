import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../../database/database.service";
import type { BoardIssueState } from "../types";

export interface BoardIssueStatusTargetRow extends QueryResultRow {
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
  project_v2_id: string | null;
  github_project_node_id: string | null;
  status_field_id: string | null;
  github_field_node_id: string | null;
  status_field_name: string | null;
  target_column_id: string;
  target_status_option_id: string | null;
  target_status_option_github_id: string | null;
  target_status_name: string | null;
  target_status_normalized_name: string | null;
}

export interface BoardIssueStatusIssueRow extends QueryResultRow {
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

export interface UpdateProjectItemStatusInput {
  projectItemId: string;
  statusFieldId: string;
  statusOptionId: string | null;
  statusOptionGithubId: string | null;
  statusName: string | null;
  statusNormalizedName: string | null;
}

export interface UpdateProjectItemStatusFieldValueInput {
  projectItemId: string;
  statusFieldId: string;
  statusFieldName: string;
  statusOptionGithubId: string;
  statusName: string;
}

@Injectable()
export class BoardIssueStatusQueries {
  constructor(private readonly database: DatabaseService) {}

  async transaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    return this.database.transaction(callback);
  }

  async findStatusMoveTarget(
    workspaceId: string,
    boardId: string,
    issueId: string,
    targetColumnId: string
  ): Promise<BoardIssueStatusTargetRow | null> {
    return this.database.queryOne<BoardIssueStatusTargetRow>(
      `
        SELECT
          pi.id::text AS id,
          pi.board_id::text AS board_id,
          pi.column_id::text AS column_id,
          pi.repository_id,
          pi.github_issue_id,
          pi.project_item_id,
          pi.github_issue_node_id,
          COALESCE(
            pi.github_project_item_node_id,
            gpi.github_project_item_node_id
          ) AS github_project_item_node_id,
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
          pi.updated_at,
          b.project_v2_id,
          gp.github_project_node_id,
          b.status_field_id,
          sf.github_field_node_id,
          sf.field_name AS status_field_name,
          target_col.id::text AS target_column_id,
          target_col.status_option_id::text AS target_status_option_id,
          target_col.status_option_github_id AS target_status_option_github_id,
          target_col.name AS target_status_name,
          target_col.normalized_name AS target_status_normalized_name
        FROM pilo_issues pi
        JOIN boards b
          ON b.id = pi.board_id
         AND b.workspace_id = pi.workspace_id
        JOIN board_columns target_col
          ON target_col.id = $4::bigint
         AND target_col.board_id = b.id
        LEFT JOIN github_projects_v2 gp
          ON gp.id = b.project_v2_id
         AND gp.workspace_id = b.workspace_id
        LEFT JOIN github_project_v2_fields sf
          ON sf.id = b.status_field_id
         AND sf.project_v2_id = b.project_v2_id
        LEFT JOIN github_project_v2_items gpi
          ON gpi.id = pi.project_item_id
         AND gpi.workspace_id = pi.workspace_id
        WHERE pi.workspace_id = $1
          AND pi.board_id = $2::bigint
          AND pi.id = $3::bigint
      `,
      [workspaceId, boardId, issueId, targetColumnId]
    );
  }

  async updateProjectItemStatus(
    transaction: DatabaseTransaction,
    input: UpdateProjectItemStatusInput
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE github_project_v2_items
        SET
          status_field_id = $2::uuid,
          status_option_id = $3::uuid,
          status_option_github_id = $4,
          status_name = $5,
          status_normalized_name = $6,
          last_synced_at = now(),
          updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        input.projectItemId,
        input.statusFieldId,
        input.statusOptionId,
        input.statusOptionGithubId,
        input.statusName,
        input.statusNormalizedName
      ]
    );
  }

  async upsertProjectItemStatusFieldValue(
    transaction: DatabaseTransaction,
    input: UpdateProjectItemStatusFieldValueInput
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

  async updatePiloIssueColumn(
    transaction: DatabaseTransaction,
    boardId: string,
    issueId: string,
    columnId: string
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE pilo_issues
        SET
          column_id = $3::bigint,
          position = CASE
            WHEN column_id = $3::bigint THEN position
            ELSE COALESCE(
              (
                SELECT MAX(existing.position) + 1
                FROM pilo_issues existing
                WHERE existing.board_id = $1::bigint
                  AND existing.column_id = $3::bigint
                  AND existing.id <> $2::bigint
              ),
              0
            )
          END,
          last_synced_at = now(),
          updated_at = now()
        WHERE board_id = $1::bigint
          AND id = $2::bigint
      `,
      [boardId, issueId, columnId]
    );
  }

  async findBoardIssueCard(
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueStatusIssueRow | null> {
    return this.database.queryOne<BoardIssueStatusIssueRow>(
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
