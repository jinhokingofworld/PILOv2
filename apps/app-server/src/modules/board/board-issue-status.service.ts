import { Injectable } from "@nestjs/common";
import { ApiError, badRequest, notFound } from "../../common/api-error";
import type { DatabaseTransaction } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GithubProjectV2WriteService } from "../github-integration/github-project-v2-write.service";
import { boardBadGateway, boardConflict } from "./board-api-error";
import type { UpdateBoardIssueStatusRequest } from "./dto";
import {
  BoardIssueStatusQueries,
  type BoardIssueStatusIssueRow,
  type BoardIssueStatusTargetRow
} from "./queries/board-issue-status.queries";
import type { BoardIssueCardPayload } from "./types";

interface NormalizedStatusInput {
  columnId: string;
  previousColumnId: string | null;
}

type GithubStatusTarget = BoardIssueStatusTargetRow & {
  github_project_node_id: string;
  github_project_item_node_id: string;
  github_field_node_id: string;
  project_item_id: string;
  status_field_id: string;
};

export interface UpdateBoardIssueStatusResult {
  issue: BoardIssueCardPayload;
  previousColumnId: string;
}

@Injectable()
export class BoardIssueStatusService {
  constructor(
    private readonly boardIssueStatusQueries: BoardIssueStatusQueries,
    private readonly workspaceService: WorkspaceService,
    private readonly githubProjectV2WriteService: GithubProjectV2WriteService
  ) {}

  async updateBoardIssueStatus(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string,
    body: unknown
  ): Promise<UpdateBoardIssueStatusResult> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    const normalizedIssueId = this.readIssueId(issueId);
    const input = this.normalizeStatusInput(body);
    const previousColumnId = await this.boardIssueStatusQueries.transaction(
      async (transaction) => {
        const target = await this.boardIssueStatusQueries.findStatusMoveTarget(
          transaction,
          workspaceId,
          normalizedBoardId,
          normalizedIssueId,
          input.columnId
        );

        if (!target) {
          throw notFound("Board issue or target column not found");
        }

        if (input.previousColumnId && input.previousColumnId !== target.column_id) {
          throw boardConflict("Board issue column changed before status update");
        }

        this.assertGithubStatusTarget(target);
        await this.updateGithubStatus(currentUserId, target);
        await this.updateStatusCache(
          transaction,
          target,
          normalizedBoardId,
          normalizedIssueId,
          input.columnId
        );

        return target.column_id;
      }
    );

    const issue = await this.boardIssueStatusQueries.findBoardIssueCard(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );

    if (!issue) {
      throw notFound("Board issue not found");
    }

    return {
      issue: this.mapBoardIssue(issue),
      previousColumnId
    };
  }

  private normalizeStatusInput(body: unknown): NormalizedStatusInput {
    const draft = this.readBody(body);

    return {
      columnId: this.requirePositiveInteger(draft.columnId, "columnId"),
      previousColumnId: this.readOptionalPositiveInteger(
        draft.previousColumnId,
        "previousColumnId"
      )
    };
  }

  private readBody(body: unknown): UpdateBoardIssueStatusRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    return body as UpdateBoardIssueStatusRequest;
  }

  private readBoardId(value: string): string {
    return this.requirePositiveInteger(value, "boardId");
  }

  private readIssueId(value: string): string {
    return this.requirePositiveInteger(value, "issueId");
  }

  private requirePositiveInteger(value: unknown, field: string): string {
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

    return String(parsed);
  }

  private readOptionalPositiveInteger(
    value: unknown,
    field: string
  ): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.requirePositiveInteger(value, field);
  }

  private assertGithubStatusTarget(
    target: BoardIssueStatusTargetRow
  ): asserts target is GithubStatusTarget {
    if (
      !target.github_project_node_id ||
      !target.github_project_item_node_id ||
      !target.github_field_node_id ||
      !target.project_item_id ||
      !target.status_field_id
    ) {
      throw badRequest("Board issue is missing GitHub ProjectV2 status metadata");
    }

    if (target.target_status_option_id && !target.target_status_option_github_id) {
      throw badRequest("Board column is missing GitHub Status option metadata");
    }
  }

  private async updateGithubStatus(
    currentUserId: string,
    target: GithubStatusTarget
  ): Promise<void> {
    try {
      await this.githubProjectV2WriteService.updateProjectV2ItemStatus({
        currentUserId,
        projectNodeId: target.github_project_node_id,
        itemNodeId: target.github_project_item_node_id,
        fieldNodeId: target.github_field_node_id,
        singleSelectOptionId: target.target_status_option_github_id
      });
    } catch (error) {
      if (this.isGithubConnectionError(error)) {
        throw error;
      }

      throw boardBadGateway("GitHub ProjectV2 status update failed");
    }
  }

  private async updateStatusCache(
    transaction: DatabaseTransaction,
    target: GithubStatusTarget,
    boardId: string,
    issueId: string,
    columnId: string
  ): Promise<void> {
    await this.boardIssueStatusQueries.updateProjectItemStatus(transaction, {
      projectItemId: target.project_item_id,
      statusFieldId: target.status_field_id,
      statusOptionId: target.target_status_option_id,
      statusOptionGithubId: target.target_status_option_github_id,
      statusName: target.target_status_name,
      statusNormalizedName: target.target_status_normalized_name
    });

    if (target.target_status_option_github_id && target.target_status_name) {
      await this.boardIssueStatusQueries.upsertProjectItemStatusFieldValue(
        transaction,
        {
          projectItemId: target.project_item_id,
          statusFieldId: target.status_field_id,
          statusFieldName: target.status_field_name ?? "Status",
          statusOptionGithubId: target.target_status_option_github_id,
          statusName: target.target_status_name
        }
      );
    } else {
      await this.boardIssueStatusQueries.clearProjectItemStatusFieldValue(
        transaction,
        target.project_item_id,
        target.status_field_id
      );
    }

    await this.boardIssueStatusQueries.updatePiloIssueColumn(
      transaction,
      boardId,
      issueId,
      columnId
    );
  }

  private isGithubConnectionError(error: unknown): boolean {
    if (!(error instanceof ApiError)) {
      return false;
    }

    const response = error.getResponse();
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      !("error" in response)
    ) {
      return false;
    }

    const apiError = (response as { error?: { message?: unknown } }).error;
    return (
      typeof apiError?.message === "string" &&
      (apiError.message.includes("GitHub OAuth connection") ||
        apiError.message.includes("GitHub ProjectV2 OAuth") ||
        apiError.message.includes("Current user not found"))
    );
  }

  private mapBoardIssue(row: BoardIssueStatusIssueRow): BoardIssueCardPayload {
    return {
      id: String(row.id),
      boardId: String(row.board_id),
      columnId: String(row.column_id),
      repositoryId: row.repository_id,
      githubIssueId: row.github_issue_id,
      projectItemId: row.project_item_id,
      githubIssueNodeId: row.github_issue_node_id,
      githubProjectItemNodeId: row.github_project_item_node_id,
      githubIssueNumber: this.toNullableInteger(
        row.github_issue_number,
        "Invalid GitHub issue number"
      ),
      issueNumber: row.issue_number,
      title: row.title,
      htmlUrl: row.html_url,
      state: row.state,
      labels: this.toArray(row.labels),
      assignees: this.toArray(row.assignees),
      position: this.toInteger(row.position, "Invalid board issue position"),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at),
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

  private toNullableInteger(
    value: string | number | null,
    message: string
  ): number | null {
    if (value === null) {
      return null;
    }

    return this.toInteger(value, message);
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
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
