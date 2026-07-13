import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import { BoardService } from "../../board/board.service";
import type {
  BoardIssueCardPayload,
  BoardPayload
} from "../../board/types";
import type {
  AgentJsonObject,
  AgentResourceRef,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult
} from "../types/agent-tool.types";

interface SearchBoardIssuesInput {
  boardName: string | null;
  search: string | null;
  state: "open" | "closed" | null;
  label: string | null;
  assignee: string | null;
  limit: number;
}

const MAX_AGENT_ISSUE_LIMIT = 20;
const MAX_BOARD_CANDIDATES = 5;
const MAX_LABELS_OR_ASSIGNEES = 5;
const FORBIDDEN_BOARD_INPUT_FIELDS = [
  "workspaceId",
  "boardId",
  "userId",
  "currentUserId",
  "requestedByUserId"
];
const SEARCH_INPUT_FIELDS = [
  "boardName",
  "search",
  "state",
  "label",
  "assignee",
  "limit"
];

@Injectable()
export class BoardAgentToolsService {
  constructor(private readonly boardService: BoardService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [this.searchBoardIssuesDefinition()];
  }

  private searchBoardIssuesDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "search_board_issues",
      description:
        "Workspace Board 이슈를 조회합니다. Board가 하나이면 자동 선택하고, 여러 Board에서는 boardName을 정확히 지정해야 합니다. 상태·검색어·label·assignee 필터만 지원하며 Board 변경은 하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          boardName: { type: "string", minLength: 1, maxLength: 120 },
          search: { type: "string", minLength: 1, maxLength: 200 },
          state: { type: "string", enum: ["open", "closed"] },
          label: { type: "string", minLength: 1, maxLength: 120 },
          assignee: { type: "string", minLength: 1, maxLength: 120 },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_AGENT_ISSUE_LIMIT
          }
        }
      },
      validateInput: (input) => this.validateSearchInput(input),
      execute: (context, input) =>
        this.executeSearchBoardIssues(
          context,
          this.validateSearchInput(input)
        )
    };
  }

  private async executeSearchBoardIssues(
    context: AgentToolContext,
    input: SearchBoardIssuesInput
  ): Promise<AgentToolExecutionResult> {
    const boards = await this.boardService.listBoards(
      context.currentUserId,
      context.workspaceId,
      { page: 1, limit: 100 }
    );
    const selectedBoard = this.selectBoard(boards.data, input.boardName);

    if (!selectedBoard) {
      return {
        outputSummary: {
          selection: boards.meta.total === 0 ? "none" : "required",
          count: boards.meta.total,
          boards: boards.data
            .slice(0, MAX_BOARD_CANDIDATES)
            .map((board) => this.summarizeBoard(board))
        },
        resourceRefs: [],
        status: "needs_clarification"
      };
    }

    const issues = await this.boardService.listBoardIssues(
      context.currentUserId,
      context.workspaceId,
      selectedBoard.id,
      {
        page: 1,
        limit: input.limit,
        ...(input.search ? { search: input.search } : {}),
        ...(input.state ? { state: input.state } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(input.assignee ? { assignee: input.assignee } : {})
      }
    );

    return {
      outputSummary: {
        selection: "selected",
        board: this.summarizeBoard(selectedBoard),
        count: issues.meta.total,
        issues: issues.data.map((issue) => this.summarizeIssue(issue))
      },
      resourceRefs: issues.data.map((issue) => this.toResourceRef(issue)),
      status: "completed"
    };
  }

  private validateSearchInput(input: unknown): SearchBoardIssuesInput {
    const draft = this.requirePlainObject(input, "Board issue search input");
    this.rejectForbiddenFields(draft);
    this.assertOnlyAllowedFields(draft);

    const stateValue = this.readOptionalString(draft, "state", 16);
    let state: "open" | "closed" | null = null;
    if (
      stateValue !== null &&
      stateValue !== "open" &&
      stateValue !== "closed"
    ) {
      throw badRequest("state must be open or closed");
    }
    if (stateValue !== null) {
      state = stateValue;
    }

    return {
      boardName: this.readOptionalString(draft, "boardName", 120),
      search: this.readOptionalString(draft, "search", 200),
      state,
      label: this.readOptionalString(draft, "label", 120),
      assignee: this.readOptionalString(draft, "assignee", 120),
      limit: this.readOptionalLimit(draft.limit)
    };
  }

  private selectBoard(
    boards: BoardPayload[],
    boardName: string | null
  ): BoardPayload | null {
    if (boardName) {
      const normalizedName = this.normalizeBoardName(boardName);
      const matches = boards.filter(
        (board) => this.normalizeBoardName(board.name) === normalizedName
      );
      return matches.length === 1 ? matches[0] : null;
    }

    return boards.length === 1 ? boards[0] : null;
  }

  private summarizeBoard(board: BoardPayload): AgentJsonObject {
    return {
      name: this.boundText(board.name, 120),
      repository: this.boundText(board.repository.fullName, 160)
    };
  }

  private summarizeIssue(issue: BoardIssueCardPayload): AgentJsonObject {
    return {
      issueNumber: this.boundText(issue.issueNumber, 40),
      title: this.boundText(issue.title, 160),
      state: issue.state ?? "unknown",
      labels: this.summarizeNamedValues(issue.labels),
      assignees: this.summarizeNamedValues(issue.assignees)
    };
  }

  private toResourceRef(issue: BoardIssueCardPayload): AgentResourceRef {
    return {
      domain: "board",
      resourceType: "issue",
      resourceId: issue.id,
      label: issue.title,
      ...(issue.htmlUrl ? { url: issue.htmlUrl } : {}),
      status: issue.state ?? undefined,
      metadata: {
        issueNumber: issue.issueNumber
      }
    };
  }

  private summarizeNamedValues(values: unknown[]): string[] {
    return values
      .map((value) => this.readNamedValue(value))
      .filter((value): value is string => value !== null)
      .slice(0, MAX_LABELS_OR_ASSIGNEES);
  }

  private readNamedValue(value: unknown): string | null {
    if (typeof value === "string") {
      return this.boundText(value, 80);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of ["name", "login", "username"]) {
      if (typeof record[key] === "string") {
        return this.boundText(record[key], 80);
      }
    }
    return null;
  }

  private requirePlainObject(input: unknown, label: string): AgentJsonObject {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      throw badRequest(`${label} must be an object`);
    }
    return input as AgentJsonObject;
  }

  private rejectForbiddenFields(input: AgentJsonObject): void {
    for (const field of FORBIDDEN_BOARD_INPUT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        throw badRequest(`${field} must not be provided to Board tools`);
      }
    }
  }

  private assertOnlyAllowedFields(input: AgentJsonObject): void {
    const allowed = new Set(SEARCH_INPUT_FIELDS);
    for (const field of Object.keys(input)) {
      if (!allowed.has(field)) {
        throw badRequest(`Board issue search input.${field} is not supported`);
      }
    }
  }

  private readOptionalString(
    input: AgentJsonObject,
    field: string,
    maxLength: number
  ): string | null {
    const value = input[field];
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be a non-empty string`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw badRequest(`${field} must be ${maxLength} characters or less`);
    }
    return normalized;
  }

  private readOptionalLimit(value: unknown): number {
    if (value === undefined) {
      return MAX_AGENT_ISSUE_LIMIT;
    }
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_AGENT_ISSUE_LIMIT
    ) {
      throw badRequest(`limit must be an integer between 1 and ${MAX_AGENT_ISSUE_LIMIT}`);
    }
    return value;
  }

  private normalizeBoardName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  }

  private boundText(value: string, maxLength: number): string {
    const text = value.trim().replace(/\s+/g, " ");
    return text.length <= maxLength
      ? text
      : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }
}
