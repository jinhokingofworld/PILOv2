import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BoardContextResolverService } = require(
  "../../dist/modules/agent/tools/board-context-resolver.service.js"
);
const { BoardAgentToolsService } = require(
  "../../dist/modules/agent/tools/board-agent-tools.service.js"
);
const { buildAgentReadResultAnswer } = require(
  "../../dist/modules/agent/agent-read-result-formatter.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID
};

function board(overrides = {}) {
  return {
    id: "42",
    workspaceId: WORKSPACE_ID,
    name: "Product Board",
    repository: {
      id: "repository-product",
      fullName: "pilo/product",
      htmlUrl: "https://github.com/pilo/product"
    },
    project: {
      id: "project-product",
      githubProjectNodeId: "PVT_product",
      projectNumber: 7,
      title: "Product Board",
      url: "https://github.com/orgs/pilo/projects/7"
    },
    statusField: {
      id: "status-field",
      githubFieldNodeId: "PVTSSF_status",
      name: "Status"
    },
    syncStatus: "success",
    lastSyncedAt: "2026-07-16T01:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-16T01:00:00.000Z",
    ...overrides
  };
}

function issue(overrides = {}) {
  return {
    id: "101",
    boardId: "42",
    columnId: "7",
    repositoryId: "repository-product",
    githubIssueId: "github-issue-134",
    projectItemId: "project-item-134",
    githubIssueNodeId: "I_134",
    githubProjectItemNodeId: "PVTI_134",
    githubIssueNumber: 134,
    issueNumber: "#134",
    title: "Board Agent Tool 구현",
    body: "Agent가 Board 문맥을 안전하게 읽고 변경합니다.",
    htmlUrl: "https://github.com/pilo/product/issues/134",
    state: "open",
    labels: [{ name: "agent", color: "0052cc" }],
    assignees: [{ login: "alice", avatar_url: null }, { login: "bob" }],
    milestone: null,
    position: 1,
    projectFields: [
      {
        fieldName: "Status",
        fieldDataType: "SINGLE_SELECT",
        singleSelectName: "Todo"
      }
    ],
    githubUpdatedAt: "2026-07-16T00:55:00.000Z",
    lastSyncedAt: "2026-07-16T01:00:00.000Z",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-16T01:00:00.000Z",
    ...overrides
  };
}

class FakeBoardService {
  constructor() {
    this.calls = [];
    this.activeBoardId = "42";
    this.boards = [
      board(),
      board({
        id: "84",
        name: "Archive Board",
        repository: {
          id: "repository-archive",
          fullName: "pilo/archive",
          htmlUrl: "https://github.com/pilo/archive"
        },
        project: {
          id: "project-archive",
          githubProjectNodeId: "PVT_archive",
          projectNumber: 8,
          title: "Archive Board",
          url: "https://github.com/orgs/pilo/projects/8"
        }
      })
    ];
    this.columns = [
      {
        id: "7",
        boardId: "42",
        statusOptionId: "status-todo",
        githubStatusOptionId: "todo",
        name: "Todo",
        normalizedName: "todo",
        position: 0,
        color: "BLUE",
        issueCount: 1
      },
      {
        id: "8",
        boardId: "42",
        statusOptionId: "status-progress",
        githubStatusOptionId: "progress",
        name: "In Progress",
        normalizedName: "in progress",
        position: 1,
        color: "YELLOW",
        issueCount: 0
      },
      {
        id: "9",
        boardId: "42",
        statusOptionId: null,
        githubStatusOptionId: null,
        name: "Unmapped",
        normalizedName: "unmapped",
        position: 2,
        color: null,
        issueCount: 2
      }
    ];
    this.issues = [issue()];
  }

  async getActiveBoardSource(currentUserId, workspaceId) {
    this.calls.push({ method: "getActiveBoardSource", currentUserId, workspaceId });
    const selected = this.boards.find((candidate) => candidate.id === this.activeBoardId);
    return selected
      ? {
          boardId: selected.id,
          workspaceId,
          repository: selected.repository,
          project: selected.project,
          updatedByUserId: USER_ID,
          updatedAt: "2026-07-16T00:30:00.000Z"
        }
      : null;
  }

