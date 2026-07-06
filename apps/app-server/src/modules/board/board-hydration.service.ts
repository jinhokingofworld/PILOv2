import { HttpStatus, Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import type { CreateBoardRequest } from "./dto";
import type { BoardPayload, BoardSyncStatus, CreateBoardResult } from "./types";

interface HydrationSourceRow extends QueryResultRow {
  repository_id: string;
  project_v2_id: string;
}

interface ExistingBoardRow extends QueryResultRow {
  id: string | number;
}

interface HydratedBoardRow extends QueryResultRow {
  board_id: string | number | null;
}

interface BoardRow extends QueryResultRow {
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

interface NormalizedCreateBoardInput {
  repositoryId: string;
  projectV2Id: string;
}

@Injectable()
export class BoardHydrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async createBoard(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<CreateBoardResult> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeCreateInput(body);
    await this.assertHydrationSource(
      workspaceId,
      input.repositoryId,
      input.projectV2Id
    );
    const existingBoard = await this.findExistingBoard(
      workspaceId,
      input.projectV2Id,
      input.repositoryId
    );
    const boardId = await this.hydrateBoard(input.projectV2Id, input.repositoryId);
    const board = await this.getBoard(workspaceId, boardId);

    return {
      board,
      statusCode: existingBoard ? HttpStatus.OK : HttpStatus.CREATED
    };
  }

  private normalizeCreateInput(body: unknown): NormalizedCreateBoardInput {
    const draft = this.readBody(body);

    return {
      repositoryId: this.requireString(draft.repositoryId, "repositoryId"),
      projectV2Id: this.requireString(draft.projectV2Id, "projectV2Id")
    };
  }

  private readBody(body: unknown): CreateBoardRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    return body as CreateBoardRequest;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw badRequest(`${field} is required`);
    }

    const normalized = value.trim();
    if (!normalized) {
      throw badRequest(`${field} is required`);
    }

    return normalized;
  }

  private async assertHydrationSource(
    workspaceId: string,
    repositoryId: string,
    projectV2Id: string
  ): Promise<void> {
    const source = await this.database.queryOne<HydrationSourceRow>(
      `
        SELECT
          gr.id AS repository_id,
          gp.id AS project_v2_id
        FROM github_repositories gr
        JOIN github_project_v2_repositories gpr
          ON gpr.repository_id = gr.id
        JOIN github_projects_v2 gp
          ON gp.id = gpr.project_v2_id
         AND gp.workspace_id = gr.workspace_id
        WHERE gr.workspace_id = $1
          AND gr.id = $2
          AND gp.id = $3
      `,
      [workspaceId, repositoryId, projectV2Id]
    );

    if (!source) {
      throw notFound("GitHub repository or ProjectV2 link not found");
    }
  }

  private async findExistingBoard(
    workspaceId: string,
    projectV2Id: string,
    repositoryId: string
  ): Promise<ExistingBoardRow | null> {
    return this.database.queryOne<ExistingBoardRow>(
      `
        SELECT id
        FROM boards
        WHERE workspace_id = $1
          AND project_v2_id = $2
          AND repository_id = $3
      `,
      [workspaceId, projectV2Id, repositoryId]
    );
  }

  private async hydrateBoard(
    projectV2Id: string,
    repositoryId: string
  ): Promise<string> {
    const hydrated = await this.database.queryOne<HydratedBoardRow>(
      `
        SELECT hydrate_pilo_board_from_github($1::uuid, $2::uuid)::text AS board_id
      `,
      [projectV2Id, repositoryId]
    );

    if (!hydrated?.board_id) {
      throw badRequest("Board could not be hydrated");
    }

    return String(hydrated.board_id);
  }

  private async getBoard(workspaceId: string, boardId: string): Promise<BoardPayload> {
    const board = await this.database.queryOne<BoardRow>(
      `
        SELECT
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
        WHERE b.workspace_id = $1
          AND b.id = $2::bigint
      `,
      [workspaceId, boardId]
    );

    if (!board) {
      throw notFound("Board not found");
    }

    return this.mapBoard(board);
  }

  private mapBoard(row: BoardRow): BoardPayload {
    return {
      id: String(row.id),
      workspaceId: row.workspace_id,
      name: row.name,
      repository: {
        id: row.repository_id,
        fullName: row.repository_full_name,
        htmlUrl: row.repository_html_url
      },
      project: {
        id: row.project_v2_id,
        githubProjectNodeId: row.github_project_node_id,
        projectNumber: this.toInteger(
          row.project_number,
          "Invalid GitHub ProjectV2 number"
        ),
        title: row.project_title,
        url: row.project_url
      },
      statusField:
        row.status_field_id && row.github_field_node_id && row.status_field_name
          ? {
              id: row.status_field_id,
              githubFieldNodeId: row.github_field_node_id,
              name: row.status_field_name
            }
          : null,
      syncStatus: row.last_sync_status,
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at)
    };
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return this.toIsoString(value);
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
