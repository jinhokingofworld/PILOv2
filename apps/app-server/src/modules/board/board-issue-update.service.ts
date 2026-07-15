import { Injectable } from "@nestjs/common";
import { ActivityLogService } from "../../common/activity-log.service";
import { badRequest, forbidden, notFound } from "../../common/api-error";
import { GithubIssueWriteService } from "../github-integration/github-issue-write.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { rethrowBoardGithubWriteError } from "./board-github-write-error";
import { buildPiloIssueUpdatedActivityLog } from "./board-activity-log";
import type { UpdateBoardIssueRequest } from "./dto";
import {
  BoardIssueUpdateQueries,
  type BoardIssueUpdateIssueRow,
  type BoardIssueUpdateProjectFieldRow,
  type BoardIssueUpdateTargetRow
} from "./queries/board-issue-update.queries";
import type {
  BoardIssueDetailPayload,
  BoardIssueState,
  BoardProjectFieldPayload
} from "./types";

interface NormalizedIssueUpdateInput {
  assignees?: string[];
  title?: string;
  body?: string;
  state?: BoardIssueState;
}

export interface UpdateBoardIssueResult {
  issue: BoardIssueDetailPayload;
}

@Injectable()
export class BoardIssueUpdateService {
  constructor(
    private readonly boardIssueUpdateQueries: BoardIssueUpdateQueries,
    private readonly workspaceService: WorkspaceService,
    private readonly githubIssueWriteService: GithubIssueWriteService,
    private readonly activityLogService: ActivityLogService
  ) {}

  async updateBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string,
    body: unknown
  ): Promise<UpdateBoardIssueResult> {
    const normalizedBoardId = this.readBoardId(boardId);
    const normalizedIssueId = this.readIssueId(issueId);
    const input = this.normalizeIssueUpdateInput(body);

    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const target = await this.boardIssueUpdateQueries.findIssueUpdateTarget(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );

    if (!target) {
      throw notFound("Board issue not found");
    }

    this.assertGithubIssueTarget(target);
    const issueNumber = this.toInteger(
      target.github_issue_number,
      "Invalid GitHub issue number"
    );
    const githubUpdate = await this.updateGithubIssue(
      currentUserId,
      target,
      issueNumber,
      input
    );
    const activityLog = buildPiloIssueUpdatedActivityLog({
      actorUserId: currentUserId,
      after: githubUpdate.issue,
      before: {
        assignees: target.assignees,
        body: target.body,
        state: target.state,
        title: target.title,
        updatedAt: target.updated_at
      },
      boardId: normalizedBoardId,
      issueId: normalizedIssueId,
      requestedChanges: input,
      workspaceId
    });

    await this.boardIssueUpdateQueries.transaction(async (transaction) => {
      const cacheInput = {
        boardId: normalizedBoardId,
        githubIssueId: target.github_issue_id,
        issue: githubUpdate.issue,
        issueId: normalizedIssueId,
        workspaceId
      };

      await this.boardIssueUpdateQueries.updateGithubIssueCache(
        transaction,
        cacheInput
      );
      await this.boardIssueUpdateQueries.updatePiloIssueCache(
        transaction,
        cacheInput
      );
      if (activityLog) {
        await this.activityLogService.append(transaction, activityLog);
      }
    });

    if (!githubUpdate.assigneesApplied) {
      throw forbidden("GitHub Issue assignee update was not applied");
    }

    const issue = await this.boardIssueUpdateQueries.findUpdatedIssueDetail(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );

    if (!issue) {
      throw notFound("Board issue not found");
    }

    const projectFields = issue.project_item_id
      ? await this.boardIssueUpdateQueries.listProjectFields(issue.project_item_id)
      : [];

    return {
      issue: this.mapBoardIssueDetail(issue, projectFields)
    };
  }

  private async updateGithubIssue(
    currentUserId: string,
    target: BoardIssueUpdateTargetRow & {
      github_issue_id: string;
      repository_name: string;
      repository_owner_login: string;
    },
    issueNumber: number,
    input: NormalizedIssueUpdateInput
  ) {
    try {
      return await this.githubIssueWriteService.updateIssue({
        assignees: input.assignees,
        body: input.body,
        currentUserId,
        issueNumber,
        owner: target.repository_owner_login,
        repo: target.repository_name,
        state: input.state,
        title: input.title
      });
    } catch (error) {
      rethrowBoardGithubWriteError(error, "GitHub issue update failed");
    }
  }

  private normalizeIssueUpdateInput(body: unknown): NormalizedIssueUpdateInput {
    const draft = this.readBody(body);
    const input: NormalizedIssueUpdateInput = {};

    if (Object.hasOwn(draft, "assignees")) {
      input.assignees = this.readAssignees(draft.assignees);
    }

    if (Object.hasOwn(draft, "title")) {
      input.title = this.readTitle(draft.title);
    }

    if (Object.hasOwn(draft, "body")) {
      input.body = this.readMarkdownBody(draft.body);
    }

    if (Object.hasOwn(draft, "state")) {
      input.state = this.readState(draft.state);
    }

    if (
      !Object.hasOwn(input, "assignees") &&
      !Object.hasOwn(input, "title") &&
      !Object.hasOwn(input, "body") &&
      !Object.hasOwn(input, "state")
    ) {
      throw badRequest("At least one of title/body/state/assignees is required");
    }

    return input;
  }

  private readBody(body: unknown): UpdateBoardIssueRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    return body as UpdateBoardIssueRequest;
  }

  private readAssignees(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw badRequest("assignees must be an array of GitHub logins");
    }

    if (value.length > 10) {
      throw badRequest("assignees must contain 10 or fewer GitHub logins");
    }

    const assignees: string[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw badRequest("assignees must be an array of GitHub logins");
      }

      const login = entry.trim();
      const normalizedLogin = login.toLowerCase();
      if (!seen.has(normalizedLogin)) {
        seen.add(normalizedLogin);
        assignees.push(login);
      }
    }

    return assignees;
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

  private readState(value: unknown): BoardIssueState {
    if (value !== "open" && value !== "closed") {
      throw badRequest("state must be open or closed");
    }

    return value;
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

  private assertGithubIssueTarget(
    target: BoardIssueUpdateTargetRow
  ): asserts target is BoardIssueUpdateTargetRow & {
    github_issue_id: string;
    github_issue_number: string | number;
    repository_name: string;
    repository_owner_login: string;
  } {
    if (
      !target.github_issue_id ||
      !target.repository_owner_login ||
      !target.repository_name
    ) {
      throw badRequest("Board issue is missing GitHub issue metadata");
    }

    const issueNumber = this.toNullableInteger(
      target.github_issue_number,
      "Invalid GitHub issue number"
    );

    if (issueNumber === null) {
      throw badRequest("Board issue is missing GitHub issue metadata");
    }
  }

  private mapBoardIssueDetail(
    row: BoardIssueUpdateIssueRow,
    projectFields: BoardIssueUpdateProjectFieldRow[]
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

  private mapProjectField(
    row: BoardIssueUpdateProjectFieldRow
  ): BoardProjectFieldPayload {
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
}
