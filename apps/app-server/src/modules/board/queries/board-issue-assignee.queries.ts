import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../../database/database.service";

export interface BoardIssueAssigneeTargetRow extends QueryResultRow {
  repository_owner_login: string | null;
  repository_name: string | null;
}

@Injectable()
export class BoardIssueAssigneeQueries {
  constructor(private readonly database: DatabaseService) {}

  async findAssigneeTarget(
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueAssigneeTargetRow | null> {
    return this.database.queryOne<BoardIssueAssigneeTargetRow>(
      `
        SELECT
          gr.owner_login AS repository_owner_login,
          gr.name AS repository_name
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
}
