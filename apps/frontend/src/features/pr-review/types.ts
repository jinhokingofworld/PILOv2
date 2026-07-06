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
