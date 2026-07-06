import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import { WorkspaceService } from "../workspace/workspace.service";
import { BoardReadQueries } from "./queries/board-read.queries";
import type {
  BoardFilterAssigneeOptionRow,
  BoardFilterColumnOptionRow,
  BoardFilterLabelOptionRow,
  BoardFilterStateOptionRow,
  BoardIssueDetailRow,
  BoardProjectFieldRow,
  BoardRelatedPullRequestRow
} from "./queries/board-read.queries";
import type {
  BoardFilterOptionsPayload,
  BoardIssueDetailPayload,
  BoardIssueState,
  BoardProjectFieldPayload,
  BoardRelatedPullRequestPayload
} from "./types";

@Injectable()
export class BoardIssueReadService {
  constructor(
    private readonly boardReadQueries: BoardReadQueries,
    private readonly workspaceService: WorkspaceService
  ) {}

  async getBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    const normalizedIssueId = this.readIssueId(issueId);
    const issue = await this.boardReadQueries.findBoardIssueDetail(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );

    if (!issue) {
      throw notFound("Board issue not found");
    }

    const projectFields = issue.project_item_id
      ? await this.boardReadQueries.listProjectFields(issue.project_item_id)
      : [];

    return this.mapBoardIssueDetail(issue, projectFields);
  }

  async listBoardIssuePullRequests(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardRelatedPullRequestPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    const normalizedIssueId = this.readIssueId(issueId);
    const issue = await this.boardReadQueries.findBoardIssueDetail(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );

    if (!issue) {
      throw notFound("Board issue not found");
    }

    const githubIssueNumber = this.toNullableInteger(
      issue.github_issue_number,
      "Invalid GitHub issue number"
    );

    if (!issue.repository_id || githubIssueNumber === null) {
      return [];
    }

    const rows = await this.boardReadQueries.listRelatedPullRequests(
      issue.repository_id,
      githubIssueNumber,
      issue.html_url
    );

    return rows.map((row) => this.mapRelatedPullRequest(row));
  }

  async getBoardFilterOptions(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardFilterOptionsPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const normalizedBoardId = this.readBoardId(boardId);
    await this.assertBoardExists(workspaceId, normalizedBoardId);

    const [columns, states, assignees, labels] = await Promise.all([
      this.boardReadQueries.listBoardFilterColumns(normalizedBoardId),
      this.boardReadQueries.listBoardFilterStates(normalizedBoardId),
      this.boardReadQueries.listBoardFilterAssignees(normalizedBoardId),
      this.boardReadQueries.listBoardFilterLabels(normalizedBoardId)
    ]);

    return {
      columns: columns.map((row) => this.mapFilterColumn(row)),
      states: this.mapFilterStates(states),
      assignees: assignees.map((row) => this.mapFilterAssignee(row)),
      labels: labels.map((row) => this.mapFilterLabel(row))
    };
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

  private readBoardId(value: string): string {
    return String(this.readPositiveInteger(value, "boardId", 0));
  }

  private readIssueId(value: string): string {
    return String(this.readPositiveInteger(value, "issueId", 0));
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

  private mapBoardIssueDetail(
    row: BoardIssueDetailRow,
    projectFields: BoardProjectFieldRow[]
  ): BoardIssueDetailPayload {
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
      body: row.body,
      htmlUrl: row.html_url,
      state: row.state,
      labels: this.toArray(row.labels),
      assignees: this.toArray(row.assignees),
      milestone: this.toNullableRecord(row.milestone),
      position: this.toInteger(row.position, "Invalid board issue position"),
      projectFields: projectFields.map((field) => this.mapProjectField(field)),
      githubUpdatedAt: this.toNullableIsoString(row.github_updated_at),
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at)
    };
  }

  private mapProjectField(row: BoardProjectFieldRow): BoardProjectFieldPayload {
    const field: BoardProjectFieldPayload = {
      fieldName: row.field_name,
      fieldDataType: row.field_data_type
    };
    this.setOptionalString(field, "textValue", row.text_value);
    this.setOptionalNumber(field, "numberValue", row.number_value);
    this.setOptionalDateString(field, "dateValue", row.date_value);
    this.setOptionalString(
      field,
      "singleSelectOptionId",
      row.single_select_option_id
    );
    this.setOptionalString(field, "singleSelectName", row.single_select_name);
    this.setOptionalString(field, "iterationId", row.iteration_id);
    this.setOptionalString(field, "iterationTitle", row.iteration_title);

    return field;
  }

  private mapRelatedPullRequest(
    row: BoardRelatedPullRequestRow
  ): BoardRelatedPullRequestPayload {
    const raw = this.toRecord(row.raw);

    return {
      id: row.id,
      repositoryId: row.repository_id,
      githubPullRequestId: this.toNullableNumber(row.github_pull_request_id),
      githubNodeId: row.github_node_id,
      githubNumber: this.toInteger(
        row.pr_number,
        "Invalid GitHub pull request number"
      ),
      title: row.title,
      authorName: row.author_login,
      authorAvatarUrl: row.author_avatar_url,
      state: this.getPullRequestState(row, raw),
      draft: this.getRawBoolean(raw, "draft") ?? false,
      mergeable: this.getRawBoolean(raw, "mergeable"),
      createdAtGithub: this.toNullableIsoString(row.github_created_at),
      updatedAtGithub: this.toNullableIsoString(row.github_updated_at),
      headBranch: row.head_branch,
      baseBranch: row.base_branch,
      headSha: this.getPullRequestSha(raw, "head"),
      baseSha: this.getPullRequestSha(raw, "base"),
      changedFilesCount: this.toInteger(
        row.changed_files_count,
        "Invalid GitHub pull request file count"
      ),
      additions: this.toInteger(row.additions, "Invalid GitHub pull request additions"),
      deletions: this.toInteger(row.deletions, "Invalid GitHub pull request deletions"),
      commitsCount: this.toInteger(
        row.commits_count,
        "Invalid GitHub pull request commit count"
      ),
      commentsCount: this.toInteger(
        row.comments_count,
        "Invalid GitHub pull request comment count"
      ),
      reviewCommentsCount: this.toInteger(
        row.review_comments_count,
        "Invalid GitHub pull request review comment count"
      ),
      githubUrl: row.html_url,
      lastSyncedAt: this.toNullableIsoString(row.last_synced_at)
    };
  }

  private mapFilterColumn(row: BoardFilterColumnOptionRow): {
    id: string;
    name: string;
    normalizedName: string | null;
    count: number;
  } {
    return {
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      count: this.toInteger(row.count, "Invalid board filter column count")
    };
  }

  private mapFilterStates(
    rows: BoardFilterStateOptionRow[]
  ): BoardFilterOptionsPayload["states"] {
    const counts = new Map<BoardIssueState, number>(
      rows.map((row) => [
        row.state,
        this.toInteger(row.count, "Invalid board filter state count")
      ])
    );

    return [
      {
        value: "open",
        label: "Open",
        count: counts.get("open") ?? 0
      },
      {
        value: "closed",
        label: "Closed",
        count: counts.get("closed") ?? 0
      }
    ];
  }

  private mapFilterAssignee(row: BoardFilterAssigneeOptionRow): {
    login: string;
    avatarUrl: string | null;
    count: number;
  } {
    return {
      login: row.login,
      avatarUrl: row.avatar_url,
      count: this.toInteger(row.count, "Invalid board filter assignee count")
    };
  }

  private mapFilterLabel(row: BoardFilterLabelOptionRow): {
    name: string;
    color: string | null;
    count: number;
  } {
    return {
      name: row.name,
      color: row.color,
      count: this.toInteger(row.count, "Invalid board filter label count")
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

  private toNullableNumber(value: string | number | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid numeric value");
    }

    return parsed;
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private toNullableRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return this.toNullableRecord(value) ?? {};
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

  private toNullableDateString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }

  private setOptionalString<T extends object>(
    target: T,
    key: keyof T,
    value: string | null
  ): void {
    if (value) {
      target[key] = value as T[keyof T];
    }
  }

  private setOptionalNumber<T extends object>(
    target: T,
    key: keyof T,
    value: string | number | null
  ): void {
    const parsed = this.toNullableNumber(value);
    if (parsed !== null) {
      target[key] = parsed as T[keyof T];
    }
  }

  private setOptionalDateString<T extends object>(
    target: T,
    key: keyof T,
    value: Date | string | null
  ): void {
    const normalized = this.toNullableDateString(value);
    if (normalized) {
      target[key] = normalized as T[keyof T];
    }
  }

  private getPullRequestState(
    row: BoardRelatedPullRequestRow,
    raw: Record<string, unknown>
  ): BoardIssueState {
    const rawState = this.getRawString(raw, "state");
    if (rawState === "open" || rawState === "closed") {
      return rawState;
    }

    return row.merged_at || row.github_closed_at ? "closed" : "open";
  }

  private getPullRequestSha(
    raw: Record<string, unknown>,
    side: "head" | "base"
  ): string | null {
    const nested = this.getNestedRawString(raw, side, "sha");
    if (nested) {
      return nested;
    }

    return (
      this.getRawString(raw, `${side}_sha`) ??
      this.getRawString(raw, `${side}Sha`)
    );
  }

  private getNestedRawString(
    raw: Record<string, unknown>,
    parent: string,
    child: string
  ): string | null {
    const parentValue = raw[parent];
    if (
      typeof parentValue !== "object" ||
      parentValue === null ||
      Array.isArray(parentValue)
    ) {
      return null;
    }

    return this.getRawString(parentValue as Record<string, unknown>, child);
  }

  private getRawString(
    raw: Record<string, unknown>,
    field: string
  ): string | null {
    const value = raw[field];
    return typeof value === "string" && value ? value : null;
  }

  private getRawBoolean(
    raw: Record<string, unknown>,
    field: string
  ): boolean | null {
    const value = raw[field];
    return typeof value === "boolean" ? value : null;
  }
}
