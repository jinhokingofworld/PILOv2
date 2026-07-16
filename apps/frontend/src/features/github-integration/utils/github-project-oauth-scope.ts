const REQUIRED_GITHUB_PROJECT_OAUTH_SCOPES = ["project", "repo"] as const;

export function hasRequiredGithubProjectOAuthScopes(
  scope: string | null | undefined
) {
  const scopes = new Set(
    (scope ?? "")
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return REQUIRED_GITHUB_PROJECT_OAUTH_SCOPES.every((requiredScope) =>
    scopes.has(requiredScope)
  );
}
