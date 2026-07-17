import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { BoardReadQueries } = require("../../dist/modules/board/queries/board-read.queries.js");
const { BoardIssueCreateQueries } = require("../../dist/modules/board/queries/board-issue-create.queries.js");
const {
  BoardIssueReadService
} = require("../../dist/modules/board/board-issue-read.service.js");
const { BoardReadService } = require("../../dist/modules/board/board-read.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueId = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const boardId = "42";
const columnId = "7";
const issueId = "100";
const pullRequestId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

function createSubject(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const readQueries = new BoardReadQueries(database);
  const readService = new BoardReadService(
    readQueries,
    workspaceService,
    new BoardIssueCreateQueries(database)
  );
  const issueReadService = new BoardIssueReadService(
    readQueries,
    workspaceService
  );
  const service = new BoardService(
    { createBoard: () => assert.fail("createBoard should not be called") },
    readService,
    issueReadService
  );

  return {
    database,
    service,
    workspaceService
  };
}

function issueRow(overrides = {}) {
  return {
    id: issueId,
    board_id: boardId,
    column_id: columnId,
    repository_id: repositoryId,
    github_issue_id: githubIssueId,
    project_item_id: projectItemId,
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 135,
    issue_number: "#135",
    title: "Board issue 상세·관련 PR·filter-options 구현",
    body: "Issue 상세 패널에 필요한 본문입니다.",
    html_url: "https://github.com/Developer-EJ/PILO/issues/135",
    state: "open",
    labels: [{ name: "board", color: "ededed" }],
    assignees: [{ login: "juhyeong", avatar_url: "https://avatar.test/u/1" }],
    milestone: { title: "MVP" },
    position: "3",
    github_updated_at: "2026-07-06T01:04:27.000Z",
    last_synced_at: "2026-07-06T01:05:00.000Z",
    created_at: "2026-07-06T01:06:00.000Z",
    updated_at: "2026-07-06T01:07:00.000Z",
    ...overrides
  };
}

function projectFieldRow(overrides = {}) {
  return {
    field_name: "Priority",
    field_data_type: "SINGLE_SELECT",
    text_value: null,
    number_value: null,
    date_value: null,
    single_select_option_id: "priority-high",
    single_select_name: "High",
    iteration_id: null,
    iteration_title: null,
    ...overrides
  };
}

function pullRequestRow(overrides = {}) {
  return {
    id: pullRequestId,
    repository_id: repositoryId,
    github_pull_request_id: "9876",
    github_node_id: "PR_kwDOExample",
    pr_number: 88,
    title: "Fix Board issue detail",
    body: "Closes #135",
    author_login: "juhyeong",
    author_avatar_url: "https://avatar.test/u/1",
    head_branch: "feat/135-board-issue-detail-filter-options",
    base_branch: "dev",
    changed_files_count: "4",
    additions: "120",
    deletions: "8",
    commits_count: "3",
    comments_count: "1",
    review_comments_count: "0",
    html_url: "https://github.com/Developer-EJ/PILO/pull/88",
    github_created_at: "2026-07-06T02:00:00.000Z",
    github_updated_at: "2026-07-06T02:30:00.000Z",
    github_closed_at: null,
    merged_at: null,
    last_synced_at: "2026-07-06T02:31:00.000Z",
    raw: {
      state: "open",
      draft: false,
      mergeable: true,
      head: { sha: "head-sha" },
      base: { sha: "base-sha" }
    },
    ...overrides
  };
}

function assertNoRemoteGithubCall(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /api\.github\.com/i);
    assert.doesNotMatch(query.text, /sync-runs/i);
    assert.doesNotMatch(query.text, /github_sync_runs/i);
    assert.doesNotMatch(query.text, /token|private_key|secret/i);
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM pilo_issues pi/i);
        assert.match(text, /pi\.workspace_id = \$1/i);
        assert.match(text, /pi\.board_id = \$2::bigint/i);
        assert.match(text, /pi\.id = \$3::bigint/i);
        assert.match(text, /pi\.body/i);
        assert.match(text, /pi\.milestone/i);
        assert.doesNotMatch(text, /pi\.raw/i);
        assert.deepEqual(values, [workspaceId, boardId, issueId]);
        return issueRow();
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_project_v2_item_field_values/i);
        assert.match(text, /project_item_id = \$1/i);
        assert.match(text, /ORDER BY field_name ASC/i);
        assert.doesNotMatch(text, /raw/i);
        assert.deepEqual(values, [projectItemId]);
        return [
          projectFieldRow(),
          projectFieldRow({
            field_name: "Due date",
            field_data_type: "DATE",
            date_value: "2026-07-08",
            single_select_option_id: null,
            single_select_name: null
          })
        ];
      }
    ]
  });
  const { database: db, service, workspaceService } = createSubject(database);

  const detail = await service.getBoardIssue(
    currentUserId,
    workspaceId,
    boardId,
    issueId
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(detail, {
    id: issueId,
    boardId,
    columnId,
    repositoryId,
    githubIssueId,
    projectItemId,
    githubIssueNodeId: "I_kwDOExample",
    githubProjectItemNodeId: "PVTI_lADOExample",
    githubIssueNumber: 135,
    issueNumber: "#135",
    title: "Board issue 상세·관련 PR·filter-options 구현",
    body: "Issue 상세 패널에 필요한 본문입니다.",
    htmlUrl: "https://github.com/Developer-EJ/PILO/issues/135",
    state: "open",
    labels: [{ name: "board", color: "ededed" }],
    assignees: [{ login: "juhyeong", avatar_url: "https://avatar.test/u/1" }],
    milestone: { title: "MVP" },
    position: 3,
    projectFields: [
      {
        fieldName: "Priority",
        fieldDataType: "SINGLE_SELECT",
        singleSelectOptionId: "priority-high",
        singleSelectName: "High"
      },
      {
        fieldName: "Due date",
        fieldDataType: "DATE",
        dateValue: "2026-07-08"
      }
    ],
    githubUpdatedAt: "2026-07-06T01:04:27.000Z",
    lastSyncedAt: "2026-07-06T01:05:00.000Z",
    createdAt: "2026-07-06T01:06:00.000Z",
    updatedAt: "2026-07-06T01:07:00.000Z"
  });
  assertNoRemoteGithubCall(db);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createSubject(database);

  await assert.rejects(
    () => service.getBoardIssue(currentUserId, workspaceId, boardId, issueId),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "Board issue not found");
      return true;
    }
  );

  assert.equal(database.queries.length, 1);
}

