export type GithubSettingsStepStatus =
  | "required"
  | "blocked"
  | "complete"
  | "optional";

export type GithubSettingsAccessState = {
  canInstallGithubApp: boolean;
  canConnectProjectOAuth: boolean;
  canChooseRepository: boolean;
  githubStepStatus: GithubSettingsStepStatus;
  installationStepStatus: GithubSettingsStepStatus;
  projectStepStatus: GithubSettingsStepStatus;
};

export function getGithubSettingsAccessState({
  connected,
  hasInstallation,
  projectOAuthConnected
}: {
  connected: boolean;
  hasInstallation: boolean;
  projectOAuthConnected: boolean;
}): GithubSettingsAccessState {
  return {
    canInstallGithubApp: connected,
    canConnectProjectOAuth: connected && hasInstallation,
    canChooseRepository: connected && hasInstallation,
    githubStepStatus: connected ? "complete" : "required",
    installationStepStatus: !connected
      ? "blocked"
      : hasInstallation
        ? "complete"
        : "required",
    projectStepStatus:
      !connected || !hasInstallation
        ? "blocked"
        : projectOAuthConnected
          ? "complete"
          : "optional"
  };
}
