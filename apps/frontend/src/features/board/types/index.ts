export type BoardSyncStatus = "running" | "success" | "failed";
export type BoardIssueState = "open" | "closed";

export type BoardRepositoryPayload = {
  id: string;
  fullName: string;
  htmlUrl: string;
};

export type BoardProjectPayload = {
  id: string;
  githubProjectNodeId: string;
  projectNumber: number;
  title: string;
  url: string;
};

export type BoardStatusFieldPayload = {
  id: string;
  githubFieldNodeId: string;
  name: string;
};

export type BoardPayload = {
  id: string;
  workspaceId: string;
  name: string;
  repository: BoardRepositoryPayload;
  project: BoardProjectPayload;
  statusField: BoardStatusFieldPayload | null;
  syncStatus: BoardSyncStatus | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardPaginatedPayload<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};

export type BoardSummaryPayload = {
  columnsCount: number;
  totalCards: number;
  openCards: number;
  closedCards: number;
};

export type BoardSyncPayload = {
  status: BoardSyncStatus | null;
  lastSyncedAt: string | null;
};

export type BoardDetailPayload = {
  id: string;
  workspaceId: string;
  name: string;
  repository: BoardRepositoryPayload;
  project: BoardProjectPayload;
  statusField: BoardStatusFieldPayload | null;
  summary: BoardSummaryPayload;
  sync: BoardSyncPayload;
  createdAt: string;
  updatedAt: string;
};

export type BoardColumnPayload = {
  id: string;
  boardId: string;
  statusOptionId: string | null;
  githubStatusOptionId: string | null;
  name: string;
  normalizedName: string | null;
  position: number;
  color: string | null;
  issueCount: number;
};

export type BoardIssueCardPayload = {
  id: string;
  boardId: string;
  columnId: string;
  repositoryId: string | null;
  githubIssueId: string | null;
  projectItemId: string | null;
  githubIssueNodeId: string | null;
  githubProjectItemNodeId: string | null;
  githubIssueNumber: number | null;
  issueNumber: string;
  title: string;
  htmlUrl: string | null;
  state: BoardIssueState | null;
  labels: unknown[];
  assignees: unknown[];
  position: number;
  githubUpdatedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardProjectFieldPayload = {
  fieldName: string;
  fieldDataType: string | null;
  textValue?: string;
  numberValue?: number;
  dateValue?: string;
  singleSelectOptionId?: string;
  singleSelectName?: string;
  iterationId?: string;
  iterationTitle?: string;
};

export type BoardIssueDetailPayload = BoardIssueCardPayload & {
  body: string | null;
  milestone: Record<string, unknown> | null;
  projectFields: BoardProjectFieldPayload[];
};

export type BoardRelatedPullRequestPayload = {
  id: string;
  repositoryId: string;
  githubPullRequestId: number | null;
  githubNodeId: string | null;
  githubNumber: number;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  state: BoardIssueState;
  draft: boolean;
  mergeable: boolean | null;
  createdAtGithub: string | null;
  updatedAtGithub: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  headSha: string | null;
  baseSha: string | null;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  commentsCount: number;
  reviewCommentsCount: number;
  githubUrl: string;
  lastSyncedAt: string | null;
};

export type BoardFilterColumnOptionPayload = {
  id: string;
  name: string;
  normalizedName: string | null;
  count: number;
};

export type BoardFilterStateOptionPayload = {
  value: BoardIssueState;
  label: "Open" | "Closed";
  count: number;
};

export type BoardFilterAssigneeOptionPayload = {
  login: string;
  avatarUrl: string | null;
  count: number;
};

export type BoardFilterLabelOptionPayload = {
  name: string;
  color: string | null;
  count: number;
};

export type BoardFilterOptionsPayload = {
  columns: BoardFilterColumnOptionPayload[];
  states: BoardFilterStateOptionPayload[];
  assignees: BoardFilterAssigneeOptionPayload[];
  labels: BoardFilterLabelOptionPayload[];
};

export type CreateBoardInput = {
  repositoryId: string;
  projectV2Id: string;
};

export type CreateBoardIssueInput = {
  title: string;
  body?: string;
  columnId: string;
};

export type CreateBoardIssueCommand = CreateBoardIssueInput & {
  idempotencyKey: string;
};

export type CreateBoardIssuePayload = {
  issue: BoardIssueCardPayload;
};

export type UpdateBoardIssueStatusInput = {
  columnId: string;
  previousColumnId?: string;
};

export type UpdateBoardIssueStatusPayload = {
  issue: BoardIssueCardPayload;
  previousColumnId: string;
};

export type UpdateBoardIssueInput = {
  title?: string;
  body?: string;
  state?: BoardIssueState;
};

export type UpdateBoardIssuePayload = {
  issue: BoardIssueDetailPayload;
};

export type ListBoardsQuery = {
  repositoryId?: string;
  projectV2Id?: string;
  page?: number;
  limit?: number;
};

export type ListBoardIssuesQuery = {
  columnId?: string;
  state?: BoardIssueState;
  search?: string;
  label?: string;
  assignee?: string;
  page?: number;
  limit?: number;
};