{
  const database = new FakeDatabase({
    queryOneRows: [issueRow()],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_pull_requests pr/i);
        assert.match(text, /pr\.repository_id = \$1/i);
        assert.match(text, /pr\.body/i);
        assert.match(text, /pr\.title/i);
        assert.match(text, /pr\.raw::text/i);
        assert.match(text, /ORDER BY pr\.github_updated_at DESC NULLS LAST/i);
        assert.deepEqual(values, [
          repositoryId,
          "(^|[^0-9])#135([^0-9]|$)",
          "%issues/135%",
          "%https://github.com/Developer-EJ/PILO/issues/135%"
        ]);
        return [pullRequestRow()];
      }
    ]
  });
  const { database: db, service } = createSubject(database);

  const pullRequests = await service.listBoardIssuePullRequests(
    currentUserId,
    workspaceId,
    boardId,
    issueId
  );

  assert.deepEqual(pullRequests, [
    {
      id: pullRequestId,
      repositoryId,
      githubPullRequestId: 9876,
      githubNodeId: "PR_kwDOExample",
      githubNumber: 88,
      title: "Fix Board issue detail",
      authorName: "juhyeong",
      authorAvatarUrl: "https://avatar.test/u/1",
      state: "open",
      draft: false,
      mergeable: true,
      createdAtGithub: "2026-07-06T02:00:00.000Z",
      updatedAtGithub: "2026-07-06T02:30:00.000Z",
      headBranch: "feat/135-board-issue-detail-filter-options",
      baseBranch: "dev",
      headSha: "head-sha",
      baseSha: "base-sha",
      changedFilesCount: 4,
      additions: 120,
      deletions: 8,
      commitsCount: 3,
      commentsCount: 1,
      reviewCommentsCount: 0,
      githubUrl: "https://github.com/Developer-EJ/PILO/pull/88",
      lastSyncedAt: "2026-07-06T02:31:00.000Z"
    }
  ]);
  assertNoRemoteGithubCall(db);
}

{
  const database = new FakeDatabase({
    queryOneRows: [issueRow({ repository_id: null, github_issue_number: null })]
  });
  const { service } = createSubject(database);

  const pullRequests = await service.listBoardIssuePullRequests(
    currentUserId,
    workspaceId,
    boardId,
    issueId
  );

  assert.deepEqual(pullRequests, []);
  assert.equal(database.queries.length, 1);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM boards/i);
        assert.deepEqual(values, [workspaceId, boardId]);
        return { id: boardId };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM board_columns bc/i);
        assert.match(text, /LEFT JOIN pilo_issues pi/i);
        assert.deepEqual(values, [boardId]);
        return [
          {
            id: "7",
            name: "Backlog",
            normalized_name: "backlog",
            count: "3"
          }
        ];
      },
      (text, values) => {
        assert.match(text, /FROM pilo_issues/i);
        assert.match(text, /GROUP BY state/i);
        assert.deepEqual(values, [boardId]);
        return [{ state: "open", count: "3" }];
      },
      (text, values) => {
        assert.match(text, /jsonb_array_elements\(pi\.assignees\)/i);
        assert.match(text, /avatar_url/i);
        assert.deepEqual(values, [boardId]);
        return [
          {
            login: "juhyeong",
            avatar_url: "https://avatar.test/u/1",
            count: "2"
          }
        ];
      },
      (text, values) => {
        assert.match(text, /jsonb_array_elements\(pi\.labels\)/i);
        assert.deepEqual(values, [boardId]);
        return [{ name: "board", color: "ededed", count: "3" }];
      }
    ]
  });
  const { database: db, service } = createSubject(database);

  const options = await service.getBoardFilterOptions(
    currentUserId,
    workspaceId,
    boardId
  );

  assert.deepEqual(options, {
    columns: [
      {
        id: "7",
        name: "Backlog",
        normalizedName: "backlog",
        count: 3
      }
    ],
    states: [
      {
        value: "open",
        label: "Open",
        count: 3
      },
      {
        value: "closed",
        label: "Closed",
        count: 0
      }
    ],
    assignees: [
      {
        login: "juhyeong",
        avatarUrl: "https://avatar.test/u/1",
        count: 2
      }
    ],
    labels: [
      {
        name: "board",
        color: "ededed",
        count: 3
      }
    ]
  });
  assertNoRemoteGithubCall(db);
}
