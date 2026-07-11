"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { collectGithubProjectV2Pages } from "@/features/github-integration/utils/github-project-v2-pagination";
import {
  createGithubSyncPollLoop,
  createGithubSyncRequestGate,
  GITHUB_SYNC_POLL_INTERVAL_MS,
  shouldPollGithubSyncRuns
} from "@/features/github-integration/utils/github-sync-progress";
import { useAuthSession } from "@/features/auth/auth-session";
import { rememberGithubBoardSelection } from "@/shared/github/board-selection";

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
const GITHUB_CALLBACK_ERROR_PARAM = "github_callback_error";
const GITHUB_OAUTH_CALLBACK_ERROR_PARAM = "github_oauth_error";
const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_ERROR = "account_already_connected";
const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE =
  "이미 다른 PILO 계정에 연결된 GitHub 계정입니다. 다른 GitHub 계정을 사용하거나 기존 연결을 해제한 뒤 다시 시도하세요.";
const GITHUB_CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  account_already_connected: GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE,
  authorization_cancelled: "GitHub 승인이 취소되었습니다. 다시 시도하세요.",
  callback_failed: "GitHub 연동을 완료하지 못했습니다. 다시 시도하세요.",
  connection_failed: "GitHub 연동을 완료하지 못했습니다. 다시 시도하세요.",
  installation_failed:
    "GitHub App 설치 정보를 저장하지 못했습니다. 다시 시도하세요.",
  installation_lookup_failed:
    "GitHub App 설치 정보를 확인하지 못했습니다. 다시 시도하세요.",
  installation_not_accessible:
    "현재 연결된 GitHub 계정에서 접근할 수 없는 GitHub App 설치입니다.",
  invalid_state:
    "GitHub 연동 요청이 만료되었거나 이미 사용되었습니다. 다시 시작하세요.",
  project_oauth_account_mismatch:
    "GitHub ProjectV2 OAuth 계정은 GitHub OAuth 계정과 같아야 합니다.",
  project_oauth_scope_missing:
    "GitHub ProjectV2 권한이 부족합니다. project 권한으로 다시 연결하세요.",
  token_exchange_failed:
    "GitHub 인증 토큰을 발급받지 못했습니다. 다시 시도하세요."
};

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

function getGithubCallbackErrorMessage(params: URLSearchParams) {
  const callbackError = params.get(GITHUB_CALLBACK_ERROR_PARAM);
  if (callbackError) {
    return (
      GITHUB_CALLBACK_ERROR_MESSAGES[callbackError] ??
      GITHUB_CALLBACK_ERROR_MESSAGES.connection_failed
    );
  }

  return getGithubLegacyOAuthCallbackErrorMessage(
    params.get(GITHUB_OAUTH_CALLBACK_ERROR_PARAM)
  );
}

function getGithubLegacyOAuthCallbackErrorMessage(value: string | null) {
  return value === GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_ERROR
    ? GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE
    : null;
}

function removeGithubCallbackErrorFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(GITHUB_CALLBACK_ERROR_PARAM);
  url.searchParams.delete(GITHUB_OAUTH_CALLBACK_ERROR_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

export function GithubPanel() {
  const authSession = useAuthSession();
  const searchParams = useSearchParams();
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
  const [syncPollingError, setSyncPollingError] = useState<string | null>(null);
  const [redirectAction, setRedirectAction] = useState<RedirectAction>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectingProjectOAuth, setIsDisconnectingProjectOAuth] =
    useState(false);
  const [isDeletingInstallation, setIsDeletingInstallation] = useState(false);
  const [isInstallationDeleteRequested, setIsInstallationDeleteRequested] =
    useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasRunningSyncRun, setHasRunningSyncRun] = useState(false);
  const [snapshot, setSnapshot] =
    useState<GithubIntegrationSnapshot>(emptySnapshot);
  const [pullRequests, setPullRequests] = useState<GithubPullRequest[]>([]);
  const [pullRequestsTotal, setPullRequestsTotal] = useState(0);
  const [isPullRequestsLoading, setIsPullRequestsLoading] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedInstallationId, setSelectedInstallationId] = useState("");
  const [selectedProjectV2Id, setSelectedProjectV2Id] = useState("");
  const [selectedProjectV2Ids, setSelectedProjectV2Ids] = useState<Set<string>>(
    new Set()
  );
  const [isSavingProjectV2Selections, setIsSavingProjectV2Selections] =
    useState(false);
  const [syncTarget, setSyncTarget] = useState<GithubSyncTarget>("full");
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const snapshotRequestGateRef = useRef(createGithubSyncRequestGate());
  const syncRunsRequestGateRef = useRef(createGithubSyncRequestGate());

  const isLoading = panelStatus === "loading" || panelStatus === "idle";
  const connected = snapshot.oauth?.connected === true;
  const isSyncActive = isSyncing || hasRunningSyncRun;
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

  async function refreshGithubSyncRuns() {
    if (!workspaceId) {
      return null;
    }

    const requestGeneration = syncRunsRequestGateRef.current.begin();
    const [syncRuns, runningSyncRuns] = await Promise.all([
      apiClient.listGithubSyncRuns(workspaceId, {
        limit: 8
      }),
      apiClient.listGithubSyncRuns(workspaceId, {
        status: "running",
        limit: 1
      })
    ]);
    if (!syncRunsRequestGateRef.current.isCurrent(requestGeneration)) {
      return null;
    }

    const hasRunningRun = runningSyncRuns.meta.total > 0;
    setSnapshot((current) => ({
      ...current,
      syncRuns: syncRuns.data,
      syncRunsTotal: syncRuns.meta.total
    }));
    setHasRunningSyncRun(hasRunningRun);
    setSyncPollingError(null);
    return hasRunningRun;
  }

  async function listAllGithubProjectsV2() {
    return collectGithubProjectV2Pages((page) =>
      apiClient.listGithubProjectsV2(workspaceId, {
        closed: true,
        limit: 100,
        page
      })
    );
  }

  async function loadGithubIntegrationSnapshot(
    preferredRepositoryId?: string,
    preferredProjectV2Id?: string
  ) {
    if (!workspaceId) {
      snapshotRequestGateRef.current.invalidate();
      syncRunsRequestGateRef.current.invalidate();
      setPanelStatus("ready");
      setSnapshot(emptySnapshot);
      setHasRunningSyncRun(false);
      setSyncPollingError(null);
      setPullRequests([]);
      setPullRequestsTotal(0);
      setSelectedRepositoryId("");
      setSelectedInstallationId("");
      setSelectedProjectV2Id("");
      setSelectedProjectV2Ids(new Set());
      setIsInstallationDeleteRequested(false);
      return;
    }

    setPanelStatus("loading");
    setErrorMessage(null);
    setActionError(null);
    setSyncPollingError(null);

    const snapshotRequestGeneration =
      snapshotRequestGateRef.current.begin();
    const syncRunsRequestGeneration =
      syncRunsRequestGateRef.current.begin();

    try {
      const [
        oauth,
        projectOAuth,
        installations,
        repositories,
        projects,
        syncRuns,
        runningSyncRuns
      ] =
        await Promise.all([
          apiClient.getGithubOAuthStatus(),
          apiClient.getGithubProjectOAuthStatus(),
          apiClient.listGithubAppInstallations(workspaceId),
          apiClient.listGithubRepositories(workspaceId, {
            includeArchived: true,
            limit: 20
          }),
          listAllGithubProjectsV2(),
          apiClient.listGithubSyncRuns(workspaceId, {
            limit: 8
          }),
          apiClient.listGithubSyncRuns(workspaceId, {
            status: "running",
            limit: 1
          })
        ]);

      if (
        !snapshotRequestGateRef.current.isCurrent(snapshotRequestGeneration)
      ) {
        return;
      }

      const canApplySyncRuns =
        syncRunsRequestGateRef.current.isCurrent(syncRunsRequestGeneration);

      const nextRepositoryId =
        repositories.data.find(
          (repository) => repository.id === preferredRepositoryId
        )?.id ??
        repositories.data[0]?.id ??
        "";
      const nextProjectV2Id = selectProjectV2IdForRepository({
        projects,
        preferredProjectV2Id,
        repositoryId: nextRepositoryId
      });
      const nextInstallationId =
        installations.find(
          (installation) => installation.id === selectedInstallationId
        )?.id ??
        installations[0]?.id ??
        "";

      setSnapshot((current) => ({
        oauth,
        projectOAuth,
        installations,
        projects,
        projectsTotal: projects.length,
        repositories: repositories.data,
        repositoriesTotal: repositories.meta.total,
        syncRuns: canApplySyncRuns ? syncRuns.data : current.syncRuns,
        syncRunsTotal: canApplySyncRuns
          ? syncRuns.meta.total
          : current.syncRunsTotal
      }));
      if (canApplySyncRuns) {
        setHasRunningSyncRun(runningSyncRuns.meta.total > 0);
      }
      setSelectedRepositoryId(nextRepositoryId);
      setSelectedProjectV2Id(nextProjectV2Id);
      setSelectedInstallationId(nextInstallationId);
      setSelectedProjectV2Ids(
        new Set(
          projects
            .filter((project) => project.selected)
            .map((project) => project.id)
        )
      );
      rememberGithubBoardSelection(workspaceId, {
        projectV2Id: nextProjectV2Id,
        repositoryId: nextRepositoryId
      });
      setIsInstallationDeleteRequested(false);
      setPanelStatus("ready");

      if (nextRepositoryId) {
        await loadGithubPullRequests(nextRepositoryId);
      } else {
        setPullRequests([]);
        setPullRequestsTotal(0);
      }
    } catch (error) {
      if (
        !snapshotRequestGateRef.current.isCurrent(snapshotRequestGeneration)
      ) {
        return;
      }

      setPanelStatus("error");
      setErrorMessage(getErrorMessage(error));
      setSnapshot(emptySnapshot);
      if (
        syncRunsRequestGateRef.current.isCurrent(syncRunsRequestGeneration)
      ) {
        setHasRunningSyncRun(false);
      }
      setPullRequests([]);
      setPullRequestsTotal(0);
    }
  }

  useEffect(() => {
    void loadGithubIntegrationSnapshot();

    // The panel reloads when workspace or token changes; interactive selection
    // refreshes data explicitly through handlers.
    return () => {
      snapshotRequestGateRef.current.invalidate();
      syncRunsRequestGateRef.current.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, apiClient]);

  useEffect(() => {
    if (!workspaceId || !shouldPollGithubSyncRuns(isSyncing, hasRunningSyncRun)) {
      return;
    }

    const pollLoop = createGithubSyncPollLoop({
      intervalMs: GITHUB_SYNC_POLL_INTERVAL_MS,
      poll: refreshGithubSyncRuns,
      shouldContinue: (hasRunningRun) =>
        shouldPollGithubSyncRuns(
          isSyncing,
          hasRunningRun ?? hasRunningSyncRun
        ),
      onError: (error) => setSyncPollingError(getErrorMessage(error)),
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (timer) => clearTimeout(timer)
    });
    pollLoop.start();

    return () => {
      pollLoop.stop();
      syncRunsRequestGateRef.current.invalidate();
    };
    // Polling depends on the local request and the latest server-side running state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, apiClient, isSyncing, hasRunningSyncRun]);

  useEffect(() => {
    const callbackError = getGithubCallbackErrorMessage(searchParams);
    if (!callbackError) {
      return;
    }

    setActionError(callbackError);
    setActionMessage(null);
    setRedirectAction(null);
    removeGithubCallbackErrorFromUrl();
  }, [searchParams]);

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
    rememberGithubBoardSelection(workspaceId, {
      projectV2Id: nextProjectV2Id,
      repositoryId
    });
    await loadGithubPullRequests(repositoryId);
  }

  function handleSelectProjectV2(projectV2Id: string) {
    setSelectedProjectV2Id(projectV2Id);
    rememberGithubBoardSelection(workspaceId, {
      projectV2Id,
      repositoryId: selectedRepositoryId
    });
  }

  function handleToggleProjectV2Selection(projectV2Id: string) {
    setSelectedProjectV2Ids((current) => {
      const next = new Set(current);
      if (next.has(projectV2Id)) {
        next.delete(projectV2Id);
      } else {
        next.add(projectV2Id);
      }
      return next;
    });
  }

  async function handleSaveProjectV2Selections() {
    if (!workspaceId) {
      setActionError("활성 워크스페이스를 확인할 수 없습니다.");
      return;
    }

    const projectIdsByInstallation = new Map<string, string[]>();
    for (const project of snapshot.projects) {
      const selectedProjectIds = projectIdsByInstallation.get(
        project.installationId
      ) ?? [];
      if (selectedProjectV2Ids.has(project.id)) {
        selectedProjectIds.push(project.id);
      }
      projectIdsByInstallation.set(project.installationId, selectedProjectIds);
    }

    setIsSavingProjectV2Selections(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await Promise.all(
        [...projectIdsByInstallation].map(
          ([installationId, projectV2Ids]) =>
            apiClient.replaceGithubProjectV2Selections(workspaceId, {
              installationId,
              projectV2Ids
            })
        )
      );
      setActionMessage("ProjectV2 상세 동기화 선택을 저장했습니다.");
      await loadGithubIntegrationSnapshot(
        selectedRepositoryId,
        selectedProjectV2Id
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSavingProjectV2Selections(false);
    }
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
      projectScopedSyncTargets.has(syncTarget) &&
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
      actionError={actionError ?? syncPollingError}
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
      isSyncing={isSyncActive}
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
      onSelectProjectV2={handleSelectProjectV2}
      onToggleProjectV2Selection={handleToggleProjectV2Selection}
      onSaveProjectV2Selections={() =>
        void handleSaveProjectV2Selections()
      }
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
      selectedProjectV2Ids={selectedProjectV2Ids}
      selectedRepository={selectedRepository}
      selectedRepositoryId={selectedRepositoryId}
      syncRuns={snapshot.syncRuns}
      syncRunsTotal={snapshot.syncRunsTotal}
      syncTarget={syncTarget}
      isSavingProjectV2Selections={isSavingProjectV2Selections}
    />
  );
}