  async listBoards(currentUserId, workspaceId, query) {
    this.calls.push({ method: "listBoards", currentUserId, workspaceId, query });
    return {
      data: this.boards,
      meta: { page: 1, limit: query.limit, total: this.boards.length }
    };
  }

  async getBoard(currentUserId, workspaceId, boardId) {
    this.calls.push({ method: "getBoard", currentUserId, workspaceId, boardId });
    const selected = this.boards.find((candidate) => candidate.id === boardId);
    return {
      ...selected,
      summary: {
        columnsCount: 3,
        totalCards: 3,
        openCards: 2,
        closedCards: 1
      },
      sync: {
        status: selected.syncStatus,
        lastSyncedAt: selected.lastSyncedAt
      }
    };
  }

  async listBoardColumns(currentUserId, workspaceId, boardId) {
    this.calls.push({ method: "listBoardColumns", currentUserId, workspaceId, boardId });
    return this.columns.map((column) => ({ ...column, boardId }));
  }

  async listBoardIssues(currentUserId, workspaceId, boardId, query) {
    this.calls.push({ method: "listBoardIssues", currentUserId, workspaceId, boardId, query });
    const data = this.issues.filter((candidate) => candidate.boardId === boardId);
    return {
      data,
      meta: { page: query.page, limit: query.limit, total: data.length }
    };
  }

  async getBoardIssue(currentUserId, workspaceId, boardId, issueId) {
    this.calls.push({ method: "getBoardIssue", currentUserId, workspaceId, boardId, issueId });
    return this.issues.find(
      (candidate) => candidate.boardId === boardId && candidate.id === issueId
    );
  }

  async listBoardIssuePullRequests(currentUserId, workspaceId, boardId, issueId) {
    this.calls.push({
      method: "listBoardIssuePullRequests",
      currentUserId,
      workspaceId,
      boardId,
      issueId
    });
    return [
      {
        id: "pr-135",
        repositoryId: "repository-product",
        githubPullRequestId: 135,
        githubNodeId: "PR_135",
        githubNumber: 135,
        title: "Implement Board Agent tools",
        authorName: "alice",
        authorAvatarUrl: null,
        state: "open",
        draft: false,
        mergeable: true,
        createdAtGithub: "2026-07-15T00:00:00.000Z",
        updatedAtGithub: "2026-07-16T00:50:00.000Z",
        headBranch: "feat/134-board-agent",
        baseBranch: "dev",
        headSha: "head",
        baseSha: "base",
        changedFilesCount: 4,
        additions: 100,
        deletions: 10,
        commitsCount: 2,
        commentsCount: 1,
        reviewCommentsCount: 0,
        githubUrl: "https://github.com/pilo/product/pull/135",
        lastSyncedAt: "2026-07-16T00:51:00.000Z"
      }
    ];
  }

  async getBoardFilterOptions(currentUserId, workspaceId, boardId) {
    this.calls.push({ method: "getBoardFilterOptions", currentUserId, workspaceId, boardId });
    return {
      columns: this.columns.map((column) => ({
        id: column.id,
        name: column.name,
        normalizedName: column.normalizedName,
        count: column.issueCount
      })),
      states: [
        { value: "open", label: "Open", count: 2 },
        { value: "closed", label: "Closed", count: 1 }
      ],
      assignees: [
        { login: "alice", avatarUrl: null, count: 1 },
        { login: "bob", avatarUrl: null, count: 1 }
      ],
      labels: [{ name: "agent", color: "0052cc", count: 1 }]
    };
  }

  async updateBoardIssueStatus(currentUserId, workspaceId, boardId, issueId, body) {
    this.calls.push({
      method: "updateBoardIssueStatus",
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      body
    });
    const current = this.issues.find((candidate) => candidate.id === issueId);
    const previousColumnId = current.columnId;
    current.columnId = body.columnId;
    return { issue: current, previousColumnId };
  }

