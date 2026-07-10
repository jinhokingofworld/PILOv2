"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertCircle,
  ArrowLeft,
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
import { PrReviewFileDiffDrawer } from "@/features/pr-review/components/review-canvas/PrReviewFileDiffDrawer";
import { PrReviewSubmitReviewModal } from "@/features/pr-review/components/review-canvas/PrReviewSubmitReviewModal";
import type {
  PrReviewCanvas,
  PrReviewConflictAnalysis,
  PrReviewConflictFile,
  PrReviewConflictStatus,
  PrReviewFile,
  PrReviewFileReviewStatus,
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewSession,
  PrReviewSummary,
  PrReviewUnsupportedConflictFile
} from "@/features/pr-review/types";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type PrReviewCanvasShellProps = {
  apiClient: PrReviewApiClient;
  onBackToSelection: () => void;
  onGoToGithub: () => void;
  onReviewSessionCreated: (session: PrReviewSession) => void;
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
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
type LoadCanvasDataOptions = {
  quiet?: boolean;
};

const DETAIL_PANEL_MIN_WIDTH = 360;
const DETAIL_PANEL_MAX_WIDTH = 620;
const DETAIL_PANEL_DEFAULT_WIDTH = 440;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "리뷰 캔버스를 불러오지 못했습니다.";
}

