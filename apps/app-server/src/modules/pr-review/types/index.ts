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

export type PrReviewFileReviewStatus =
  | "not_reviewed"
  | "approved"
  | "discussion_needed"
  | "unknown";

export type PrReviewFileRiskLevel = "high" | "medium" | "low" | "unknown";

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

export interface PrReviewGithubConflictContentPayload {
  filePath: string;
  mergeBaseContent: string | null;
  baseContent: string | null;
  headContent: string | null;
  headBlobSha: string | null;
  unsupportedReason: string | null;
}

export interface PrReviewGithubConflictInputsPayload {
  mergeBaseSha: string;
  files: PrReviewGithubConflictContentPayload[];
}

export type PrReviewGithubReviewSubmitType =
  | "COMMENT"
  | "APPROVE"
  | "REQUEST_CHANGES";

export interface PrReviewGithubReviewSubmissionPayload {
  submittedByGithubLogin: string;
  githubReviewId: string | null;
  githubReviewUrl: string | null;
  submittedAt: string;
}

export interface PrReviewGithubConflictApplyInput {
  filePath: string;
  resolvedContent: string;
  expectedBaseSha: string;
  expectedHeadSha: string;
  expectedHeadBlobSha: string;
}

export interface PrReviewGithubConflictApplyPayload {
  appliedByGithubLogin: string;
  commitSha: string;
  commitUrl: string | null;
  headShaBefore: string;
  headShaAfter: string;
  headBlobShaBefore: string;
  headBlobShaAfter: string;
  localCacheUpdated: boolean;
}

export interface PrReviewGithubPullRequestMergeInput {
  expectedHeadSha: string;
}

export interface PrReviewGithubPullRequestMergePayload {
  mergedByGithubLogin: string;
  mergeMethod: "merge";
  mergeCommitSha: string;
  mergeCommitUrl: string | null;
  pullRequestState: "closed";
  mergedAt: string | null;
  headSha: string;
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

  getPullRequestConflictInputs(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: {
      baseSha: string;
      headSha: string;
      filePaths: string[];
    }
  ): Promise<PrReviewGithubConflictInputsPayload>;

  submitPullRequestReview(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: {
      submitType: PrReviewGithubReviewSubmitType;
      reviewBody: string;
    }
  ): Promise<PrReviewGithubReviewSubmissionPayload>;

  applyPullRequestFileResolution(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: PrReviewGithubConflictApplyInput
  ): Promise<PrReviewGithubConflictApplyPayload>;

  mergePullRequest(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: PrReviewGithubPullRequestMergeInput
  ): Promise<PrReviewGithubPullRequestMergePayload>;
}