  async createBoardIssue(currentUserId, workspaceId, boardId, body, idempotencyKey) {
    this.calls.push({
      method: "createBoardIssue",
      currentUserId,
      workspaceId,
      boardId,
      body,
      idempotencyKey
    });
    const created = issue({
      id: "102",
      boardId,
      columnId: body.columnId,
      githubIssueNumber: 245,
      issueNumber: "#245",
      title: body.title,
      body: body.body ?? null,
      assignees: []
    });
    this.issues.push(created);
    return { issue: created, statusCode: 201 };
  }

  async listBoardIssueAssigneeOptions(currentUserId, workspaceId, boardId, issueId) {
    this.calls.push({
      method: "listBoardIssueAssigneeOptions",
      currentUserId,
      workspaceId,
      boardId,
      issueId
    });
    return ["alice", "bob", "carol"].map((login) => ({ login, avatarUrl: null }));
  }

  async updateBoardIssue(currentUserId, workspaceId, boardId, issueId, body) {
    this.calls.push({
      method: "updateBoardIssue",
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      body
    });
    const current = this.issues.find((candidate) => candidate.id === issueId);
    current.assignees = body.assignees.map((login) => ({ login }));
    return { issue: current };
  }

  async updateBoardIssueAssigneesDelta(
    currentUserId,
    workspaceId,
    boardId,
    issueId,
    input
  ) {
    this.calls.push({
      method: "updateBoardIssueAssigneesDelta",
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      input
    });
    const current = this.issues.find((candidate) => candidate.id === issueId);
    const assignees = new Map(
      current.assignees.map((assignee) => [
        assignee.login.toLowerCase(),
        assignee.login
      ])
    );
    for (const login of input.removeAssignees) {
      assignees.delete(login.toLowerCase());
    }
    for (const login of input.addAssignees) {
      assignees.set(login.toLowerCase(), login);
    }
    current.assignees = [...assignees.values()].map((login) => ({ login }));
    return { issue: current };
  }
}

function createTools() {
  const boardService = new FakeBoardService();
  const resolver = new BoardContextResolverService(boardService);
  const tools = new BoardAgentToolsService(boardService, resolver);
  const definitions = new Map(
    tools.listDefinitions().map((definition) => [definition.name, definition])
  );
  return { boardService, resolver, definitions };
}

function definition(definitions, name) {
  const found = definitions.get(name);
  assert.ok(found, `${name} should be registered`);
  return found;
}

{
  const { definitions } = createTools();
  assert.deepEqual([...definitions.keys()], [
    "search_board_issues",
    "move_board_issue_status",
    "get_board_issue_context",
    "create_board_issue",
    "resolve_board_context",
    "get_board_briefing",
    "assign_board_issue_safely",
    "diagnose_board_freshness"
  ]);
  for (const name of [
    "move_board_issue_status",
    "create_board_issue",
    "assign_board_issue_safely"
  ]) {
    const tool = definition(definitions, name);
    assert.equal(tool.riskLevel, "medium");
    assert.equal(tool.executionMode, "confirmation_required");
  }
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "resolve_board_context");
  const explicit = await tool.execute(
    context,
    tool.validateInput({
      boardName: "Archive Board",
      repositoryFullName: "pilo/archive"
    })
  );
  assert.equal(explicit.outputSummary.selection, "selected");
  assert.equal(explicit.outputSummary.source, "explicit");
  assert.equal(explicit.outputSummary.board.name, "Archive Board");

  const active = await tool.execute(context, tool.validateInput({}));
  assert.equal(active.outputSummary.source, "active");
  assert.equal(active.outputSummary.board.name, "Product Board");
  const missing = await tool.execute(
    context,
    tool.validateInput({ boardName: "Missing Board" })
  );
  assert.equal(missing.status, "needs_clarification");
  assert.equal(missing.outputSummary.reason, "board_not_found");
  assert.equal(missing.outputSummary.selection, "none");
  assert.deepEqual(missing.outputSummary.boards, []);


  boardService.activeBoardId = null;
  const ambiguous = await tool.execute(context, tool.validateInput({}));
  assert.equal(ambiguous.status, "needs_clarification");
  assert.equal(ambiguous.outputSummary.selection, "required");
  assert.equal(ambiguous.outputSummary.boards.length, 2);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "move_board_issue_status");
  const input = tool.validateInput({
    issueNumber: "#134",
    columnName: "In Progress"
  });
  const plan = await tool.buildConfirmation(context, input);
  assert.equal(plan.toolName, "move_board_issue_status");
  assert.equal(plan.before.columnName, "Todo");
  assert.equal(plan.after.columnName, "In Progress");
  assert.equal(
    Object.prototype.hasOwnProperty.call(plan.after, "boardId"),
    false
  );
  const confirmedInput = tool.validateConfirmationInput(
    tool.buildConfirmationInput(plan)
  );
  await tool.execute(context, confirmedInput);
  const call = boardService.calls.find(
    (candidate) => candidate.method === "updateBoardIssueStatus"
  );
  assert.deepEqual(call.body, { columnId: "8", previousColumnId: "7" });
}

