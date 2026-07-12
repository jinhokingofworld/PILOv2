export const GITHUB_ONBOARDING_STEPS = [
  "oauth",
  "installation",
  "project-oauth",
  "repositories",
  "projects"
] as const;

export type GithubOnboardingStep = (typeof GITHUB_ONBOARDING_STEPS)[number];

export function getGithubOnboardingStep(value: string | null): GithubOnboardingStep {
  return GITHUB_ONBOARDING_STEPS.includes(value as GithubOnboardingStep)
    ? (value as GithubOnboardingStep)
    : "oauth";
}

export function readGithubOnboardingCallback(searchParams: URLSearchParams) {
  return {
    workspaceId: searchParams.get("workspaceId") || null,
    step: getGithubOnboardingStep(searchParams.get("github_onboarding_step")),
    installationId: searchParams.get("github_installation_id") || null,
    callbackError: searchParams.get("github_callback_error") || null
  };
}

export function createGithubOnboardingReturnUrl(workspaceId: string, step: GithubOnboardingStep, installationId?: string | null) {
  const params = new URLSearchParams({ workspaceId, github_onboarding_step: step });
  if (installationId) params.set("github_installation_id", installationId);
  return `/workspace/new?${params.toString()}`;
}

export function getGithubCallbackErrorMessage(error: string | null) {
  const messages: Record<string, string> = {
    authorization_cancelled: "GitHub 연결이 취소되었습니다. workspace는 유지되며 언제든 다시 연결할 수 있습니다.",
    project_oauth_account_mismatch: "ProjectV2 권한은 GitHub App 연결에 사용한 동일한 계정으로 승인해 주세요.",
    project_oauth_scope_missing: "ProjectV2 권한에 필요한 project scope가 승인되지 않았습니다. 다시 연결해 주세요.",
    account_already_connected: "이 GitHub 계정은 다른 PILO 계정에 연결되어 있습니다.",
    installation_not_accessible: "선택한 GitHub App 설치에 접근할 수 없습니다. 다시 설치해 주세요."
  };
  return error ? messages[error] ?? "GitHub 연결을 완료하지 못했습니다. 다시 시도해 주세요." : null;
}
