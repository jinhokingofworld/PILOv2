import type { DatabaseTransaction } from "../../../database/database.service";

export interface ActiveBoardSourceRow {
  board_id: string | number;
  workspace_id: string;
  repository_id: string;
  repository_full_name: string;
  repository_html_url: string;
  project_v2_id: string;
  github_project_node_id: string;
  project_number: string | number;
  project_title: string;
  project_url: string;
  updated_by_user_id: string | null;
  updated_at: Date | string;
}

export class ActiveBoardSourceQueries {
  async lockWorkspaceTransition(
    connection: DatabaseTransaction,
    workspaceId: string
  ): Promise<void> {
    await connection.execute(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [workspaceId]
    );
  }

  async findByWorkspace(
    connection: DatabaseTransaction,
    workspaceId: string
  ): Promise<ActiveBoardSourceRow | null> {
    return connection.queryOne<ActiveBoardSourceRow>(`${this.selectSourceSql()} WHERE settings.workspace_id = $1`, [workspaceId]);
  }

  async upsert(
    connection: DatabaseTransaction,
    workspaceId: string,
    boardId: string,
    updatedByUserId: string
  ): Promise<ActiveBoardSourceRow | null> {
    await connection.execute(
      `
        INSERT INTO workspace_board_settings (
          workspace_id,
          active_board_id,
          updated_by_user_id
        ) VALUES ($1::uuid, $2::bigint, $3::uuid)
        ON CONFLICT (workspace_id) DO UPDATE
          SET active_board_id = EXCLUDED.active_board_id,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
      `,
      [workspaceId, boardId, updatedByUserId]
    );

    return this.findByWorkspace(connection, workspaceId);
  }

  private selectSourceSql() {
    return `
      SELECT
        settings.active_board_id::text AS board_id,
        settings.workspace_id,
        boards.repository_id,
        repositories.full_name AS repository_full_name,
        repositories.html_url AS repository_html_url,
        boards.project_v2_id,
        projects.github_project_node_id,
        projects.project_number,
        projects.title AS project_title,
        projects.url AS project_url,
        settings.updated_by_user_id,
        settings.updated_at
      FROM workspace_board_settings settings
      JOIN boards
        ON boards.id = settings.active_board_id
       AND boards.workspace_id = settings.workspace_id
      JOIN github_repositories repositories
        ON repositories.id = boards.repository_id
       AND repositories.workspace_id = settings.workspace_id
      JOIN github_projects_v2 projects
        ON projects.id = boards.project_v2_id
       AND projects.workspace_id = settings.workspace_id
    `;
  }
}
