export type GitHubIntegrationModuleInfo = {
  domain: "github-integration";
  apiContract: "docs/api/github-integration-api.md";
};

export interface GithubOAuthStatusPayload {
  connected: boolean;
  githubUserId: number | null;
  githubLogin: string | null;
  tokenScope: string | null;
  githubConnectedAt: string | null;
  githubRevokedAt: string | null;
}

export interface GithubOAuthStartPayload {
  authorizeUrl: string;
  state: string;
}

export interface GithubOAuthCallbackPayload {
  connected: true;
  githubUserId: number;
  githubLogin: string;
  tokenScope: string | null;
  githubConnectedAt: string;
}

export interface GithubOAuthDisconnectPayload {
  disconnected: true;
}

export interface GithubAppInstallationPayload {
  id: string;
  workspaceId: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string | null;
  permissions: Record<string, unknown>;
  installedByUserId: string | null;
  installedAt: string | null;
  suspendedAt: string | null;
  lastSyncedAt: string | null;
}

export interface GithubAppInstallationStartPayload {
  installUrl: string;
  state: string;
}

export interface GithubAppInstallationCallbackPayload
  extends Omit<GithubAppInstallationPayload, "id"> {
  installationId: string;
}

export interface GithubPaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface GithubPaginatedPayload<T> {
  data: T[];
  meta: GithubPaginationMeta;
}

export interface GithubRepositoryListItemPayload {
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
}

export interface GithubRepositoryDetailPayload
  extends GithubRepositoryListItemPayload {
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
}

export interface GithubIssuePayload {
  id: string;
  repositoryId: string;
  githubIssueId: number | null;
  githubNodeId: string | null;
  issueNumber: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  stateReason: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  htmlUrl: string;
  labels: unknown[];
  assignees: unknown[];
  milestone: Record<string, unknown> | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  githubClosedAt: string | null;
  lastSyncedAt: string | null;
}

export interface GithubPullRequestListItemPayload {
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
}

export interface GithubPullRequestDetailPayload
  extends GithubPullRequestListItemPayload {
  description: string | null;
  closedAtGithub: string | null;
  mergedAt: string | null;
}
