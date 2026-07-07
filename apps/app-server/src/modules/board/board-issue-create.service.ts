import { Injectable } from "@nestjs/common";
import { ApiError, badRequest, notFound } from "../../common/api-error";
import { GithubIssueWriteService } from "../github-integration/github-issue-write.service";
import { GithubProjectV2WriteService } from "../github-integration/github-project-v2-write.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { boardBadGateway } from "./board-api-error";
import type { CreateBoardIssueRequest } from "./dto";
import {
  BoardIssueCreateQueries,
  type BoardIssueCreateIssueRow,
  type BoardIssueCreateTargetRow
} from "./queries/board-issue-create.queries";
import type { BoardIssueCardPayload } from "./types";

interface NormalizedIssueCreateInput {
  title: string;
  body?: string;
  columnId: string;
}

export interface CreateBoardIssueResult {
  issue: BoardIssueCardPayload;
}

@Injectable()
export class BoardIssueCreateService {
  constructor(
    private readonly boardIssueCreateQueries: BoardIssueCreateQueries,
    private readonly workspaceService: WorkspaceService,
    private readonly githubIssueWriteService: GithubIssueWriteService,
    private readonly githubProjectV2WriteService: GithubProjectV2WriteService
  ) {}

  async createBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    body: unknown
  ): Promise<CreateBoardIssueResult> {
    const normalizedBoardId = this.readBoardId(boardId);
    const input = this.normalizeIssueCreateInput(body);

    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const target = await this.boardIssueCreateQueries.findIssueCreateTarget(
      workspaceId,
      normalizedBoardId,
      input.columnId
    );

    if (!target) {
      throw notFound("Board or target column not found");
    }

    this.assertGithubCreateTarget(target);

    const githubIssue = await this.createGithubIssue(currentUserId, target, input);
    const projectItem = await this.addProjectItem(currentUserId, target, githubIssue.node_id);
    await this.updateProjectItemStatus(currentUserId, target, projectItem.itemNodeId);

    let createdIssueId = "";
    await this.boardIssueCreateQueries.transaction(async (transaction) => {
      const githubIssueId = await this.boardIssueCreateQueries.upsertGithubIssueCache(
        transaction,
        {
          issue: githubIssue,
          repositoryId: target.repository_id,
          workspaceId
        }
      );

      const projectItemId =
        await this.boardIssueCreateQueries.upsertProjectItemCache(transaction, {
          githubIssueId,
          itemNodeId: projectItem.itemNodeId,
          projectV2Id: target.project_v2_id,
          statusFieldId: target.status_field_id,
          statusName: target.target_status_name,
          statusNormalizedName: target.target_status_normalized_name,
          statusOptionGithubId: target.target_status_option_github_id,
          statusOptionId: target.target_status_option_id,
          workspaceId
        });

      if (target.target_status_option_github_id && target.target_status_name) {
        await this.boardIssueCreateQueries.upsertProjectItemStatusFieldValue(
          transaction,
          {
            projectItemId,
            statusFieldId: target.status_field_id,
            statusFieldName: target.status_field_name ?? "Status",
            statusOptionGithubId: target.target_status_option_github_id,
            statusName: target.target_status_name
          }
        );
      } else {
        await this.boardIssueCreateQueries.clearProjectItemStatusFieldValue(
          transaction,
          projectItemId,
          target.status_field_id
        );
      }

      createdIssueId = await this.boardIssueCreateQueries.insertPiloIssueCache(
        transaction,
        {
          boardId: normalizedBoardId,
          columnId: input.columnId,
          githubIssueId,
          issue: githubIssue,
          projectItemId,
          repositoryId: target.repository_id,
          workspaceId
        }
      );

      await this.boardIssueCreateQueries.updatePiloIssueProjectItemNodeId(
        transaction,
        normalizedBoardId,
        createdIssueId,
        projectItem.itemNodeId
      );
    });

    const issue = await this.boardIssueCreateQueries.findCreatedIssueCard(
      workspaceId,
      normalizedBoardId,
      createdIssueId
    );

    if (!issue) {
      throw notFound("Board issue not found");
    }

    return {
      issue: this.mapBoardIssue(issue)
    };
  }

  private async createGithubIssue(
    currentUserId: string,
    target: BoardIssueCreateTargetRow & {
      repository_name: string;
      repository_owner_login: string;
    },
    input: NormalizedIssueCreateInput
  ) {
    try {
      return await this.githubIssueWriteService.createIssue({
        body: input.body,
        currentUserId,
        owner: target.repository_owner_login,
        repo: target.repository_name,
        title: input.title
      });
    } catch (error) {
      if (this.isGithubConnectionError(error)) {
        throw error;
      }

      throw boardBadGateway("GitHub issue create failed");
    }
  }

  private async addProjectItem(
    currentUserId: string,
    target: BoardIssueCreateTargetRow & {
      github_project_node_id: string;
    },
    contentNodeId: string
  ) {
    try {
      return await this.githubProjectV2WriteService.addProjectV2ItemByContentId({
        contentNodeId,
        currentUserId,
        projectNodeId: target.github_project_node_id
      });
    } catch (error) {
      if (this.isGithubConnectionError(error)) {
        throw error;
      }

      throw boardBadGateway("GitHub ProjectV2 item add failed");
    }
  }

  private async updateProjectItemStatus(
    currentUserId: string,
    target: BoardIssueCreateTargetRow & {
      github_field_node_id: string;
      github_project_node_id: string;
    },
    itemNodeId: string
  ): Promise<void> {
    try {
      await this.githubProjectV2WriteService.updateProjectV2ItemStatus({
        currentUserId,
        fieldNodeId: target.github_field_node_id,
        itemNodeId,
        projectNodeId: target.github_project_node_id,
        singleSelectOptionId: target.target_status_option_github_id
      });
    } catch (error) {
      if (this.isGithubConnectionError(error)) {
        throw error;
      }

      throw boardBadGateway("GitHub ProjectV2 status update failed");
    }
  }

  private normalizeIssueCreateInput(body: unknown): NormalizedIssueCreateInput {
    const draft = this.readBody(body);

    return {
      body: Object.hasOwn(draft, "body")
        ? this.readMarkdownBody(draft.body)
        : undefined,
      columnId: this.requirePositiveInteger(draft.columnId, "columnId"),
      title: this.readTitle(draft.title)
    };
  }

  private readBody(body: unknown): CreateBoardIssueRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    return body as CreateBoardIssueRequest;
  }

  private readTitle(value: unknown): string {
    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest("title must be a non-empty string");
    }

    const title = value.trim();
    if (!title) {
      throw badRequest("title must be a non-empty string");
    }

    if (title.length > 255) {
      throw badRequest("title must be 255 characters or less");
    }

    return title;
  }

  private readMarkdownBody(value: unknown): string {
    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest("body must be a string");
    }

    return value;
  }

  private readBoardId(value: string): string {
    return this.requirePositiveInteger(value, "boardId");
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

  private assertGithubCreateTarget(
    target: BoardIssueCreateTargetRow
  ): asserts target is BoardIssueCreateTargetRow & {
    github_field_node_id: string;
    github_project_node_id: string;
    project_v2_id: string;
    repository_id: string;
    repository_name: string;
    repository_owner_login: string;
    status_field_id: string;
  } {
    if (
      !target.repository_id ||
      !target.repository_owner_login ||
      !target.repository_name
    ) {
      throw badRequest("Board is missing GitHub repository metadata");
    }

    if (
      !target.project_v2_id ||
      !target.github_project_node_id ||
      !target.status_field_id ||
      !target.github_field_node_id
    ) {
      throw badRequest("Board is missing GitHub ProjectV2 status metadata");
    }

    if (target.target_status_option_id && !target.target_status_option_github_id) {
      throw badRequest("Board column is missing GitHub Status option metadata");
    }
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

  private mapBoardIssue(row: BoardIssueCreateIssueRow): BoardIssueCardPayload {
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
