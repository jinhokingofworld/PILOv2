"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  HelpCircle,
  Loader2,
  MessageSquareWarning,
  RefreshCcw,
  Sparkles
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { createPrReviewApiClient } from "@/features/pr-review/api/client";
import { PrReviewResolvedCodeEditor } from "./PrReviewResolvedCodeEditor";
import {
  buildConflictResolutionDraft,
  isConflictResolutionComplete,
  type PrReviewConflictResolutionChoice
} from "./pr-review-conflict-resolution";
import type {
  PrReviewDiffRow,
  PrReviewConflictApplyResult,
  PrReviewConflictFile,
  PrReviewConflictHunk,
  PrReviewConflictSuggestion,
  PrReviewFile,
  PrReviewFileDecisionStatus,
  PrReviewFileDiff,
  PrReviewFileFlowMembership,
  PrReviewFileRiskLevel,
  PrReviewFileReviewStatus,
  PrReviewUnsupportedConflictFile
} from "@/features/pr-review/types";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type FileReviewStatus = "idle" | "loading" | "ready" | "error";
type ConflictAnalysisLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "stale";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type ConflictSuggestionLoadStatus = "idle" | "loading" | "ready" | "error";
type ConflictApplyStatus = "idle" | "applying" | "applied" | "error";
type ConflictWorkspaceView = "conflict" | "resolved";

type PrReviewFileDiffDrawerProps = {
  apiClient: PrReviewApiClient;
  baseBranch: string | null;
  conflictAnalysisErrorMessage: string | null;
  conflictAnalysisStatus: ConflictAnalysisLoadStatus;
  conflictFile: PrReviewConflictFile | null;
  conflictHeadSha: string | null;
  headBranch: string | null;
  isReviewSessionConflicted: boolean;
  onClose: () => void;
  onConflictApplied: (result: PrReviewConflictApplyResult) => void | Promise<void>;
  onDecisionSaved: (
    file: PrReviewFile,
    previousStatus: PrReviewFileReviewStatus
  ) => void;
  reviewFileId: string;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
  workspaceId: string;
};

const decisionOptions: Array<{
  status: PrReviewFileDecisionStatus;
  label: string;
  description: string;
  icon: typeof CheckCircle2;
}> = [
  {
    status: "approved",
    label: "문제 없음",
    description: "이 파일 변경은 바로 통과해도 됩니다.",
    icon: CheckCircle2
  },
  {
    status: "discussion_needed",
    label: "논의 필요",
    description: "확인하거나 수정해야 할 지점이 있습니다.",
    icon: MessageSquareWarning
  },
  {
    status: "unknown",
    label: "판단 불가",
    description: "지금은 판단을 보류합니다.",
    icon: HelpCircle
  }
];

const decisionLabelByStatus = Object.fromEntries(
  decisionOptions.map((option) => [option.status, option.label])
) as Record<PrReviewFileDecisionStatus, string>;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "파일 리뷰 정보를 불러오지 못했습니다.";
}

function getConflictApplyErrorMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (
    message.includes("Single supported content conflict file is required") ||
    message.includes("multiple conflicted files")
  ) {
    return "현재는 지원 가능한 Conflict 파일이 1개인 PR만 적용할 수 있습니다.";
  }

  if (
    message.includes("Review session head SHA is stale") ||
    message.includes("GitHub pull request head SHA is stale") ||
    message.includes("Review session base SHA is stale") ||
    message.includes("GitHub pull request base SHA is stale") ||
    message.includes("Review file blob SHA is stale") ||
    message.includes("pull request conflict no longer exists")
  ) {
    return "PR 브랜치가 변경되었습니다. 동기화 후 새 리뷰를 시작해 주세요.";
  }

  if (
    message.includes("repository file lookup is temporarily unavailable") ||
    message.includes("repository file content lookup failed") ||
    message.includes("repository content lookup failed")
  ) {
    return "GitHub 파일 정보를 잠시 불러오지 못했습니다. 다시 시도해 주세요.";
  }

  if (message.includes("Contents write permission is required")) {
    return "GitHub App에 Contents 쓰기 권한이 필요합니다.";
  }

  if (message.includes("GitHub OAuth connection is required")) {
    return "GitHub 연결이 필요합니다. 설정에서 GitHub를 연결한 뒤 다시 시도해 주세요.";
  }

  if (message.includes("GitHub OAuth connection is invalid")) {
    return "GitHub 연결이 유효하지 않습니다. GitHub를 다시 연결해 주세요.";
  }

  if (message.includes("GitHub conflict merge commit apply failed")) {
    return "GitHub에 Conflict 해결 commit을 적용하지 못했습니다. 다시 시도해 주세요.";
  }

  return message;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function getInitialDecisionStatus(
  file: PrReviewFile
): PrReviewFileDecisionStatus | null {
  return file.currentStatus === "not_reviewed" ? null : file.currentStatus;
}

function getStoredComment(value: string) {
  return value.trim() || null;
}

const CONFLICT_MARKER_PATTERN = /(^|\n)(<<<<<<<|=======|>>>>>>>)(?:\s|$)/;

