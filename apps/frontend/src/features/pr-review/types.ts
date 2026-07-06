export type PrReviewPaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export type PrReviewPaginatedPayload<T> = {
  data: T[];
  meta: PrReviewPaginationMeta;
};

export type PrReviewRepository = {
  id: string;
  githubRepositoryId: number | null;
  githubNodeId: string | null;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
  htmlUrl: string;
  pushedAt: string | null;
  lastSyncedAt: string | null;
};

export type PrReviewPullRequest = {
  id: string;
  repositoryId: string;
  githubPullRequestId: number | null;
  githubNodeId: string | null;
  githubNumber: number;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  state: "open" | "closed";
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

export type PrReviewPullRequestDetail = PrReviewPullRequest & {
  description: string | null;
  closedAtGithub: string | null;
  mergedAt: string | null;
};

export type PrReviewPullRequestFile = {
  filePath: string;
  previousFilePath: string | null;
  fileName: string;
  fileStatus: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string;
  patch: string | null;
};

export type PrReviewFileStatus = PrReviewPullRequestFile["fileStatus"];

export type PrReviewSessionStatus =
  | "analyzing"
  | "reviewing"
  | "ready_to_submit"
  | "submitted"
  | "failed"
  | "archived";

export type PrReviewConflictStatus =
  | "checking"
  | "clean"
  | "conflicted"
  | "unknown";

export type PrReviewFileReviewStatus =
  | "not_reviewed"
  | "approved"
  | "discussion_needed"
  | "unknown";

export type PrReviewSession = {
  id: string;
  pullRequestId: string;
  headSha: string;
  status: PrReviewSessionStatus;
  prPurpose: string | null;
  changeSummary: string[];
  recommendedReviewOrder: string | null;
  cautionPoints: string[];
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrReviewSummary = {
  reviewSessionId: string;
  pullRequestId: string;
  githubNumber: number;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  githubUrl: string;
  headSha: string;
  status: PrReviewSessionStatus;
  prPurpose: string | null;
  changeSummary: string[];
  recommendedReviewOrder: string | null;
  cautionPoints: string[];
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
  readyToSubmit: boolean;
};

export type PrReviewFlow = {
  id: string;
  reviewSessionId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fileCount: number;
};

export type PrReviewFileNodeData = {
  reviewFileId: string;
  reviewSessionId: string;
  reviewFlowFileId: string;
  flowId: string;
  workflowOrder: number;
  fileName: string;
  filePath: string;
  roleSummary: string | null;
  reviewStatus: PrReviewFileReviewStatus;
};

export type PrReviewFlowFile = {
  id: string;
  reviewSessionId: string;
  flowId: string;
  reviewFileId: string;
  workflowOrder: number;
  filePath: string;
  fileName: string;
  fileStatus: PrReviewFileStatus;
  fileRole: string | null;
  currentStatus: PrReviewFileReviewStatus;
  fileNodeData: PrReviewFileNodeData;
};

export type PrReviewCanvasFlow = PrReviewFlow & {
  files: PrReviewFlowFile[];
};

export type PrReviewCanvasEdge = {
  fromReviewFileId: string;
  toReviewFileId: string;
  flowId: string;
  reason: string;
};

export type PrReviewCanvas = {
  reviewSessionId: string;
  headBranch: string | null;
  baseBranch: string | null;
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  flows: PrReviewCanvasFlow[];
  edges: PrReviewCanvasEdge[];
};

export type ListPrReviewRepositoriesQuery = {
  q?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
};

export type ListPrReviewPullRequestsQuery = {
  state?: "open" | "closed";
  query?: string;
  page?: number;
  limit?: number;
};