function getConflictAnalysisErrorState(error: unknown): {
  message: string;
  status: Exclude<ConflictAnalysisLoadStatus, "idle" | "loading" | "ready">;
} {
  const message =
    error instanceof Error
      ? error.message
      : "Conflict 정보를 불러오지 못했습니다.";

  if (error instanceof PrReviewApiError && error.status === 409) {
    return {
      message,
      status: "stale"
    };
  }

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

function getMergeDisabledReason(input: {
  conflictStatus: PrReviewConflictStatus;
  isPullRequestMerged: boolean;
  loadStatus: CanvasLoadStatus;
  pullRequestState: "open" | "closed";
  reviewSubmitted: boolean;
}): string | null {
  if (input.loadStatus !== "ready") {
    return "Review data is still loading";
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
  onBackToSelection,
  onGoToGithub,
  onReviewSessionCreated,
  pullRequest,
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
  const [selectedReviewFileId, setSelectedReviewFileId] = useState<
    string | null
  >(null);
  const [isSubmitReviewModalOpen, setIsSubmitReviewModalOpen] = useState(false);
  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus>("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);

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
      const nextConflictStatus =
        nextCanvas.conflictStatus ?? nextSummary.conflictStatus;
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

  const handleConflictApplied = useCallback(() => {
    void loadCanvasData({ quiet: true });
  }, [loadCanvasData]);

  const headBranch =
    canvas?.headBranch ??
    summary?.headBranch ??
    pullRequest?.headBranch ??
    session.headSha.slice(0, 7);
  const baseBranch = canvas?.baseBranch ?? summary?.baseBranch ?? pullRequest?.baseBranch ?? "-";
  const reviewedCount =
    canvas?.reviewedCount ?? summary?.reviewedCount ?? session.reviewedCount;
  const totalFileCount =
    canvas?.totalFileCount ?? summary?.totalFileCount ?? session.totalFileCount;
  const conflictStatus =
    canvas?.conflictStatus ?? summary?.conflictStatus ?? session.conflictStatus;
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
  const selectedConflictFile = selectedReviewFileId
    ? contentConflictByFileId.get(selectedReviewFileId) ?? null
    : null;
  const selectedUnsupportedConflictFile = selectedReviewFileId
    ? unsupportedConflictByFileId.get(selectedReviewFileId) ?? null
    : null;
  const reviewSubmitted = (summary?.status ?? session.status) === "submitted";
  const pullRequestState = summary?.pullRequestState ?? pullRequest?.state ?? "open";
  const pullRequestMergedAt =
    summary?.pullRequestMergedAt ?? getPullRequestMergedAt(pullRequest);
  const isPullRequestMerged =
    pullRequestState === "closed" && Boolean(pullRequestMergedAt);
  const expectedMergeHeadSha = summary?.headSha ?? session.headSha;
  const mergeDisabledReason = getMergeDisabledReason({
    conflictStatus,
    isPullRequestMerged,
    loadStatus,
    pullRequestState,
    reviewSubmitted
  });
  const progressLabel = `${formatNumber(reviewedCount)} / ${formatNumber(
    totalFileCount
  )}`;

  async function createNewReviewSession() {
    const pullRequestId = summary?.pullRequestId ?? session.pullRequestId;
    const nextSession = await apiClient.createReviewSession(
      workspaceId,
      pullRequestId
    );

    setIsSubmitReviewModalOpen(false);
    setSelectedReviewFileId(null);
    onReviewSessionCreated(nextSession);
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
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4">
        <Button onClick={onBackToSelection} type="button" variant="outline">
          <ArrowLeft className="size-4" />
          PR 선택으로 돌아가기
        </Button>
        <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium">
          <GitBranch className="size-4 shrink-0 text-slate-500" />
          <span className="max-w-44 truncate">{headBranch}</span>
          <span className="text-slate-400">→</span>
          <span className="max-w-32 truncate">{baseBranch}</span>
        </div>
        <div className="hidden h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm md:flex">
          <GitPullRequest className="size-4 text-blue-600" />
          <span>리뷰 진행률</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 items-center rounded-full border px-3 text-sm font-medium",
              getConflictClassName(conflictStatus)
            )}
          >
            {getConflictLabel(conflictStatus)}
          </span>
          <Button
            disabled={loadStatus !== "ready" || reviewSubmitted}
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

      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden">
          {loadStatus === "loading" || loadStatus === "idle" ? (
            <CanvasLoadingState />
          ) : loadStatus === "error" ? (
            <CanvasErrorState
              message={loadError}
              onRetry={() => void loadCanvasData()}
            />
          ) : canvas && canvas.flows.length > 0 ? (
            <>
              <ConflictAnalysisNotice
                analysis={conflictAnalysis}
                conflictStatus={conflictStatus}
                errorMessage={conflictAnalysisError}
                status={conflictAnalysisStatus}
              />
              <PrReviewCanvasSurface
                canvas={canvas}
                className="h-full w-full"
                conflictAnalysis={conflictAnalysis}
                onFileSelect={setSelectedReviewFileId}
                selectedReviewFileId={selectedReviewFileId}
              />
            </>
          ) : (
            <CanvasEmptyState />
          )}
          {selectedReviewFileId ? (
            <PrReviewFileDiffDrawer
              apiClient={apiClient}
              conflictAnalysisErrorMessage={conflictAnalysisError}
              conflictAnalysisStatus={conflictAnalysisStatus}
              conflictFile={selectedConflictFile}
              isReviewSessionConflicted={conflictStatus === "conflicted"}
              onClose={() => setSelectedReviewFileId(null)}
              onConflictApplied={handleConflictApplied}
              onDecisionSaved={handleDecisionSaved}
              reviewFileId={selectedReviewFileId}
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
            pullRequest={pullRequest}
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
          pullRequest={pullRequest}
          session={session}
          workspaceId={workspaceId}
        />
      ) : null}

      <AlertDialog
        open={isMergeConfirmOpen}
        onOpenChange={(open) => {
          if (mergeStatus !== "merging") {
            setIsMergeConfirmOpen(open);
          }
        }}
      >
        <AlertDialogContent size="default">
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
              disabled={mergeStatus === "merging"}
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
  errorMessage,
  status
}: {
  analysis: PrReviewConflictAnalysis | null;
  conflictStatus: PrReviewConflictStatus;
  errorMessage: string | null;
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
  } else if (status === "stale") {
    title = "Conflict 정보가 오래되었습니다";
    description =
      errorMessage ?? "PR head가 변경되어 새 review session이 필요합니다.";
    className = "border-rose-200 bg-rose-50 text-rose-900";
  } else if (status === "error") {
    title = "Conflict 정보를 불러오지 못했습니다";
    description = errorMessage ?? "잠시 후 다시 시도해 주세요.";
    className = "border-amber-200 bg-amber-50 text-amber-950";
  } else if (totalConflictFileCount === 0) {
    title = "파일 단위 Conflict 정보가 없습니다";
    description = "GitHub PR은 conflict 상태지만 표시할 hunk가 없습니다.";
    className = "border-slate-200 bg-white text-slate-700";
  } else if (unsupportedCount > 0) {
    title = `${formatNumber(unsupportedCount)}개 Conflict 파일은 아직 지원하지 않습니다`;
    description =
      supportedCount > 0
        ? `${formatNumber(supportedCount)}개 파일은 Conflict Resolution mode로 확인할 수 있습니다.`
        : "초기 버전에서는 content conflict만 Resolution mode로 확인할 수 있습니다.";
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