function hasConflictMarkers(value: string) {
  return CONFLICT_MARKER_PATTERN.test(value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
}

function getCodeClassName(type: PrReviewDiffRow["type"]) {
  switch (type) {
    case "added":
      return "text-emerald-900";
    case "deleted":
      return "text-rose-900";
    case "unchanged":
      return "text-slate-700";
  }
}

function getFileStatusClassName(status: PrReviewFile["fileStatus"]) {
  switch (status) {
    case "added":
      return "bg-emerald-50 text-emerald-700";
    case "deleted":
      return "bg-rose-50 text-rose-700";
    case "renamed":
      return "bg-violet-50 text-violet-700";
    case "modified":
      return "bg-slate-100 text-slate-700";
  }
}

const riskLevelLabels: Record<PrReviewFileRiskLevel, string> = {
  high: "위험도 높음",
  medium: "위험도 중간",
  low: "위험도 낮음",
  unknown: "위험도 미확인"
};

const riskLevelClassNames: Record<PrReviewFileRiskLevel, string> = {
  high: "bg-rose-50 text-rose-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-emerald-50 text-emerald-700",
  unknown: "bg-slate-100 text-slate-600"
};

function getSaveStatusLabel(status: SaveStatus) {
  switch (status) {
    case "saving":
      return "저장 중";
    case "saved":
      return "저장됨";
    case "error":
      return "저장 실패";
    case "idle":
      return "자동 저장 대기";
  }
}

function getUnsupportedConflictReasonLabel(reason: string) {
  if (reason.includes("binary")) {
    return "바이너리 파일 conflict는 아직 지원하지 않습니다.";
  }

  if (reason.includes("large diff")) {
    return "큰 diff conflict는 아직 지원하지 않습니다.";
  }

  if (reason.includes("add/add")) {
    return "add/add conflict는 아직 지원하지 않습니다.";
  }

  if (reason.includes("modify/delete")) {
    return "modify/delete conflict는 아직 지원하지 않습니다.";
  }

  if (reason.includes("rename/modify")) {
    return "rename/modify conflict는 아직 지원하지 않습니다.";
  }

  if (reason.includes("content")) {
    return "Conflict 분석에 필요한 파일 내용을 가져오지 못했습니다.";
  }

  return reason;
}

function getDecisionDisabledReason(input: {
  conflictAnalysisErrorMessage: string | null;
  conflictAnalysisStatus: ConflictAnalysisLoadStatus;
  conflictFile: PrReviewConflictFile | null;
  isReviewSessionConflicted: boolean;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
}) {
  if (input.conflictFile?.resolutionStatus === "unresolved") {
    return "Conflict 해결 전에는 일반 판단을 저장할 수 없습니다.";
  }

  if (input.unsupportedConflictFile) {
    return getUnsupportedConflictReasonLabel(input.unsupportedConflictFile.reason);
  }

  if (!input.isReviewSessionConflicted) {
    return null;
  }

  if (
    input.conflictAnalysisStatus === "idle" ||
    input.conflictAnalysisStatus === "loading"
  ) {
    return "Conflict 정보를 확인한 뒤 판단을 저장할 수 있습니다.";
  }

  if (input.conflictAnalysisStatus === "stale") {
    return (
      input.conflictAnalysisErrorMessage ??
      "PR head가 변경되어 새 review session이 필요합니다."
    );
  }

  return null;
}

export function PrReviewFileDiffDrawer({
  apiClient,
  baseBranch,
  conflictAnalysisErrorMessage,
  conflictAnalysisStatus,
  conflictFile,
  conflictHeadSha,
  headBranch,
  isReviewSessionConflicted,
  onClose,
  onConflictApplied,
  onDecisionSaved,
  reviewFileId,
  unsupportedConflictFile,
  workspaceId
}: PrReviewFileDiffDrawerProps) {
  const [status, setStatus] = useState<FileReviewStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [file, setFile] = useState<PrReviewFile | null>(null);
  const [diff, setDiff] = useState<PrReviewFileDiff | null>(null);
  const [decisionStatus, setDecisionStatus] =
    useState<PrReviewFileDecisionStatus | null>(null);
  const [comment, setComment] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [conflictSuggestion, setConflictSuggestion] =
    useState<PrReviewConflictSuggestion | null>(null);
  const [conflictSuggestionStatus, setConflictSuggestionStatus] =
    useState<ConflictSuggestionLoadStatus>("idle");
  const [conflictSuggestionError, setConflictSuggestionError] = useState<
    string | null
  >(null);
  const [conflictApplyStatus, setConflictApplyStatus] =
    useState<ConflictApplyStatus>("idle");
  const [conflictApplyError, setConflictApplyError] = useState<string | null>(
    null
  );
  const [conflictApplyResult, setConflictApplyResult] =
    useState<PrReviewConflictApplyResult | null>(null);
  const [resolvedContentDraft, setResolvedContentDraft] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedConflictHunkIndex, setSelectedConflictHunkIndex] = useState(0);
  const [isBaseComparisonOpen, setIsBaseComparisonOpen] = useState(false);
  const [conflictWorkspaceView, setConflictWorkspaceView] =
    useState<ConflictWorkspaceView>("conflict");
  const [resolutionChoices, setResolutionChoices] = useState<
    Record<string, PrReviewConflictResolutionChoice>
  >({});
  const [isResolvedDraftCustomized, setIsResolvedDraftCustomized] =
    useState(false);
  const commentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const clearScheduledCommentSave = useCallback(() => {
    if (commentSaveTimerRef.current) {
      clearTimeout(commentSaveTimerRef.current);
      commentSaveTimerRef.current = null;
    }
  }, []);

  const enqueueDecisionSave = useCallback(
    (nextStatus: PrReviewFileDecisionStatus, nextComment: string) => {
      const saveTask = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          setSaveStatus("saving");
          setSaveErrorMessage(null);

          const previousStatus = file?.currentStatus ?? "not_reviewed";
          const storedComment = getStoredComment(nextComment);
          const updatedFile = await apiClient.updateReviewFileDecision(
            workspaceId,
            reviewFileId,
            {
              comment: storedComment,
              status: nextStatus
            }
          );
          const savedFile: PrReviewFile = {
            ...updatedFile,
            comment: storedComment,
            currentStatus: nextStatus
          };

          setFile(savedFile);
          setDecisionStatus((currentStatus) =>
            currentStatus === null || currentStatus === nextStatus
              ? getInitialDecisionStatus(savedFile)
              : currentStatus
          );
          setComment((currentComment) =>
            currentComment === nextComment ? savedFile.comment ?? "" : currentComment
          );
          setSaveStatus("saved");
          onDecisionSaved(savedFile, previousStatus);
        })
        .catch((error) => {
          setSaveStatus("error");
          setSaveErrorMessage(getErrorMessage(error));
        });

      saveQueueRef.current = saveTask;

      return saveTask;
    },
    [apiClient, file?.currentStatus, onDecisionSaved, reviewFileId, workspaceId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadReviewFile() {
      clearScheduledCommentSave();
      setStatus("loading");
      setSaveStatus("idle");
      setErrorMessage(null);
      setSaveErrorMessage(null);
      setConflictSuggestion(null);
      setConflictSuggestionStatus("idle");
      setConflictSuggestionError(null);
      setConflictApplyStatus("idle");
      setConflictApplyError(null);
      setConflictApplyResult(null);
      setResolvedContentDraft("");
      setConflictWorkspaceView("conflict");
      setResolutionChoices({});
      setIsResolvedDraftCustomized(false);
      setFile(null);
      setDiff(null);

      try {
        const [nextFile, nextDiff] = await Promise.all([
          apiClient.getReviewFile(workspaceId, reviewFileId),
          apiClient.getReviewFileDiff(workspaceId, reviewFileId)
        ]);

        if (cancelled) {
          return;
        }

        setFile(nextFile);
        setDiff(nextDiff);
        setDecisionStatus(getInitialDecisionStatus(nextFile));
        setComment(nextFile.comment ?? "");
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
        setStatus("error");
      }
    }

    void loadReviewFile();

    return () => {
      cancelled = true;
    };
  }, [
    apiClient,
    clearScheduledCommentSave,
    reloadVersion,
    reviewFileId,
    workspaceId
  ]);

  useEffect(() => {
    return () => {
      clearScheduledCommentSave();
    };
  }, [clearScheduledCommentSave]);

  useEffect(() => {
    setSelectedConflictHunkIndex(0);
    setIsBaseComparisonOpen(false);
    setConflictWorkspaceView("conflict");
    setResolutionChoices({});
    setIsResolvedDraftCustomized(false);
    setResolvedContentDraft(conflictFile?.headContent ?? "");
  }, [conflictFile?.headContent, conflictFile?.reviewFileId]);

  const selectedDecision = useMemo(
    () => decisionOptions.find((option) => option.status === decisionStatus),
    [decisionStatus]
  );
  const decisionDisabledReason = getDecisionDisabledReason({
    conflictAnalysisErrorMessage,
    conflictAnalysisStatus,
    conflictFile,
    isReviewSessionConflicted,
    unsupportedConflictFile
  });
  const decisionDisabled = decisionDisabledReason !== null;
  const selectedConflictHunk =
    conflictFile?.hunks[selectedConflictHunkIndex] ?? null;
  const aiResolvedHunks = conflictSuggestion?.resolvedHunks ?? [];
  const resolvedHunkCount = conflictFile
    ? conflictFile.hunks.filter((hunk) => Boolean(resolutionChoices[hunk.id])).length
    : 0;
  const resolutionComplete = conflictFile
    ? isConflictResolutionComplete({
        hunks: conflictFile.hunks,
        choices: resolutionChoices,
        aiResolvedHunks
      })
    : false;
  const drawerModeLabel = decisionDisabled
    ? "Conflict Resolution"
    : "파일 경로";

  const rebuildResolvedDraft = useCallback(
    (
      nextChoices: Record<string, PrReviewConflictResolutionChoice>,
      nextAiResolvedHunks = aiResolvedHunks
    ) => {
      if (!conflictFile) {
        return;
      }

      setResolvedContentDraft(
        buildConflictResolutionDraft({
          headContent: conflictFile.headContent,
          hunks: conflictFile.hunks,
          choices: nextChoices,
          aiResolvedHunks: nextAiResolvedHunks
        })
      );
    },
    [aiResolvedHunks, conflictFile]
  );

  const handleResolutionChoiceChange = useCallback(
    (hunkId: string, choice: PrReviewConflictResolutionChoice) => {
      if (!conflictFile || isResolvedDraftCustomized) {
        return;
      }

      const nextChoices = {
        ...resolutionChoices,
        [hunkId]: choice
      };
      setResolutionChoices(nextChoices);
      rebuildResolvedDraft(nextChoices);
      setConflictApplyStatus("idle");
      setConflictApplyError(null);
      setConflictApplyResult(null);
    },
    [
      conflictFile,
      isResolvedDraftCustomized,
      rebuildResolvedDraft,
      resolutionChoices
    ]
  );

  const handleResetCustomizedDraft = useCallback(() => {
    rebuildResolvedDraft(resolutionChoices);
    setIsResolvedDraftCustomized(false);
    setConflictApplyStatus("idle");
    setConflictApplyError(null);
    setConflictApplyResult(null);
  }, [rebuildResolvedDraft, resolutionChoices]);

  const handleCreateConflictSuggestion = useCallback(async () => {
    if (!conflictFile || conflictSuggestionStatus === "loading") {
      return;
    }

    setConflictSuggestionStatus("loading");
    setConflictSuggestionError(null);

    try {
      const suggestion = await apiClient.createReviewFileConflictSuggestion(
        workspaceId,
        conflictFile.reviewFileId
      );
      setConflictSuggestion(suggestion);
      setResolutionChoices(
        Object.fromEntries(
          conflictFile.hunks.map((hunk) => [hunk.id, "ai"])
        ) as Record<string, PrReviewConflictResolutionChoice>
      );
      setResolvedContentDraft(suggestion.resolvedContent);
      setIsResolvedDraftCustomized(false);
      setConflictWorkspaceView("resolved");
      setConflictApplyStatus("idle");
      setConflictApplyError(null);
      setConflictApplyResult(null);
      setConflictSuggestionStatus("ready");
    } catch (error) {
      setConflictSuggestionStatus("error");
      setConflictSuggestionError(getErrorMessage(error));
    }
  }, [apiClient, conflictFile, conflictSuggestionStatus, workspaceId]);

  const handleApplyConflictResolution = useCallback(async (): Promise<boolean> => {
    if (conflictApplyStatus === "applying") {
      return false;
    }

    const expectedHeadSha = conflictSuggestion?.headSha ?? conflictHeadSha;
    const expectedHeadBlobSha =
      conflictSuggestion?.headBlobSha ?? conflictFile?.headBlobSha;

    if (!conflictFile || !expectedHeadSha || !expectedHeadBlobSha) {
      setConflictApplyStatus("error");
      setConflictApplyError("Conflict 적용 기준 정보를 확인할 수 없습니다.");
      return false;
    }

    if (!resolutionComplete) {
      setConflictApplyStatus("error");
      setConflictApplyError("모든 conflict hunk의 해결 방식을 선택해 주세요.");
      return false;
    }

    if (!resolvedContentDraft.trim() || hasConflictMarkers(resolvedContentDraft)) {
      setConflictApplyStatus("error");
      setConflictApplyError("최종 해결 코드가 비어 있거나 conflict marker가 남아 있습니다.");
      return false;
    }

    setConflictApplyStatus("applying");
    setConflictApplyError(null);

    try {
      const result = await apiClient.applyReviewFileConflictResolution(
        workspaceId,
        conflictFile.reviewFileId,
        {
          expectedHeadBlobSha,
          expectedHeadSha,
          resolvedContent: resolvedContentDraft
        }
      );

      setConflictApplyResult(result);
      setConflictApplyStatus("applied");
      await onConflictApplied(result);
      void apiClient
        .getReviewFileDiff(workspaceId, conflictFile.reviewFileId)
        .then(setDiff)
        .catch(() => undefined);
      return true;
    } catch (error) {
      setConflictApplyStatus("error");
      setConflictApplyError(getConflictApplyErrorMessage(error));
      return false;
    }
  }, [
    apiClient,
    conflictApplyStatus,
    conflictFile,
    conflictHeadSha,
    conflictSuggestion,
    onConflictApplied,
    resolutionComplete,
    resolvedContentDraft,
    workspaceId
  ]);

  useEffect(() => {
    if (decisionDisabled) {
      clearScheduledCommentSave();
    }
  }, [clearScheduledCommentSave, decisionDisabled]);

  function scheduleCommentSave(nextComment: string) {
    if (decisionDisabled) {
      return;
    }

    if (!decisionStatus) {
      return;
    }

    clearScheduledCommentSave();
    commentSaveTimerRef.current = setTimeout(() => {
      commentSaveTimerRef.current = null;
      void enqueueDecisionSave(decisionStatus, nextComment);
    }, 500);
  }

  function flushCommentSave() {
    if (decisionDisabled) {
      return;
    }

    if (!decisionStatus) {
      return;
    }

    clearScheduledCommentSave();
    void enqueueDecisionSave(decisionStatus, comment);
  }

  function handleDecisionStatusChange(nextStatus: PrReviewFileDecisionStatus) {
    if (decisionDisabled) {
      return;
    }

    clearScheduledCommentSave();
    setDecisionStatus(nextStatus);
    void enqueueDecisionSave(nextStatus, comment);
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4">
        <Button onClick={onClose} type="button" variant="outline">
          <ArrowLeft className="size-4" />
          리뷰 캔버스로 돌아가기
        </Button>
        <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm">
          <FileText className="size-4 shrink-0 text-blue-600" />
          <span className="shrink-0 font-medium text-slate-500">
            {drawerModeLabel}
          </span>
          <span className="max-w-[48vw] truncate font-semibold">
            {file?.filePath ?? "파일 리뷰"}
          </span>
        </div>
      </header>

      {status === "loading" || status === "idle" ? (
        <FileReviewLoadingState />
      ) : status === "error" ? (
        <FileReviewErrorState
          message={errorMessage}
          onRetry={() => setReloadVersion((version) => version + 1)}
        />
      ) : file && diff ? (
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50">
            <FileDiffHeader file={file} />
            <Separator />
            {conflictFile && selectedConflictHunk ? (
              <>
                <ConflictWorkspaceTabs
                  onViewChange={setConflictWorkspaceView}
                  resolvedHunkCount={resolvedHunkCount}
                  totalHunkCount={conflictFile.hunks.length}
                  view={conflictWorkspaceView}
                />
                {conflictWorkspaceView === "conflict" ? (
                  <ConflictHunkComparison
                    aiResolvedText={
                      aiResolvedHunks.find(
                        (hunk) => hunk.hunkId === selectedConflictHunk.id
                      )?.resolvedText ?? null
                    }
                    baseBranch={baseBranch}
                    choice={resolutionChoices[selectedConflictHunk.id] ?? null}
                    headBranch={headBranch}
                    hunk={selectedConflictHunk}
                    hunkCount={conflictFile.hunks.length}
                    hunkIndex={selectedConflictHunkIndex}
                    isBaseComparisonOpen={isBaseComparisonOpen}
                    isChoiceDisabled={isResolvedDraftCustomized}
                    onChoiceChange={(choice) =>
                      handleResolutionChoiceChange(selectedConflictHunk.id, choice)
                    }
                    onHunkIndexChange={setSelectedConflictHunkIndex}
                    onResetCustomizedDraft={handleResetCustomizedDraft}
                    onToggleBaseComparison={() =>
                      setIsBaseComparisonOpen((current) => !current)
                    }
                  />
                ) : (
                  <ResolvedDraftWorkspace
                    filePath={file.filePath}
                    isCustomized={isResolvedDraftCustomized}
                    onChange={(value) => {
                      setResolvedContentDraft(value);
                      setIsResolvedDraftCustomized(true);
                      setConflictApplyStatus("idle");
                      setConflictApplyError(null);
                      setConflictApplyResult(null);
                    }}
                    readOnly={
                      conflictApplyStatus === "applying" ||
                      conflictApplyStatus === "applied"
                    }
                    value={resolvedContentDraft}
                  />
                )}
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DiffView diff={diff} />
              </div>
            )}
          </section>

          <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-white lg:w-[400px] lg:border-l lg:border-t-0">
            <ReviewNodePanel
              comment={comment}
              conflictFile={conflictFile}
              conflictSuggestion={conflictSuggestion}
              conflictSuggestionErrorMessage={conflictSuggestionError}
              conflictSuggestionStatus={conflictSuggestionStatus}
              conflictApplyErrorMessage={conflictApplyError}
              conflictApplyResult={conflictApplyResult}
              conflictApplyStatus={conflictApplyStatus}
              decisionStatus={decisionStatus}
              decisionDisabledReason={decisionDisabledReason}
              file={file}
              isResolvedDraftCustomized={isResolvedDraftCustomized}
              onCommentChange={(value) => {
                setComment(value);
                setSaveStatus("idle");
                scheduleCommentSave(value);
              }}
              onCommentBlur={flushCommentSave}
              onApplyConflictResolution={handleApplyConflictResolution}
              onCreateConflictSuggestion={handleCreateConflictSuggestion}
              onDecisionStatusChange={handleDecisionStatusChange}
              onOpenResolvedDraft={() => setConflictWorkspaceView("resolved")}
              resolutionComplete={resolutionComplete}
              resolvedHunkCount={resolvedHunkCount}
              resolvedContentDraft={resolvedContentDraft}
              saveErrorMessage={saveErrorMessage}
              saveStatus={saveStatus}
              selectedDecisionLabel={selectedDecision?.label ?? "아직 선택 안 됨"}
              unsupportedConflictFile={unsupportedConflictFile}
            />
          </aside>
        </main>
      ) : null}
    </div>
  );
}

