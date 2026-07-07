"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createGithubIntegrationApiClient,
  GithubIntegrationApiError
} from "@/features/github-integration/api/client";
import { GithubConnectLayout } from "@/features/github-integration/components/github-connect-layout";
import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectOAuthStatus,
  GithubProjectV2,
  GithubPullRequest,
  GithubRepository,
  GithubSyncRun,
  GithubSyncTarget,
  StartGithubSyncRunInput
} from "@/features/github-integration/types";
import {
  getGithubConnectSyncStatusLabel,
  getGithubConnectSyncTargetLabel
} from "@/features/github-integration/utils/github-connect-format";
import { selectProjectV2IdForRepository } from "@/features/github-integration/utils/github-project-selection";
import { useAuthSession } from "@/features/auth/auth-session";

type PanelStatus = "idle" | "loading" | "ready" | "error";
type RedirectAction = "oauth" | "installation" | "project_oauth" | null;

type GithubIntegrationSnapshot = {
  oauth: GithubOAuthStatus | null;
  projectOAuth: GithubProjectOAuthStatus | null;
  installations: GithubAppInstallation[];
  repositories: GithubRepository[];
  repositoriesTotal: number;
  projects: GithubProjectV2[];
  projectsTotal: number;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
};

const emptySnapshot: GithubIntegrationSnapshot = {
  oauth: null,
  projectOAuth: null,
  installations: [],
  projects: [],
  projectsTotal: 0,
  repositories: [],
  repositoriesTotal: 0,
  syncRuns: [],
  syncRunsTotal: 0
};

const projectScopedSyncTargets = new Set<GithubSyncTarget>([
  "project_v2",
  "project_v2_fields",
  "project_v2_items"
]);

const repositoryScopedSyncTargets = new Set<GithubSyncTarget>([
  "issues",
  "pull_requests"
]);

const PERSONAL_PROJECT_OAUTH_REQUIRED_MESSAGE =
  "GitHub ProjectV2 OAuth connection is required for personal ProjectV2 sync";
const PERSONAL_PROJECT_OAUTH_ACCOUNT_MISMATCH_MESSAGE =
  "GitHub ProjectV2 OAuth account does not match this personal ProjectV2 owner";
const PERSONAL_PROJECT_OAUTH_SCOPE_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project scope";

function requiresProjectOAuth(target: GithubSyncTarget) {
  return target === "full" || projectScopedSyncTargets.has(target);
}

function hasProjectScope(scope: string | null | undefined) {
  if (!scope) {
    return false;
  }

  return scope.split(/[,\s]+/).includes("project");
}

