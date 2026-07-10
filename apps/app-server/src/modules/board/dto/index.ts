export interface CreateBoardRequest {
  repositoryId?: unknown;
  projectV2Id?: unknown;
}

export interface ListBoardsQuery {
  repositoryId?: unknown;
  projectV2Id?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface ListBoardIssuesQuery {
  columnId?: unknown;
  state?: unknown;
  search?: unknown;
  label?: unknown;
  assignee?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface UpdateBoardIssueStatusRequest {
  columnId?: unknown;
  previousColumnId?: unknown;
}

export interface UpdateBoardIssueRequest {
  assignees?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
}

export interface CreateBoardIssueRequest {
  title?: unknown;
  body?: unknown;
  columnId?: unknown;
}