{
  const { boardService, definitions } = createTools();
  boardService.issues[0].milestone = {
    title: "Agent MVP",
    state: "open",
    due_on: "2026-07-31T00:00:00.000Z"
  };
  const tool = definition(definitions, "get_board_issue_context");
  const result = await tool.execute(
    context,
    tool.validateInput({ issueNumber: "134" })
  );
  assert.equal(result.outputSummary.issue.issueNumber, "#134");
  assert.equal(result.outputSummary.relatedPullRequests.source, "cached_heuristic");
  assert.equal(result.outputSummary.relatedPullRequests.items.length, 1);
  assert.equal(result.outputSummary.relatedPullRequests.items[0].number, 135);
  assert.equal(result.resourceRefs.length, 2);
  assert.equal(
    boardService.calls.filter((candidate) => candidate.method === "getBoardIssue").length,
    1
  );

  const answer = buildAgentReadResultAnswer({
    toolName: tool.name,
    outputSummary: result.outputSummary,
    resourceRefs: result.resourceRefs
  });
  assert.match(answer, /#134/);
  assert.match(answer, /라벨: agent/);
  assert.match(answer, /담당자: alice, bob/);
  assert.match(answer, /마일스톤: Agent MVP · open · 마감 2026-07-31/);
  assert.match(answer, /프로젝트 필드:/);
  assert.match(answer, /Status: Todo/);
  assert.match(answer, /관련 PR 1개/);
  assert.doesNotMatch(answer, /githubIssueNodeId|projectItemId/);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  assert.deepEqual(tool.inputSchema.required, ["title"]);
  const defaultPlan = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Default placement issue", body: "Automatic selection" })
  );
  assert.equal(defaultPlan.target.boardId, "42");
  assert.equal(defaultPlan.after.columnName, "Unmapped");
  assert.equal(defaultPlan.call.columnId, "9");
  const input = tool.validateInput({
    title: "새 Agent 이슈",
    body: "확인 후 생성",
    columnName: "Todo"
  });
  const firstPlan = await tool.buildConfirmation(context, input);
  const secondPlan = await tool.buildConfirmation(context, input);
  assert.equal(firstPlan.call.idempotencyKey, `agent:${RUN_ID}:create_board_issue`);
  assert.equal(secondPlan.call.idempotencyKey, firstPlan.call.idempotencyKey);
  const confirmedInput = tool.validateConfirmationInput(
    tool.buildConfirmationInput(firstPlan)
  );
  const result = await tool.execute(context, confirmedInput);
  assert.equal(result.outputSummary.issue.issueNumber, "#245");
  const call = boardService.calls.find(
    (candidate) => candidate.method === "createBoardIssue"
  );
  assert.equal(call.idempotencyKey, `agent:${RUN_ID}:create_board_issue`);
  assert.deepEqual(call.body, {
    title: "새 Agent 이슈",
    body: "확인 후 생성",
    columnId: "7"
  });
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  boardService.activeBoardId = null;
  boardService.boards = [boardService.boards[0]];
  const plan = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Only Board default" })
  );
  assert.equal(plan.target.boardId, "42");
  assert.equal(plan.after.columnName, "Unmapped");
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  boardService.activeBoardId = null;
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Ambiguous Board" })
  );
  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.reason, "board_ambiguous");
  assert.equal(result.outputSummary.boards.length, 2);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  boardService.columns = boardService.columns.filter((column) => column.id !== "9");
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Missing default Column" })
  );
  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.reason, "unmapped_column_missing");
  assert.equal(result.outputSummary.boardName, "Product Board");

  const answer = buildAgentReadResultAnswer({
    toolName: tool.name,
    outputSummary: result.outputSummary,
    resourceRefs: result.resourceRefs
  });
  assert.match(answer, /GitHub repository/);
  assert.match(answer, /ProjectV2/);
  assert.match(answer, /sync|동기화/i);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  boardService.columns.push({ ...boardService.columns[2], id: "10" });
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Ambiguous default Column" })
  );
  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.reason, "unmapped_column_missing");
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "create_board_issue");
  boardService.columns[2] = {
    ...boardService.columns[2],
    githubStatusOptionId: "provider-unmapped"
  };
  const providerBacked = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Provider-backed Unmapped" })
  );
  assert.equal(providerBacked.outputSummary.reason, "unmapped_column_missing");

  boardService.columns[2] = {
    ...boardService.columns[2],
    githubStatusOptionId: null,
    normalizedName: "todo"
  };
  const wrongNormalizedName = await tool.buildConfirmation(
    context,
    tool.validateInput({ title: "Name-only Unmapped" })
  );
  assert.equal(wrongNormalizedName.outputSummary.reason, "unmapped_column_missing");
}

