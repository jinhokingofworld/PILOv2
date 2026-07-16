export const GITHUB_PROJECT_OAUTH_AUTHORIZE_SCOPE =
  "read:user user:email project repo";

export const GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes";

const REQUIRED_SCOPES = ["project", "repo"] as const;

export function hasRequiredGithubProjectOAuthScopes(
  scope: string | null
): boolean {
  const scopes = new Set(
    (scope ?? "")
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return REQUIRED_SCOPES.every((requiredScope) => scopes.has(requiredScope));
}
