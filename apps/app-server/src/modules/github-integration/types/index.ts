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
