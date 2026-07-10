import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import { GithubIssueWriteService } from "../github-integration/github-issue-write.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { rethrowBoardGithubWriteError } from "./board-github-write-error";
import { BoardIssueAssigneeQueries } from "./queries/board-issue-assignee.queries";
import type { BoardIssueAssigneeOptionPayload } from "./types";

@Injectable()
export class BoardIssueAssigneeService {
  constructor(
    private readonly boardIssueAssigneeQueries: BoardIssueAssigneeQueries,
    private readonly workspaceService: WorkspaceService,
    private readonly githubIssueWriteService: GithubIssueWriteService
  ) {}

  async listAssigneeOptions(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueAssigneeOptionPayload[]> {
    const normalizedBoardId = this.requirePositiveInteger(boardId, "boardId");
    const normalizedIssueId = this.requirePositiveInteger(issueId, "issueId");

    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const target = await this.boardIssueAssigneeQueries.findAssigneeTarget(
      workspaceId,
      normalizedBoardId,
      normalizedIssueId
    );
    if (!target) {
      throw notFound("Board issue not found");
    }
    if (!target.repository_owner_login || !target.repository_name) {
      throw badRequest("Board issue is missing GitHub repository metadata");
    }

    try {
      const assignees = await this.githubIssueWriteService.listAssignableUsers({
        currentUserId,
        owner: target.repository_owner_login,
        repo: target.repository_name
      });

      return assignees
        .map((assignee) => ({
          login: assignee.login,
          avatarUrl: assignee.avatar_url ?? null
        }))
        .sort((left, right) =>
          left.login.localeCompare(right.login, "en", { sensitivity: "base" })
        );
    } catch (error) {
      rethrowBoardGithubWriteError(error, "GitHub issue assignee lookup failed");
    }
  }

  private requirePositiveInteger(value: unknown, field: string): string {
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
}
