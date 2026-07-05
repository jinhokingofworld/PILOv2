export type PrReviewModuleInfo = {
  domain: "pr-review";
  apiContract: "docs/api/pr-review-api.md";
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

export type PrReviewFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface PrReviewGithubOAuthStatus {
  connected: boolean;
  githubUserId: number | null;
  githubLogin: string | null;
  tokenScope: string | null;
  githubConnectedAt: string | null;
  githubRevokedAt: string | null;
}

export interface PrReviewGithubPullRequestDetail {
  id: string;
  repositoryId: string;
  prNumber: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  mergeable: boolean | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  headSha: string;
  baseSha: string | null;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  htmlUrl: string;
}

export interface PrReviewGithubChangedFile {
  filePath: string;
  previousFilePath: string | null;
  fileName: string;
  fileStatus: PrReviewFileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string | null;
  patch: string | null;
  patchSizeBytes: number;
}

export interface PrReviewGithubConflictStatusPayload {
  conflictStatus: PrReviewConflictStatus;
  checkedAt: string | null;
}

export interface PrReviewGithubDependency {
  getCurrentUserGithubOAuthStatus(
    currentUserId: string
  ): Promise<PrReviewGithubOAuthStatus>;

  getPullRequestDetail(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubPullRequestDetail>;

  getPullRequestChangedFiles(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubChangedFile[]>;

  getPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubConflictStatusPayload>;
}
