"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  RefreshCcw,
  Send
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PrReviewApiError,
  type createPrReviewApiClient
} from "@/features/pr-review/api/client";
import { PrReviewCanvasSurface } from "@/features/pr-review/components/review-canvas/PrReviewCanvasSurface";
import { PrReviewRoomDeleteButton } from "@/features/pr-review/components/pr-review-room-delete-button";
import { PrReviewFileDiffDrawer } from "@/features/pr-review/components/review-canvas/PrReviewFileDiffDrawer";
import { PrReviewSubmitReviewModal } from "@/features/pr-review/components/review-canvas/PrReviewSubmitReviewModal";
import { getPrReviewErrorMessage } from "@/features/pr-review/pr-review-error-message";
import {
  applyDecisionUpdateToCanvas,
  applyDecisionUpdateToSummary
} from "@/features/pr-review/realtime/pr-review-decision-sync";
import {
  applyPrReviewConflictDraftResolutionState,
  buildPrReviewConflictsApplyInput,
  createPrReviewConflictDraft,
  getPrReviewConflictDraftProgress,
  isPrReviewConflictDraftReady,
  reconcilePrReviewConflictDrafts,
  toPrReviewConflictDraftResolutionState,
  type PrReviewConflictDraft,
  type PrReviewConflictDraftMap
} from "@/features/pr-review/components/review-canvas/pr-review-conflict-drafts";
import type {
  PrReviewCanvas,
  PrReviewConflictAnalysis,
  PrReviewConflictDraftResolutionState,
  PrReviewConflictsApplyResult,
  PrReviewConflictFile,
  PrReviewConflictStatus,
  PrReviewDecisionUpdatedEvent,
  PrReviewFile,
  PrReviewFileReviewStatus,
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewSession,
  PrReviewSummary,
  PrReviewUnsupportedConflictFile
} from "@/features/pr-review/types";
import type { CanvasRealtimeIdentity } from "@/shared/canvas-realtime/canvas-realtime-types";
import { usePrReviewGithubSourceInvalidation } from "@/features/pr-review/realtime/usePrReviewGithubSourceInvalidation";
import { createPrReviewPullRequestRefreshCoordinator } from "@/features/pr-review/realtime/pr-review-pull-request-refresh";
import type { PrReviewFollowSurfaceKey } from "@/features/pr-review/pr-review-follow-location";
import { useWorkspacePresence } from "@/shared/workspace-presence/workspace-presence-provider";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type PrReviewCanvasShellProps = {
  apiClient: PrReviewApiClient;
  backLabel: string;
  onBackToSelection: () => void;
  onGoToGithub: () => void;
  onReviewRoomDeleted: () => void;
  onReviewSessionCreated: (session: PrReviewSession) => void;
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  realtimeIdentity: CanvasRealtimeIdentity;
  session: PrReviewSession;
  workspaceId: string;
};

type CanvasLoadStatus = "idle" | "loading" | "ready" | "error";
type ConflictAnalysisLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "stale";
type MergeStatus = "idle" | "merging" | "merged" | "error";
type ConflictApplyStatus = "idle" | "applying" | "applied" | "error";
type GithubReconnectStatus = "idle" | "opening" | "opened" | "error";
type RevisionStartStatus = "idle" | "starting" | "error";
type LoadCanvasDataOptions = {
  quiet?: boolean;
};

const DETAIL_PANEL_MIN_WIDTH = 360;
const DETAIL_PANEL_MAX_WIDTH = 620;
const DETAIL_PANEL_DEFAULT_WIDTH = 440;
const CONFLICT_STATUS_POLL_INTERVAL_MS = 2_000;
const CONFLICT_STATUS_POLL_MAX_ATTEMPTS = 5;
const PULL_REQUEST_HEAD_POLL_INTERVAL_MS = 30_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getErrorMessage(error: unknown) {
  return getPrReviewErrorMessage(
    error,
    "리뷰 Canvas를 불러오지 못했습니다."
  );
}

function getConflictAnalysisErrorState(error: unknown): {
  message: string;
  status: Exclude<ConflictAnalysisLoadStatus, "idle" | "loading" | "ready">;
} {
  const rawMessage =
    error instanceof Error
      ? error.message
      : "Conflict 정보를 불러오지 못했습니다.";

  if (error instanceof PrReviewApiError && error.status === 409) {
    return {
      message: "PR head가 변경되었습니다. PR 목록으로 돌아가 새 리뷰를 시작해 주세요.",
      status: "stale"
    };
  }

  const message =
    rawMessage.includes("repository file lookup is temporarily unavailable") ||
    rawMessage.includes("repository file content lookup failed") ||
    rawMessage.includes("repository content lookup failed")
      ? "GitHub 파일 정보를 잠시 불러오지 못했습니다. 다시 시도해 주세요."
      : rawMessage.includes("Contents read permission is required")
        ? "GitHub App에 Contents 읽기 권한이 필요합니다."
        : rawMessage;

  return {
    message,
    status: "error"
  };
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

function getConflictLabel(status: PrReviewConflictStatus) {
  switch (status) {
    case "checking":
      return "Conflict 확인 중";
    case "clean":
      return "Conflict 없음";
    case "conflicted":
      return "Conflict 있음";
    case "unknown":
      return "Conflict 미확인";
  }
}

function getConflictClassName(status: PrReviewConflictStatus) {
  switch (status) {
    case "checking":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "clean":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "conflicted":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "unknown":
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function updateReviewedCount(
  currentCount: number,
  previousStatus: PrReviewFileReviewStatus,
  nextStatus: PrReviewFileReviewStatus
) {
  const wasReviewed = previousStatus !== "not_reviewed";
  const isReviewed = nextStatus !== "not_reviewed";

  if (wasReviewed === isReviewed) {
    return currentCount;
  }

  return currentCount + (isReviewed ? 1 : -1);
}

function getPullRequestMergedAt(
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null
): string | null {
  return pullRequest && "mergedAt" in pullRequest ? pullRequest.mergedAt : null;
}

function getMergeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "GitHub pull request merge failed";
}

function getConflictApplyErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Conflict 적용에 실패했습니다.";

  if (
    message.includes("conflict file set is stale") ||
    message.includes("head SHA is stale") ||
    message.includes("base SHA is stale") ||
    message.includes("blob SHA is stale") ||
    message.includes("pull request conflict no longer exists")
  ) {
    return "PR 브랜치의 Conflict 상태가 바뀌었습니다. 동기화 후 새 리뷰를 시작해 주세요.";
  }
  if (message.includes("Unsupported conflict files")) {
    return "PILO에서 지원하지 않는 Conflict 파일이 있어 전체 적용할 수 없습니다.";
  }
  if (message.includes("Contents write permission is required")) {
    return "GitHub App에 Contents 쓰기 권한이 필요합니다.";
  }
  if (message.includes("GitHub OAuth connection is required")) {
    return "GitHub 연결이 필요합니다. GitHub를 연결한 뒤 다시 시도해 주세요.";
  }
  if (message.includes("GitHub OAuth connection is invalid")) {
    return "GitHub 연결이 유효하지 않습니다. GitHub를 다시 연결해 주세요.";
  }

  return message;
}

function isGithubOAuthReconnectError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("GitHub OAuth connection is required") ||
    message.includes("GitHub OAuth connection is invalid")
  );
}

