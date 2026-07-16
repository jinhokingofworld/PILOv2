"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCcw,
  Search,
  X
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth";
import {
  isPrReviewAnalysisDelayed,
  PR_REVIEW_ANALYSIS_DELAY_NOTICE_MS,
  PR_REVIEW_ANALYSIS_POLL_INTERVAL_MS,
  shouldPollPrReviewAnalysis
} from "@/features/pr-review/analysis-status";
import {
  createPrReviewApiClient,
  PrReviewApiError
} from "@/features/pr-review/api/client";
import { PrReviewAnalysisStatus } from "@/features/pr-review/components/pr-review-analysis-status";
import { PrReviewRoomsPanel } from "@/features/pr-review/components/pr-review-rooms-panel";
import { PrReviewCanvasErrorBoundary } from "@/features/pr-review/components/review-canvas/PrReviewCanvasErrorBoundary";
import { PrReviewCanvasShell } from "@/features/pr-review/components/review-canvas/PrReviewCanvasShell";
import { getPrReviewErrorMessage } from "@/features/pr-review/pr-review-error-message";
import { PrReviewDocumentWorkspaceLocationAdapter } from "@/features/pr-review/pr-review-workspace-location-adapter";
import type {
  PrReviewPaginationMeta,
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewPullRequestFile,
  PrReviewRepository,
  PrReviewSession
} from "@/features/pr-review/types";
import type { CanvasRealtimeIdentity } from "@/shared/canvas-realtime/canvas-realtime-types";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type DetailStatus = "idle" | "loading" | "ready" | "error";

const PR_PAGE_SIZE = 10;
const FILE_PREVIEW_LIMIT = 6;

type PrReviewRouteSelection = {
  pullRequestId: string | null;
  repositoryId: string | null;
  reviewSessionId: string | null;
};

const emptyPagination: PrReviewPaginationMeta = {
  limit: PR_PAGE_SIZE,
  page: 1,
  total: 0
};

function readInitialPrReviewRouteSelection(): PrReviewRouteSelection {
  if (typeof window === "undefined") {
    return {
      pullRequestId: null,
      repositoryId: null,
      reviewSessionId: null
    };
  }

  const searchParams = new URLSearchParams(window.location.search);

  return {
    pullRequestId: searchParams.get("pullRequestId")?.trim() || null,
    repositoryId: searchParams.get("repositoryId")?.trim() || null,
    reviewSessionId: searchParams.get("reviewSessionId")?.trim() || null
  };
}

function replaceReviewSessionRoute(reviewSessionId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (reviewSessionId) {
    url.searchParams.set("reviewSessionId", reviewSessionId);
  } else {
    url.searchParams.delete("reviewSessionId");
  }

  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  return getPrReviewErrorMessage(
    error,
    "PR Review 정보를 불러오지 못했습니다."
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "opened time unknown";
  }

  const createdAt = new Date(value).getTime();
  const diffMs = Date.now() - createdAt;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `opened ${diffMinutes} minutes ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `opened ${diffHours} hours ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `opened ${diffDays} days ago`;
}

function getAuthorInitial(authorName: string | null) {
  return (authorName?.trim().slice(0, 1) || "?").toUpperCase();
}

function getFileStatusLabel(status: PrReviewPullRequestFile["fileStatus"]) {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "modified":
      return "Modified";
    case "renamed":
      return "Renamed";
  }
}

