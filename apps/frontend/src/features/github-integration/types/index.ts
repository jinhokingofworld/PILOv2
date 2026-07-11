export type GithubOAuthStatus = {
  connected: boolean;
  githubUserId: number | null;
  githubLogin: string | null;
  tokenScope: string | null;
  githubConnectedAt: string | null;
  githubRevokedAt: string | null;
};

export type GithubOAuthStart = {
  authorizeUrl: string;
  state: string;
};

export type GithubOAuthDisconnect = {
  disconnected: true;
};

export type GithubProjectOAuthStatus = GithubOAuthStatus;

export type GithubProjectOAuthStart = GithubOAuthStart;

export type GithubProjectOAuthDisconnect = GithubOAuthDisconnect;

export type GithubAppInstallation = {
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
};

export type GithubAppInstallationDelete = {
  deleted: true;
  alreadyDeleted: boolean;
  installationId: string;
  githubInstallationId: number;
  accountLogin: string;
};

export type GithubAppInstallationStart = {
  installUrl: string;
  state: string;
};

export type GithubPaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export type GithubPaginatedPayload<T> = {
  data: T[];
  meta: GithubPaginationMeta;
};

export type GithubRepository = {
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

export type GithubRepositoryCollaboratorStatus = {
  repository: {
    id: string;
    fullName: string;
  };
  githubLogin: string;
  permission: string | null;
  hasAccess: boolean;
  checkedAt: string;
};

export type GithubProjectV2 = {
  id: string;
  installationId: string;
  githubProjectNodeId: string;
  githubProjectFullDatabaseId: number | null;
  ownerLogin: string;
  ownerType: "User" | "Organization";
  projectNumber: number;
  title: string;
  shortDescription: string | null;
  url: string;
  public: boolean;
  closed: boolean;
  template: boolean;
  repositoryIds: string[];
  selected: boolean;
  lastSyncedAt: string | null;
};

export type ReplaceGithubProjectV2SelectionsInput = {
  installationId: string;
  projectV2Ids: string[];
};

export type GithubProjectV2Selection = ReplaceGithubProjectV2SelectionsInput;

export type GithubProjectV2SelectionResult = GithubProjectV2Selection & {
  syncRunId: string | null;
  syncStatus: "queued" | "failed" | null;
  syncError: string | null;
};

export type GithubProjectV2Discovery = {
  connectionRequired: boolean;
  installationId: string;
  projects: GithubProjectV2[];
};

export type GithubProjectV2AccessPermission = "ADMIN" | "WRITE" | "READ";

export type GithubProjectV2AccessStatus = {
  project: {
    id: string;
    title: string;
    ownerLogin: string;
  };
  githubLogin: string;
  permission: GithubProjectV2AccessPermission | null;
  hasAccess: boolean;
  canUpdate: boolean;
  canManageAccess: boolean;
  checkedAt: string;
};

export type GithubPullRequest = {
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

export type GithubSyncTarget =
  | "repositories"
  | "issues"
  | "pull_requests"
  | "project_v2"
  | "project_v2_fields"
  | "project_v2_items"
  | "full";

export type GithubSyncStatus = "running" | "success" | "failed";

export type GithubSyncProgressStage =
  | "initializing"
  | "repositories"
  | "project_v2_discovery"
  | "issues"
  | "pull_requests"
  | "project_v2"
  | "project_v2_fields"
  | "project_v2_items"
  | "board_hydration"
  | "finalizing"
  | "completed";

export type GithubSyncRun = {
  id: string;
  target: GithubSyncTarget;
  status: GithubSyncStatus;
  installationId: string | null;
  repositoryId: string | null;
  projectV2Id: string | null;
  startedAt: string;
  finishedAt: string | null;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  progressPercent: number;
  progressStage: GithubSyncProgressStage;
  errorMessage: string | null;
};

export type StartGithubOAuthInput = {
  returnUrl?: string;
};

export type StartGithubAppInstallationInput = {
  returnUrl?: string;
};

export type ListGithubRepositoriesQuery = {
  q?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
};

export type ListGithubProjectsV2Query = {
  ownerLogin?: string;
  closed?: boolean;
  q?: string;
  management?: boolean;
  page?: number;
  limit?: number;
};

export type ListGithubPullRequestsQuery = {
  state?: "open" | "closed";
  query?: string;
  page?: number;
  limit?: number;
};

export type StartGithubSyncRunInput = {
  target: GithubSyncTarget;
  installationId: string;
  repositoryId?: string;
  projectV2Id?: string;
};

export type ListGithubSyncRunsQuery = {
  target?: GithubSyncTarget;
  status?: GithubSyncStatus;
  repositoryId?: string;
  projectV2Id?: string;
  page?: number;
  limit?: number;
};
