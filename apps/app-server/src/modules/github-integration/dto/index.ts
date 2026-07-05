export interface StartGithubOAuthRequest {
  returnUrl?: unknown;
}

export interface GithubOAuthCallbackQuery {
  code?: unknown;
  state?: unknown;
}

export interface StartGithubAppInstallationRequest {
  returnUrl?: unknown;
}

export interface GithubAppInstallationCallbackQuery {
  installation_id?: unknown;
  setup_action?: unknown;
  state?: unknown;
}

export interface ListGithubRepositoriesQuery {
  q?: unknown;
  includeArchived?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface ListGithubProjectsV2Query {
  ownerLogin?: unknown;
  closed?: unknown;
  q?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface ListGithubPullRequestsQuery {
  state?: unknown;
  query?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface ListGithubPullRequestFilesQuery {
  page?: unknown;
  limit?: unknown;
}

export interface StartGithubSyncRunRequest {
  target?: unknown;
  installationId?: unknown;
  repositoryId?: unknown;
  projectV2Id?: unknown;
}

export interface ListGithubSyncRunsQuery {
  target?: unknown;
  status?: unknown;
  repositoryId?: unknown;
  projectV2Id?: unknown;
  page?: unknown;
  limit?: unknown;
}
