import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import { BoardService } from "../../board/board.service";
import type {
  BoardColumnPayload,
  BoardIssueCardPayload
} from "../../board/types";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentResourceRef,
  AgentToolClarificationResult,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult
} from "../types/agent-tool.types";
import {
  issueResourceRef,
  pullRequestResourceRefs,
  readAssigneeLogins,
  summarizeBoard,
  summarizeBoardCandidates,
  summarizeIssueCard,
  summarizeIssueDetail,
  summarizeRelatedPullRequests
} from "./board-agent-tool-serializer";
import {
  BoardContextResolverService,
  type BoardContextResolution,
  type BoardContextSelector,
  type ResolvedBoardContext
} from "./board-context-resolver.service";

interface SearchBoardIssuesInput extends BoardContextSelector {
  search: string | null;
  state: "open" | "closed" | null;
  label: string | null;
  assignee: string | null;
  limit: number;
}

interface BoardIssueTargetInput extends BoardContextSelector {
  issueNumber: string;
}

interface MoveBoardIssueStatusInput extends BoardIssueTargetInput {
  columnName: string;
}

interface CreateBoardIssueInput extends BoardContextSelector {
  title: string;
  body: string | null;
  columnName: string;
}

interface AssignBoardIssueInput extends BoardIssueTargetInput {
  addAssignees: string[];
  removeAssignees: string[];
}

interface ResolvedMoveBoardIssueStatusInput {
  boardId: string;
  issueId: string;
  columnId: string;
  previousColumnId: string;
}

interface ResolvedCreateBoardIssueInput {
  boardId: string;
  title: string;
  body: string | null;
  columnId: string;
  idempotencyKey: string;
}

interface ResolvedAssignBoardIssueInput {
  boardId: string;
  issueId: string;
  addAssignees: string[];
  removeAssignees: string[];
}

const MAX_AGENT_ISSUE_LIMIT = 20;
const MAX_AGENT_BODY_LENGTH = 8_000;
const MAX_DISTRIBUTION_ITEMS = 20;
const FRESHNESS_ISSUE_SAMPLE_LIMIT = 20;
const FORBIDDEN_BOARD_INPUT_FIELDS = [
  "workspaceId",
  "boardId",
  "issueId",
  "columnId",
  "idempotencyKey",
  "userId",
  "currentUserId",
  "requestedByUserId",
  "createdBy"
] as const;
const BOARD_SELECTOR_FIELDS = ["boardName", "repositoryFullName"] as const;

