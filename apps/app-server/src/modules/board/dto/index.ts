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