export function PrReviewPanel({
  view = "pull-requests"
}: {
  view?: "pull-requests" | "rooms";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeReviewSessionId =
    searchParams.get("reviewSessionId")?.trim() || null;
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken ?? null;
  const apiClient = useMemo(
    () =>
      createPrReviewApiClient({
        accessToken
      }),
    [accessToken]
  );
  const realtimeIdentity = useMemo<CanvasRealtimeIdentity>(
    () => ({
      authToken: accessToken,
      currentUser: authSession
        ? {
            userId: authSession.user.id,
            displayName:
              authSession.user.name ?? authSession.user.email ?? "PILO",
            avatarUrl: authSession.user.avatarUrl
          }
        : null
    }),
    [
      accessToken,
      authSession?.user.avatarUrl,
      authSession?.user.email,
      authSession?.user.id,
      authSession?.user.name
    ]
  );

  const [repositoryStatus, setRepositoryStatus] =
    useState<LoadStatus>("idle");
  const [pullRequestStatus, setPullRequestStatus] =
    useState<LoadStatus>("idle");
  const [detailStatus, setDetailStatus] = useState<DetailStatus>("idle");
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [pullRequestError, setPullRequestError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [analysisPollingError, setAnalysisPollingError] = useState<string | null>(
    null
  );
  const [isAnalysisDelayed, setIsAnalysisDelayed] = useState(false);
  const [isRetryingReview, setIsRetryingReview] = useState(false);
  const [retryReviewError, setRetryReviewError] = useState<string | null>(null);
  const [reviewSessionLoadError, setReviewSessionLoadError] = useState<
    string | null
  >(null);
  const retryAbortControllerRef = useRef<AbortController | null>(null);
  const [repository, setRepository] = useState<PrReviewRepository | null>(null);
  const [pullRequests, setPullRequests] = useState<PrReviewPullRequest[]>([]);
  const [pagination, setPagination] =
    useState<PrReviewPaginationMeta>(emptyPagination);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedPullRequest, setSelectedPullRequest] =
    useState<PrReviewPullRequest | null>(null);
  const [pullRequestDetail, setPullRequestDetail] =
    useState<PrReviewPullRequestDetail | null>(null);
  const [pullRequestFiles, setPullRequestFiles] = useState<
    PrReviewPullRequestFile[]
  >([]);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [activeReviewSession, setActiveReviewSession] =
    useState<PrReviewSession | null>(null);
  const [activeReviewPullRequest, setActiveReviewPullRequest] = useState<
    PrReviewPullRequest | PrReviewPullRequestDetail | null
  >(null);
  const [routeSelection] = useState(readInitialPrReviewRouteSelection);
  const [requestedReviewSessionId, setRequestedReviewSessionId] = useState(
    routeSelection.reviewSessionId
  );
  const [autoOpenedPullRequestId, setAutoOpenedPullRequestId] = useState<
    string | null
  >(null);

  const repositoryConnected = repositoryStatus === "ready" && repository !== null;
  const isRepositoryLoading =
    repositoryStatus === "idle" || repositoryStatus === "loading";
  const isPullRequestLoading =
    pullRequestStatus === "idle" || pullRequestStatus === "loading";
  const totalPages = Math.max(1, Math.ceil(pagination.total / PR_PAGE_SIZE));
  const visibleFiles = pullRequestFiles.slice(0, FILE_PREVIEW_LIMIT);
  const activeDetail = pullRequestDetail ?? selectedPullRequest;
  const detailDescription =
    pullRequestDetail?.description?.trim() || "PR 설명이 없습니다.";
  const shouldClampDescription =
    detailDescription.length > 360 || detailDescription.split("\n").length > 7;
  const displayedDescription =
    descriptionExpanded || !shouldClampDescription
      ? detailDescription
      : `${detailDescription.slice(0, 360).trimEnd()}...`;
  const backToSelectionLabel =
    view === "rooms" ? "리뷰 공간으로" : "PR 선택으로";

  useEffect(() => {
    setRequestedReviewSessionId(routeReviewSessionId);
  }, [routeReviewSessionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    return () => retryAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (view !== "pull-requests") {
      return;
    }

    void loadConnectedRepository();
    // Repository state reloads when workspace or token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, apiClient, view]);

  useEffect(() => {
    if (view !== "pull-requests") {
      return;
    }

    if (!repositoryConnected || !repository) {
      setPullRequests([]);
      setPagination(emptyPagination);
      setPullRequestStatus("ready");
      return;
    }

    void loadPullRequests(repository.id, page, debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryConnected, repository?.id, page, debouncedQuery, view]);

  useEffect(() => {
    const reviewSessionId = requestedReviewSessionId;
    if (!reviewSessionId || !workspaceId || activeReviewSession) {
      return;
    }

    const abortController = new AbortController();
    setReviewSessionLoadError(null);

    void (async () => {
      try {
        const session = await apiClient.getReviewSession(
          workspaceId,
          reviewSessionId,
          { signal: abortController.signal }
        );
        if (abortController.signal.aborted) {
          return;
        }

        let pullRequest: PrReviewPullRequestDetail | null = null;

        try {
          pullRequest = await apiClient.getPullRequest(
            workspaceId,
            session.pullRequestId,
            { signal: abortController.signal }
          );
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
        }

        if (abortController.signal.aborted) {
          return;
        }

        setActiveReviewSession(session);
        setActiveReviewPullRequest(pullRequest);
        setAnalysisPollingError(null);
        setRetryReviewError(null);
      } catch (error) {
        if (!isAbortError(error)) {
          setReviewSessionLoadError(
            view === "rooms"
              ? "Review session 상태를 불러오지 못했습니다. 리뷰 공간에서 다시 입장해주세요."
              : "Review session 상태를 불러오지 못했습니다. PR 목록에서 다시 시작해주세요."
          );
        }
      }
    })();

    return () => abortController.abort();
  }, [activeReviewSession, apiClient, requestedReviewSessionId, view, workspaceId]);

  useEffect(() => {
    if (
      !routeSelection.pullRequestId ||
      requestedReviewSessionId ||
      view !== "pull-requests" ||
      !repositoryConnected ||
      !workspaceId ||
      selectedPullRequest ||
      activeReviewSession ||
      autoOpenedPullRequestId === routeSelection.pullRequestId
    ) {
      return;
    }

    const listedPullRequest = pullRequests.find(
      (pullRequest) => pullRequest.id === routeSelection.pullRequestId
    );

    setAutoOpenedPullRequestId(routeSelection.pullRequestId);

    if (listedPullRequest) {
      void openPullRequestDetail(listedPullRequest);
      return;
    }

    void openPullRequestDetailById(routeSelection.pullRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeReviewSession,
    autoOpenedPullRequestId,
    pullRequests,
    repositoryConnected,
    requestedReviewSessionId,
    routeSelection.pullRequestId,
    selectedPullRequest,
    view,
    workspaceId
  ]);

  useEffect(() => {
    const session = activeReviewSession;
    if (!session || !workspaceId || !shouldPollPrReviewAnalysis(session.status)) {
      return;
    }

    const abortController = new AbortController();
    let pollTimeoutId: number | null = null;
    let delayTimeoutId: number | null = null;

    setAnalysisPollingError(null);
    setIsAnalysisDelayed(isPrReviewAnalysisDelayed(session));

    const startedAtMs = Date.parse(session.createdAt);
    if (Number.isFinite(startedAtMs)) {
      const delayRemainingMs = Math.max(
        0,
        PR_REVIEW_ANALYSIS_DELAY_NOTICE_MS - (Date.now() - startedAtMs)
      );
      delayTimeoutId = window.setTimeout(
        () => setIsAnalysisDelayed(true),
        delayRemainingMs
      );
    }

    const scheduleNextPoll = () => {
      pollTimeoutId = window.setTimeout(() => {
        void pollReviewSession();
      }, PR_REVIEW_ANALYSIS_POLL_INTERVAL_MS);
    };

    const pollReviewSession = async () => {
      try {
        const nextSession = await apiClient.getReviewSession(
          workspaceId,
          session.id,
          { signal: abortController.signal }
        );
        if (abortController.signal.aborted) {
          return;
        }

        setActiveReviewSession((currentSession) =>
          currentSession?.id === nextSession.id ? nextSession : currentSession
        );
        setAnalysisPollingError(null);

        if (shouldPollPrReviewAnalysis(nextSession.status)) {
          scheduleNextPoll();
        }
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          return;
        }

        setAnalysisPollingError(
          "분석 상태를 확인하지 못했습니다. 분석은 계속 진행될 수 있으며 자동으로 다시 확인합니다."
        );
        scheduleNextPoll();
      }
    };

    scheduleNextPoll();

    return () => {
      abortController.abort();
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
      }
      if (delayTimeoutId !== null) {
        window.clearTimeout(delayTimeoutId);
      }
    };
  }, [
    activeReviewSession?.createdAt,
    activeReviewSession?.id,
    activeReviewSession?.status,
    apiClient,
    workspaceId
  ]);

  async function loadConnectedRepository() {
    if (!workspaceId) {
      setRepositoryStatus("ready");
      setRepository(null);
      setRepositoryError(null);
      return;
    }

    setRepositoryStatus("loading");
    setRepositoryError(null);
    setSessionError(null);
    setActiveReviewSession(null);
    setActiveReviewPullRequest(null);

    try {
      const repositoriesPage = await apiClient.listRepositories(workspaceId, {
        includeArchived: false,
        limit: routeSelection.repositoryId ? 100 : 2
      });
      const requestedRepository = routeSelection.repositoryId
        ? repositoriesPage.data.find(
            (candidate) => candidate.id === routeSelection.repositoryId
          )
        : null;
      const nextRepository =
        requestedRepository ??
        repositoriesPage.data.find((candidate) => !candidate.archived) ??
        repositoriesPage.data[0] ??
        null;

      setRepository(nextRepository);
      setRepositoryStatus("ready");
      setPage(1);
      setQuery("");
      setDebouncedQuery("");
    } catch (error) {
      setRepository(null);
      setRepositoryStatus("error");
      setRepositoryError(getErrorMessage(error));
    }
  }

  async function openPullRequestDetailById(pullRequestId: string) {
    setSelectedPullRequest(null);
    setPullRequestDetail(null);
    setPullRequestFiles([]);
    setDescriptionExpanded(false);
    setDetailError(null);
    setSessionError(null);
    setDetailStatus("loading");

    try {
      const [detail, files] = await Promise.all([
        apiClient.getPullRequest(workspaceId, pullRequestId),
        apiClient.listPullRequestFiles(workspaceId, pullRequestId)
      ]);
      setSelectedPullRequest(detail);
      setPullRequestDetail(detail);
      setPullRequestFiles(files);
      setDetailStatus("ready");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(getErrorMessage(error));
    }
  }

  async function loadPullRequests(
    repositoryId: string,
    nextPage: number,
    nextQuery: string
  ) {
    setPullRequestStatus("loading");
    setPullRequestError(null);

    try {
      const pullRequestPage = await apiClient.listOpenPullRequests(
        workspaceId,
        repositoryId,
        {
          limit: PR_PAGE_SIZE,
          page: nextPage,
          query: nextQuery || undefined
        }
      );

      setPullRequests(pullRequestPage.data);
      setPagination(pullRequestPage.meta);
      setPullRequestStatus("ready");
    } catch (error) {
      setPullRequests([]);
      setPagination(emptyPagination);
      setPullRequestStatus("error");
      setPullRequestError(getErrorMessage(error));
    }
  }

  async function openPullRequestDetail(pullRequest: PrReviewPullRequest) {
    setSelectedPullRequest(pullRequest);
    setPullRequestDetail(null);
    setPullRequestFiles([]);
    setDescriptionExpanded(false);
    setDetailError(null);
    setSessionError(null);
    setDetailStatus("loading");

    try {
      const [detail, files] = await Promise.all([
        apiClient.getPullRequest(workspaceId, pullRequest.id),
        apiClient.listPullRequestFiles(workspaceId, pullRequest.id)
      ]);
      setPullRequestDetail(detail);
      setPullRequestFiles(files);
      setDetailStatus("ready");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(getErrorMessage(error));
    }
  }

  function closePullRequestDetail() {
    if (isStartingReview) {
      return;
    }

    setSelectedPullRequest(null);
    setPullRequestDetail(null);
    setPullRequestFiles([]);
    setDetailError(null);
    setSessionError(null);
    setDetailStatus("idle");
    setDescriptionExpanded(false);
  }

  function activateReviewSession(
    session: PrReviewSession,
    pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null
  ) {
    setActiveReviewSession(session);
    setActiveReviewPullRequest(pullRequest);
    setAnalysisPollingError(null);
    setIsAnalysisDelayed(isPrReviewAnalysisDelayed(session));
    setRetryReviewError(null);
    setReviewSessionLoadError(null);
    setRequestedReviewSessionId(session.id);
    setSelectedPullRequest(null);
    setPullRequestDetail(null);
    setPullRequestFiles([]);
    setDetailError(null);
    setSessionError(null);
    setDetailStatus("idle");
    setDescriptionExpanded(false);
    replaceReviewSessionRoute(session.id);
  }

  function activateReviewSessionWithLatestPullRequest(session: PrReviewSession) {
    void apiClient
      .getPullRequest(workspaceId, session.pullRequestId)
      .then((pullRequest) => activateReviewSession(session, pullRequest))
      .catch(() => activateReviewSession(session, activeReviewPullRequest));
  }

  function leaveReviewSession() {
    retryAbortControllerRef.current?.abort();
    setActiveReviewSession(null);
    setActiveReviewPullRequest(null);
    setAnalysisPollingError(null);
    setIsAnalysisDelayed(false);
    setRetryReviewError(null);
    setReviewSessionLoadError(null);
    setRequestedReviewSessionId(null);
    replaceReviewSessionRoute(null);
  }

  function enterReviewSession(reviewSessionId: string) {
    setReviewSessionLoadError(null);
    setRequestedReviewSessionId(reviewSessionId);
    replaceReviewSessionRoute(reviewSessionId);
  }

  async function startReviewSession() {
    const pullRequestId = activeDetail?.id;
    const reviewPullRequest = activeDetail;
    if (!pullRequestId) {
      return;
    }

    setIsStartingReview(true);
    setSessionError(null);

    try {
      const session = await apiClient.createReviewSession(
        workspaceId,
        pullRequestId
      );
      activateReviewSession(session, reviewPullRequest);
    } catch (error) {
      setSessionError(getErrorMessage(error));
    } finally {
      setIsStartingReview(false);
    }
  }

  async function retryReviewSession() {
    const session = activeReviewSession;
    if (!session || session.status !== "failed") {
      return;
    }

    setIsRetryingReview(true);
    setRetryReviewError(null);
    const abortController = new AbortController();
    retryAbortControllerRef.current = abortController;

    try {
      const nextSession = await apiClient.retryReviewSession(
        workspaceId,
        session.id,
        { signal: abortController.signal }
      );
      if (abortController.signal.aborted) {
        return;
      }
      activateReviewSession(nextSession, activeReviewPullRequest);
    } catch (error) {
      if (!isAbortError(error)) {
        setRetryReviewError(
          error instanceof PrReviewApiError
            ? error.message
            : "새 분석을 시작하지 못했습니다. 다시 시도해주세요."
        );
      }
    } finally {
      if (retryAbortControllerRef.current === abortController) {
        retryAbortControllerRef.current = null;
        setIsRetryingReview(false);
      }
    }
  }

  function goToGithubPage() {
    router.push("/github");
  }

  return (
    <>
      {!activeReviewSession && !requestedReviewSessionId && !routeReviewSessionId ? (
        <PrReviewDocumentWorkspaceLocationAdapter />
      ) : null}
      {activeReviewSession?.status === "analyzing" ||
      activeReviewSession?.status === "failed" ? (
        <PrReviewAnalysisStatus
          backLabel={backToSelectionLabel}
          isDelayed={isAnalysisDelayed}
          isRetrying={isRetryingReview}
          onBackToSelection={leaveReviewSession}
          onRetry={() => void retryReviewSession()}
          pollingError={analysisPollingError}
          pullRequest={activeReviewPullRequest}
          retryError={retryReviewError}
          session={activeReviewSession}
        />
      ) : activeReviewSession ? (
        <PrReviewCanvasErrorBoundary
          backLabel={backToSelectionLabel}
          key={activeReviewSession.id}
          onBackToSelection={leaveReviewSession}
        >
          <PrReviewCanvasShell
            apiClient={apiClient}
            backLabel={backToSelectionLabel}
            onBackToSelection={leaveReviewSession}
            onGoToGithub={goToGithubPage}
            onReviewRoomDeleted={leaveReviewSession}
            onReviewSessionCreated={activateReviewSessionWithLatestPullRequest}
            pullRequest={activeReviewPullRequest}
            realtimeIdentity={realtimeIdentity}
            session={activeReviewSession}
            workspaceId={workspaceId}
          />
        </PrReviewCanvasErrorBoundary>
      ) : null}

      {!activeReviewSession &&
      requestedReviewSessionId &&
      !reviewSessionLoadError ? (
        <ReviewSessionLoadingState />
      ) : null}

      {!activeReviewSession && reviewSessionLoadError ? (
        <ReviewSessionLoadErrorState
          backLabel={backToSelectionLabel}
          message={reviewSessionLoadError}
          onBack={leaveReviewSession}
          onRetry={() => window.location.reload()}
        />
      ) : null}

      {!activeReviewSession &&
      !requestedReviewSessionId &&
      view === "rooms" ? (
        <PrReviewRoomsPanel onEnterReviewSession={enterReviewSession} />
      ) : null}

      {!activeReviewSession &&
      !requestedReviewSessionId &&
      view === "pull-requests" ? (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <section className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium text-primary">PR Review</p>
        <h1 className="text-3xl font-semibold tracking-normal text-foreground">
          리뷰할 PR을 선택하세요
        </h1>
      </section>

      {reviewSessionLoadError ? (
        <InlineErrorState
          message={reviewSessionLoadError}
          onRetry={() => window.location.reload()}
        />
      ) : null}

      {isRepositoryLoading ? (
        <RepositoryLoadingState />
      ) : repositoryStatus === "error" ? (
        <RepositoryErrorState
          message={repositoryError}
          onRetry={() => void loadConnectedRepository()}
        />
      ) : !repository ? (
        <RepositoryDisconnectedState onGoToGithub={goToGithubPage} />
      ) : (
        <Card className="rounded-lg">
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <GitPullRequest className="size-5 text-primary" />
                  Open PR
                </CardTitle>
                <CardDescription className="mt-1">
                  {repository.fullName} repository의 열린 Pull Request입니다.
                </CardDescription>
              </div>
              <RepositorySummary repository={repository} />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input
                aria-label="PR 번호 또는 제목 검색"
                className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="PR 번호 또는 제목 검색"
                value={query}
              />
            </div>
          </CardHeader>

          <CardContent>
            {isPullRequestLoading ? (
              <PullRequestListSkeleton />
            ) : pullRequestStatus === "error" ? (
              <InlineErrorState
                message={pullRequestError}
                onRetry={() =>
                  void loadPullRequests(repository.id, page, debouncedQuery)
                }
              />
            ) : pullRequests.length === 0 ? (
              <EmptyPullRequestState hasQuery={Boolean(debouncedQuery)} />
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className="divide-y">
                  {pullRequests.map((pullRequest) => (
                    <PullRequestRow
                      key={pullRequest.id}
                      onSelect={() => void openPullRequestDetail(pullRequest)}
                      pullRequest={pullRequest}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {formatNumber(pagination.total)} open PR
              </p>
              <div className="flex items-center gap-2">
                <Button
                  disabled={page <= 1 || isPullRequestLoading}
                  onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                  <span className="sr-only">이전 페이지</span>
                </Button>
                <span className="min-w-14 text-center text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  disabled={page >= totalPages || isPullRequestLoading}
                  onClick={() => setPage((currentPage) => currentPage + 1)}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronRight className="size-4" />
                  <span className="sr-only">다음 페이지</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedPullRequest ? (
        <PullRequestDetailDialog
          descriptionExpanded={descriptionExpanded}
          detail={activeDetail}
          detailError={detailError}
          detailStatus={detailStatus}
          displayedDescription={displayedDescription}
          files={visibleFiles}
          filesTotal={pullRequestFiles.length}
          isStartingReview={isStartingReview}
          onClose={closePullRequestDetail}
          onRetry={() => void openPullRequestDetail(selectedPullRequest)}
          onStartReview={() => void startReviewSession()}
          sessionError={sessionError}
          setDescriptionExpanded={setDescriptionExpanded}
          shouldClampDescription={shouldClampDescription}
        />
      ) : null}
      </div>
      ) : null}
    </>
  );
}

function RepositorySummary({ repository }: { repository: PrReviewRepository }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <FolderGit2 className="size-4 text-muted-foreground" />
      <span className="font-medium">{repository.name}</span>
      <span className="text-muted-foreground">
        {repository.private ? "Private" : "Public"}
      </span>
    </div>
  );
}

function ReviewSessionLoadingState() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        리뷰 공간을 여는 중
      </div>
    </div>
  );
}

function ReviewSessionLoadErrorState({
  backLabel,
  message,
  onBack,
  onRetry
}: {
  backLabel: string;
  message: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-xl items-center">
      <Card className="w-full rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-destructive" />
            리뷰 공간을 열지 못했습니다
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-end gap-2">
          <Button onClick={onBack} type="button" variant="secondary">
            <ArrowLeft className="size-4" />
            {backLabel}
          </Button>
          <Button onClick={onRetry} type="button" variant="outline">
            <RefreshCcw className="size-4" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RepositoryLoadingState() {
  return (
    <Card className="mx-auto w-full max-w-xl rounded-lg">
      <CardHeader>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

function RepositoryErrorState({
  message,
  onRetry
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Card className="mx-auto w-full max-w-xl rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="size-4 text-destructive" />
          PR 정보를 불러오지 못했습니다
        </CardTitle>
        <CardDescription>{message ?? "잠시 후 다시 시도해주세요."}</CardDescription>
        <CardAction>
          <Button onClick={onRetry} type="button" variant="outline">
            <RefreshCcw className="size-4" />
            다시 시도
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

function RepositoryDisconnectedState({
  onGoToGithub
}: {
  onGoToGithub: () => void;
}) {
  return (
    <Card className="mx-auto w-full max-w-xl rounded-lg">
      <CardHeader className="items-center text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FolderGit2 className="size-5" />
        </span>
        <CardTitle>레포지토리 연결이 안 되었습니다</CardTitle>
        <CardDescription>
          PR Review를 시작하려면 먼저 GitHub 탭에서 repository를 연결해주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button onClick={onGoToGithub} type="button">
          <FolderGit2 className="size-4" />
          GitHub로 이동
        </Button>
      </CardContent>
    </Card>
  );
}

function PullRequestListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton className="h-[76px] rounded-lg" key={index} />
      ))}
    </div>
  );
}

function InlineErrorState({
  message,
  onRetry
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm">
      <span className="text-destructive">
        {message ?? "요청을 처리하지 못했습니다."}
      </span>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        다시 시도
      </Button>
    </div>
  );
}

function EmptyPullRequestState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {hasQuery
        ? "검색 조건과 일치하는 open PR이 없습니다."
        : "연결된 repository에 열린 PR이 없습니다."}
    </div>
  );
}

function PullRequestRow({
  pullRequest,
  onSelect
}: {
  pullRequest: PrReviewPullRequest;
  onSelect: () => void;
}) {
  return (
    <button
      className="grid w-full gap-2 bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_auto]"
      onClick={onSelect}
      type="button"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base font-semibold text-primary">
            #{pullRequest.githubNumber}
          </span>
          <span className="truncate text-base font-semibold">
            {pullRequest.title}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          #{pullRequest.githubNumber} {formatRelativeTime(pullRequest.createdAtGithub)}{" "}
          by {pullRequest.authorName ?? "unknown"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground md:justify-end">
        <span>{pullRequest.changedFilesCount} files</span>
        <span className="text-emerald-600">
          +{formatNumber(pullRequest.additions)}
        </span>
        <span className="text-red-500">-{formatNumber(pullRequest.deletions)}</span>
      </div>
    </button>
  );
}

function PullRequestDetailDialog({
  detail,
  detailStatus,
  detailError,
  displayedDescription,
  shouldClampDescription,
  descriptionExpanded,
  setDescriptionExpanded,
  files,
  filesTotal,
  isStartingReview,
  sessionError,
  onClose,
  onRetry,
  onStartReview
}: {
  detail: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  detailStatus: DetailStatus;
  detailError: string | null;
  displayedDescription: string;
  shouldClampDescription: boolean;
  descriptionExpanded: boolean;
  setDescriptionExpanded: (value: boolean) => void;
  files: PrReviewPullRequestFile[];
  filesTotal: number;
  isStartingReview: boolean;
  sessionError: string | null;
  onClose: () => void;
  onRetry: () => void;
  onStartReview: () => void;
}) {
  if (!detail) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
    >
      <Card className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-lg shadow-2xl">
        <CardHeader className="gap-3">
          <CardAction>
            <Button
              disabled={isStartingReview}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
              <span className="sr-only">닫기</span>
            </Button>
          </CardAction>
          <div className="min-w-0 pr-9">
            <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl">
              <span className="text-primary">#{detail.githubNumber}</span>
              <span>{detail.title}</span>
            </CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
              <AuthorLabel pullRequest={detail} />
              <span>{formatRelativeTime(detail.createdAtGithub)}</span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <GitBranch className="size-3.5" />
              {detail.headBranch ?? "-"} → {detail.baseBranch ?? "-"}
            </span>
            <span>{detail.changedFilesCount} files changed</span>
            <span className="font-medium text-emerald-600">
              +{formatNumber(detail.additions)}
            </span>
            <span className="font-medium text-red-500">
              -{formatNumber(detail.deletions)}
            </span>
            <span>{formatNumber(detail.commitsCount)} commits</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {detailStatus === "loading" ? (
            <DetailLoadingState />
          ) : detailStatus === "error" ? (
            <InlineErrorState message={detailError} onRetry={onRetry} />
          ) : (
            <>
              <section>
                <h2 className="mb-2 text-sm font-semibold">설명</h2>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {displayedDescription}
                  </p>
                  {shouldClampDescription ? (
                    <div className="mt-3 flex justify-end">
                      <Button
                        onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {descriptionExpanded ? "접기" : "... 더보기"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">변경 파일</h2>
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(detail.changedFilesCount)} files
                  </span>
                </div>
                <div className="rounded-lg border">
                  {files.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      변경 파일 상세를 불러오지 못했거나 표시할 파일이 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {files.map((file) => (
                        <ChangedFileRow file={file} key={file.filePath} />
                      ))}
                    </div>
                  )}
                </div>
                {filesTotal > FILE_PREVIEW_LIMIT ? (
                  <p className="mt-2 text-right text-sm text-muted-foreground">
                    외 {formatNumber(filesTotal - FILE_PREVIEW_LIMIT)}개 파일
                  </p>
                ) : null}
              </section>
            </>
          )}

          {sessionError ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {sessionError}
            </div>
          ) : null}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button
              disabled={isStartingReview}
              onClick={onClose}
              type="button"
              variant="secondary"
            >
              <ArrowLeft className="size-4" />
              뒤로가기
            </Button>
            <Button
              disabled={detailStatus === "loading" || isStartingReview}
              onClick={onStartReview}
              type="button"
            >
              {isStartingReview ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GitPullRequest className="size-4" />
              )}
              리뷰 시작
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailLoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-28 rounded-lg" />
    </div>
  );
}

function AuthorLabel({ pullRequest }: { pullRequest: PrReviewPullRequest }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar size="sm">
        {pullRequest.authorAvatarUrl ? (
          <AvatarImage
            alt={pullRequest.authorName ?? "PR author"}
            src={pullRequest.authorAvatarUrl}
          />
        ) : null}
        <AvatarFallback>{getAuthorInitial(pullRequest.authorName)}</AvatarFallback>
      </Avatar>
      by {pullRequest.authorName ?? "unknown"}
    </span>
  );
}

function ChangedFileRow({ file }: { file: PrReviewPullRequestFile }) {
  return (
    <div className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{file.filePath}</span>
          <a
            aria-label={`${file.filePath} GitHub에서 열기`}
            className="shrink-0 text-muted-foreground hover:text-primary"
            href={file.githubFileUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {getFileStatusLabel(file.fileStatus)}
          {file.previousFilePath ? ` · from ${file.previousFilePath}` : ""}
          {file.isBinary ? " · binary" : ""}
          {file.isLargeDiff ? " · large diff" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 md:justify-end">
        <span className="text-emerald-600">+{formatNumber(file.additions)}</span>
        <span className="text-red-500">-{formatNumber(file.deletions)}</span>
      </div>
    </div>
  );
}