{
  const { definitions } = createTools();
  const tool = definition(definitions, "get_board_briefing");
  const result = await tool.execute(context, tool.validateInput({}));
  assert.deepEqual(result.outputSummary.summary, {
    columnsCount: 3,
    totalCards: 3,
    openCards: 2,
    closedCards: 1
  });
  assert.deepEqual(result.outputSummary.columns[0], { name: "Todo", count: 1 });
  assert.deepEqual(result.outputSummary.labels[0], {
    name: "agent",
    color: "0052cc",
    count: 1
  });
  assert.equal("priority" in result.outputSummary, false);

  const answer = buildAgentReadResultAnswer({
    toolName: tool.name,
    outputSummary: result.outputSummary,
    resourceRefs: result.resourceRefs
  });
  assert.match(answer, /전체 3개/);
  assert.match(answer, /Todo 1개/);
  assert.match(answer, /상태 분포: Open 2개, Closed 1개/);
  assert.match(answer, /라벨 분포: agent 1개/);
  assert.match(answer, /담당자 분포: alice 1개, bob 1개/);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "assign_board_issue_safely");
  const input = tool.validateInput({
    issueNumber: "#134",
    addAssignees: ["carol"],
    removeAssignees: ["bob"]
  });
  const plan = await tool.buildConfirmation(context, input);
  assert.deepEqual(plan.before.assignees, ["alice", "bob"]);
  assert.deepEqual(plan.after.assignees, ["alice", "carol"]);
  assert.deepEqual(plan.after.retained, ["alice"]);
  assert.deepEqual(plan.after.added, ["carol"]);
  assert.deepEqual(plan.after.removed, ["bob"]);
  assert.deepEqual(plan.call.addAssignees, ["carol"]);
  assert.deepEqual(plan.call.removeAssignees, ["bob"]);

  const confirmedInput = tool.validateConfirmationInput(
    tool.buildConfirmationInput(plan)
  );
  assert.deepEqual(confirmedInput, {
    boardId: "42",
    issueId: "101",
    addAssignees: ["carol"],
    removeAssignees: ["bob"]
  });

  boardService.issues[0].assignees = [{ login: "dave" }];
  await tool.execute(context, confirmedInput);
  const updateCall = boardService.calls.find(
    (candidate) => candidate.method === "updateBoardIssueAssigneesDelta"
  );
  assert.deepEqual(updateCall.input, {
    addAssignees: ["carol"],
    removeAssignees: ["bob"]
  });
  assert.deepEqual(boardService.issues[0].assignees, [
    { login: "dave" },
    { login: "carol" }
  ]);
  assert.equal(
    boardService.calls.some((candidate) => candidate.method === "updateBoardIssue"),
    false
  );
}

