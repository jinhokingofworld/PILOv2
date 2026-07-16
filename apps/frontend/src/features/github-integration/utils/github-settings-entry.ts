export const GITHUB_SETTINGS_QUERY_KEY = "settings";
export const GITHUB_SETTINGS_QUERY_VALUE = "github";

export function isGithubSettingsEntry(params: URLSearchParams) {
  return params.get(GITHUB_SETTINGS_QUERY_KEY) === GITHUB_SETTINGS_QUERY_VALUE;
}

export function buildGithubSettingsReturnUrl(href: string) {
  const url = new URL(href);
  url.searchParams.set(GITHUB_SETTINGS_QUERY_KEY, GITHUB_SETTINGS_QUERY_VALUE);
  return url.toString();
}

export function buildGithubSettingsCompatibilityPath(
  search: string,
  fallbackPath = "/home"
) {
  const params = new URLSearchParams(search);
  params.set(GITHUB_SETTINGS_QUERY_KEY, GITHUB_SETTINGS_QUERY_VALUE);
  return `${fallbackPath}?${params.toString()}`;
}
