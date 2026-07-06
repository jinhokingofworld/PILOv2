import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import { WorkspaceService } from "../workspace/workspace.service";
import type { ListBoardsQuery } from "./dto";
import { BoardReadQueries } from "./queries/board-read.queries";
import type {
  BoardColumnRow,
  BoardDetailRow,
  BoardRow
} from "./queries/board-read.queries";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardPaginatedPayload,
  BoardPayload
} from "./types";

interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_LIMIT = 100;

@Injectable()
export class BoardReadService {
  constructor(
    private readonly boardReadQueries: BoardReadQueries,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listBoards(
    currentUserId: string,
    workspaceId: string,
    query: ListBoardsQuery
  ): Promise<BoardPaginatedPayload<BoardPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pagination = this.normalizePagination(query, 20);
    const repositoryId = this.readOptionalString(query.repositoryId, "repositoryId");
    const projectV2Id = this.readOptionalString(query.projectV2Id, "projectV2Id");
    const filters = { workspaceId, repositoryId, projectV2Id };
    const count = await this.boardReadQueries.countBoards(filters);
    const rows = await this.boardReadQueries.listBoards(
      filters,
      pagination.limit,
      pagination.offset
    );

    return {
      data: rows.map((row) => this.mapBoard(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getBoard(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    const board = await this.boardReadQueries.findBoardDetail(
      workspaceId,
      normalizedBoardId
    );

    if (!board) {
      throw notFound("Board not found");
    }

    return this.mapBoardDetail(board);
  }

  async listBoardColumns(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardColumnPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    await this.assertBoardExists(workspaceId, normalizedBoardId);
    const rows = await this.boardReadQueries.listBoardColumns(normalizedBoardId);

    return rows.map((row) => this.mapBoardColumn(row));
  }

  private async assertBoardExists(
    workspaceId: string,
    boardId: string
  ): Promise<void> {
    const board = await this.boardReadQueries.findBoardId(workspaceId, boardId);

    if (!board) {
      throw notFound("Board not found");
    }
  }

  private normalizePagination(
    input: ListBoardsQuery,
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

  private readBoardId(value: string): string {
    return String(this.readPositiveInteger(value, "boardId", 0));
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

  private readOptionalString(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
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

  private mapBoardDetail(row: BoardDetailRow): BoardDetailPayload {
    const board = this.mapBoard(row);

    return {
      id: board.id,
      workspaceId: board.workspaceId,
      name: board.name,
      repository: board.repository,
      project: board.project,
      statusField: board.statusField,
      summary: {
        columnsCount: this.toInteger(row.columns_count, "Invalid board column count"),
        totalCards: this.toInteger(row.total_cards, "Invalid board card count"),
        openCards: this.toInteger(row.open_cards, "Invalid open board card count"),
        closedCards: this.toInteger(
          row.closed_cards,
          "Invalid closed board card count"
        )
      },
      sync: {
        status: board.syncStatus,
        lastSyncedAt: board.lastSyncedAt
      },
      createdAt: board.createdAt,
      updatedAt: board.updatedAt
    };
  }

  private mapBoardColumn(row: BoardColumnRow): BoardColumnPayload {
    return {
      id: String(row.id),
      boardId: String(row.board_id),
      statusOptionId: row.status_option_id,
      githubStatusOptionId: row.status_option_github_id,
      name: row.name,
      normalizedName: row.normalized_name,
      position: this.toInteger(row.position, "Invalid board column position"),
      color: row.color,
      issueCount: this.toInteger(row.issue_count, "Invalid board column issue count")
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
