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
  GithubRepository,
  GithubSyncRun,
  GithubSyncTarget,
  StartGithubSyncRunInput
} from "@/features/github-integration/types";
import {
  getGithubConnectSyncTargetLabel
} from "@/features/github-integration/utils/github-connect-format";
import { getGithubManualSyncActionMessage } from "@/features/github-integration/utils/github-manual-sync-status";
import { hasRequiredGithubProjectOAuthScopes } from "@/features/github-integration/utils/github-project-oauth-scope";
import { buildGithubSettingsReturnUrl } from "@/features/github-integration/utils/github-settings-entry";
import {
  resolveGithubActiveBoardSelection,
  selectProjectV2IdForRepository
} from "@/features/github-integration/utils/github-project-selection";
import { collectGithubPages } from "@/features/github-integration/utils/github-page-collector";
import {
  createGithubSyncPollLoop,
  createGithubSyncRequestGate,
  GITHUB_SYNC_POLL_INTERVAL_MS,
  shouldPollGithubSyncRuns
} from "@/features/github-integration/utils/github-sync-progress";
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
  "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes";
const GITHUB_CALLBACK_ERROR_PARAM = "github_callback_error";
const GITHUB_OAUTH_CALLBACK_ERROR_PARAM = "github_oauth_error";
const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_ERROR =
  "account_already_connected";
const REPOSITORIES_PER_PAGE = 20;
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
    "GitHub ProjectV2 OAuth에는 project와 repo 권한이 모두 필요합니다. 다시 연결하세요.",
  token_exchange_failed:
    "GitHub 인증 토큰을 발급받지 못했습니다. 다시 시도하세요."
};