function getErrorMessage(error: unknown) {
  if (error instanceof GithubIntegrationApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "GitHub 연동 정보를 불러오지 못했습니다.";
}

export function GithubPanel() {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const apiClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: authSession?.accessToken ?? null
      }),
    [authSession?.accessToken]
  );
  const [panelStatus, setPanelStatus] = useState<PanelStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [redirectAction, setRedirectAction] = useState<RedirectAction>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectingProjectOAuth, setIsDisconnectingProjectOAuth] =
    useState(false);
  const [isDeletingInstallation, setIsDeletingInstallation] = useState(false);
  const [isInstallationDeleteRequested, setIsInstallationDeleteRequested] =
    useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [snapshot, setSnapshot] =
    useState<GithubIntegrationSnapshot>(emptySnapshot);
  const [pullRequests, setPullRequests] = useState<GithubPullRequest[]>([]);
  const [pullRequestsTotal, setPullRequestsTotal] = useState(0);
  const [isPullRequestsLoading, setIsPullRequestsLoading] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedInstallationId, setSelectedInstallationId] = useState("");
  const [selectedProjectV2Id, setSelectedProjectV2Id] = useState("");
  const [syncTarget, setSyncTarget] = useState<GithubSyncTarget>("full");
  const [repositoryQuery, setRepositoryQuery] = useState("");

  const isLoading = panelStatus === "loading" || panelStatus === "idle";
  const connected = snapshot.oauth?.connected === true;
  const selectedRepository = snapshot.repositories.find(
    (repository) => repository.id === selectedRepositoryId
  );
  const selectedProject = snapshot.projects.find(
    (project) => project.id === selectedProjectV2Id
  );
  const selectedInstallation = snapshot.installations.find(
    (installation) => installation.id === selectedInstallationId
  );
  const filteredRepositories = repositoryQuery.trim()
    ? snapshot.repositories.filter((repository) =>
        repository.fullName
          .toLowerCase()
          .includes(repositoryQuery.trim().toLowerCase())
      )
    : snapshot.repositories;

  async function loadGithubPullRequests(repositoryId: string) {
    if (!workspaceId || !repositoryId) {
      setPullRequests([]);
      setPullRequestsTotal(0);
      return;
    }

    setIsPullRequestsLoading(true);
    setActionError(null);

    try {
      const page = await apiClient.listGithubPullRequests(
        workspaceId,
        repositoryId,
        {
          limit: 8
        }
      );
      setPullRequests(page.data);
      setPullRequestsTotal(page.meta.total);
    } catch (error) {
      setPullRequests([]);
      setPullRequestsTotal(0);
      setActionError(getErrorMessage(error));
    } finally {
      setIsPullRequestsLoading(false);
    }
  }

  async function loadGithubIntegrationSnapshot(
    preferredRepositoryId?: string,
    preferredProjectV2Id?: string
  ) {
    if (!workspaceId) {
      setPanelStatus("ready");
      setSnapshot(emptySnapshot);
      setPullRequests([]);
      setPullRequestsTotal(0);
      setSelectedRepositoryId("");
      setSelectedInstallationId("");
      setSelectedProjectV2Id("");
      setIsInstallationDeleteRequested(false);
      return;
    }

    setPanelStatus("loading");
    setErrorMessage(null);
    setActionError(null);

    try {
      const [
        oauth,
        projectOAuth,
        installations,
        repositories,
        projects,
        syncRuns
      ] =
        await Promise.all([
          apiClient.getGithubOAuthStatus(),
          apiClient.getGithubProjectOAuthStatus(),
          apiClient.listGithubAppInstallations(workspaceId),
          apiClient.listGithubRepositories(workspaceId, {
            includeArchived: true,
            limit: 20
          }),
          apiClient.listGithubProjectsV2(workspaceId, {
            limit: 20
          }),
          apiClient.listGithubSyncRuns(workspaceId, {
            limit: 8
          })
        ]);

      const nextRepositoryId =
        repositories.data.find(
          (repository) => repository.id === preferredRepositoryId
        )?.id ??
        repositories.data[0]?.id ??
        "";
      const nextProjectV2Id = selectProjectV2IdForRepository({
        projects: projects.data,
        preferredProjectV2Id,
        repositoryId: nextRepositoryId
      });
      const nextInstallationId =
        installations.find(
          (installation) => installation.id === selectedInstallationId
        )?.id ??
        installations[0]?.id ??
        "";

      setSnapshot({
        oauth,
        projectOAuth,
        installations,
        projects: projects.data,
        projectsTotal: projects.meta.total,
        repositories: repositories.data,
        repositoriesTotal: repositories.meta.total,
        syncRuns: syncRuns.data,
        syncRunsTotal: syncRuns.meta.total
      });
      setSelectedRepositoryId(nextRepositoryId);
      setSelectedProjectV2Id(nextProjectV2Id);
      setSelectedInstallationId(nextInstallationId);
      setIsInstallationDeleteRequested(false);
      setPanelStatus("ready");

      if (nextRepositoryId) {
        await loadGithubPullRequests(nextRepositoryId);
      } else {
        setPullRequests([]);
        setPullRequestsTotal(0);
      }
    } catch (error) {
      setPanelStatus("error");
      setErrorMessage(getErrorMessage(error));
      setSnapshot(emptySnapshot);
      setPullRequests([]);
      setPullRequestsTotal(0);
    }
  }

  useEffect(() => {
    void loadGithubIntegrationSnapshot();
    // The panel reloads when workspace or token changes; interactive selection
    // refreshes data explicitly through handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, apiClient]);

  async function handleStartGithubOAuth() {
    setRedirectAction("oauth");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await apiClient.startGithubOAuth({
        returnUrl: window.location.href
      });
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      setRedirectAction(null);
      setActionError(getErrorMessage(error));
    }
  }

  async function handleDisconnectGithubOAuth() {
    setIsDisconnecting(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await apiClient.disconnectGithubOAuth();
      setActionMessage("GitHub OAuth 연결을 해제했습니다.");
      await loadGithubIntegrationSnapshot();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleStartGithubProjectOAuth() {
    setRedirectAction("project_oauth");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await apiClient.startGithubProjectOAuth({
        returnUrl: window.location.href
      });
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      setRedirectAction(null);
      setActionError(getErrorMessage(error));
    }
  }

  async function handleDisconnectGithubProjectOAuth() {
    setIsDisconnectingProjectOAuth(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await apiClient.disconnectGithubProjectOAuth();
      setActionMessage("GitHub ProjectV2 OAuth connection disconnected.");
      await loadGithubIntegrationSnapshot();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsDisconnectingProjectOAuth(false);
    }
  }

  async function handleStartGithubAppInstallation() {
    if (!workspaceId) {
      setActionError("활성 워크스페이스를 확인할 수 없습니다.");
      return;
    }

    if (!connected) {
      setActionError("GitHub OAuth 연결 후 GitHub App을 설치할 수 있습니다.");
      return;
    }

    setRedirectAction("installation");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await apiClient.startGithubAppInstallation(workspaceId, {
        returnUrl: window.location.href
      });
      window.location.assign(result.installUrl);
    } catch (error) {
      setRedirectAction(null);
      setActionError(getErrorMessage(error));
    }
  }

  function handleRequestDeleteGithubAppInstallation() {
    if (!selectedInstallationId) {
      setActionError("삭제할 GitHub App 설치를 먼저 선택해야 합니다.");
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setIsInstallationDeleteRequested(true);
  }

  function handleCancelDeleteGithubAppInstallation() {
    setIsInstallationDeleteRequested(false);
  }

  async function handleConfirmDeleteGithubAppInstallation() {
    if (!workspaceId || !selectedInstallationId) {
      setActionError("삭제할 GitHub App 설치를 확인할 수 없습니다.");
      return;
    }

    setIsDeletingInstallation(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await apiClient.deleteGithubAppInstallation(
        workspaceId,
        selectedInstallationId
      );
      setIsInstallationDeleteRequested(false);
      setActionMessage(
        result.alreadyDeleted
          ? "GitHub App 설치가 이미 해제되어 local 연결 정보를 정리했습니다."
          : "GitHub에서 App 설치를 해제하고 local 연결 정보를 정리했습니다."
      );
      setSelectedInstallationId("");
      await loadGithubIntegrationSnapshot();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsDeletingInstallation(false);
    }
  }

  async function handleSelectRepository(repositoryId: string) {
    const nextProjectV2Id = selectProjectV2IdForRepository({
      projects: snapshot.projects,
      preferredProjectV2Id: selectedProjectV2Id,
      repositoryId
    });
    setSelectedRepositoryId(repositoryId);
    setSelectedProjectV2Id(nextProjectV2Id);
    await loadGithubPullRequests(repositoryId);
  }

  async function handleStartGithubSyncRun() {
    if (!workspaceId) {
      setActionError("활성 워크스페이스를 확인할 수 없습니다.");
      return;
    }

    if (!selectedInstallationId) {
      setActionError("동기화할 GitHub App 설치를 먼저 선택해야 합니다.");
      return;
    }

    if (projectScopedSyncTargets.has(syncTarget) && !selectedProjectV2Id) {
      setActionError("ProjectV2 동기화에는 ProjectV2 선택이 필요합니다.");
      return;
    }

    if (
      selectedInstallation?.accountType === "User" &&
      requiresProjectOAuth(syncTarget)
    ) {
      const projectOAuth = snapshot.projectOAuth;
      if (!projectOAuth?.connected) {
        setActionError(PERSONAL_PROJECT_OAUTH_REQUIRED_MESSAGE);
        return;
      }

      if (
        !projectOAuth.githubLogin ||
        projectOAuth.githubLogin.toLowerCase() !==
          selectedInstallation.accountLogin.toLowerCase()
      ) {
        setActionError(PERSONAL_PROJECT_OAUTH_ACCOUNT_MISMATCH_MESSAGE);
        return;
      }

      if (!hasProjectScope(projectOAuth.tokenScope)) {
        setActionError(PERSONAL_PROJECT_OAUTH_SCOPE_MESSAGE);
        return;
      }
    }

    const body: StartGithubSyncRunInput = {
      installationId: selectedInstallationId,
      target: syncTarget
    };

    if (
      (syncTarget === "full" || repositoryScopedSyncTargets.has(syncTarget)) &&
      selectedRepositoryId
    ) {
      body.repositoryId = selectedRepositoryId;
    }

    if (
      (syncTarget === "full" || projectScopedSyncTargets.has(syncTarget)) &&
      selectedProjectV2Id
    ) {
      body.projectV2Id = selectedProjectV2Id;
    }

    setIsSyncing(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const syncRun = await apiClient.startGithubSyncRun(workspaceId, body);
      setActionMessage(
        `${getGithubConnectSyncTargetLabel(
          syncRun.target
        )} 동기화가 ${getGithubConnectSyncStatusLabel(
          syncRun.status
        )} 상태로 종료되었습니다.`
      );
      await loadGithubIntegrationSnapshot(
        selectedRepositoryId,
        selectedProjectV2Id
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <GithubConnectLayout
      actionError={actionError}
      actionMessage={actionMessage}
      connected={connected}
      errorMessage={errorMessage}
      filteredRepositories={filteredRepositories}
      isDisconnecting={isDisconnecting}
      isDisconnectingProjectOAuth={isDisconnectingProjectOAuth}
      isDeletingInstallation={isDeletingInstallation}
      isInstallationDeleteRequested={isInstallationDeleteRequested}
      isLoading={isLoading}
      isPullRequestsLoading={isPullRequestsLoading}
      isSyncing={isSyncing}
      oauth={snapshot.oauth}
      projectOAuth={snapshot.projectOAuth}
      onDisconnectOAuth={() => void handleDisconnectGithubOAuth()}
      onDisconnectGithubProjectOAuth={() =>
        void handleDisconnectGithubProjectOAuth()
      }
      onCancelDeleteInstallation={handleCancelDeleteGithubAppInstallation}
      onConfirmDeleteInstallation={() =>
        void handleConfirmDeleteGithubAppInstallation()
      }
      onRefresh={() =>
        void loadGithubIntegrationSnapshot(
          selectedRepositoryId,
          selectedProjectV2Id
        )
      }
      onRepositoryQueryChange={setRepositoryQuery}
      onSelectProjectV2={setSelectedProjectV2Id}
      onSelectRepository={(repositoryId) => void handleSelectRepository(repositoryId)}
      onRequestDeleteInstallation={handleRequestDeleteGithubAppInstallation}
      onStartInstallation={() => void handleStartGithubAppInstallation()}
      onStartOAuth={() => void handleStartGithubOAuth()}
      onStartGithubProjectOAuth={() => void handleStartGithubProjectOAuth()}
      onStartSync={() => void handleStartGithubSyncRun()}
      onSyncTargetChange={setSyncTarget}
      panelStatus={panelStatus}
      projects={snapshot.projects}
      projectsTotal={snapshot.projectsTotal}
      pullRequests={pullRequests}
      pullRequestsTotal={pullRequestsTotal}
      redirectAction={redirectAction}
      repositories={snapshot.repositories}
      repositoriesTotal={snapshot.repositoriesTotal}
      repositoryQuery={repositoryQuery}
      selectedInstallation={selectedInstallation}
      installations={snapshot.installations}
      selectedInstallationId={selectedInstallationId}
      selectedProject={selectedProject}
      selectedProjectV2Id={selectedProjectV2Id}
      selectedRepository={selectedRepository}
      selectedRepositoryId={selectedRepositoryId}
      syncRuns={snapshot.syncRuns}
      syncRunsTotal={snapshot.syncRunsTotal}
      syncTarget={syncTarget}
    />
  );
}
