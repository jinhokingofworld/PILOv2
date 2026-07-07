export type BoardSyncStatus = "running" | "success" | "failed";
export type BoardIssueState = "open" | "closed";

export interface BoardRepositoryPayload {
  id: string;
  fullName: string;
  htmlUrl: string;
}

export interface BoardProjectPayload {
  id: string;
  githubProjectNodeId: string;
  projectNumber: number;
  title: string;
  url: string;
}

export interface BoardStatusFieldPayload {
  id: string;
  githubFieldNodeId: string;
  name: string;
}

export interface BoardPayload {
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
}

export interface BoardPaginatedPayload<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface BoardSummaryPayload {
  columnsCount: number;
  totalCards: number;
  openCards: number;
  closedCards: number;
}

export interface BoardSyncPayload {
  status: BoardSyncStatus | null;
  lastSyncedAt: string | null;
}

export interface BoardDetailPayload {
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
}

export interface BoardColumnPayload {
  id: string;
  boardId: string;
  statusOptionId: string | null;
  githubStatusOptionId: string | null;
  name: string;
  normalizedName: string | null;
  position: number;
  color: string | null;
  issueCount: number;
}

export interface BoardIssueCardPayload {
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
}

export interface BoardProjectFieldPayload {
  fieldName: string;
  fieldDataType: string | null;
  textValue?: string;
  numberValue?: number;
  dateValue?: string;
  singleSelectOptionId?: string;
  singleSelectName?: string;
  iterationId?: string;
  iterationTitle?: string;
}

export interface BoardIssueDetailPayload extends BoardIssueCardPayload {
  body: string | null;
  milestone: Record<string, unknown> | null;
  projectFields: BoardProjectFieldPayload[];
}

export interface BoardRelatedPullRequestPayload {
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
}

export interface BoardFilterColumnOptionPayload {
  id: string;
  name: string;
  normalizedName: string | null;
  count: number;
}

export interface BoardFilterStateOptionPayload {
  value: BoardIssueState;
  label: "Open" | "Closed";
  count: number;
}

export interface BoardFilterAssigneeOptionPayload {
  login: string;
  avatarUrl: string | null;
  count: number;
}

export interface BoardFilterLabelOptionPayload {
  name: string;
  color: string | null;
  count: number;
}

export interface BoardFilterOptionsPayload {
  columns: BoardFilterColumnOptionPayload[];
  states: BoardFilterStateOptionPayload[];
  assignees: BoardFilterAssigneeOptionPayload[];
  labels: BoardFilterLabelOptionPayload[];
}

export interface CreateBoardResult {
  board: BoardPayload;
  statusCode: 200 | 201;
}

export interface UpdateBoardIssueStatusPayload {
  issue: BoardIssueCardPayload;
  previousColumnId: string;
}

export interface UpdateBoardIssuePayload {
  issue: BoardIssueDetailPayload;
}

export interface CreateBoardIssuePayload {
  issue: BoardIssueCardPayload;
}