function requiresProjectOAuth(target: GithubSyncTarget) {
  return target === "full" || projectScopedSyncTargets.has(target);
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
  const isWorkspaceOwner = authSession?.activeWorkspace.isOwner ?? false;
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
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedInstallationId, setSelectedInstallationId] = useState("");
  const [selectedProjectV2Id, setSelectedProjectV2Id] = useState("");
  const [isSavingProjectV2Selections, setIsSavingProjectV2Selections] =
    useState(false);
  const [syncTarget, setSyncTarget] = useState<GithubSyncTarget>("full");
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryPage, setRepositoryPage] = useState(1);
  const snapshotRequestGateRef = useRef(createGithubSyncRequestGate());
  const syncRunsRequestGateRef = useRef(createGithubSyncRequestGate());
  const selectedRepositoryIdRef = useRef("");

  const isLoading = panelStatus === "loading" || panelStatus === "idle";
  const connected = snapshot.oauth?.connected === true;
  const isSyncActive = isSyncing || hasRunningSyncRun;
  const selectedRepository = snapshot.repositories.find(
    (repository) => repository.id === selectedRepositoryId
  );
  const selectedInstallation = snapshot.installations.find(
    (installation) => installation.id === selectedInstallationId
  );
  const hasNextRepositoryPage =
    snapshot.repositoriesTotal > repositoryPage * REPOSITORIES_PER_PAGE;

  async function refreshGithubSyncRuns() {
    if (!workspaceId) {
      return null;
    }

    const requestGeneration = syncRunsRequestGateRef.current.begin();
    const [syncRuns, queuedSyncRuns, runningSyncRuns] = await Promise.all([
      apiClient.listGithubSyncRuns(workspaceId, {
        triggerSource: "manual",
        limit: 8
      }),
      apiClient.listGithubSyncRuns(workspaceId, {
        status: "queued",
        limit: 1
      }),
      apiClient.listGithubSyncRuns(workspaceId, {
        status: "running",
        limit: 1
      })
    ]);
    if (!syncRunsRequestGateRef.current.isCurrent(requestGeneration)) {
      return null;
    }

    const hasRunningRun =
      queuedSyncRuns.meta.total > 0 || runningSyncRuns.meta.total > 0;
    setSnapshot((current) => ({
      ...current,
      syncRuns: syncRuns.data,
      syncRunsTotal: syncRuns.meta.total
    }));
    setHasRunningSyncRun(hasRunningRun);
    setSyncPollingError(null);
    return hasRunningRun;
  }

  async function listAllGithubProjectsV2(repositoryId: string) {
    return collectGithubPages((page) =>
      apiClient.listGithubProjectsV2(workspaceId, {
        repositoryId,
        closed: true,
        limit: 100,
        management: true,
        page
      })
    );
  }

  async function loadGithubProjectV2s(repositoryId: string) {
    try {
      const projects = await listAllGithubProjectsV2(repositoryId);
      if (selectedRepositoryIdRef.current !== repositoryId) {
        return;
      }

      const nextProjectV2Id = selectProjectV2IdForRepository({
        projects,
        preferredProjectV2Id: selectedProjectV2Id,
        repositoryId
      });
      setSnapshot((current) => ({
        ...current,
        projects,
        projectsTotal: projects.length
      }));
      setSelectedProjectV2Id(nextProjectV2Id);
    } catch (error) {
      if (selectedRepositoryIdRef.current !== repositoryId) {
        return;
      }
      throw error;
    }
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
      setSelectedRepositoryId("");
      selectedRepositoryIdRef.current = "";
      setSelectedInstallationId("");
      setSelectedProjectV2Id("");
      setIsInstallationDeleteRequested(false);
      return;
    }

    setPanelStatus("loading");
    setErrorMessage(null);
    setActionError(null);
    setSyncPollingError(null);

    const snapshotRequestGeneration = snapshotRequestGateRef.current.begin();
    const syncRunsRequestGeneration = syncRunsRequestGateRef.current.begin();

    try {
      const [
        oauth,
        projectOAuth,
        installations,
        repositories,
        activeBoardSource,
        syncRuns,
        queuedSyncRuns,
        runningSyncRuns
      ] = await Promise.all([
        apiClient.getGithubOAuthStatus(),
        apiClient.getGithubProjectOAuthStatus(),
        apiClient.listGithubAppInstallations(workspaceId),
        apiClient.listGithubRepositories(workspaceId, {
          includeArchived: true,
          limit: REPOSITORIES_PER_PAGE,
          page: repositoryPage,
          q: repositoryQuery.trim() || undefined
        }),
        apiClient.getWorkspaceActiveBoardSource(workspaceId),
        apiClient.listGithubSyncRuns(workspaceId, {
          triggerSource: "manual",
          limit: 8
        }),
        apiClient.listGithubSyncRuns(workspaceId, {
          status: "queued",
          limit: 1
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

      const initialBoardSelection = resolveGithubActiveBoardSelection({
        repositories: repositories.data,
        projects: [],
        activeBoardSource,
        preferredRepositoryId,
        preferredProjectV2Id
      });
      const nextRepository = repositories.data.find(
        (repository) => repository.id === initialBoardSelection.repositoryId
      );
      let nextProjects: GithubProjectV2[] = [];
      let repositoryDataError: string | null = null;

      if (nextRepository) {
        try {
          nextProjects = await listAllGithubProjectsV2(nextRepository.id);
        } catch (error) {
          repositoryDataError = getErrorMessage(error);
        }

        if (
          !snapshotRequestGateRef.current.isCurrent(snapshotRequestGeneration)
        ) {
          return;
        }
      }

      const nextBoardSelection = resolveGithubActiveBoardSelection({
        repositories: repositories.data,
        projects: nextProjects,
        activeBoardSource,
        preferredRepositoryId,
        preferredProjectV2Id
      });
      const nextRepositoryId = nextBoardSelection.repositoryId;
      const nextProjectV2Id = nextBoardSelection.projectV2Id;
      const canApplySyncRuns = syncRunsRequestGateRef.current.isCurrent(
        syncRunsRequestGeneration
      );
      const nextInstallationId =
        nextRepository?.installationId ??
        installations.find(
          (installation) => installation.id === selectedInstallationId
        )?.id ??
        installations[0]?.id ??
        "";

      setSnapshot((current) => ({
        oauth,
        projectOAuth,
        installations,
        projects: nextProjects,
        projectsTotal: nextProjects.length,
        repositories: repositories.data,
        repositoriesTotal: repositories.meta.total,
        syncRuns: canApplySyncRuns ? syncRuns.data : current.syncRuns,
        syncRunsTotal: canApplySyncRuns
          ? syncRuns.meta.total
          : current.syncRunsTotal
      }));
      if (canApplySyncRuns) {
        setHasRunningSyncRun(
          queuedSyncRuns.meta.total > 0 || runningSyncRuns.meta.total > 0
        );
      }
      setSelectedRepositoryId(nextRepositoryId);
      selectedRepositoryIdRef.current = nextRepositoryId;
      setSelectedProjectV2Id(nextProjectV2Id);
      setSelectedInstallationId(nextInstallationId);
      setIsInstallationDeleteRequested(false);
      setPanelStatus("ready");
      setActionError(repositoryDataError);

    } catch (error) {
      if (
        !snapshotRequestGateRef.current.isCurrent(snapshotRequestGeneration)
      ) {
        return;
      }

      setPanelStatus("error");
      setErrorMessage(getErrorMessage(error));
      setSnapshot(emptySnapshot);
      setSelectedRepositoryId("");
      selectedRepositoryIdRef.current = "";
      setSelectedInstallationId("");
      setSelectedProjectV2Id("");
      if (syncRunsRequestGateRef.current.isCurrent(syncRunsRequestGeneration)) {
        setHasRunningSyncRun(false);
      }
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
  }, [workspaceId, apiClient, repositoryPage, repositoryQuery]);

  useEffect(() => {
    if (
      !workspaceId ||
      !shouldPollGithubSyncRuns(isSyncing, hasRunningSyncRun)
    ) {
      return;
    }

    const pollLoop = createGithubSyncPollLoop({
      intervalMs: GITHUB_SYNC_POLL_INTERVAL_MS,
      poll: refreshGithubSyncRuns,
      shouldContinue: (hasRunningRun) =>
        shouldPollGithubSyncRuns(isSyncing, hasRunningRun ?? hasRunningSyncRun),
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
        returnUrl: buildGithubSettingsReturnUrl(window.location.href)
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
        returnUrl: buildGithubSettingsReturnUrl(window.location.href)
      });
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      setRedirectAction(null);
      setActionError(getErrorMessage(error));
    }
  }

  async function handleDiscoverGithubProjectV2(
    installationId: string,
    repositoryId = selectedRepositoryId
  ) {
    if (!workspaceId || !repositoryId) {
      setActionError(
        "저장소를 선택한 뒤 ProjectV2 동기화 범위를 관리할 수 있습니다."
      );
      return;
    }
    setActionError(null);
    try {
      const discovery = await apiClient.discoverGithubProjectV2(
        workspaceId,
        installationId,
        {
          repositoryId
        }
      );
      if (selectedRepositoryIdRef.current !== repositoryId) {
        return;
      }
      if (discovery.connectionRequired) {
        setActionMessage(
          "개인 Project v2를 조회하려면 3단계에서 Project 작업 권한을 연결하세요."
        );
        return;
      }
      setSelectedInstallationId(installationId);
      await loadGithubProjectV2s(repositoryId);
    } catch (error) {
      if (selectedRepositoryIdRef.current !== repositoryId) {
        return;
      }
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
        returnUrl: buildGithubSettingsReturnUrl(window.location.href)
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
    if (!workspaceId) return;
    const repository = snapshot.repositories.find(
      (candidate) => candidate.id === repositoryId
    );
    if (!repository) return;

    setSelectedRepositoryId(repositoryId);
    selectedRepositoryIdRef.current = repositoryId;
    setSelectedInstallationId(repository.installationId);
    setSnapshot((current) => ({ ...current, projects: [], projectsTotal: 0 }));
    setSelectedProjectV2Id("");
    await handleDiscoverGithubProjectV2(repository.installationId, repositoryId);
  }

  function clearRepositorySelection() {
    setSelectedRepositoryId("");
    selectedRepositoryIdRef.current = "";
    setSelectedInstallationId("");
    setSelectedProjectV2Id("");
    setSnapshot((current) => ({ ...current, projects: [], projectsTotal: 0 }));
  }

  function handleRepositoryQueryChange(value: string) {
    setRepositoryQuery(value);
    setRepositoryPage(1);
    clearRepositorySelection();
  }

  function handleRepositoryPageChange(page: number) {
    if (page < 1 || page === repositoryPage) {
      return;
    }

    setRepositoryPage(page);
    clearRepositorySelection();
  }

  async function handleActivateProjectV2(projectV2Id: string) {
    if (!workspaceId || !selectedRepositoryId) {
      throw new Error("repository를 먼저 선택해 주세요.");
    }
    if (!isWorkspaceOwner) {
      throw new Error("Workspace Owner만 활성 Board를 변경할 수 있습니다.");
    }

    setIsSavingProjectV2Selections(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await apiClient.activateWorkspaceBoardSource(
        workspaceId,
        {
          repositoryId: selectedRepositoryId,
          projectV2Id
        }
      );
      setSelectedProjectV2Id(projectV2Id);
      setActionMessage("활성 Board를 변경했습니다.");
      void refreshGithubSyncRuns().catch(() => undefined);
    } catch (error) {
      setActionError(getErrorMessage(error));
      throw error;
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

    const requiresSelectedRepository = syncTarget !== "source";
    if (requiresSelectedRepository && !selectedRepositoryId) {
      setActionError("저장소를 선택한 뒤 해당 동기화를 시작할 수 있습니다.");
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

      if (!hasRequiredGithubProjectOAuthScopes(projectOAuth.tokenScope)) {
        setActionError(PERSONAL_PROJECT_OAUTH_SCOPE_MESSAGE);
        return;
      }
    }

    const body: StartGithubSyncRunInput = {
      installationId: selectedInstallationId,
      target: syncTarget
    };

    if (requiresSelectedRepository && selectedRepositoryId) {
      body.repositoryId = selectedRepositoryId;
    }

    if (projectScopedSyncTargets.has(syncTarget) && selectedProjectV2Id) {
      body.projectV2Id = selectedProjectV2Id;
    }

    setIsSyncing(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const syncRun = await apiClient.startGithubSyncRun(workspaceId, body);
      setActionMessage(
        getGithubManualSyncActionMessage(
          getGithubConnectSyncTargetLabel(syncRun.target),
          syncRun.status
        )
      );
      await refreshGithubSyncRuns();
      if (syncRun.status === "queued" || syncRun.status === "running") {
        setHasRunningSyncRun(true);
      }
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
      hasNextRepositoryPage={hasNextRepositoryPage}
      isDisconnecting={isDisconnecting}
      isDisconnectingProjectOAuth={isDisconnectingProjectOAuth}
      isDeletingInstallation={isDeletingInstallation}
      isInstallationDeleteRequested={isInstallationDeleteRequested}
      isLoading={isLoading}
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
      onRepositoryPageChange={handleRepositoryPageChange}
      onRepositoryQueryChange={handleRepositoryQueryChange}
      onActivateProjectV2={handleActivateProjectV2}
      onSelectRepository={(repositoryId) =>
        void handleSelectRepository(repositoryId)
      }
      onRequestDeleteInstallation={handleRequestDeleteGithubAppInstallation}
      onStartInstallation={() => void handleStartGithubAppInstallation()}
      onStartOAuth={() => void handleStartGithubOAuth()}
      onStartGithubProjectOAuth={() => void handleStartGithubProjectOAuth()}
      onStartSync={() => void handleStartGithubSyncRun()}
      onSyncTargetChange={setSyncTarget}
      panelStatus={panelStatus}
      projects={snapshot.projects}
      redirectAction={redirectAction}
      repositories={snapshot.repositories}
      repositoriesTotal={snapshot.repositoriesTotal}
      repositoryPage={repositoryPage}
      repositoryQuery={repositoryQuery}
      selectedInstallation={selectedInstallation}
      installations={snapshot.installations}
      selectedInstallationId={selectedInstallationId}
      selectedProjectV2Id={selectedProjectV2Id}
      selectedRepository={selectedRepository}
      selectedRepositoryId={selectedRepositoryId}
      syncRuns={snapshot.syncRuns}
      syncRunsTotal={snapshot.syncRunsTotal}
      syncTarget={syncTarget}
      isActivatingProjectV2={isSavingProjectV2Selections}
      isWorkspaceOwner={isWorkspaceOwner}
    />
  );
}