function FileReviewLoadingState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        <Loader2 className="size-4 animate-spin text-blue-600" />
        파일 리뷰 화면 불러오는 중
      </div>
    </div>
  );
}

function FileReviewErrorState({
  message,
  onRetry
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-rose-200 bg-white px-5 py-4 text-center shadow-sm">
        <AlertCircle className="mx-auto size-8 text-rose-600" />
        <h3 className="mt-3 text-base font-semibold">
          파일 리뷰 정보를 불러오지 못했습니다
        </h3>
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

function FileDiffHeader({ file }: { file: PrReviewFile }) {
  return (
    <section className="shrink-0 space-y-4 bg-white px-5 py-4">
      <div>
        <p className="text-xs font-semibold uppercase text-blue-600">
          선택한 리뷰 노드
        </p>
        <h1 className="mt-1 break-words text-xl font-semibold text-slate-950">
          {file.filePath}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium",
            getFileStatusClassName(file.fileStatus)
          )}
        >
          <FileText className="size-3.5" />
          {file.fileStatus}
        </span>
        <span className="font-medium text-emerald-600">
          +{formatNumber(file.additions)}
        </span>
        <span className="font-medium text-rose-500">
          -{formatNumber(file.deletions)}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-1 text-xs font-semibold",
            riskLevelClassNames[file.riskLevel]
          )}
        >
          {riskLevelLabels[file.riskLevel]}
        </span>
        {file.previousFilePath ? (
          <span className="min-w-0 truncate text-slate-500">
            from {file.previousFilePath}
          </span>
        ) : null}
        {file.githubFileUrl ? (
          <a
            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
            href={file.githubFileUrl}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    </section>
  );
}