function getMergeDisabledReason(input: {
  conflictStatus: PrReviewConflictStatus;
  isPullRequestMerged: boolean;
  isPullRequestClosed: boolean;
  isReviewVersionStale: boolean;
  loadStatus: CanvasLoadStatus;
  pullRequestState: "open" | "closed";
  reviewSubmitted: boolean;
}): string | null {
  if (input.loadStatus !== "ready") {
    return "Review data is still loading";
  }

  if (input.isReviewVersionStale) {
    return "A newer commit was detected. Start the latest version analysis first.";
  }

  if (input.isPullRequestClosed) {
    return "This pull request is closed and the review room is read-only.";
  }

  if (input.isPullRequestMerged) {
    return "Pull request is already merged";
  }

  if (input.pullRequestState !== "open") {
    return "Only open pull requests can be merged";
  }

  if (!input.reviewSubmitted) {
    return "Submit the GitHub Review before merge";
  }

  if (input.conflictStatus !== "clean") {
    return "Resolve PR conflicts before merge";
  }

  return null;
}

export function PrReviewCanvasShell({
  apiClient,
  backLabel,
  onBackToSelection,
  onGoToGithub,
  onReviewRoomDeleted,
  onReviewSessionCreated,
  pullRequest,
  realtimeIdentity,
  session,
  workspaceId
}: PrReviewCanvasShellProps) {
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    DETAIL_PANEL_DEFAULT_WIDTH
  );
  const [loadStatus, setLoadStatus] = useState<CanvasLoadStatus>("idle");
  const [summary, setSummary] = useState<PrReviewSummary | null>(null);
  const [canvas, setCanvas] = useState<PrReviewCanvas | null>(null);
  const [conflictAnalysis, setConflictAnalysis] =
    useState<PrReviewConflictAnalysis | null>(null);
  const [conflictAnalysisStatus, setConflictAnalysisStatus] =
    useState<ConflictAnalysisLoadStatus>("idle");
  const [conflictAnalysisError, setConflictAnalysisError] = useState<
    string | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openedReviewFileId, setOpenedReviewFileId] = useState<
    string | null
  >(null);
  const [activeFollowSurface, setActiveFollowSurface] =
    useState<PrReviewFollowSurfaceKey>("pr-review-diff");
  const { reportManualInteraction } = useWorkspacePresence();
  const [latestDecisionUpdate, setLatestDecisionUpdate] =
    useState<PrReviewDecisionUpdatedEvent | null>(null);
  const [isSubmitReviewModalOpen, setIsSubmitReviewModalOpen] = useState(false);
  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus>("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [conflictDrafts, setConflictDrafts] =
    useState<PrReviewConflictDraftMap>({});
  const [isConflictApplyConfirmOpen, setIsConflictApplyConfirmOpen] =
    useState(false);
  const [conflictApplyStatus, setConflictApplyStatus] =
    useState<ConflictApplyStatus>("idle");
  const [conflictApplyError, setConflictApplyError] = useState<string | null>(
    null
  );
  const [conflictApplyResult, setConflictApplyResult] =
    useState<PrReviewConflictsApplyResult | null>(null);
  const [
    conflictApplyRequiresGithubReconnect,
    setConflictApplyRequiresGithubReconnect
  ] = useState(false);
  const [githubReconnectStatus, setGithubReconnectStatus] =
    useState<GithubReconnectStatus>("idle");
  const [githubReconnectMessage, setGithubReconnectMessage] = useState<
    string | null
  >(null);
  const [latestPullRequest, setLatestPullRequest] = useState(pullRequest);
  const [revisionStartStatus, setRevisionStartStatus] =
    useState<RevisionStartStatus>("idle");
  const [revisionStartError, setRevisionStartError] = useState<string | null>(
    null
  );
  const conflictDraftSaveTimersRef = useRef<
    Record<string, number | undefined>
  >({});
  const refreshPullRequestRef = useRef<() => void | Promise<unknown>>(
    () => undefined
  );

  useEffect(() => {
    setLatestPullRequest(pullRequest);
  }, [pullRequest]);

  const refreshPullRequest = useCallback(
    () => refreshPullRequestRef.current(),
    []
  );

  const handleOpenedReviewFileChange = useCallback(
    (reviewFileId: string | null) => {
      if (reviewFileId && reviewFileId !== openedReviewFileId) {
        setActiveFollowSurface("pr-review-diff");
      }
      setOpenedReviewFileId(reviewFileId);
    },
    [openedReviewFileId]
  );

  const handleFollowSurfaceInteraction = useCallback(
    (surface: PrReviewFollowSurfaceKey) => {
      setActiveFollowSurface(surface);
      reportManualInteraction();
    },
    [reportManualInteraction]
  );

  usePrReviewGithubSourceInvalidation({
    authToken: realtimeIdentity.authToken,
    pullRequestId: session.pullRequestId,
    refreshPullRequest,
    workspaceId
  });

  useEffect(() => {
    if (!workspaceId || !session.pullRequestId) {
      refreshPullRequestRef.current = () => undefined;
      return;
    }

    const coordinator = createPrReviewPullRequestRefreshCoordinator({
      apply: setLatestPullRequest,
      load: () => apiClient.getPullRequest(workspaceId, session.pullRequestId)
    });
    const requestRefresh = () => coordinator.refresh();
    refreshPullRequestRef.current = requestRefresh;

    void requestRefresh();
    const intervalId = window.setInterval(
      () => void requestRefresh(),
      PULL_REQUEST_HEAD_POLL_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
      coordinator.dispose();
      if (refreshPullRequestRef.current === requestRefresh) {
        refreshPullRequestRef.current = () => undefined;
      }
    };
  }, [apiClient, session.pullRequestId, workspaceId]);

  const loadCanvasData = useCallback(async (options: LoadCanvasDataOptions = {}) => {
    const quiet = options.quiet ?? false;

    if (!workspaceId) {
      setLoadStatus("error");
      setLoadError("워크스페이스 정보를 확인할 수 없습니다.");
      setSummary(null);
      setCanvas(null);
      setConflictAnalysis(null);
      setConflictAnalysisStatus("error");
      setConflictAnalysisError("워크스페이스 정보를 확인할 수 없습니다.");
      return;
    }

    if (!quiet) {
      setLoadStatus("loading");
      setLoadError(null);
      setConflictAnalysisStatus("loading");
      setConflictAnalysisError(null);
    }

    try {
      const [nextSummary, nextCanvas] = await Promise.all([
        apiClient.getReviewSessionSummary(workspaceId, session.id),
        apiClient.getReviewSessionCanvas(workspaceId, session.id)
      ]);
      const nextConflictStatus = nextSummary.conflictStatus;
      let nextConflictAnalysis: PrReviewConflictAnalysis | null = null;
      let nextConflictAnalysisStatus: ConflictAnalysisLoadStatus = "ready";
      let nextConflictAnalysisError: string | null = null;

      if (nextConflictStatus === "conflicted") {
        try {
          nextConflictAnalysis = await apiClient.getReviewSessionConflicts(
            workspaceId,
            session.id
          );
        } catch (error) {
          const conflictErrorState = getConflictAnalysisErrorState(error);
          nextConflictAnalysisStatus = conflictErrorState.status;
          nextConflictAnalysisError = conflictErrorState.message;
        }
      }

      setSummary(nextSummary);
      setCanvas(nextCanvas);
      setConflictAnalysis(nextConflictAnalysis);
      setConflictAnalysisStatus(nextConflictAnalysisStatus);
      setConflictAnalysisError(nextConflictAnalysisError);
      setLoadStatus("ready");
      setLoadError(null);
    } catch (error) {
      if (quiet) {
        setLoadError(getErrorMessage(error));
        return;
      }

      setSummary(null);
      setCanvas(null);
      setConflictAnalysis(null);
      setConflictAnalysisStatus("error");
      setConflictAnalysisError(getErrorMessage(error));
      setLoadStatus("error");
      setLoadError(getErrorMessage(error));
    }
  }, [apiClient, session.id, workspaceId]);

  useEffect(() => {
    void loadCanvasData();
  }, [loadCanvasData]);

  useEffect(() => {
    setConflictDrafts({});
    setConflictApplyStatus("idle");
    setConflictApplyError(null);
    setConflictApplyResult(null);
    setConflictApplyRequiresGithubReconnect(false);
    setGithubReconnectStatus("idle");
    setGithubReconnectMessage(null);
  }, [session.id]);

  useEffect(() => {
    if (!conflictAnalysis || conflictAnalysis.reviewSessionId !== session.id) {
      return;
    }

    setConflictDrafts((currentDrafts) =>
      reconcilePrReviewConflictDrafts(conflictAnalysis, currentDrafts)
    );
  }, [conflictAnalysis, session.id]);

  useEffect(() => {
    if (!conflictAnalysis || conflictAnalysis.reviewSessionId !== session.id) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      conflictAnalysis.files.map(async file => ({
        file,
        draft: await apiClient.getReviewFileConflictDraft(
          workspaceId,
          file.reviewFileId
        )
      }))
    )
      .then(entries => {
        if (cancelled) return;
        setConflictDrafts(currentDrafts => {
          const nextDrafts = reconcilePrReviewConflictDrafts(
            conflictAnalysis,
            currentDrafts
          );
          for (const { file, draft } of entries) {
            if (!draft || draft.sourceHeadBlobSha !== file.headBlobSha) continue;
            nextDrafts[file.reviewFileId] = {
              ...applyPrReviewConflictDraftResolutionState(
                nextDrafts[file.reviewFileId],
                draft.resolutionState
              ),
              sourceHeadBlobSha: draft.sourceHeadBlobSha,
              resolvedContent: draft.resolvedContent,
              draftVersion: draft.draftVersion,
              updatedByUserId: draft.updatedByUserId,
              updatedAt: draft.updatedAt
            };
          }
          return nextDrafts;
        });
      })
      .catch(() => {
        // The initial marker draft remains usable when a persisted draft is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, conflictAnalysis, session.id, workspaceId]);

  const handleDecisionSaved = useCallback(
    (
      updatedFile: PrReviewFile,
      previousReviewStatus: PrReviewFileReviewStatus
    ) => {
      setCanvas((currentCanvas) => {
        if (!currentCanvas) {
          return currentCanvas;
        }

        let previousStatus: PrReviewFileReviewStatus | null = null;
        let matchedFile = false;
        const flows = currentCanvas.flows.map((flow) => ({
          ...flow,
          files: flow.files.map((flowFile) => {
            if (flowFile.reviewFileId !== updatedFile.id) {
              return flowFile;
            }

            matchedFile = true;
            if (previousStatus === null) {
              previousStatus = flowFile.currentStatus;
            }

            return {
              ...flowFile,
              currentStatus: updatedFile.currentStatus,
              fileRole: updatedFile.fileRole,
              riskLevel: updatedFile.riskLevel,
              fileNodeData: {
                ...flowFile.fileNodeData,
                reviewStatus: updatedFile.currentStatus,
                roleSummary: updatedFile.fileRole,
                riskLevel: updatedFile.riskLevel
              }
            };
          })
        }));

        const reviewStatusBefore = previousStatus ?? previousReviewStatus;
        if (!matchedFile) {
          return {
            ...currentCanvas,
            reviewedCount: updateReviewedCount(
              currentCanvas.reviewedCount,
              reviewStatusBefore,
              updatedFile.currentStatus
            )
          };
        }

        if (previousStatus === null) {
          return currentCanvas;
        }

        return {
          ...currentCanvas,
          reviewedCount: updateReviewedCount(
            currentCanvas.reviewedCount,
            reviewStatusBefore,
            updatedFile.currentStatus
          ),
          flows
        };
      });

      setSummary((currentSummary) => {
        if (!currentSummary) {
          return currentSummary;
        }

        const reviewedCount = updateReviewedCount(
          currentSummary.reviewedCount,
          previousReviewStatus,
          updatedFile.currentStatus
        );

        return {
          ...currentSummary,
          readyToSubmit: reviewedCount === currentSummary.totalFileCount,
          reviewedCount
        };
      });

      void loadCanvasData({ quiet: true });
    },
    [loadCanvasData]
  );

  const handleRealtimeDecisionUpdated = useCallback(
    (update: PrReviewDecisionUpdatedEvent) => {
      if (update.reviewSessionId !== session.id) {
        return;
      }

      setCanvas(currentCanvas =>
        currentCanvas
          ? applyDecisionUpdateToCanvas(currentCanvas, update)
          : currentCanvas
      );
      setSummary(currentSummary =>
        currentSummary
          ? applyDecisionUpdateToSummary(currentSummary, update)
          : currentSummary
      );
      setLatestDecisionUpdate(update);
    },
    [session.id]
  );

  const handleRealtimeRoomJoined = useCallback(() => {
    void loadCanvasData({ quiet: true });
  }, [loadCanvasData]);

  const handleConflictDraftChange = useCallback(
    (reviewFileId: string, draft: PrReviewConflictDraft) => {
      setConflictDrafts((currentDrafts) => ({
        ...currentDrafts,
        [reviewFileId]: draft
      }));
      setConflictApplyStatus("idle");
      setConflictApplyError(null);
      setConflictApplyResult(null);

      const currentTimer = conflictDraftSaveTimersRef.current[reviewFileId];
      if (currentTimer) {
        window.clearTimeout(currentTimer);
      }
      conflictDraftSaveTimersRef.current[reviewFileId] = window.setTimeout(() => {
        void apiClient
          .updateReviewFileConflictDraft(workspaceId, reviewFileId, {
            sourceHeadBlobSha: draft.sourceHeadBlobSha,
            resolvedContent: draft.resolvedContent,
            resolutionState: toPrReviewConflictDraftResolutionState(draft),
            expectedDraftVersion: draft.draftVersion
          })
          .then(savedDraft => {
            setConflictDrafts(currentDrafts => {
              const currentDraft = currentDrafts[reviewFileId];
              if (!currentDraft || currentDraft.resolvedContent !== draft.resolvedContent) {
                return currentDrafts;
              }
              return {
                ...currentDrafts,
                [reviewFileId]: {
                  ...currentDraft,
                  draftVersion: savedDraft.draftVersion,
                  updatedByUserId: savedDraft.updatedByUserId,
                  updatedAt: savedDraft.updatedAt
                }
              };
            });
          })
          .catch(error => {
            setConflictApplyStatus("error");
            setConflictApplyError(getConflictApplyErrorMessage(error));
          });
      }, 500);
    },
    [apiClient, workspaceId]
  );

  useEffect(() => () => {
    for (const timer of Object.values(conflictDraftSaveTimersRef.current)) {
      if (timer) window.clearTimeout(timer);
    }
  }, []);

  const handleRemoteConflictDraftUpdated = useCallback(
    (remoteDraft: {
      reviewFileId: string;
      sourceHeadBlobSha: string;
      resolvedContent: string;
      resolutionState: PrReviewConflictDraftResolutionState;
      draftVersion: number;
      updatedByUserId: string;
      updatedAt: string;
    }) => {
      setConflictDrafts(currentDrafts => {
        const currentDraft = currentDrafts[remoteDraft.reviewFileId];
        if (
          currentDraft &&
          currentDraft.sourceHeadBlobSha === remoteDraft.sourceHeadBlobSha &&
          currentDraft.draftVersion >= remoteDraft.draftVersion
        ) {
          return currentDrafts;
        }
        const file = conflictAnalysis?.files.find(
          candidate => candidate.reviewFileId === remoteDraft.reviewFileId
        );
        if (!currentDraft && !file) return currentDrafts;
        return {
          ...currentDrafts,
          [remoteDraft.reviewFileId]: {
            ...applyPrReviewConflictDraftResolutionState(
              currentDraft ?? createPrReviewConflictDraft(file!),
              remoteDraft.resolutionState
            ),
            sourceHeadBlobSha: remoteDraft.sourceHeadBlobSha,
            resolvedContent: remoteDraft.resolvedContent,
            draftVersion: remoteDraft.draftVersion,
            updatedByUserId: remoteDraft.updatedByUserId,
            updatedAt: remoteDraft.updatedAt
          }
        };
      });
    },
    [conflictAnalysis]
  );

  const handleRemoteConflictDraftInvalidated = useCallback(() => {
    void loadCanvasData({ quiet: true });
  }, [loadCanvasData]);

  const headBranch =
    canvas?.headBranch ??
    summary?.headBranch ??
    latestPullRequest?.headBranch ??
    session.headSha.slice(0, 7);
  const baseBranch = canvas?.baseBranch ?? summary?.baseBranch ?? latestPullRequest?.baseBranch ?? "-";
  const reviewedCount =
    canvas?.reviewedCount ?? summary?.reviewedCount ?? session.reviewedCount;
  const totalFileCount =
    canvas?.totalFileCount ?? summary?.totalFileCount ?? session.totalFileCount;
  const conflictStatus =
    summary?.conflictStatus ?? canvas?.conflictStatus ?? session.conflictStatus;
  const contentConflictByFileId = useMemo(
    () =>
      new Map(
        (conflictAnalysis?.files ?? []).map((file) => [file.reviewFileId, file])
      ),
    [conflictAnalysis]
  );
  const unsupportedConflictByFileId = useMemo(
    () =>
      new Map(
        (conflictAnalysis?.unsupportedFiles ?? []).map((file) => [
          file.reviewFileId,
          file
        ])
      ),
    [conflictAnalysis]
  );
  const selectedConflictFile = openedReviewFileId
    ? contentConflictByFileId.get(openedReviewFileId) ?? null
    : null;
  const selectedConflictDraft = selectedConflictFile
    ? conflictDrafts[selectedConflictFile.reviewFileId] ??
      createPrReviewConflictDraft(selectedConflictFile)
    : null;
  const selectedUnsupportedConflictFile = openedReviewFileId
    ? unsupportedConflictByFileId.get(openedReviewFileId) ?? null
    : null;
  const conflictDraftProgress = useMemo(
    () => getPrReviewConflictDraftProgress(conflictAnalysis, conflictDrafts),
    [conflictAnalysis, conflictDrafts]
  );
  const preparedConflictFileIdKey = useMemo(
    () =>
      (conflictAnalysis?.files ?? [])
        .filter((file) =>
          isPrReviewConflictDraftReady(
            file,
            conflictDrafts[file.reviewFileId]
          )
        )
        .map((file) => file.reviewFileId)
        .sort()
        .join("\0"),
    [conflictAnalysis, conflictDrafts]
  );
  const preparedConflictFileIds = useMemo(
    () =>
      new Set(
        preparedConflictFileIdKey ? preparedConflictFileIdKey.split("\0") : []
      ),
    [preparedConflictFileIdKey]
  );
  const conflictApplyDisabledReason =
    latestPullRequest?.state === "closed"
      ? "닫힌 PR에는 Conflict 해결안을 적용할 수 없습니다."
      : latestPullRequest?.headSha && latestPullRequest.headSha !== session.headSha
      ? "새 커밋이 감지되어 이전 버전에는 Conflict 해결안을 적용할 수 없습니다."
      : conflictStatus !== "conflicted"
      ? "적용할 Conflict가 없습니다."
      : conflictAnalysisStatus !== "ready" || !conflictAnalysis
        ? "Conflict 분석이 끝난 뒤 적용할 수 있습니다."
        : conflictAnalysis.unsupportedFiles.length > 0
          ? "지원하지 않는 Conflict 파일이 있어 전체 적용할 수 없습니다."
          : conflictDraftProgress.total === 0
            ? "적용할 수 있는 Conflict 파일이 없습니다."
            : !conflictDraftProgress.allReady
              ? `${formatNumber(
                  conflictDraftProgress.total - conflictDraftProgress.ready
                )}개 파일의 해결안을 더 준비해 주세요.`
              : null;
  const reviewSubmitted = (summary?.status ?? session.status) === "submitted";
  const isReviewVersionStale = Boolean(
    latestPullRequest?.headSha && latestPullRequest.headSha !== session.headSha
  );
  const isPullRequestClosed = latestPullRequest?.state === "closed";
  const isReviewReadOnly = isReviewVersionStale || isPullRequestClosed;
  const pullRequestState = latestPullRequest?.state ?? summary?.pullRequestState ?? "open";
  const pullRequestMergedAt =
    summary?.pullRequestMergedAt ?? getPullRequestMergedAt(latestPullRequest);
  const isPullRequestMerged =
    pullRequestState === "closed" && Boolean(pullRequestMergedAt);
  const expectedMergeHeadSha = summary?.headSha ?? session.headSha;
  const mergeDisabledReason = getMergeDisabledReason({
    conflictStatus,
    isPullRequestMerged,
    isPullRequestClosed,
    isReviewVersionStale,
    loadStatus,
    pullRequestState,
    reviewSubmitted
  });
  const progressLabel = `${formatNumber(reviewedCount)} / ${formatNumber(
    totalFileCount
  )}`;

  useEffect(() => {
    if (loadStatus !== "ready" || conflictStatus !== "checking") {
      return;
    }

    let attemptCount = 0;
    let refreshInFlight = false;
    const intervalId = window.setInterval(() => {
      if (refreshInFlight) {
        return;
      }

      if (attemptCount >= CONFLICT_STATUS_POLL_MAX_ATTEMPTS) {
        window.clearInterval(intervalId);
        return;
      }

      attemptCount += 1;
      refreshInFlight = true;
      void loadCanvasData({ quiet: true }).finally(() => {
        refreshInFlight = false;
      });
    }, CONFLICT_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [conflictStatus, loadCanvasData, loadStatus]);

  async function createNewReviewSession() {
    const result = await apiClient.createReviewRoomRevision(
      workspaceId,
      session.reviewRoomId
    );

    setIsSubmitReviewModalOpen(false);
    setOpenedReviewFileId(null);
    onReviewSessionCreated(result.revision);
  }

  async function startLatestReviewVersion() {
    if (revisionStartStatus === "starting") {
      return;
    }

    setRevisionStartStatus("starting");
    setRevisionStartError(null);

    try {
      const result = await apiClient.createReviewRoomRevision(
        workspaceId,
        session.reviewRoomId
      );
      setOpenedReviewFileId(null);
      onReviewSessionCreated(result.revision);
    } catch (error) {
      setRevisionStartStatus("error");
      setRevisionStartError(getErrorMessage(error));
    }
  }

  function startPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailPanelWidth;

    function handlePointerMove(nextEvent: PointerEvent) {
      setDetailPanelWidth(
        clamp(
          startWidth + startX - nextEvent.clientX,
          DETAIL_PANEL_MIN_WIDTH,
          DETAIL_PANEL_MAX_WIDTH
        )
      );
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  async function handleMergeReviewSession() {
    if (isReviewReadOnly) {
      return;
    }
    setMergeStatus("merging");
    setMergeError(null);

    try {
      const result = await apiClient.mergeReviewSession(workspaceId, session.id, {
        confirm: true,
        expectedHeadSha: expectedMergeHeadSha
      });

      setSummary((currentSummary) =>
        currentSummary
          ? {
              ...currentSummary,
              pullRequestMergeable: false,
              pullRequestMergedAt: result.mergedAt,
              pullRequestState: result.pullRequestState
            }
          : currentSummary
      );
      setMergeStatus("merged");
      setIsMergeConfirmOpen(false);
      void loadCanvasData({ quiet: true });
    } catch (error) {
      setMergeStatus("error");
      setMergeError(getMergeErrorMessage(error));
      void loadCanvasData({ quiet: true });
    }
  }

  async function handleApplyConflictResolutions() {
    if (
      isReviewReadOnly ||
      !conflictAnalysis ||
      conflictApplyStatus === "applying"
    ) {
      return;
    }

    const input = buildPrReviewConflictsApplyInput(
      conflictAnalysis,
      conflictDrafts
    );
    if (!input) {
      setConflictApplyStatus("error");
      setConflictApplyError(
        conflictApplyDisabledReason ??
          "모든 Conflict 파일의 해결안을 준비해 주세요."
      );
      return;
    }

    setConflictApplyStatus("applying");
    setConflictApplyError(null);
    setConflictApplyRequiresGithubReconnect(false);

    try {
      const result = await apiClient.applyReviewSessionConflictResolutions(
        workspaceId,
        session.id,
        input
      );
      setConflictApplyResult(result);
      setConflictApplyStatus("applied");
      setGithubReconnectStatus("idle");
      setGithubReconnectMessage(null);
      setConflictDrafts({});

      if (result.localStateStatus === "updated") {
        await loadCanvasData({ quiet: true });
      }
    } catch (error) {
      setConflictApplyStatus("error");
      setConflictApplyError(getConflictApplyErrorMessage(error));
      setConflictApplyRequiresGithubReconnect(
        isGithubOAuthReconnectError(error)
      );
    }
  }

  function openConflictApplyConfirm() {
    setConflictApplyError(null);
    setConflictApplyResult(null);
    setConflictApplyStatus("idle");
    setConflictApplyRequiresGithubReconnect(false);
    setGithubReconnectStatus("idle");
    setGithubReconnectMessage(null);
    setIsConflictApplyConfirmOpen(true);
  }

  async function handleReconnectGithubOAuth() {
    const reconnectWindow = window.open(
      "about:blank",
      "pilo-github-oauth-reconnect",
      "popup=yes,width=760,height=820"
    );

    if (!reconnectWindow) {
      setGithubReconnectStatus("error");
      setGithubReconnectMessage(
        "새 창을 열 수 없습니다. 브라우저의 팝업 차단을 해제해 주세요."
      );
      return;
    }

    reconnectWindow.opener = null;
    setGithubReconnectStatus("opening");
    setGithubReconnectMessage(null);

    try {
      const result = await apiClient.startGithubOAuth("/github");
      reconnectWindow.location.replace(result.authorizeUrl);
      setGithubReconnectStatus("opened");
      setGithubReconnectMessage(
        "새 창에서 GitHub 재연결을 마친 뒤 이 모달에서 다시 적용해 주세요."
      );
    } catch (error) {
      reconnectWindow.close();
      setGithubReconnectStatus("error");
      setGithubReconnectMessage(getErrorMessage(error));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button onClick={onBackToSelection} type="button" variant="outline">
            <ArrowLeft className="size-4" />
            {backLabel}
          </Button>
          <PrReviewRoomDeleteButton
            apiClient={apiClient}
            onDeleted={onReviewRoomDeleted}
            reviewRoomId={session.reviewRoomId}
            workspaceId={workspaceId}
          />
          <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium">
            <GitBranch className="size-4 shrink-0 text-slate-500" />
            <span className="max-w-44 truncate">{headBranch}</span>
            <span className="text-slate-400">→</span>
            <span className="max-w-32 truncate">{baseBranch}</span>
          </div>
        </div>
        <div className="hidden h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm md:flex">
          <GitPullRequest className="size-4 text-blue-600" />
          <span>리뷰 진행률</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium",
              getConflictClassName(conflictStatus)
            )}
          >
            {getConflictLabel(conflictStatus)}
            {conflictStatus === "conflicted" ? (
              <span className="border-l border-current/20 pl-2 text-xs font-semibold">
                해결&nbsp;
                <strong>
                  {formatNumber(conflictDraftProgress.ready)} /{" "}
                  {formatNumber(conflictDraftProgress.total)}
                </strong>
              </span>
            ) : null}
          </span>
          <Button
            disabled={
              loadStatus !== "ready" || reviewSubmitted || isReviewReadOnly
            }
            onClick={() => setIsSubmitReviewModalOpen(true)}
            type="button"
          >
            <Send className="size-4" />
            {reviewSubmitted ? "제출 완료" : "Review 제출"}
          </Button>
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <Button
                disabled={
                  Boolean(mergeDisabledReason) || mergeStatus === "merging"
                }
                onClick={() => {
                  setMergeError(null);
                  setIsMergeConfirmOpen(true);
                }}
                type="button"
                variant="outline"
              >
                {mergeStatus === "merging" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GitMerge className="size-4" />
                )}
                {isPullRequestMerged || mergeStatus === "merged"
                  ? "Merged"
                  : mergeStatus === "merging"
                    ? "Merging"
                    : "Merge"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {mergeDisabledReason ??
                "Merge this PR through the GitHub merge API."}
            </TooltipContent>
          </Tooltip>
          {mergeError ? (
            <span className="max-w-64 truncate text-xs font-medium text-rose-600">
              {mergeError}
            </span>
          ) : mergeStatus === "merged" || isPullRequestMerged ? (
            <span className="text-xs font-medium text-emerald-700">
              Merge complete
            </span>
          ) : null}
        </div>
      </header>

      {isPullRequestClosed ? (
        <section className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3 text-slate-900">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-slate-600" />
            <div>
              <p className="text-sm font-semibold">
                {isPullRequestMerged ? "PR이 병합되었습니다" : "PR이 닫혔습니다"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-700">
                이 리뷰 공간은 참고용 읽기 전용입니다. 파일 판단, Conflict 적용, Review 제출과 Merge를 할 수 없습니다.
              </p>
            </div>
          </div>
        </section>
      ) : isReviewVersionStale ? (
        <section className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3 text-amber-950">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold">새 커밋이 감지되었습니다</p>
              <p className="mt-1 text-xs leading-5 text-amber-900">
                현재 리뷰 버전은 읽기 전용입니다. 최신 버전 분석을 시작하면 새 리뷰 버전으로 이동합니다.
              </p>
              <p className="mt-1 font-mono text-xs text-amber-800">
                {session.headSha.slice(0, 7)} -&gt; {latestPullRequest?.headSha?.slice(0, 7)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button
              disabled={revisionStartStatus === "starting"}
              onClick={() => void startLatestReviewVersion()}
              type="button"
            >
              {revisionStartStatus === "starting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              최신 버전 분석 시작
            </Button>
            {revisionStartError ? (
              <span className="max-w-80 text-right text-xs font-medium text-rose-700">
                {revisionStartError}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden">
          {loadStatus === "loading" || loadStatus === "idle" ? (
            <CanvasLoadingState />
          ) : loadStatus === "error" ? (
            <CanvasErrorState
              message={loadError}
              onRetry={() => void loadCanvasData()}
            />
          ) : conflictStatus === "conflicted" &&
            (conflictAnalysisStatus === "error" ||
              conflictAnalysisStatus === "stale") ? (
            <ConflictAnalysisFailureState
              backLabel={backLabel}
              message={conflictAnalysisError}
              onBack={onBackToSelection}
              onRetry={() => void loadCanvasData()}
              stale={conflictAnalysisStatus === "stale"}
            />
          ) : canvas && canvas.flows.length > 0 ? (
            <>
              <ConflictAnalysisNotice
                analysis={conflictAnalysis}
                conflictStatus={conflictStatus}
                status={conflictAnalysisStatus}
              />
              <PrReviewCanvasSurface
                activeFollowSurface={activeFollowSurface}
                apiClient={apiClient}
                canvas={canvas}
                className="h-full w-full"
                conflictAnalysis={conflictAnalysis}
                onDecisionUpdated={handleRealtimeDecisionUpdated}
                onFileOpen={handleOpenedReviewFileChange}
                onFollowSurfaceChange={setActiveFollowSurface}
                onOpenedReviewFileChange={handleOpenedReviewFileChange}
                onRealtimeRoomJoined={handleRealtimeRoomJoined}
                onRealtimeRoomDeleted={onReviewRoomDeleted}
                openedReviewFileId={openedReviewFileId}
                preparedConflictFileIds={preparedConflictFileIds}
                readOnly={isReviewReadOnly}
                realtimeIdentity={realtimeIdentity}
                reviewRoomId={session.reviewRoomId}
                workspaceId={workspaceId}
              />
            </>
          ) : (
            <CanvasEmptyState />
          )}
          {openedReviewFileId &&
          !(
            conflictStatus === "conflicted" &&
            (conflictAnalysisStatus === "error" ||
              conflictAnalysisStatus === "stale")
          ) ? (
            <PrReviewFileDiffDrawer
              apiClient={apiClient}
              baseBranch={summary?.baseBranch ?? latestPullRequest?.baseBranch ?? null}
              conflictAnalysisErrorMessage={conflictAnalysisError}
              conflictAnalysisStatus={conflictAnalysisStatus}
              conflictApplyDisabledReason={conflictApplyDisabledReason}
              conflictApplyProgress={conflictDraftProgress}
              conflictDraft={selectedConflictDraft}
              conflictFile={selectedConflictFile}
              headBranch={summary?.headBranch ?? latestPullRequest?.headBranch ?? null}
              isReviewRoomCompleted={isPullRequestClosed}
              isReviewVersionStale={isReviewVersionStale}
              isReviewSessionConflicted={conflictStatus === "conflicted"}
              onClose={() => handleOpenedReviewFileChange(null)}
              onOpenConflictApply={openConflictApplyConfirm}
              onConflictDraftChange={handleConflictDraftChange}
              onRemoteConflictDraftUpdated={handleRemoteConflictDraftUpdated}
              onRemoteConflictDraftInvalidated={handleRemoteConflictDraftInvalidated}
              onDecisionSaved={handleDecisionSaved}
              onFollowSurfaceInteraction={handleFollowSurfaceInteraction}
              remoteDecisionUpdate={latestDecisionUpdate}
              realtimeIdentity={realtimeIdentity}
              reviewFileId={openedReviewFileId}
              reviewRoomId={session.reviewRoomId}
              reviewSessionId={session.id}
              unsupportedConflictFile={selectedUnsupportedConflictFile}
              workspaceId={workspaceId}
            />
          ) : null}
        </section>

        <button
          aria-label="PR 설명 패널 크기 조절"
          className="z-10 hidden w-2 cursor-col-resize items-center justify-center border-x border-slate-200 bg-white hover:bg-slate-100 md:flex"
          onPointerDown={startPanelResize}
          type="button"
        >
          <span className="h-12 w-0.5 rounded-full bg-slate-300" />
        </button>

        <aside
          className="hidden min-h-0 shrink-0 overflow-y-auto border-l border-slate-200 bg-white md:block"
          style={{ width: detailPanelWidth }}
        >
          <ReviewDetailPanel
            pullRequest={latestPullRequest}
            session={session}
            summary={summary}
          />
        </aside>
      </main>

      {isSubmitReviewModalOpen ? (
        <PrReviewSubmitReviewModal
          apiClient={apiClient}
          onClose={() => setIsSubmitReviewModalOpen(false)}
          onCreateNewReview={createNewReviewSession}
          onGoToGithub={onGoToGithub}
          onSubmitted={() => {
            void loadCanvasData({ quiet: true });
          }}
          pullRequest={latestPullRequest}
          session={session}
          workspaceId={workspaceId}
        />
      ) : null}

      <AlertDialog
        open={isConflictApplyConfirmOpen}
        onOpenChange={(open) => {
          if (conflictApplyStatus !== "applying") {
            setIsConflictApplyConfirmOpen(open);
          }
        }}
      >
        <AlertDialogContent
          className="z-[90]"
          overlayClassName="z-[90]"
          size="default"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-amber-50 text-amber-700">
              <GitMerge className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>Conflict 해결안 적용</AlertDialogTitle>
            <AlertDialogDescription>
              준비한 모든 파일을 PR head와 base를 부모로 갖는 merge commit
              하나로 적용합니다. 일부 파일만 적용되지는 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {conflictApplyResult ? (
            <div
              className={cn(
                "rounded-lg border px-4 py-3",
                conflictApplyResult.localStateStatus === "updated"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4" />
                {formatNumber(conflictApplyResult.files.length)}개 파일 적용 완료
              </p>
              <p className="mt-2 text-xs leading-5">
                {conflictApplyResult.localStateStatus === "updated"
                  ? "GitHub의 최신 Conflict 상태와 Merge 가능 여부를 다시 불러왔습니다."
                  : "GitHub에는 적용됐지만 PILO 상태 갱신이 필요합니다. GitHub 동기화 후 새 리뷰를 시작해 주세요."}
              </p>
              <p className="mt-2 font-mono text-xs">
                {conflictApplyResult.headShaBefore.slice(0, 7)} →{" "}
                {conflictApplyResult.headShaAfter.slice(0, 7)}
              </p>
              {conflictApplyResult.commitUrl ? (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
                  href={conflictApplyResult.commitUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  GitHub 커밋 보기
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {(conflictAnalysis?.files ?? []).map((file) => (
                <div
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700"
                  key={file.reviewFileId}
                >
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 truncate font-medium">
                    {file.filePath}
                  </span>
                </div>
              ))}
            </div>
          )}

          {conflictApplyError ? (
            <div
              aria-live="polite"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              <p className="font-semibold">적용 실패</p>
              <p className="mt-1">{conflictApplyError}</p>
            </div>
          ) : null}

          {conflictApplyRequiresGithubReconnect ? (
            <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
              <p className="text-sm leading-6 text-blue-900">
                새 창에서 GitHub 사용자 연결만 갱신합니다. 이 탭의 모든 해결 초안은 그대로 유지됩니다.
              </p>
              <Button
                disabled={githubReconnectStatus === "opening"}
                onClick={() => void handleReconnectGithubOAuth()}
                type="button"
                variant="outline"
              >
                {githubReconnectStatus === "opening" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
                {githubReconnectStatus === "opening"
                  ? "재연결 준비 중"
                  : "GitHub 재연결"}
              </Button>
              {githubReconnectMessage ? (
                <p
                  className={cn(
                    "text-xs leading-5",
                    githubReconnectStatus === "error"
                      ? "text-rose-700"
                      : "text-blue-800"
                  )}
                >
                  {githubReconnectMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            {conflictApplyResult ? (
              <AlertDialogAction
                onClick={() => setIsConflictApplyConfirmOpen(false)}
              >
                닫기
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel
                  disabled={conflictApplyStatus === "applying"}
                >
                  취소
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={
                    conflictApplyStatus === "applying" ||
                    Boolean(conflictApplyDisabledReason)
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    void handleApplyConflictResolutions();
                  }}
                >
                  {conflictApplyStatus === "applying" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <GitMerge className="size-4" />
                  )}
                  {conflictApplyStatus === "applying"
                    ? "해결안 적용 중"
                    : conflictApplyRequiresGithubReconnect
                      ? "Conflict 해결안 다시 적용"
                      : "Conflict 해결안 적용"}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isMergeConfirmOpen}
        onOpenChange={(open) => {
          if (mergeStatus !== "merging") {
            setIsMergeConfirmOpen(open);
          }
        }}
      >
        <AlertDialogContent
          className="z-[90]"
          overlayClassName="z-[90]"
          size="default"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-blue-50 text-blue-700">
              <GitMerge className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>Merge pull request?</AlertDialogTitle>
            <AlertDialogDescription>
              GitHub Review submitted PR will be merged with a merge commit.
              Branch protection and required checks are enforced by GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mergeError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {mergeError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeStatus === "merging"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mergeStatus === "merging" || isReviewReadOnly}
              onClick={(event) => {
                event.preventDefault();
                void handleMergeReviewSession();
              }}
            >
              {mergeStatus === "merging" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GitMerge className="size-4" />
              )}
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConflictAnalysisNotice({
  analysis,
  conflictStatus,
  status
}: {
  analysis: PrReviewConflictAnalysis | null;
  conflictStatus: PrReviewConflictStatus;
  status: ConflictAnalysisLoadStatus;
}) {
  if (conflictStatus !== "conflicted") {
    return null;
  }

  const supportedCount = analysis?.files.length ?? 0;
  const unsupportedCount = analysis?.unsupportedFiles.length ?? 0;
  const totalConflictFileCount = supportedCount + unsupportedCount;
  let title: string | null = null;
  let description: string | null = null;
  let className = "border-blue-200 bg-blue-50 text-blue-900";

  if (status === "idle" || status === "loading") {
    title = "Conflict 파일 확인 중";
    description = "파일별 충돌 정보를 불러오고 있습니다.";
  } else if (totalConflictFileCount === 0) {
    title = "파일 단위 Conflict 정보가 없습니다";
    description = "GitHub PR은 conflict 상태지만 표시할 hunk가 없습니다.";
    className = "border-slate-200 bg-white text-slate-700";
  } else if (unsupportedCount > 0) {
    title = `${formatNumber(unsupportedCount)}개 Conflict 파일은 아직 지원하지 않습니다`;
    description =
      supportedCount > 0
        ? `${formatNumber(supportedCount)}개 파일은 Conflict 해결 모드로 확인할 수 있습니다.`
        : "초기 버전에서는 content Conflict만 해결 모드로 확인할 수 있습니다.";
    className = "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (!title) {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute left-4 top-4 z-10 max-w-md rounded-lg border px-4 py-3 shadow-sm",
        className
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <AlertCircle className="size-4 shrink-0" />
        {title}
      </p>
      {description ? (
        <p className="mt-1 text-sm leading-5 opacity-85">{description}</p>
      ) : null}
    </div>
  );
}

function ConflictAnalysisFailureState({
  backLabel,
  message,
  onBack,
  onRetry,
  stale
}: {
  backLabel: string;
  message: string | null;
  onBack: () => void;
  onRetry: () => void;
  stale: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white px-5 py-5 text-center shadow-sm">
        <AlertCircle className="mx-auto size-8 text-amber-600" />
        <h3 className="mt-3 text-base font-semibold text-slate-950">
          {stale
            ? "Conflict 정보가 오래되었습니다"
            : "Conflict 정보를 불러오지 못했습니다"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {message ?? "잠시 후 다시 시도해 주세요."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {stale ? (
            <Button onClick={onBack} type="button" variant="outline">
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>
          ) : (
            <Button onClick={onRetry} type="button" variant="outline">
              <RefreshCcw className="size-4" />
              Conflict 정보 다시 불러오기
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasLoadingState() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        <Loader2 className="size-4 animate-spin text-blue-600" />
        Workflow graph 불러오는 중
      </div>
    </div>
  );
}

function CanvasErrorState({
  message,
  onRetry
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-8">
      <div className="max-w-md rounded-lg border border-rose-200 bg-white px-5 py-4 text-center shadow-sm">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <AlertCircle className="size-5" />
        </div>
        <h1 className="text-base font-semibold">리뷰 캔버스를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {message ?? "잠시 후 다시 시도해 주세요."}
        </p>
        <Button className="mt-4" onClick={onRetry} type="button" variant="outline">
          <RefreshCcw className="size-4" />
          다시 시도
        </Button>
      </div>
    </div>
  );
}

function CanvasEmptyState() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-8">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white px-5 py-4 text-center shadow-sm">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <GitPullRequest className="size-5" />
        </div>
        <h1 className="text-base font-semibold">표시할 workflow가 없습니다</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          분석 결과에 flow와 file node가 생성되면 이 영역에 표시됩니다.
        </p>
      </div>
    </div>
  );
}

function ReviewDetailPanel({
  pullRequest,
  session,
  summary
}: {
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  session: PrReviewSession;
  summary: PrReviewSummary | null;
}) {
  const displayTitle = summary
    ? `#${summary.githubNumber} ${summary.title}`
    : pullRequest
      ? `#${pullRequest.githubNumber} ${pullRequest.title}`
      : "PR 정보";
  const headBranch =
    summary?.headBranch ?? pullRequest?.headBranch ?? session.headSha.slice(0, 7);
  const baseBranch = summary?.baseBranch ?? pullRequest?.baseBranch ?? "-";
  const changedFilesCount =
    summary?.changedFilesCount ??
    pullRequest?.changedFilesCount ??
    session.totalFileCount;
  const additions = summary?.additions ?? pullRequest?.additions ?? null;
  const deletions = summary?.deletions ?? pullRequest?.deletions ?? null;
  const commitsCount = summary?.commitsCount ?? pullRequest?.commitsCount ?? null;
  const githubUrl = summary?.githubUrl ?? pullRequest?.githubUrl ?? null;
  const prPurpose = summary?.prPurpose ?? session.prPurpose;
  const changeSummary = summary?.changeSummary ?? session.changeSummary;
  const recommendedReviewOrder =
    summary?.recommendedReviewOrder ?? session.recommendedReviewOrder;
  const cautionPoints = summary?.cautionPoints ?? session.cautionPoints;
  const reviewedCount = summary?.reviewedCount ?? session.reviewedCount;
  const totalFileCount = summary?.totalFileCount ?? session.totalFileCount;
  const conflictStatus = summary?.conflictStatus ?? session.conflictStatus;
  const createdAt = summary?.githubCreatedAt ?? session.createdAt;
  const status = summary?.status ?? session.status;

  return (
    <div className="space-y-6 p-5">
      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">PR</p>
        <h2 className="mt-2 text-xl font-semibold leading-7">{displayTitle}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
            <GitBranch className="size-3.5" />
            {headBranch} → {baseBranch}
          </span>
          <span>{formatNumber(changedFilesCount)} files</span>
          {additions !== null ? (
            <span className="text-emerald-600">+{formatNumber(additions)}</span>
          ) : null}
          {deletions !== null ? (
            <span className="text-rose-500">-{formatNumber(deletions)}</span>
          ) : null}
          {commitsCount !== null ? (
            <span>{formatNumber(commitsCount)} commits</span>
          ) : null}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">PR 의도</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {prPurpose ?? "PR 의도 분석 결과가 아직 없습니다."}
        </p>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">AI 분석</p>
        {changeSummary.length ? (
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {changeSummary.map((item, index) => (
              <li className="flex gap-2" key={`${item}-${index}`}>
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-blue-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-500">
            변경 요약 분석 결과가 아직 없습니다.
          </p>
        )}
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">
          리뷰 순서
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {recommendedReviewOrder ?? "추천 리뷰 순서 분석 결과가 아직 없습니다."}
        </p>
      </section>

      {cautionPoints.length ? (
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            주의사항
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {cautionPoints.map((item, index) => (
              <li className="flex gap-2" key={`${item}-${index}`}>
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Separator />

      <section className="grid grid-cols-2 gap-2">
        <Metric label="리뷰 진행률" value={`${reviewedCount}/${totalFileCount}`} />
        <Metric label="상태" value={status} />
        <Metric label="Conflict" value={getConflictLabel(conflictStatus)} />
        <Metric label="생성일" value={formatDateTime(createdAt)} />
      </section>

      {githubUrl ? (
        <a
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline"
          href={githubUrl}
          rel="noreferrer"
          target="_blank"
        >
          <FileText className="size-4" />
          GitHub에서 PR 보기
        </a>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
        {value}
      </p>
    </div>
  );
}
