const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getGithubIntegrationApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function buildGithubIntegrationApiUrl(path: `/${string}`) {
  return `${getGithubIntegrationApiBaseUrl()}${path}`;
}