function ReviewNodePanel({
  comment,
  conflictFile,
  conflictApplyErrorMessage,
  conflictApplyResult,
  conflictApplyStatus,
  conflictSuggestion,
  conflictSuggestionErrorMessage,
  conflictSuggestionStatus,
  decisionStatus,
  decisionDisabledReason,
  file,
  isResolvedDraftCustomized,
  onApplyConflictResolution,
  onCommentBlur,
  onCommentChange,
  onCreateConflictSuggestion,
  onDecisionStatusChange,
  onOpenResolvedDraft,
  resolutionComplete,
  resolvedHunkCount,
  resolvedContentDraft,
  saveErrorMessage,
  saveStatus,
  selectedDecisionLabel,
  unsupportedConflictFile
}: {
  comment: string;
  conflictFile: PrReviewConflictFile | null;
  conflictApplyErrorMessage: string | null;
  conflictApplyResult: PrReviewConflictApplyResult | null;
  conflictApplyStatus: ConflictApplyStatus;
  conflictSuggestion: PrReviewConflictSuggestion | null;
  conflictSuggestionErrorMessage: string | null;
  conflictSuggestionStatus: ConflictSuggestionLoadStatus;
  decisionStatus: PrReviewFileDecisionStatus | null;
  decisionDisabledReason: string | null;
  file: PrReviewFile;
  isResolvedDraftCustomized: boolean;
  onApplyConflictResolution: () => Promise<boolean>;
  onCommentBlur: () => void;
  onCommentChange: (value: string) => void;
  onCreateConflictSuggestion: () => void;
  onDecisionStatusChange: (status: PrReviewFileDecisionStatus) => void;
  onOpenResolvedDraft: () => void;
  resolutionComplete: boolean;
  resolvedHunkCount: number;
  resolvedContentDraft: string;
  saveErrorMessage: string | null;
  saveStatus: SaveStatus;
  selectedDecisionLabel: string;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
}) {
  const decisionDisabled = decisionDisabledReason !== null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-5 p-5">
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            리뷰 노드
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold leading-7 text-slate-950">
            {file.fileName}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              {file.fileRole ?? "역할 미분류"}
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                riskLevelClassNames[file.riskLevel]
              )}
            >
              {riskLevelLabels[file.riskLevel]}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {file.currentStatus === "not_reviewed"
                ? "not reviewed"
                : decisionLabelByStatus[file.currentStatus]}
            </span>
          </div>
        </section>

        {conflictApplyResult ? (
          <ConflictApplySuccessNotice result={conflictApplyResult} />
        ) : null}

        {decisionDisabledReason ? (
          <ConflictResolutionPanel
            conflictFile={conflictFile}
            conflictApplyErrorMessage={conflictApplyErrorMessage}
            conflictApplyStatus={conflictApplyStatus}
            conflictSuggestion={conflictSuggestion}
            conflictSuggestionErrorMessage={conflictSuggestionErrorMessage}
            conflictSuggestionStatus={conflictSuggestionStatus}
            isResolvedDraftCustomized={isResolvedDraftCustomized}
            onApplyConflictResolution={onApplyConflictResolution}
            onCreateConflictSuggestion={onCreateConflictSuggestion}
            onOpenResolvedDraft={onOpenResolvedDraft}
            reason={decisionDisabledReason}
            resolutionComplete={resolutionComplete}
            resolvedHunkCount={resolvedHunkCount}
            resolvedContentDraft={resolvedContentDraft}
            unsupportedConflictFile={unsupportedConflictFile}
          />
        ) : null}

        <Separator />

        <PanelSection title="리뷰에서 보는 역할">
          <p>{file.fileRole ?? "이 파일의 역할 분석 결과가 아직 없습니다."}</p>
        </PanelSection>

        <PanelSection title="확인해야 하는 이유">
          <p>{file.changeReason ?? "변경 이유 분석 결과가 아직 없습니다."}</p>
        </PanelSection>

        <PanelSection title="변경 요약">
          <p>{file.changeSummary ?? "변경 요약 분석 결과가 아직 없습니다."}</p>
        </PanelSection>

        <FlowMemberships memberships={file.flowMemberships} />

        <PanelSection title="리뷰 포인트">
          {file.reviewPoints.length ? (
            <ul className="space-y-2">
              {file.reviewPoints.map((point, index) => (
                <li className="flex gap-2" key={`${point}-${index}`}>
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-blue-500" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>리뷰 포인트 분석 결과가 아직 없습니다.</p>
          )}
        </PanelSection>
      </div>

      <div className="mt-auto border-t border-slate-200 bg-white p-5">
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            리뷰 코멘트
          </p>
          <textarea
            className={cn(
              "mt-2 min-h-28 w-full resize-y rounded-lg border px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:ring-3",
              decisionDisabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500 focus:border-slate-200 focus:ring-transparent"
                : "border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100"
            )}
            disabled={decisionDisabled}
            onBlur={onCommentBlur}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder={
              decisionDisabled
                ? "Conflict 해결 후 코멘트를 저장할 수 있습니다."
                : "파일 리뷰 코멘트를 남겨주세요."
            }
            value={comment}
          />
        </section>

        <div className="mt-4 grid gap-2">
          {decisionOptions.map((option) => {
            const Icon = option.icon;
            const selected = decisionStatus === option.status;

            return (
              <button
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  decisionDisabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    : selected
                      ? "border-blue-500 bg-blue-50 text-blue-950"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
                disabled={decisionDisabled}
                key={option.status}
                onClick={() => onDecisionStatusChange(option.status)}
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="size-4" />
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Current decision
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {selectedDecisionLabel}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            {saveStatus === "saving" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {decisionDisabled ? "Conflict 해결 필요" : getSaveStatusLabel(saveStatus)}
          </p>
        </div>

        {decisionDisabledReason ? (
          <p className="mt-3 text-sm leading-6 text-amber-700">
            {decisionDisabledReason}
          </p>
        ) : saveErrorMessage ? (
          <p className="mt-3 text-sm leading-6 text-rose-600">
            {saveErrorMessage}
          </p>
        ) : saveStatus === "saved" ? (
          <p className="mt-3 text-sm leading-6 text-emerald-600">
            파일 판단이 저장되었습니다.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ConflictResolutionPanel({
  conflictFile,
  conflictApplyErrorMessage,
  conflictApplyStatus,
  conflictSuggestion,
  conflictSuggestionErrorMessage,
  conflictSuggestionStatus,
  isResolvedDraftCustomized,
  onApplyConflictResolution,
  onCreateConflictSuggestion,
  onOpenResolvedDraft,
  reason,
  resolutionComplete,
  resolvedHunkCount,
  resolvedContentDraft,
  unsupportedConflictFile
}: {
  conflictFile: PrReviewConflictFile | null;
  conflictApplyErrorMessage: string | null;
  conflictApplyStatus: ConflictApplyStatus;
  conflictSuggestion: PrReviewConflictSuggestion | null;
  conflictSuggestionErrorMessage: string | null;
  conflictSuggestionStatus: ConflictSuggestionLoadStatus;
  isResolvedDraftCustomized: boolean;
  onApplyConflictResolution: () => Promise<boolean>;
  onCreateConflictSuggestion: () => void;
  onOpenResolvedDraft: () => void;
  reason: string;
  resolutionComplete: boolean;
  resolvedHunkCount: number;
  resolvedContentDraft: string;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
}) {
  const isSuggestionLoading = conflictSuggestionStatus === "loading";

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
        <AlertCircle className="size-4 shrink-0" />
        Conflict Resolution
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">{reason}</p>
      {unsupportedConflictFile ? (
        <p className="mt-2 text-xs leading-5 text-amber-800">
          이 파일은 후속 conflict type slice에서 처리합니다.
        </p>
      ) : null}
      {conflictFile ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-800">
                  AI draft
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {conflictSuggestion
                    ? conflictSuggestion.status === "invalid"
                      ? "검증 실패"
                      : "초안 준비됨"
                    : "초안 없음"}
                </p>
              </div>
              <Button
                disabled={isSuggestionLoading || isResolvedDraftCustomized}
                onClick={onCreateConflictSuggestion}
                size="sm"
                type="button"
                variant="outline"
              >
                {isSuggestionLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                AI 해결안 생성
              </Button>
            </div>
            {isResolvedDraftCustomized ? (
              <p className="mt-3 text-xs leading-5 text-blue-700">
                직접 편집 내용을 보호하기 위해 AI 재생성을 잠갔습니다. conflict 비교에서 선택 기반 코드로 복원하면 다시 생성할 수 있습니다.
              </p>
            ) : null}
            {conflictSuggestionErrorMessage ? (
              <p className="mt-3 text-xs leading-5 text-rose-600">
                {conflictSuggestionErrorMessage}
              </p>
            ) : null}
            {conflictSuggestion ? (
              <ConflictSuggestionPreview suggestion={conflictSuggestion} />
            ) : null}
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-800">
                  Resolution progress
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-950">
                  {resolvedHunkCount} / {conflictFile.hunks.length} hunk 선택
                </p>
              </div>
              <Button onClick={onOpenResolvedDraft} size="sm" type="button" variant="outline">
                최종 코드 보기
              </Button>
            </div>
          </div>

          <ConflictApplyControls
            applyErrorMessage={conflictApplyErrorMessage}
            applyStatus={conflictApplyStatus}
            onApply={onApplyConflictResolution}
            resolutionComplete={resolutionComplete}
            resolvedContent={resolvedContentDraft}
          />
        </div>
      ) : null}
    </section>
  );
}

function ConflictSuggestionPreview({
  suggestion
}: {
  suggestion: PrReviewConflictSuggestion;
}) {
  const invalid = suggestion.status === "invalid";

  return (
    <div className="mt-3 space-y-3">
      <div
        className={cn(
          "rounded-md border px-3 py-2 text-xs font-semibold",
          invalid
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700"
        )}
      >
        {invalid ? "검증 실패" : "초안 준비됨"}
      </div>

      <PanelSection title="AI 원인 요약">
        <p>{suggestion.aiSummary}</p>
      </PanelSection>

      <PanelSection title="AI 해결 방향">
        <p>{suggestion.aiSuggestion}</p>
      </PanelSection>

      {suggestion.validationMessages.length ? (
        <PanelSection title="검증 메시지">
          <ul className="space-y-1">
            {suggestion.validationMessages.map((message) => (
              <li className="text-rose-600" key={message}>
                {message}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
    </div>
  );
}

function ConflictApplyControls({
  applyErrorMessage,
  applyStatus,
  onApply,
  resolutionComplete,
  resolvedContent
}: {
  applyErrorMessage: string | null;
  applyStatus: ConflictApplyStatus;
  onApply: () => Promise<boolean>;
  resolutionComplete: boolean;
  resolvedContent: string;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const isApplying = applyStatus === "applying";
  const applied = applyStatus === "applied";
  const draftEmpty = !resolvedContent.trim();
  const draftHasConflictMarkers = hasConflictMarkers(resolvedContent);
  const canApply =
    resolutionComplete &&
    !draftEmpty &&
    !draftHasConflictMarkers &&
    !isApplying &&
    !applied;
  const applyDisabledReason = !resolutionComplete
    ? "모든 conflict hunk의 해결 방식을 선택해 주세요."
    : draftEmpty
      ? "최종 해결 코드가 비어 있습니다."
      : draftHasConflictMarkers
        ? "최종 해결 코드에 conflict marker가 남아 있습니다."
        : null;

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-3">
      {applyDisabledReason ? (
        <p className="text-xs leading-5 text-amber-800">{applyDisabledReason}</p>
      ) : null}

      {applyErrorMessage ? (
        <div
          aria-live="polite"
          className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700"
        >
          <p className="font-semibold">적용 실패</p>
          <p className="mt-1">{applyErrorMessage}</p>
        </div>
      ) : null}

      {isConfirming ? (
        <div className="space-y-3">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-sm font-semibold text-blue-950">
              이 해결 코드를 PR 브랜치에 commit할까요?
            </p>
            <p className="mt-1 text-xs leading-5 text-blue-800">
              적용 후에는 GitHub의 최신 conflict 상태를 다시 확인합니다.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              disabled={isApplying}
              onClick={() => setIsConfirming(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              취소
            </Button>
            <Button
              disabled={isApplying || !canApply}
              onClick={() => {
                void onApply().then((success) => {
                  if (success) {
                    setIsConfirming(false);
                  }
                });
              }}
              size="sm"
              type="button"
            >
              {isApplying ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {isApplying ? "적용 중" : "GitHub에 적용"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={!canApply}
            onClick={() => setIsConfirming(true)}
            size="sm"
            type="button"
          >
            <CheckCircle2 className="size-3.5" />
            Apply resolution
          </Button>
        </div>
      )}
    </div>
  );
}

function ConflictApplySuccessNotice({
  result
}: {
  result: PrReviewConflictApplyResult;
}) {
  const requiresSync = result.localStateStatus === "sync_required";
  const statusMessage = requiresSync
    ? "GitHub에는 적용됐지만 PILO 상태 갱신에 실패했습니다. GitHub 동기화 후 새 리뷰를 시작해 주세요."
    : result.conflictStatus === "clean"
      ? "GitHub에서 남은 Conflict가 없음을 확인했습니다."
      : result.conflictStatus === "checking"
        ? "GitHub에서 갱신된 PR의 Conflict 상태를 확인하고 있습니다."
        : "GitHub의 최신 Conflict 상태를 다시 확인했습니다.";

  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3",
        requiresSync
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="size-4 shrink-0" />
        Conflict 해결 merge commit 완료
      </p>
      <p className="mt-2 text-xs leading-5">{statusMessage}</p>
      <p className="mt-2 font-mono text-xs">
        {result.headShaBefore.slice(0, 7)} -&gt; {result.headShaAfter.slice(0, 7)}
      </p>
      {result.commitUrl ? (
        <a
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
          href={result.commitUrl}
          rel="noreferrer"
          target="_blank"
        >
          Commit
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </section>
  );
}

function ConflictWorkspaceTabs({
  onViewChange,
  resolvedHunkCount,
  totalHunkCount,
  view
}: {
  onViewChange: (view: ConflictWorkspaceView) => void;
  resolvedHunkCount: number;
  totalHunkCount: number;
  view: ConflictWorkspaceView;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-1">
        <button
          aria-pressed={view === "conflict"}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-semibold transition-colors",
            view === "conflict"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
          onClick={() => onViewChange("conflict")}
          type="button"
        >
          Conflict 비교
        </button>
        <button
          aria-pressed={view === "resolved"}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-semibold transition-colors",
            view === "resolved"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
          onClick={() => onViewChange("resolved")}
          type="button"
        >
          최종 해결 코드
        </button>
      </div>
      <p className="text-xs font-medium text-slate-500">
        해결 선택 {resolvedHunkCount} / {totalHunkCount}
      </p>
    </div>
  );
}

function ResolvedDraftWorkspace({
  filePath,
  isCustomized,
  onChange,
  readOnly,
  value
}: {
  filePath: string;
  isCustomized: boolean;
  onChange: (value: string) => void;
  readOnly: boolean;
  value: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{filePath}</p>
          <p className="mt-1 text-xs text-slate-500">
            hunk 선택 결과를 조립한 파일 전체 코드입니다. 적용 전에 직접 수정할 수 있습니다.
          </p>
        </div>
        {isCustomized ? (
          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
            직접 편집됨
          </span>
        ) : null}
      </header>
      <PrReviewResolvedCodeEditor
        filePath={filePath}
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    </section>
  );
}

function ConflictHunkComparison({
  aiResolvedText,
  baseBranch,
  choice,
  headBranch,
  hunk,
  hunkCount,
  hunkIndex,
  isBaseComparisonOpen,
  isChoiceDisabled,
  onChoiceChange,
  onHunkIndexChange,
  onResetCustomizedDraft,
  onToggleBaseComparison
}: {
  aiResolvedText: string | null;
  baseBranch: string | null;
  choice: PrReviewConflictResolutionChoice | null;
  headBranch: string | null;
  hunk: PrReviewConflictHunk;
  hunkCount: number;
  hunkIndex: number;
  isBaseComparisonOpen: boolean;
  isChoiceDisabled: boolean;
  onChoiceChange: (choice: PrReviewConflictResolutionChoice) => void;
  onHunkIndexChange: (index: number) => void;
  onResetCustomizedDraft: () => void;
  onToggleBaseComparison: () => void;
}) {
  const targetBranchLabel = baseBranch ?? "Target branch";
  const headBranchLabel = headBranch ?? "PR branch";
  const choices: Array<{
    label: string;
    value: PrReviewConflictResolutionChoice;
    disabled?: boolean;
  }> = [
    { label: "AI 사용", value: "ai", disabled: aiResolvedText === null },
    { label: "PR 브랜치 선택", value: "pr" },
    { label: "대상 브랜치 선택", value: "target" },
    { label: "둘 다 선택", value: "both" }
  ];

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-amber-700">
            Conflict hunk
          </p>
          <p className="mt-1 font-mono text-xs text-slate-600">{hunk.header}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="이전 conflict hunk"
            disabled={hunkIndex === 0}
            onClick={() => onHunkIndexChange(hunkIndex - 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span aria-live="polite" className="min-w-12 text-center text-sm font-semibold">
            {hunkIndex + 1} / {hunkCount}
          </span>
          <Button
            aria-label="다음 conflict hunk"
            disabled={hunkIndex === hunkCount - 1}
            onClick={() => onHunkIndexChange(hunkIndex + 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            onClick={onToggleBaseComparison}
            size="sm"
            type="button"
            variant="outline"
          >
            {isBaseComparisonOpen ? "Base 숨기기" : "Base 보기"}
          </Button>
        </div>
      </div>

      {hunkCount > 1 ? (
        <div aria-label="Conflict hunk 선택" className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: hunkCount }, (_, index) => (
            <Button
              key={index}
              onClick={() => onHunkIndexChange(index)}
              size="sm"
              type="button"
              variant={index === hunkIndex ? "default" : "outline"}
            >
              Hunk {index + 1}
            </Button>
          ))}
        </div>
      ) : null}

      {isChoiceDisabled ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm leading-6 text-blue-900">
            최종 코드를 직접 편집했습니다. hunk 선택을 바꾸려면 직접 편집 내용을 초기화해야 합니다.
          </p>
          <Button onClick={onResetCustomizedDraft} size="sm" type="button" variant="outline">
            선택 기반 코드로 복원
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Hunk 해결 방식">
        {choices.map((option) => (
          <Button
            disabled={isChoiceDisabled || option.disabled}
            key={option.value}
            onClick={() => onChoiceChange(option.value)}
            size="sm"
            type="button"
            variant={choice === option.value ? "default" : "outline"}
          >
            {option.value === "ai" ? <Sparkles className="size-3.5" /> : null}
            {option.label}
          </Button>
        ))}
      </div>

      <ConflictUnifiedCodePane
        aiResolvedText={aiResolvedText}
        headBranchLabel={headBranchLabel}
        hunk={hunk}
        isBaseComparisonOpen={isBaseComparisonOpen}
        targetBranchLabel={targetBranchLabel}
      />
    </section>
  );
}

function ConflictUnifiedCodePane({
  aiResolvedText,
  headBranchLabel,
  hunk,
  isBaseComparisonOpen,
  targetBranchLabel
}: {
  aiResolvedText: string | null;
  headBranchLabel: string;
  hunk: PrReviewConflictHunk;
  isBaseComparisonOpen: boolean;
  targetBranchLabel: string;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="max-h-[calc(100vh-330px)] overflow-auto">
        <div className="min-w-max text-xs leading-5">
          <ConflictMarkerRow label={`<<<<<<< PR branch: ${headBranchLabel}`} />
          <ConflictCodeRows
            lineStart={hunk.incomingStartLine}
            tone="pr"
            value={hunk.incomingText}
          />
          <ConflictMarkerRow label="=======" />
          <ConflictCodeRows
            lineStart={hunk.currentStartLine}
            tone="target"
            value={hunk.currentText}
          />
          <ConflictMarkerRow label={`>>>>>>> Target branch: ${targetBranchLabel}`} />
          {aiResolvedText !== null ? (
            <>
              <ConflictMarkerRow label="AI RESOLUTION" tone="ai" />
              <ConflictCodeRows lineStart={1} tone="ai" value={aiResolvedText} />
            </>
          ) : null}
          {isBaseComparisonOpen ? (
            <>
              <ConflictMarkerRow label="BASE: common ancestor" tone="base" />
              <ConflictCodeRows
                lineStart={hunk.baseStartLine}
                tone="base"
                value={hunk.baseText}
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ConflictMarkerRow({
  label,
  tone = "marker"
}: {
  label: string;
  tone?: "marker" | "ai" | "base";
}) {
  const classNameByTone = {
    marker: "bg-amber-50 text-amber-800",
    ai: "bg-violet-100 text-violet-800",
    base: "bg-slate-100 text-slate-600"
  } as const;

  return (
    <div
      className={cn(
        "grid min-w-full grid-cols-[72px_minmax(560px,1fr)] border-b border-slate-200 font-mono font-semibold",
        classNameByTone[tone]
      )}
    >
      <span className="px-2 py-1.5" />
      <code className="whitespace-pre px-3 py-1.5">{label}</code>
    </div>
  );
}

function ConflictCodeRows({
  lineStart,
  tone,
  value
}: {
  lineStart: number;
  tone: "ai" | "base" | "pr" | "target";
  value: string;
}) {
  const lines = value ? value.replace(/\r\n/g, "\n").split("\n") : ["(empty)"];
  const classNameByTone = {
    ai: "bg-violet-50/70 text-violet-950",
    base: "bg-slate-50 text-slate-700",
    pr: "bg-emerald-50/80 text-emerald-950",
    target: "bg-blue-50/80 text-blue-950"
  } as const;

  return (
    <>
      {lines.map((line, index) => (
        <div
          className={cn(
            "grid min-w-full grid-cols-[72px_minmax(560px,1fr)] border-b border-slate-100",
            classNameByTone[tone]
          )}
          key={`${tone}-${lineStart}-${index}`}
        >
          <span className="select-none px-2 py-1.5 text-right font-mono text-slate-400">
            {value && tone !== "ai" ? lineStart + index : ""}
          </span>
          <code className="whitespace-pre px-3 py-1.5 font-mono">{line || " "}</code>
        </div>
      ))}
    </>
  );
}

function PanelSection({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <div className="mt-2 text-sm leading-6 text-slate-700">{children}</div>
    </section>
  );
}

function FlowMemberships({
  memberships
}: {
  memberships: PrReviewFileFlowMembership[];
}) {
  return (
    <PanelSection title="함께 보는 workflow">
      {memberships.length ? (
        <ul className="space-y-2">
          {memberships.map((membership) => (
            <li
              className="rounded-lg border border-slate-200 px-3 py-2"
              key={membership.reviewFlowFileId}
            >
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 shrink-0 text-blue-600" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                  {membership.flowTitle}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  #{membership.workflowOrder}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>연결된 workflow 정보가 없습니다.</p>
      )}
    </PanelSection>
  );
}

type DiffPaneSide = "old" | "new";

type DiffPaneRow = {
  key: string;
  lineNumber: number | null;
  text: string;
  type: PrReviewDiffRow["type"];
};

const diffPaneLabels: Record<
  DiffPaneSide,
  {
    emptyMessage: string;
    lineLabel: string;
    title: string;
  }
> = {
  old: {
    emptyMessage: "Before content is empty.",
    lineLabel: "Old",
    title: "Before"
  },
  new: {
    emptyMessage: "After content is empty.",
    lineLabel: "New",
    title: "After"
  }
};

function getDiffPaneRows(
  rows: PrReviewDiffRow[],
  side: DiffPaneSide
): DiffPaneRow[] {
  return rows.flatMap((row, index) => {
    const lineNumber = side === "old" ? row.oldLineNumber : row.newLineNumber;
    const text = side === "old" ? row.oldText : row.newText;

    if (text === null) {
      return [];
    }

    return [
      {
        key: `${side}-${lineNumber ?? "x"}-${index}`,
        lineNumber,
        text,
        type: row.type
      }
    ];
  });
}

function getDiffPaneRowClassName(type: PrReviewDiffRow["type"]) {
  switch (type) {
    case "added":
      return "bg-emerald-50/80";
    case "deleted":
      return "bg-rose-50/80";
    case "unchanged":
      return "bg-white";
  }
}

function DiffCodePane({
  rows,
  side
}: {
  rows: DiffPaneRow[];
  side: DiffPaneSide;
}) {
  const labels = diffPaneLabels[side];

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-500">
        <span className="px-2 py-2 text-right">{labels.lineLabel}</span>
        <span className="px-3 py-2">{labels.title}</span>
      </div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        {rows.length ? (
          <div className="min-w-max text-xs leading-5">
            {rows.map((row) => (
              <div
                className={cn(
                  "grid min-w-full grid-cols-[72px_minmax(520px,1fr)] border-b border-slate-100 last:border-b-0",
                  getDiffPaneRowClassName(row.type)
                )}
                key={row.key}
              >
                <span className="select-none px-2 py-1.5 text-right font-mono text-slate-400">
                  {row.lineNumber ?? ""}
                </span>
                <code
                  className={cn(
                    "block min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 font-mono",
                    getCodeClassName(row.type)
                  )}
                >
                  {row.text}
                </code>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            {labels.emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: PrReviewFileDiff }) {
  if (diff.mode !== "side_by_side") {
    return (
      <section className="p-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-950">
            PILO에서 diff를 미리 볼 수 없습니다.
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            {diff.message ?? "GitHub에서 파일 diff를 확인해 주세요."}
          </p>
          {diff.githubFileUrl ? (
            <a
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
              href={diff.githubFileUrl}
              rel="noreferrer"
              target="_blank"
            >
              GitHub에서 diff 보기
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  if (!diff.rows.length) {
    return (
      <section className="p-5">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          표시할 diff row가 없습니다.
        </div>
      </section>
    );
  }

  const beforeRows = getDiffPaneRows(diff.rows, "old");
  const afterRows = getDiffPaneRows(diff.rows, "new");

  return (
    <section className="p-5">
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <DiffCodePane rows={beforeRows} side="old" />
        <DiffCodePane rows={afterRows} side="new" />
      </div>
    </section>
  );
}
