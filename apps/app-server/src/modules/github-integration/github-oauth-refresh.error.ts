export const GITHUB_OAUTH_RECONNECTION_REQUIRED_MESSAGE =
  "GitHub OAuth reconnection is required";
export const GITHUB_OAUTH_INVALID_CONNECTION_MESSAGE =
  "GitHub OAuth connection is invalid; reconnect is required";
export const GITHUB_OAUTH_TOKEN_REFRESH_FAILED_MESSAGE =
  "GitHub OAuth token refresh failed";

export class GithubOAuthRefreshRejectedError extends Error {
  constructor() {
    super("GitHub OAuth token refresh was rejected");
    this.name = "GithubOAuthRefreshRejectedError";
  }
}