@Injectable()
export class BoardAgentToolsService {
  constructor(
    private readonly boardService: BoardService,
    private readonly boardContextResolver: BoardContextResolverService
  ) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.searchBoardIssuesDefinition(),
      this.moveBoardIssueStatusDefinition(),
      this.getBoardIssueContextDefinition(),
      this.createBoardIssueDefinition(),
      this.resolveBoardContextDefinition(),
      this.getBoardBriefingDefinition(),
      this.assignBoardIssueSafelyDefinition(),
      this.diagnoseBoardFreshnessDefinition()
    ];
  }

  private searchBoardIssuesDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "search_board_issues",
      description:
        "Workspace Board 이슈를 검색합니다. 명시한 Board를 우선하고, 없으면 active Board, active가 없으면 유일한 Board를 사용합니다. 상태·검색어·label·assignee 필터만 지원하며 Board를 변경하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...this.boardSelectorSchema(),
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
        this.executeSearchBoardIssues(context, this.validateSearchInput(input))
    };
  }

  private moveBoardIssueStatusDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "move_board_issue_status",
      description:
        "GitHub issue 번호로 Board 카드를 정확히 찾아 지정한 기존 Status column으로 이동합니다. 실행 전 confirmation이 필요하며 현재 column을 previousColumnId로 다시 검증합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["issueNumber", "columnName"],
        additionalProperties: false,
        properties: {
          ...this.boardSelectorSchema(),
          issueNumber: this.issueNumberSchema(),
          columnName: { type: "string", minLength: 1, maxLength: 120 }
        }
      },
      validateInput: (input) => this.validateMoveInput(input),
      validateConfirmationInput: (input) =>
        this.validateResolvedMoveInput(input),
      buildConfirmationInput: (plan) => ({
        boardId: plan.call.boardId,
        issueId: plan.call.issueId,
        columnId: plan.call.columnId,
        previousColumnId: plan.call.previousColumnId
      }),
      buildConfirmation: (context, input) =>
        this.buildMoveConfirmation(context, this.validateMoveInput(input)),
      execute: (context, input) =>
        this.executeMoveBoardIssueStatus(
          context,
          this.validateResolvedMoveInput(input)
        )
    };
  }

  private getBoardIssueContextDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_board_issue_context",
      description:
        "GitHub issue 번호로 Board 이슈 상세와 동기화된 관련 PR 후보를 bounded projection으로 조회합니다. PR 관계는 cache 기반 heuristic이며 GitHub를 새로 호출하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["issueNumber"],
        additionalProperties: false,
        properties: {
          ...this.boardSelectorSchema(),
          issueNumber: this.issueNumberSchema()
        }
      },
      validateInput: (input) => this.validateIssueTargetInput(input),
      execute: (context, input) =>
        this.executeGetBoardIssueContext(
          context,
          this.validateIssueTargetInput(input)
        )
    };
  }

  private createBoardIssueDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "create_board_issue",
      description:
        "GitHub issue를 생성하고 기존 ProjectV2 Board column에 배치합니다. 실행 전 confirmation이 필요하며 Agent run 기반의 안정적인 idempotency key를 사용합니다. title, body, column만 지원합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["title", "columnName"],
        additionalProperties: false,
        properties: {
          ...this.boardSelectorSchema(),
          title: { type: "string", minLength: 1, maxLength: 255 },
          body: { type: "string", maxLength: MAX_AGENT_BODY_LENGTH },
          columnName: { type: "string", minLength: 1, maxLength: 120 }
        }
      },
      validateInput: (input) => this.validateCreateInput(input),
      validateConfirmationInput: (input) =>
        this.validateResolvedCreateInput(input),
      buildConfirmationInput: (plan) => ({
        boardId: plan.call.boardId,
        title: plan.after.title,
        body: plan.after.body,
        columnId: plan.call.columnId,
        idempotencyKey: plan.call.idempotencyKey
      }),
      buildConfirmation: (context, input) =>
        this.buildCreateConfirmation(context, this.validateCreateInput(input)),
      execute: (context, input) =>
        this.executeCreateBoardIssue(
          context,
          this.validateResolvedCreateInput(input)
        )
    };
  }

  private resolveBoardContextDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "resolve_board_context",
      description:
        "후속 Board 작업의 대상을 확인합니다. 명시한 Board, active Board, 유일한 Board 순으로 선택하며 모호하면 최대 5개 후보를 반환하고 추측하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.boardSelectorSchema()
      },
      validateInput: (input) =>
        this.validateSelectorOnlyInput(input, "Board context input"),
      execute: (context, input) =>
        this.executeResolveBoardContext(
          context,
          this.validateSelectorOnlyInput(input, "Board context input")
        )
    };
  }

  private getBoardBriefingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_board_briefing",
      description:
        "Board의 카드·상태·column·label·assignee 분포와 마지막 sync 사실을 요약합니다. 우선순위나 개인 성과를 추론하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.boardSelectorSchema()
      },
      validateInput: (input) =>
        this.validateSelectorOnlyInput(input, "Board briefing input"),
      execute: (context, input) =>
        this.executeGetBoardBriefing(
          context,
          this.validateSelectorOnlyInput(input, "Board briefing input")
        )
    };
  }

  private assignBoardIssueSafelyDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "assign_board_issue_safely",
      description:
        "GitHub issue 담당자 추가·제거 의도를 현재 assignee 목록과 합성합니다. 새로 추가할 대상만 live repository 후보로 검증하고 유지·추가·제거 목록을 confirmation에 표시하며, 승인 시 저장된 delta를 안전하게 적용합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["issueNumber"],
        anyOf: [
          { required: ["addAssignees"] },
          { required: ["removeAssignees"] }
        ],
        additionalProperties: false,
        properties: {
          ...this.boardSelectorSchema(),
          issueNumber: this.issueNumberSchema(),
          addAssignees: {
            type: "array",
            maxItems: 10,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 120 }
          },
          removeAssignees: {
            type: "array",
            maxItems: 10,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 120 }
          }
        }
      },
      validateInput: (input) => this.validateAssignInput(input),
      validateConfirmationInput: (input) =>
        this.validateResolvedAssignInput(input),
      buildConfirmationInput: (plan) => ({
        boardId: plan.call.boardId,
        issueId: plan.call.issueId,
        addAssignees: plan.call.addAssignees,
        removeAssignees: plan.call.removeAssignees
      }),
      buildConfirmation: (context, input) =>
        this.buildAssignConfirmation(context, this.validateAssignInput(input)),
      execute: (context, input) =>
        this.executeAssignBoardIssue(
          context,
          this.validateResolvedAssignInput(input)
        )
    };
  }

  private diagnoseBoardFreshnessDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "diagnose_board_freshness",
      description:
        "Board의 active 여부, hydration sync, issue/관련 PR cache 시각, Unmapped 카드 수를 bounded sample로 진단합니다. 동기화나 다른 mutation은 실행하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.boardSelectorSchema()
      },
      validateInput: (input) =>
        this.validateSelectorOnlyInput(input, "Board freshness input"),
      execute: (context, input) =>
        this.executeDiagnoseBoardFreshness(
          context,
          this.validateSelectorOnlyInput(input, "Board freshness input")
        )
    };
  }

  private async executeSearchBoardIssues(
    context: AgentToolContext,
    input: SearchBoardIssuesInput
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return this.boardResolutionExecutionResult(resolution);
    }

    const issues = await this.boardService.listBoardIssues(
      context.currentUserId,
      context.workspaceId,
      resolution.board.id,
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
        source: resolution.source,
        board: summarizeBoard(resolution.board),
        count: issues.meta.total,
        issues: issues.data.map((issue) => summarizeIssueCard(issue))
      },
      resourceRefs: issues.data.map((issue) => issueResourceRef(issue)),
      status: "completed"
    };
  }

  private async executeResolveBoardContext(
    context: AgentToolContext,
    input: BoardContextSelector
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return this.boardResolutionExecutionResult(resolution);
    }
    return {
      outputSummary: {
        selection: "selected",
        source: resolution.source,
        board: summarizeBoard(resolution.board)
      },
      resourceRefs: [this.boardResourceRef(resolution.board)],
      status: "completed"
    };
  }

  private async executeGetBoardIssueContext(
    context: AgentToolContext,
    input: BoardIssueTargetInput
  ): Promise<AgentToolExecutionResult> {
    const target = await this.resolveIssueTarget(context, input);
    if ("clarification" in target) {
      return this.clarificationAsExecution(target.clarification);
    }

    const [detail, pullRequests] = await Promise.all([
      this.boardService.getBoardIssue(
        context.currentUserId,
        context.workspaceId,
        target.board.id,
        target.issue.id
      ),
      this.boardService.listBoardIssuePullRequests(
        context.currentUserId,
        context.workspaceId,
        target.board.id,
        target.issue.id
      )
    ]);

    return {
      outputSummary: {
        selection: "selected",
        board: summarizeBoard(target.board),
        issue: summarizeIssueDetail(detail),
        relatedPullRequests: summarizeRelatedPullRequests(pullRequests)
      },
      resourceRefs: [
        issueResourceRef(detail),
        ...pullRequestResourceRefs(pullRequests)
      ],
      status: "completed"
    };
  }

  private async executeGetBoardBriefing(
    context: AgentToolContext,
    input: BoardContextSelector
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return this.boardResolutionExecutionResult(resolution);
    }

    const [detail, columns, filters] = await Promise.all([
      this.boardService.getBoard(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id
      ),
      this.boardService.listBoardColumns(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id
      ),
      this.boardService.getBoardFilterOptions(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id
      )
    ]);

    return {
      outputSummary: {
        selection: "selected",
        board: summarizeBoard(resolution.board),
        summary: {
          columnsCount: detail.summary.columnsCount,
          totalCards: detail.summary.totalCards,
          openCards: detail.summary.openCards,
          closedCards: detail.summary.closedCards
        },
        sync: {
          status: detail.sync.status,
          lastSyncedAt: detail.sync.lastSyncedAt
        },
        columns: columns.map((column) => ({
          name: column.name,
          count: column.issueCount
        })),
        states: filters.states.map((state) => ({
          value: state.value,
          label: state.label,
          count: state.count
        })),
        labels: filters.labels
          .slice(0, MAX_DISTRIBUTION_ITEMS)
          .map((label) => ({
            name: label.name,
            color: label.color,
            count: label.count
          })),
        assignees: filters.assignees
          .slice(0, MAX_DISTRIBUTION_ITEMS)
          .map((assignee) => ({
            login: assignee.login,
            avatarUrl: assignee.avatarUrl,
            count: assignee.count
          }))
      },
      resourceRefs: [this.boardResourceRef(resolution.board)],
      status: "completed"
    };
  }

  private async executeDiagnoseBoardFreshness(
    context: AgentToolContext,
    input: BoardContextSelector
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return this.boardResolutionExecutionResult(resolution);
    }

    const [active, detail, columns, issues] = await Promise.all([
      this.boardService.getActiveBoardSource(
        context.currentUserId,
        context.workspaceId
      ),
      this.boardService.getBoard(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id
      ),
      this.boardService.listBoardColumns(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id
      ),
      this.boardService.listBoardIssues(
        context.currentUserId,
        context.workspaceId,
        resolution.board.id,
        { page: 1, limit: FRESHNESS_ISSUE_SAMPLE_LIMIT }
      )
    ]);
    const pullRequestGroups = await Promise.all(
      issues.data.map((issue) =>
        this.boardService.listBoardIssuePullRequests(
          context.currentUserId,
          context.workspaceId,
          resolution.board.id,
          issue.id
        )
      )
    );
    const pullRequests = pullRequestGroups.flat();
    const unmapped = columns.find(
      (column) => this.normalizeName(column.name) === "unmapped"
    );

    return {
      outputSummary: {
        selection: "selected",
        board: summarizeBoard(resolution.board),
        active: {
          isActive: active?.boardId === resolution.board.id,
          sourceUpdatedAt: active?.updatedAt ?? null
        },
        sync: {
          status: detail.sync.status,
          lastHydratedAt: detail.sync.lastSyncedAt
        },
        issueFreshness: {
          sampled: issues.data.length,
          total: issues.meta.total,
          complete: issues.data.length >= issues.meta.total,
          ...this.timestampRange(issues.data.map((issue) => issue.lastSyncedAt))
        },
        pullRequestFreshness: {
          relatedCount: pullRequests.length,
          ...this.timestampRange(
            pullRequests.map((pullRequest) => pullRequest.lastSyncedAt)
          )
        },
        unmapped: {
          present: Boolean(unmapped),
          count: unmapped?.issueCount ?? 0
        }
      },
      resourceRefs: [this.boardResourceRef(resolution.board)],
      status: "completed"
    };
  }

  private async buildMoveConfirmation(
    context: AgentToolContext,
    input: MoveBoardIssueStatusInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const target = await this.resolveIssueTarget(context, input);
    if ("clarification" in target) {
      return target.clarification;
    }
    const columns = await this.boardService.listBoardColumns(
      context.currentUserId,
      context.workspaceId,
      target.board.id
    );
    const column = this.findExactColumn(columns, input.columnName);
    if (!column) {
      return this.columnClarification(columns, input.columnName);
    }
    const previousColumn = columns.find(
      (candidate) => candidate.id === target.issue.columnId
    );

    return {
      toolName: "move_board_issue_status",
      summary: `${target.issue.issueNumber} 이슈를 ${column.name} column으로 이동합니다.`,
      target: {
        domain: "board",
        resourceType: "issue",
        resourceId: target.issue.id,
        boardId: target.board.id,
        issueNumber: target.issue.issueNumber
      },
      before: {
        columnName: previousColumn?.name ?? "Unknown"
      },
      after: {
        columnName: column.name
      },
      call: {
        service: "BoardService.updateBoardIssueStatus",
        method: "PATCH",
        path: "/api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status",
        boardId: target.board.id,
        issueId: target.issue.id,
        columnId: column.id,
        previousColumnId: target.issue.columnId
      }
    };
  }

  private async executeMoveBoardIssueStatus(
    context: AgentToolContext,
    input: ResolvedMoveBoardIssueStatusInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.boardService.updateBoardIssueStatus(
      context.currentUserId,
      context.workspaceId,
      input.boardId,
      input.issueId,
      {
        columnId: input.columnId,
        previousColumnId: input.previousColumnId
      }
    );
    return {
      outputSummary: {
        action: "status_moved",
        issue: summarizeIssueCard(result.issue)
      },
      resourceRefs: [issueResourceRef(result.issue, "status_moved")],
      status: "updated"
    };
  }

  private async buildCreateConfirmation(
    context: AgentToolContext,
    input: CreateBoardIssueInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return this.boardResolutionClarification(resolution);
    }
    const columns = await this.boardService.listBoardColumns(
      context.currentUserId,
      context.workspaceId,
      resolution.board.id
    );
    const column = this.findExactColumn(columns, input.columnName);
    if (!column) {
      return this.columnClarification(columns, input.columnName);
    }
    const idempotencyKey = `agent:${context.runId}:create_board_issue`;

    return {
      toolName: "create_board_issue",
      summary: `${resolution.board.name}의 ${column.name} column에 ${input.title} 이슈를 생성합니다.`,
      target: {
        domain: "board",
        resourceType: "issue",
        boardId: resolution.board.id,
        boardName: resolution.board.name
      },
      before: null,
      after: {
        title: input.title,
        body: input.body,
        columnName: column.name
      },
      call: {
        service: "BoardService.createBoardIssue",
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/boards/{boardId}/issues",
        boardId: resolution.board.id,
        columnId: column.id,
        idempotencyKey
      }
    };
  }

  private async executeCreateBoardIssue(
    context: AgentToolContext,
    input: ResolvedCreateBoardIssueInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.boardService.createBoardIssue(
      context.currentUserId,
      context.workspaceId,
      input.boardId,
      {
        title: input.title,
        ...(input.body !== null ? { body: input.body } : {}),
        columnId: input.columnId
      },
      input.idempotencyKey
    );
    return {
      outputSummary: {
        action: "created",
        issue: summarizeIssueCard(result.issue)
      },
      resourceRefs: [issueResourceRef(result.issue, "created")],
      status: "created"
    };
  }

  private async buildAssignConfirmation(
    context: AgentToolContext,
    input: AssignBoardIssueInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const target = await this.resolveIssueTarget(context, input);
    if ("clarification" in target) {
      return target.clarification;
    }
    const [current, options] = await Promise.all([
      this.boardService.getBoardIssue(
        context.currentUserId,
        context.workspaceId,
        target.board.id,
        target.issue.id
      ),
      this.boardService.listBoardIssueAssigneeOptions(
        context.currentUserId,
        context.workspaceId,
        target.board.id,
        target.issue.id
      )
    ]);
    const currentAssignees = this.sortLogins(readAssigneeLogins(current.assignees));
    const optionMap = new Map(
      options.map((option) => [option.login.toLocaleLowerCase("en-US"), option.login])
    );
    const requestedFinal = new Map(
      currentAssignees.map((login) => [login.toLocaleLowerCase("en-US"), login])
    );
    for (const login of input.removeAssignees) {
      requestedFinal.delete(login.toLocaleLowerCase("en-US"));
    }
    for (const login of input.addAssignees) {
      const canonical = optionMap.get(login.toLocaleLowerCase("en-US"));
      if (canonical) {
        requestedFinal.set(canonical.toLocaleLowerCase("en-US"), canonical);
      }
    }
    const finalAssignees = this.sortLogins([...requestedFinal.values()]);
    const invalidAssignees = input.addAssignees.filter(
      (login) => !optionMap.has(login.toLocaleLowerCase("en-US"))
    );
    const uniqueInvalid = this.normalizeLogins(invalidAssignees);
    if (uniqueInvalid.length > 0) {
      return this.clarification("assignee_not_assignable", {
        invalidAssignees: uniqueInvalid,
        issueNumber: current.issueNumber
      });
    }
    if (finalAssignees.length > 10) {
      return this.clarification("assignee_limit_exceeded", {
        count: finalAssignees.length,
        maximum: 10,
        issueNumber: current.issueNumber
      });
    }
    const retained = finalAssignees.filter((login) =>
      this.includesLogin(currentAssignees, login)
    );
    const added = finalAssignees.filter(
      (login) => !this.includesLogin(currentAssignees, login)
    );
    const removed = currentAssignees.filter(
      (login) => !this.includesLogin(finalAssignees, login)
    );
    if (added.length === 0 && removed.length === 0) {
      return this.clarification("assignee_no_changes", {
        issueNumber: current.issueNumber,
        assignees: currentAssignees
      });
    }

    return {
      toolName: "assign_board_issue_safely",
      summary: `${current.issueNumber} 이슈의 담당자를 변경합니다.`,
      target: {
        domain: "board",
        resourceType: "issue",
        resourceId: current.id,
        boardId: target.board.id,
        issueNumber: current.issueNumber
      },
      before: {
        assignees: currentAssignees
      },
      after: {
        assignees: finalAssignees,
        retained,
        added,
        removed
      },
      call: {
        service: "BoardService.updateBoardIssueAssigneesDelta",
        boardId: target.board.id,
        issueId: current.id,
        addAssignees: added,
        removeAssignees: removed
      }
    };
  }

  private async executeAssignBoardIssue(
    context: AgentToolContext,
    input: ResolvedAssignBoardIssueInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.boardService.updateBoardIssueAssigneesDelta(
      context.currentUserId,
      context.workspaceId,
      input.boardId,
      input.issueId,
      {
        addAssignees: input.addAssignees,
        removeAssignees: input.removeAssignees
      }
    );
    return {
      outputSummary: {
        action: "assignees_updated",
        issue: summarizeIssueDetail(result.issue)
      },
      resourceRefs: [issueResourceRef(result.issue, "assignees_updated")],
      status: "updated"
    };
  }

  private async resolveBoard(
    context: AgentToolContext,
    selector: BoardContextSelector
  ): Promise<BoardContextResolution> {
    return this.boardContextResolver.resolve(
      context.currentUserId,
      context.workspaceId,
      selector
    );
  }

  private async resolveIssueTarget(
    context: AgentToolContext,
    input: BoardIssueTargetInput
  ): Promise<
    | { board: ResolvedBoardContext; issue: BoardIssueCardPayload }
    | { clarification: AgentToolClarificationResult }
  > {
    const resolution = await this.resolveBoard(context, input);
    if (resolution.kind !== "selected") {
      return { clarification: this.boardResolutionClarification(resolution) };
    }
    const issue = await this.findIssueByNumber(
      context,
      resolution.board.id,
      input.issueNumber
    );
    if (!issue) {
      return {
        clarification: this.clarification("issue_not_found", {
          issueNumber: input.issueNumber,
          board: summarizeBoard(resolution.board)
        })
      };
    }
    return { board: resolution.board, issue };
  }

  private async findIssueByNumber(
    context: AgentToolContext,
    boardId: string,
    issueNumber: string
  ): Promise<BoardIssueCardPayload | null> {
    let page = 1;
    while (true) {
      const issues = await this.boardService.listBoardIssues(
        context.currentUserId,
        context.workspaceId,
        boardId,
        { page, limit: 100 }
      );
      const match = issues.data.find(
        (candidate) => candidate.issueNumber === issueNumber
      );
      if (match) {
        return match;
      }
      if (page * issues.meta.limit >= issues.meta.total) {
        return null;
      }
      page += 1;
    }
  }

  private boardResolutionExecutionResult(
    resolution: Exclude<BoardContextResolution, { kind: "selected" }>
  ): AgentToolExecutionResult {
    const result = this.boardResolutionClarification(resolution);
    return this.clarificationAsExecution(result);
  }

  private boardResolutionClarification(
    resolution: Exclude<BoardContextResolution, { kind: "selected" }>
  ): AgentToolClarificationResult {
    return this.clarification(resolution.reason, {
      selection: resolution.candidates.length === 0 ? "none" : "required",
      count: resolution.totalCandidates,
      boards: summarizeBoardCandidates(resolution.candidates)
    });
  }

  private columnClarification(
    columns: BoardColumnPayload[],
    requestedColumnName: string
  ): AgentToolClarificationResult {
    return this.clarification("column_not_found", {
      requestedColumnName,
      columns: columns.slice(0, 20).map((column) => column.name)
    });
  }

  private clarification(
    reason: string,
    fields: AgentJsonObject
  ): AgentToolClarificationResult {
    return {
      kind: "needs_clarification",
      outputSummary: {
        status: "needs_clarification",
        reason,
        ...fields
      },
      resourceRefs: []
    };
  }

  private clarificationAsExecution(
    result: AgentToolClarificationResult
  ): AgentToolExecutionResult {
    return {
      outputSummary: result.outputSummary,
      resourceRefs: result.resourceRefs,
      status: "needs_clarification"
    };
  }

  private findExactColumn(
    columns: BoardColumnPayload[],
    columnName: string
  ): BoardColumnPayload | null {
    const normalized = this.normalizeName(columnName);
    const matches = columns.filter(
      (column) =>
        this.normalizeName(column.name) === normalized ||
        (column.normalizedName !== null &&
          this.normalizeName(column.normalizedName) === normalized)
    );
    return matches.length === 1 ? matches[0] : null;
  }

  private validateSearchInput(input: unknown): SearchBoardIssuesInput {
    const draft = this.validatePublicObject(
      input,
      "Board issue search input",
      [...BOARD_SELECTOR_FIELDS, "search", "state", "label", "assignee", "limit"]
    );
    const stateValue = this.readOptionalString(draft, "state", 16);
    if (
      stateValue !== null &&
      stateValue !== "open" &&
      stateValue !== "closed"
    ) {
      throw badRequest("state must be open or closed");
    }
    return {
      ...this.readSelector(draft),
      search: this.readOptionalString(draft, "search", 200),
      state: stateValue,
      label: this.readOptionalString(draft, "label", 120),
      assignee: this.readOptionalString(draft, "assignee", 120),
      limit: this.readOptionalLimit(draft.limit)
    };
  }

  private validateSelectorOnlyInput(
    input: unknown,
    label: string
  ): BoardContextSelector {
    const draft = this.validatePublicObject(input, label, [...BOARD_SELECTOR_FIELDS]);
    return this.readSelector(draft);
  }

  private validateIssueTargetInput(input: unknown): BoardIssueTargetInput {
    const draft = this.validatePublicObject(
      input,
      "Board issue target input",
      [...BOARD_SELECTOR_FIELDS, "issueNumber"]
    );
    return {
      ...this.readSelector(draft),
      issueNumber: this.readIssueNumber(draft.issueNumber)
    };
  }

  private validateMoveInput(input: unknown): MoveBoardIssueStatusInput {
    const draft = this.validatePublicObject(
      input,
      "Board issue status input",
      [...BOARD_SELECTOR_FIELDS, "issueNumber", "columnName"]
    );
    return {
      ...this.readSelector(draft),
      issueNumber: this.readIssueNumber(draft.issueNumber),
      columnName: this.requireString(draft.columnName, "columnName", 120)
    };
  }

  private validateCreateInput(input: unknown): CreateBoardIssueInput {
    const draft = this.validatePublicObject(
      input,
      "Board issue create input",
      [...BOARD_SELECTOR_FIELDS, "title", "body", "columnName"]
    );
    const body = draft.body;
    if (body !== undefined && typeof body !== "string") {
      throw badRequest("body must be a string");
    }
    if (typeof body === "string" && body.length > MAX_AGENT_BODY_LENGTH) {
      throw badRequest(`body must be ${MAX_AGENT_BODY_LENGTH} characters or less`);
    }
    return {
      ...this.readSelector(draft),
      title: this.requireString(draft.title, "title", 255),
      body: typeof body === "string" ? body : null,
      columnName: this.requireString(draft.columnName, "columnName", 120)
    };
  }

  private validateAssignInput(input: unknown): AssignBoardIssueInput {
    const draft = this.validatePublicObject(
      input,
      "Board issue assignee input",
      [...BOARD_SELECTOR_FIELDS, "issueNumber", "addAssignees", "removeAssignees"]
    );
    const addAssignees = this.readLoginArray(draft, "addAssignees");
    const removeAssignees = this.readLoginArray(draft, "removeAssignees");
    if (addAssignees.length === 0 && removeAssignees.length === 0) {
      throw badRequest("At least one assignee must be added or removed");
    }
    const overlap = addAssignees.find((login) =>
      this.includesLogin(removeAssignees, login)
    );
    if (overlap) {
      throw badRequest("The same assignee cannot be added and removed");
    }
    return {
      ...this.readSelector(draft),
      issueNumber: this.readIssueNumber(draft.issueNumber),
      addAssignees,
      removeAssignees
    };
  }

  private validateResolvedMoveInput(
    input: unknown
  ): ResolvedMoveBoardIssueStatusInput {
    const draft = this.validateInternalObject(input, [
      "boardId",
      "issueId",
      "columnId",
      "previousColumnId"
    ]);
    return {
      boardId: this.readPositiveIntegerString(draft.boardId, "boardId"),
      issueId: this.readPositiveIntegerString(draft.issueId, "issueId"),
      columnId: this.readPositiveIntegerString(draft.columnId, "columnId"),
      previousColumnId: this.readPositiveIntegerString(
        draft.previousColumnId,
        "previousColumnId"
      )
    };
  }

  private validateResolvedCreateInput(
    input: unknown
  ): ResolvedCreateBoardIssueInput {
    const draft = this.validateInternalObject(input, [
      "boardId",
      "title",
      "body",
      "columnId",
      "idempotencyKey"
    ]);
    const body = draft.body;
    if (body !== null && typeof body !== "string") {
      throw badRequest("body must be a string or null");
    }
    return {
      boardId: this.readPositiveIntegerString(draft.boardId, "boardId"),
      title: this.requireString(draft.title, "title", 255),
      body,
      columnId: this.readPositiveIntegerString(draft.columnId, "columnId"),
      idempotencyKey: this.requireString(
        draft.idempotencyKey,
        "idempotencyKey",
        128
      )
    };
  }

  private validateResolvedAssignInput(
    input: unknown
  ): ResolvedAssignBoardIssueInput {
    const draft = this.validateInternalObject(input, [
      "boardId",
      "issueId",
      "addAssignees",
      "removeAssignees"
    ]);
    return {
      boardId: this.readPositiveIntegerString(draft.boardId, "boardId"),
      issueId: this.readPositiveIntegerString(draft.issueId, "issueId"),
      addAssignees: this.readLoginArray(draft, "addAssignees", true),
      removeAssignees: this.readLoginArray(draft, "removeAssignees", true)
    };
  }

  private validatePublicObject(
    input: unknown,
    label: string,
    allowedFields: readonly string[]
  ): AgentJsonObject {
    const draft = this.requirePlainObject(input, label);
    for (const field of FORBIDDEN_BOARD_INPUT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(draft, field)) {
        throw badRequest(`${field} must not be provided to Board tools`);
      }
    }
    this.assertOnlyAllowedFields(draft, allowedFields, label);
    return draft;
  }

  private validateInternalObject(
    input: unknown,
    allowedFields: readonly string[]
  ): AgentJsonObject {
    const draft = this.requirePlainObject(input, "Board confirmation input");
    this.assertOnlyAllowedFields(
      draft,
      allowedFields,
      "Board confirmation input"
    );
    return draft;
  }

  private readSelector(input: AgentJsonObject): BoardContextSelector {
    return {
      boardName: this.readOptionalString(input, "boardName", 120),
      repositoryFullName: this.readOptionalString(
        input,
        "repositoryFullName",
        160
      )
    };
  }

  private readIssueNumber(value: unknown): string {
    if (typeof value !== "string") {
      throw badRequest("issueNumber must be a positive GitHub issue number");
    }
    const match = value.trim().match(/^#?([1-9]\d*)$/);
    if (!match) {
      throw badRequest("issueNumber must be a positive GitHub issue number");
    }
    const parsed = Number(match[1]);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest("issueNumber must be a positive GitHub issue number");
    }
    return `#${parsed}`;
  }

  private readLoginArray(
    input: AgentJsonObject,
    field: string,
    required = false
  ): string[] {
    const value = input[field];
    if (value === undefined && !required) {
      return [];
    }
    if (!Array.isArray(value) || value.length > 10) {
      throw badRequest(`${field} must be an array of 10 or fewer GitHub logins`);
    }
    const logins = value.map((item) => {
      if (typeof item !== "string" || !item.trim() || item.trim().length > 120) {
        throw badRequest(`${field} must contain GitHub login strings`);
      }
      return item.trim();
    });
    return this.normalizeLogins(logins);
  }

  private normalizeLogins(logins: string[]): string[] {
    const unique = new Map<string, string>();
    for (const login of logins) {
      const key = login.toLocaleLowerCase("en-US");
      if (!unique.has(key)) {
        unique.set(key, login);
      }
    }
    return this.sortLogins([...unique.values()]);
  }

  private sortLogins(logins: string[]): string[] {
    return [...logins].sort((left, right) =>
      left.localeCompare(right, "en-US", { sensitivity: "base" })
    );
  }

  private includesLogin(logins: string[], target: string): boolean {
    const normalized = target.toLocaleLowerCase("en-US");
    return logins.some(
      (login) => login.toLocaleLowerCase("en-US") === normalized
    );
  }

  private timestampRange(values: Array<string | null>): AgentJsonObject {
    const timestamps = values
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right));
    return {
      oldestLastSyncedAt: timestamps[0] ?? null,
      newestLastSyncedAt: timestamps[timestamps.length - 1] ?? null
    };
  }

  private boardResourceRef(board: ResolvedBoardContext): AgentResourceRef {
    return {
      domain: "board",
      resourceType: "board",
      resourceId: board.id,
      label: board.name,
      url: board.project.url,
      metadata: {
        repository: board.repository.fullName
      }
    };
  }

  private boardSelectorSchema(): AgentJsonObject {
    return {
      boardName: { type: "string", minLength: 1, maxLength: 120 },
      repositoryFullName: {
        type: "string",
        minLength: 1,
        maxLength: 160,
        description: "owner/repository 형식의 정확한 GitHub repository 이름"
      }
    };
  }

  private issueNumberSchema(): AgentJsonObject {
    return {
      type: "string",
      pattern: "^#?[1-9]\\d*$",
      description: "GitHub issue 번호. 예: #134"
    };
  }

  private requirePlainObject(input: unknown, label: string): AgentJsonObject {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw badRequest(`${label} must be an object`);
    }
    return input as AgentJsonObject;
  }

  private assertOnlyAllowedFields(
    input: AgentJsonObject,
    allowedFields: readonly string[],
    label: string
  ): void {
    const allowed = new Set(allowedFields);
    for (const field of Object.keys(input)) {
      if (!allowed.has(field)) {
        throw badRequest(`${label}.${field} is not supported`);
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
    return this.requireString(value, field, maxLength);
  }

  private requireString(
    value: unknown,
    field: string,
    maxLength: number
  ): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be a non-empty string`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw badRequest(`${field} must be ${maxLength} characters or less`);
    }
    return normalized;
  }

  private readPositiveIntegerString(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
      throw badRequest(`${field} must be a positive integer string`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(`${field} must be a positive integer string`);
    }
    return String(parsed);
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
      throw badRequest(
        `limit must be an integer between 1 and ${MAX_AGENT_ISSUE_LIMIT}`
      );
    }
    return value;
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  }
}
