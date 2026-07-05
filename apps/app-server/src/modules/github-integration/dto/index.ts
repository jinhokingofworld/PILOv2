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
