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
  returnUrl: string | null;
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

export interface GithubAppInstallationDeletePayload {
  deleted: true;
  alreadyDeleted: boolean;
  installationId: string;
  githubInstallationId: number;
  accountLogin: string;
}

export interface GithubAppInstallationStartPayload {
  installUrl: string;
  state: string;
}

export interface GithubAppInstallationCallbackPayload
  extends Omit<GithubAppInstallationPayload, "id"> {
  installationId: string;
  returnUrl: string | null;
}

export type GithubWebhookDeliveryStatus = "received" | "ignored";

export interface GithubWebhookDeliveryPayload {
  deliveryId: string;
  eventName: string;
  status: GithubWebhookDeliveryStatus;
  receivedAt: string;
  processedAt: string | null;
  message: string;
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

export type GithubProjectV2OwnerType = "User" | "Organization";

export type GithubProjectV2ItemContentType =
  | "ISSUE"
  | "PULL_REQUEST"
  | "DRAFT_ISSUE"
  | "UNKNOWN";

export interface GithubProjectV2ListItemPayload {
  id: string;
  installationId: string;
  githubProjectNodeId: string;
  githubProjectFullDatabaseId: number | null;
  ownerLogin: string;
  ownerType: GithubProjectV2OwnerType;
  projectNumber: number;
  title: string;
  shortDescription: string | null;
  url: string;
  public: boolean;
  closed: boolean;
  template: boolean;
  lastSyncedAt: string | null;
}

export interface GithubProjectV2DetailPayload
  extends GithubProjectV2ListItemPayload {
  readme: string | null;
  resourcePath: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  githubClosedAt: string | null;
}

export interface GithubProjectV2FieldPayload {
  id: string;
  projectV2Id: string;
  githubFieldNodeId: string;
  fieldName: string;
  dataType: string;
  isStatusField: boolean;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
}

export interface GithubProjectV2StatusOptionPayload {
  id: string;
  fieldId: string;
  githubOptionId: string;
  optionName: string;
  normalizedName: string;
  color: string | null;
  description: string | null;
  position: number | null;
}

export interface GithubProjectV2ItemPayload {
  id: string;
  projectV2Id: string;
  githubProjectItemNodeId: string;
  githubProjectItemFullDatabaseId: number | null;
  contentType: GithubProjectV2ItemContentType;
  issueId: string | null;
  pullRequestId: string | null;
  isArchived: boolean;
  statusFieldId: string | null;
  statusOptionId: string | null;
  statusOptionGithubId: string | null;
  statusName: string | null;
  statusNormalizedName: string | null;
  position: number | null;
  contentNumber: number | null;
  contentTitle: string | null;
  contentState: string | null;
  contentUrl: string | null;
  labels: unknown[];
  assignees: unknown[];
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface GithubProjectV2KanbanItemPayload {
  id: string;
  contentType: GithubProjectV2ItemContentType;
  issueId: string | null;
  pullRequestId: string | null;
  title: string | null;
  url: string | null;
  assignees: unknown[];
  labels: unknown[];
}

export interface GithubProjectV2KanbanColumnPayload {
  id: string;
  fieldId: string;
  githubOptionId: string;
  name: string;
  key: string;
  color: string | null;
  description: string | null;
  position: number | null;
  items: GithubProjectV2KanbanItemPayload[];
}

export interface GithubProjectV2KanbanPayload {
  project: {
    id: string;
    title: string;
  };
  statusField: GithubProjectV2FieldPayload | null;
  columns: GithubProjectV2KanbanColumnPayload[];
  unmappedItems: GithubProjectV2KanbanItemPayload[];
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

export interface GithubPullRequestFilePayload {
  filePath: string;
  previousFilePath: string | null;
  fileName: string;
  fileStatus: string;
  additions: number;
  deletions: number;
  changes: number;
  isBinary: boolean;
  isLargeDiff: boolean;
  blobUrl: string | null;
  rawUrl: string | null;
  contentsUrl: string | null;
  githubFileUrl: string;
  patch: string | null;
}

export type GithubPullRequestConflictStatus =
  | "checking"
  | "clean"
  | "conflicted"
  | "unknown";

export interface GithubPullRequestConflictStatusPayload {
  conflictStatus: GithubPullRequestConflictStatus;
  conflictCheckedAt: string;
  message: string;
}

export type GithubPullRequestReviewSubmitType =
  | "COMMENT"
  | "APPROVE"
  | "REQUEST_CHANGES";

export interface SubmitGithubPullRequestReviewInput {
  submitType: GithubPullRequestReviewSubmitType;
  reviewBody: string;
}

export interface GithubPullRequestReviewSubmissionPayload {
  submittedByGithubLogin: string;
  githubReviewId: string | null;
  githubReviewUrl: string | null;
  submittedAt: string;
}

export type GithubSyncTarget =
  | "repositories"
  | "issues"
  | "pull_requests"
  | "project_v2"
  | "project_v2_fields"
  | "project_v2_items"
  | "full";

export type GithubSyncStatus = "running" | "success" | "failed";

export interface GithubSyncRunPayload {
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
  errorMessage: string | null;
}

export interface GithubSyncRunDetailPayload extends GithubSyncRunPayload {
  cursor: Record<string, unknown>;
}