{
  const { boardService, definitions } = createTools();
  boardService.issues[0].assignees = [{ login: "legacy-user" }];
  const tool = definition(definitions, "assign_board_issue_safely");
  const input = tool.validateInput({
    issueNumber: "#134",
    addAssignees: ["carol"]
  });
  const plan = await tool.buildConfirmation(context, input);
  assert.notEqual(plan.kind, "needs_clarification");
  assert.deepEqual(plan.after.assignees, ["carol", "legacy-user"]);
  assert.deepEqual(plan.after.retained, ["legacy-user"]);
  assert.deepEqual(plan.after.added, ["carol"]);
  assert.deepEqual(plan.after.removed, []);
  assert.deepEqual(plan.call.addAssignees, ["carol"]);
  assert.deepEqual(plan.call.removeAssignees, []);
}

{
  const { definitions } = createTools();
  const tool = definition(definitions, "assign_board_issue_safely");
  const invalid = tool.validateInput({
    issueNumber: "#134",
    addAssignees: ["not-assignable"]
  });
  const result = await tool.buildConfirmation(context, invalid);
  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.reason, "assignee_not_assignable");
  assert.deepEqual(result.outputSummary.invalidAssignees, ["not-assignable"]);
}

{
  const { boardService, definitions } = createTools();
  const tool = definition(definitions, "diagnose_board_freshness");
  const result = await tool.execute(context, tool.validateInput({}));
  assert.equal(result.outputSummary.active.isActive, true);
  assert.equal(result.outputSummary.sync.status, "success");
  assert.equal(result.outputSummary.sync.lastHydratedAt, "2026-07-16T01:00:00.000Z");
  assert.equal(result.outputSummary.issueFreshness.sampled, 1);
  assert.equal(result.outputSummary.pullRequestFreshness.relatedCount, 1);
  assert.deepEqual(result.outputSummary.unmapped, {
    present: true,
    count: 2
  });
  assert.equal(
    boardService.calls.some((candidate) =>
      ["createBoard", "setActiveBoardSource"].includes(candidate.method)
    ),
    false
  );

  const answer = buildAgentReadResultAnswer({
    toolName: tool.name,
    outputSummary: result.outputSummary,
    resourceRefs: result.resourceRefs
  });
  assert.match(answer, /동기화 상태: success/);
  assert.match(answer, /Unmapped 2개/);
  assert.match(
    answer,
    /active Board: 예 · source 갱신 2026-07-16T00:30:00.000Z/
  );
  assert.match(
    answer,
    /이슈 표본: 전체 · 가장 오래된 cache 2026-07-16T01:00:00.000Z · 최신 cache 2026-07-16T01:00:00.000Z/
  );
  assert.match(
    answer,
    /관련 PR cache: 가장 오래된 2026-07-16T00:51:00.000Z · 최신 2026-07-16T00:51:00.000Z/
  );
}

{
  const { definitions } = createTools();
  const tool = definition(definitions, "get_board_issue_context");
  assert.throws(
    () => tool.validateInput({ issueNumber: "#134", boardId: "42" }),
    (error) => {
      assert.equal(
        error.getResponse().error.message,
        "boardId must not be provided to Board tools"
      );
      return true;
    }
  );
  assert.throws(
    () => tool.validateInput({ issueNumber: "issue-latest" }),
    (error) => {
      assert.equal(
        error.getResponse().error.message,
        "issueNumber must be a positive GitHub issue number"
      );
      return true;
    }
  );
}

console.log("agent board tools tests passed");
