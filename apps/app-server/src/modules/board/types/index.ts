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

export interface CreateBoardResult {
  board: BoardPayload;
  statusCode: 200 | 201;
}
