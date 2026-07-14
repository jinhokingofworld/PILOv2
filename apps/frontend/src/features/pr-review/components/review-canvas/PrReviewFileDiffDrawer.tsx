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
  GitMerge,
  HelpCircle,
  Loader2,
  MessageSquareWarning,
  Pencil,
  RefreshCcw,
  Sparkles
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  PrReviewApiError,
  type createPrReviewApiClient
} from "@/features/pr-review/api/client";
import { PrReviewResolvedCodeEditor } from "./PrReviewResolvedCodeEditor";
import { usePrReviewConflictDraftLock } from "@/features/pr-review/realtime/usePrReviewConflictDraftLock";
import {
  buildPrReviewConflictMarkerDraft,
  type PrReviewConflictDraft
} from "./pr-review-conflict-drafts";
import {
  applyAllPrReviewConflictSuggestion,
  buildPrReviewConflictSuggestionInput,
  getConflictResolutionText,
  isConflictResolutionComplete,
  updatePrReviewConflictSuggestion,
  type PrReviewConflictResolutionChoice
} from "./pr-review-conflict-resolution";
import type {
  PrReviewDiffRow,
  PrReviewConflictFile,
  PrReviewConflictDraftResolutionState,
  PrReviewConflictHunk,
  PrReviewConflictSuggestion,
  PrReviewDecisionUpdatedEvent,
  PrReviewFile,
  PrReviewFileDecisionStatus,
  PrReviewFileDiff,
  PrReviewFileFlowMembership,
  PrReviewFileRiskLevel,
  PrReviewFileReviewStatus,
  PrReviewUnsupportedConflictFile
} from "@/features/pr-review/types";
import type { CanvasRealtimeIdentity } from "@/shared/canvas-realtime/canvas-realtime-types";

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
type ConflictWorkspaceView = "conflict" | "resolved";

type PrReviewFileDiffDrawerProps = {
  apiClient: PrReviewApiClient;
  baseBranch: string | null;
  conflictAnalysisErrorMessage: string | null;
  conflictAnalysisStatus: ConflictAnalysisLoadStatus;
  conflictApplyDisabledReason: string | null;
  conflictApplyProgress: { ready: number; total: number };
  conflictDraft: PrReviewConflictDraft | null;
  conflictFile: PrReviewConflictFile | null;
  headBranch: string | null;
  isReviewRoomCompleted: boolean;
  isReviewVersionStale: boolean;
  isReviewSessionConflicted: boolean;
  onClose: () => void;
  onOpenConflictApply: () => void;
  onConflictDraftChange: (
    reviewFileId: string,
    draft: PrReviewConflictDraft
  ) => void;
  onRemoteConflictDraftUpdated: (draft: {
    reviewFileId: string;
    sourceHeadBlobSha: string;
    resolvedContent: string;
    resolutionState: PrReviewConflictDraftResolutionState;
    draftVersion: number;
    updatedByUserId: string;
    updatedAt: string;
  }) => void;
  onRemoteConflictDraftInvalidated: () => void;
  onDecisionSaved: (
    file: PrReviewFile,
    previousStatus: PrReviewFileReviewStatus
  ) => void;
  remoteDecisionUpdate: PrReviewDecisionUpdatedEvent | null;
  realtimeIdentity: CanvasRealtimeIdentity;
  reviewFileId: string;
  reviewRoomId: string;
  reviewSessionId: string;
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

function getConflictSuggestionErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes("currentDraft.resolvedContent must not contain conflict markers")
    ? "현재 충돌 초안을 AI에 전달하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요."
    : message;
}

function isReviewDecisionChangedError(error: unknown) {
  return (
    error instanceof PrReviewApiError &&
    error.status === 409 &&
    error.code === "REVIEW_DECISION_CHANGED"
  );
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
  conflictApplyDisabledReason,
  conflictApplyProgress,
  conflictDraft,
  conflictFile,
  headBranch,
  isReviewRoomCompleted,
  isReviewVersionStale,
  isReviewSessionConflicted,
  onClose,
  onOpenConflictApply,
  onConflictDraftChange,
  onRemoteConflictDraftUpdated,
  onRemoteConflictDraftInvalidated,
  onDecisionSaved,
  remoteDecisionUpdate,
  realtimeIdentity,
  reviewFileId,
  reviewRoomId,
  reviewSessionId,
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
  const [decisionConflictMessage, setDecisionConflictMessage] = useState<
    string | null
  >(null);
  const [conflictSuggestionStatus, setConflictSuggestionStatus] =
    useState<ConflictSuggestionLoadStatus>("idle");
  const [conflictSuggestionError, setConflictSuggestionError] = useState<
    string | null
  >(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedConflictHunkIndex, setSelectedConflictHunkIndex] = useState(0);
  const [isBaseComparisonOpen, setIsBaseComparisonOpen] = useState(false);
  const [conflictWorkspaceView, setConflictWorkspaceView] =
    useState<ConflictWorkspaceView>("conflict");
  const conflictSuggestion = conflictDraft?.suggestion ?? null;
  const resolvedContentDraft = conflictDraft?.resolvedContent ?? "";
  const resolutionChoices = conflictDraft?.resolutionChoices ?? {};
  const acceptedAiResolvedTexts =
    conflictDraft?.acceptedAiResolvedTexts ?? {};
  const manualResolvedTexts = conflictDraft?.manualResolvedTexts ?? {};
  const isResolvedDraftCustomized = conflictDraft?.isCustomized ?? false;
  const commentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const decisionVersionRef = useRef<number | null>(null);

  const clearScheduledCommentSave = useCallback(() => {
    if (commentSaveTimerRef.current) {
      clearTimeout(commentSaveTimerRef.current);
      commentSaveTimerRef.current = null;
    }
  }, []);

  const enqueueDecisionSave = useCallback(
    (nextStatus: PrReviewFileDecisionStatus, nextComment: string) => {
      const previousStatus = file?.currentStatus ?? "not_reviewed";
      const saveTask = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          setSaveStatus("saving");
          setSaveErrorMessage(null);
          setDecisionConflictMessage(null);

          const expectedDecisionVersion = decisionVersionRef.current;
          if (expectedDecisionVersion === null) {
            throw new Error("파일 판단 버전을 확인하지 못했습니다.");
          }

          const storedComment = getStoredComment(nextComment);
          const updatedFile = await apiClient.updateReviewFileDecision(
            workspaceId,
            reviewFileId,
            {
              comment: storedComment,
              status: nextStatus,
              expectedDecisionVersion
            }
          );
          const savedFile: PrReviewFile = {
            ...updatedFile,
            comment: storedComment,
            currentStatus: nextStatus
          };

          setFile(savedFile);
          decisionVersionRef.current = savedFile.decisionVersion;
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
        .catch(async (error) => {
          if (isReviewDecisionChangedError(error)) {
            try {
              const latestFile = await apiClient.getReviewFile(
                workspaceId,
                reviewFileId
              );
              setFile(latestFile);
              decisionVersionRef.current = latestFile.decisionVersion;
              setSaveStatus("idle");
              setSaveErrorMessage(null);
              setDecisionConflictMessage(
                "다른 리뷰어의 판단이 먼저 저장되어 최신 내용을 불러왔습니다."
              );
              onDecisionSaved(latestFile, previousStatus);
              return;
            } catch (refreshError) {
              setSaveStatus("error");
              setSaveErrorMessage(getErrorMessage(refreshError));
              return;
            }
          }

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
      setDecisionConflictMessage(null);
      setConflictSuggestionStatus("idle");
      setConflictSuggestionError(null);
      setConflictWorkspaceView("conflict");
      setFile(null);
      setDiff(null);
      decisionVersionRef.current = null;

      try {
        const [nextFile, nextDiff] = await Promise.all([
          apiClient.getReviewFile(workspaceId, reviewFileId),
          apiClient.getReviewFileDiff(workspaceId, reviewFileId)
        ]);

        if (cancelled) {
          return;
        }

        setFile(nextFile);
        decisionVersionRef.current = nextFile.decisionVersion;
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
    if (
      !file ||
      !remoteDecisionUpdate ||
      remoteDecisionUpdate.reviewFileId !== reviewFileId ||
      remoteDecisionUpdate.decisionVersion <= file.decisionVersion ||
      saveStatus === "saving"
    ) {
      return;
    }

    let cancelled = false;
    const hasLocalDraft =
      decisionStatus !== getInitialDecisionStatus(file) ||
      getStoredComment(comment) !== getStoredComment(file.comment ?? "");

    void apiClient
      .getReviewFile(workspaceId, reviewFileId)
      .then(latestFile => {
        if (cancelled) return;

        setFile(latestFile);
        decisionVersionRef.current = latestFile.decisionVersion;
        if (!hasLocalDraft) {
          setDecisionStatus(getInitialDecisionStatus(latestFile));
          setComment(latestFile.comment ?? "");
          setDecisionConflictMessage(null);
          return;
        }

        setDecisionConflictMessage(
          "다른 리뷰어의 판단이 업데이트되었습니다. 작성 중인 내용은 유지했습니다."
        );
      })
      .catch(error => {
        if (!cancelled) {
          setSaveErrorMessage(getErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiClient,
    comment,
    decisionStatus,
    file,
    remoteDecisionUpdate,
    reviewFileId,
    saveStatus,
    workspaceId
  ]);

  useEffect(() => {
    setSelectedConflictHunkIndex(0);
    setIsBaseComparisonOpen(false);
    setConflictWorkspaceView("conflict");
  }, [conflictFile?.reviewFileId]);

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
  const isReviewReadOnly = isReviewVersionStale || isReviewRoomCompleted;
  const {
    canEdit: canEditConflictDraft,
    editingOwnerUserId,
    isEditClaimPending,
    isEditing: isEditingConflictDraft,
    isRealtimeReady,
    releaseEdit: releaseConflictDraftEdit,
    startEdit: startConflictDraftEdit
  } = usePrReviewConflictDraftLock({
    apiClient,
    conflictFileId: conflictFile?.reviewFileId ?? null,
    onDraftInvalidated: onRemoteConflictDraftInvalidated,
    onDraftUpdated: onRemoteConflictDraftUpdated,
    realtimeIdentity,
    reviewRoomId,
    reviewSessionId,
    workspaceId
  });
  const decisionDisabled = isReviewReadOnly || decisionDisabledReason !== null;
  const selectedConflictHunk =
    conflictFile?.hunks[selectedConflictHunkIndex] ?? null;
  const aiResolvedHunks =
    conflictSuggestion?.status === "suggested"
      ? conflictSuggestion.resolvedHunks
      : [];
  const resolvedHunkCount = conflictFile
    ? conflictFile.hunks.filter((hunk) => Boolean(resolutionChoices[hunk.id])).length
    : 0;
  const resolutionComplete = conflictFile
    ? isConflictResolutionComplete({
        hunks: conflictFile.hunks,
        choices: resolutionChoices,
        acceptedAiResolvedTexts,
        manualResolvedTexts
      })
    : false;
  const drawerModeLabel = isReviewRoomCompleted
    ? "완료된 PR"
    : isReviewVersionStale
      ? "이전 버전"
    : decisionDisabled
      ? "Conflict 해결"
      : "파일 경로";

  const rebuildResolvedDraft = useCallback(
    (
      nextChoices: Record<string, PrReviewConflictResolutionChoice>,
      nextAcceptedAiResolvedTexts = acceptedAiResolvedTexts,
      nextManualResolvedTexts = manualResolvedTexts
    ) => {
      if (!conflictFile || !conflictDraft || isReviewReadOnly) {
        return;
      }

      onConflictDraftChange(conflictFile.reviewFileId, {
        ...conflictDraft,
        resolutionChoices: nextChoices,
        acceptedAiResolvedTexts: nextAcceptedAiResolvedTexts,
        manualResolvedTexts: nextManualResolvedTexts,
        resolvedContent: buildPrReviewConflictMarkerDraft(
          conflictFile,
          Object.fromEntries(
            conflictFile.hunks.flatMap((hunk) => {
              const choice = nextChoices[hunk.id];
              if (!choice) {
                return [];
              }

              const resolvedText = getConflictResolutionText({
                hunk,
                choice,
                acceptedAiResolvedTexts: nextAcceptedAiResolvedTexts,
                manualResolvedTexts: nextManualResolvedTexts
              });

              return resolvedText === null ? [] : [[hunk.id, resolvedText]];
            })
          )
        ),
        isCustomized: false
      });
    },
    [
      acceptedAiResolvedTexts,
      conflictDraft,
      conflictFile,
      isReviewReadOnly,
      manualResolvedTexts,
      onConflictDraftChange
    ]
  );

  const handleResolutionChoiceChange = useCallback(
    (hunkId: string, choice: PrReviewConflictResolutionChoice) => {
      if (!conflictFile || isResolvedDraftCustomized || isReviewReadOnly) {
        return;
      }

      const hunk = conflictFile.hunks.find((candidate) => candidate.id === hunkId);
      if (!hunk) {
        return;
      }

      let nextAcceptedAiResolvedTexts = acceptedAiResolvedTexts;
      let nextManualResolvedTexts = manualResolvedTexts;
      if (choice === "ai") {
        const suggestionText = aiResolvedHunks.find(
          (candidate) => candidate.hunkId === hunkId
        )?.resolvedText;
        if (suggestionText === undefined) {
          return;
        }
        nextAcceptedAiResolvedTexts = {
          ...acceptedAiResolvedTexts,
          [hunkId]: suggestionText
        };
      }
      if (choice === "manual" && !Object.hasOwn(manualResolvedTexts, hunkId)) {
        const currentChoice = resolutionChoices[hunkId];
        const initialText = currentChoice
          ? getConflictResolutionText({
              hunk,
              choice: currentChoice,
              acceptedAiResolvedTexts,
              manualResolvedTexts
            })
          : null;
        nextManualResolvedTexts = {
          ...manualResolvedTexts,
          [hunkId]: initialText ?? hunk.incomingText
        };
      }

      const nextChoices = {
        ...resolutionChoices,
        [hunkId]: choice
      };
      rebuildResolvedDraft(
        nextChoices,
        nextAcceptedAiResolvedTexts,
        nextManualResolvedTexts
      );
    },
    [
      acceptedAiResolvedTexts,
      aiResolvedHunks,
      conflictFile,
      isResolvedDraftCustomized,
      isReviewReadOnly,
      manualResolvedTexts,
      rebuildResolvedDraft,
      resolutionChoices
    ]
  );

  const handleResetCustomizedDraft = useCallback(() => {
    if (isReviewReadOnly) {
      return;
    }
    rebuildResolvedDraft(resolutionChoices);
  }, [isReviewReadOnly, rebuildResolvedDraft, resolutionChoices]);

  const handleResolutionChoiceReset = useCallback(
    (hunkId: string) => {
      if (isResolvedDraftCustomized || isReviewReadOnly) {
        return;
      }

      const nextChoices = { ...resolutionChoices };
      const nextAcceptedAiResolvedTexts = { ...acceptedAiResolvedTexts };
      const nextManualResolvedTexts = { ...manualResolvedTexts };
      delete nextChoices[hunkId];
      delete nextAcceptedAiResolvedTexts[hunkId];
      delete nextManualResolvedTexts[hunkId];
      rebuildResolvedDraft(
        nextChoices,
        nextAcceptedAiResolvedTexts,
        nextManualResolvedTexts
      );
    },
    [
      acceptedAiResolvedTexts,
      isResolvedDraftCustomized,
      isReviewReadOnly,
      manualResolvedTexts,
      rebuildResolvedDraft,
      resolutionChoices
    ]
  );

  const handleManualResolutionChange = useCallback(
    (hunkId: string, resolvedText: string) => {
      if (!conflictFile || isResolvedDraftCustomized || isReviewReadOnly) {
        return;
      }

      const nextChoices = {
        ...resolutionChoices,
        [hunkId]: "manual" as const
      };
      rebuildResolvedDraft(nextChoices, acceptedAiResolvedTexts, {
        ...manualResolvedTexts,
        [hunkId]: resolvedText
      });
    },
    [
      acceptedAiResolvedTexts,
      conflictFile,
      isResolvedDraftCustomized,
      isReviewReadOnly,
      manualResolvedTexts,
      rebuildResolvedDraft,
      resolutionChoices
    ]
  );

  const handleCreateConflictSuggestion = useCallback(async () => {
    if (
      !conflictFile ||
      conflictSuggestionStatus === "loading" ||
      isReviewReadOnly ||
      !isEditingConflictDraft
    ) {
      return;
    }

    setConflictSuggestionStatus("loading");
    setConflictSuggestionError(null);

    try {
      const suggestion = await apiClient.createReviewFileConflictSuggestion(
        workspaceId,
        conflictFile.reviewFileId,
        conflictDraft
          ? buildPrReviewConflictSuggestionInput(conflictFile, conflictDraft)
          : undefined
      );
      if (!conflictDraft) {
        throw new Error("Conflict draft is not ready");
      }
      onConflictDraftChange(conflictFile.reviewFileId, {
        ...updatePrReviewConflictSuggestion(conflictDraft, suggestion)
      });
      setConflictSuggestionStatus("ready");
    } catch (error) {
      setConflictSuggestionStatus("error");
      setConflictSuggestionError(getConflictSuggestionErrorMessage(error));
    }
  }, [
    apiClient,
    conflictDraft,
    conflictFile,
    conflictSuggestionStatus,
    isEditingConflictDraft,
    isReviewReadOnly,
    onConflictDraftChange,
    workspaceId
  ]);

  const handleApplyAllAiSuggestions = useCallback(() => {
    if (
      !conflictFile ||
      !conflictSuggestion ||
      conflictSuggestion.status === "invalid" ||
      isResolvedDraftCustomized ||
      isReviewReadOnly ||
      !isEditingConflictDraft
    ) {
      return;
    }

    if (!conflictDraft) {
      return;
    }
    onConflictDraftChange(
      conflictFile.reviewFileId,
      applyAllPrReviewConflictSuggestion(
        conflictFile,
        conflictDraft,
        conflictSuggestion
      )
    );
    setConflictWorkspaceView("resolved");
  }, [
    conflictDraft,
    conflictFile,
    conflictSuggestion,
    isResolvedDraftCustomized,
    isEditingConflictDraft,
    isReviewReadOnly,
    onConflictDraftChange
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
                        hunk => hunk.hunkId === selectedConflictHunk.id
                      )?.resolvedText ?? null
                    }
                    baseBranch={baseBranch}
                    choice={resolutionChoices[selectedConflictHunk.id] ?? null}
                    filePath={file.filePath}
                    headBranch={headBranch}
                    hunk={selectedConflictHunk}
                    hunkCount={conflictFile.hunks.length}
                    hunkIndex={selectedConflictHunkIndex}
                    isBaseComparisonOpen={isBaseComparisonOpen}
                    isChoiceDisabled={
                      isReviewReadOnly || isResolvedDraftCustomized
                    }
                    manualResolvedText={
                      manualResolvedTexts[selectedConflictHunk.id] ??
                      selectedConflictHunk.incomingText
                    }
                    onChoiceChange={choice =>
                      handleResolutionChoiceChange(selectedConflictHunk.id, choice)
                    }
                    onChoiceReset={() =>
                      handleResolutionChoiceReset(selectedConflictHunk.id)
                    }
                    onHunkIndexChange={setSelectedConflictHunkIndex}
                    onManualResolvedTextChange={value =>
                      handleManualResolutionChange(selectedConflictHunk.id, value)
                    }
                    onResetCustomizedDraft={handleResetCustomizedDraft}
                    onToggleBaseComparison={() =>
                      setIsBaseComparisonOpen(open => !open)
                    }
                  />
                ) : (
                  <ResolvedDraftWorkspace
                    canStartEditing={canEditConflictDraft}
                    editingOwnerUserId={editingOwnerUserId}
                    filePath={file.filePath}
                    isCustomized={isResolvedDraftCustomized}
                    isEditClaimPending={isEditClaimPending}
                    isEditing={isEditingConflictDraft}
                    isRealtimeReady={isRealtimeReady}
                    isReviewReadOnly={isReviewReadOnly}
                    onChange={(value) => {
                      if (
                        isReviewReadOnly ||
                        !isEditingConflictDraft ||
                        !conflictDraft ||
                        value === conflictDraft.resolvedContent
                      ) {
                        return;
                      }
                      onConflictDraftChange(conflictFile.reviewFileId, {
                        ...conflictDraft,
                        resolvedContent: value,
                        isCustomized: true
                      });
                    }}
                    onFinishEditing={releaseConflictDraftEdit}
                    onStartEditing={startConflictDraftEdit}
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
              conflictApplyDisabledReason={conflictApplyDisabledReason}
              conflictApplyProgress={conflictApplyProgress}
              decisionConflictMessage={decisionConflictMessage}
              decisionStatus={decisionStatus}
              decisionDisabledReason={decisionDisabledReason}
              file={file}
              isConflictDraftEditing={isEditingConflictDraft}
              isResolvedDraftCustomized={isResolvedDraftCustomized}
              isReviewReadOnly={isReviewReadOnly}
              isReviewRoomCompleted={isReviewRoomCompleted}
              onCommentChange={(value) => {
                setComment(value);
                setSaveStatus("idle");
                scheduleCommentSave(value);
              }}
              onCommentBlur={flushCommentSave}
              onApplyAllAiSuggestions={handleApplyAllAiSuggestions}
              onCreateConflictSuggestion={handleCreateConflictSuggestion}
              onDecisionStatusChange={handleDecisionStatusChange}
              onOpenConflictApply={onOpenConflictApply}
              onOpenResolvedDraft={() => setConflictWorkspaceView("resolved")}
              resolutionComplete={resolutionComplete}
              resolvedHunkCount={resolvedHunkCount}
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
            이전 경로: {file.previousFilePath}
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
  conflictSuggestion,
  conflictSuggestionErrorMessage,
  conflictSuggestionStatus,
  conflictApplyDisabledReason,
  conflictApplyProgress,
  decisionConflictMessage,
  decisionStatus,
  decisionDisabledReason,
  file,
  isConflictDraftEditing,
  isResolvedDraftCustomized,
  isReviewReadOnly,
  isReviewRoomCompleted,
  onCommentBlur,
  onCommentChange,
  onApplyAllAiSuggestions,
  onCreateConflictSuggestion,
  onDecisionStatusChange,
  onOpenConflictApply,
  onOpenResolvedDraft,
  resolutionComplete,
  resolvedHunkCount,
  saveErrorMessage,
  saveStatus,
  selectedDecisionLabel,
  unsupportedConflictFile
}: {
  comment: string;
  conflictFile: PrReviewConflictFile | null;
  conflictSuggestion: PrReviewConflictSuggestion | null;
  conflictSuggestionErrorMessage: string | null;
  conflictSuggestionStatus: ConflictSuggestionLoadStatus;
  conflictApplyDisabledReason: string | null;
  conflictApplyProgress: { ready: number; total: number };
  decisionConflictMessage: string | null;
  decisionStatus: PrReviewFileDecisionStatus | null;
  decisionDisabledReason: string | null;
  file: PrReviewFile;
  isConflictDraftEditing: boolean;
  isResolvedDraftCustomized: boolean;
  isReviewReadOnly: boolean;
  isReviewRoomCompleted: boolean;
  onCommentBlur: () => void;
  onCommentChange: (value: string) => void;
  onApplyAllAiSuggestions: () => void;
  onCreateConflictSuggestion: () => void;
  onDecisionStatusChange: (status: PrReviewFileDecisionStatus) => void;
  onOpenConflictApply: () => void;
  onOpenResolvedDraft: () => void;
  resolutionComplete: boolean;
  resolvedHunkCount: number;
  saveErrorMessage: string | null;
  saveStatus: SaveStatus;
  selectedDecisionLabel: string;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
}) {
  const decisionDisabled = isReviewReadOnly || decisionDisabledReason !== null;

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
                ? "미리뷰"
                : decisionLabelByStatus[file.currentStatus]}
            </span>
          </div>
        </section>

        {isReviewReadOnly ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {isReviewRoomCompleted
              ? "PR이 종료되어 이 파일은 읽기 전용입니다. 내용은 확인할 수 있지만 수정하거나 저장할 수 없습니다."
              : "새 커밋이 감지되어 이 파일은 이전 리뷰 버전으로 열렸습니다. 내용은 확인할 수 있지만 수정하거나 저장할 수 없습니다."}
          </section>
        ) : null}

        {decisionDisabledReason ? (
          <ConflictResolutionPanel
            conflictFile={conflictFile}
            conflictSuggestion={conflictSuggestion}
            conflictSuggestionErrorMessage={conflictSuggestionErrorMessage}
            conflictSuggestionStatus={conflictSuggestionStatus}
            conflictApplyDisabledReason={conflictApplyDisabledReason}
            conflictApplyProgress={conflictApplyProgress}
            isConflictDraftEditing={isConflictDraftEditing}
            isResolvedDraftCustomized={isResolvedDraftCustomized}
            isReviewReadOnly={isReviewReadOnly}
            onApplyAllAiSuggestions={onApplyAllAiSuggestions}
            onCreateConflictSuggestion={onCreateConflictSuggestion}
            onOpenResolvedDraft={onOpenResolvedDraft}
            onOpenConflictApply={onOpenConflictApply}
            reason={decisionDisabledReason}
            resolutionComplete={resolutionComplete}
            resolvedHunkCount={resolvedHunkCount}
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
            현재 판단
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {selectedDecisionLabel}
          </p>
          {file.decisionCarriedOver ? (
            <p className="mt-1 text-xs font-medium text-blue-700">
              이전 버전에서 유지된 판단입니다.
            </p>
          ) : null}
          <p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            {saveStatus === "saving" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {decisionDisabled
              ? isReviewReadOnly
                ? isReviewRoomCompleted
                  ? "PR 종료"
                  : "새 버전 분석 필요"
                : "Conflict 해결 필요"
              : getSaveStatusLabel(saveStatus)}
          </p>
        </div>

        {isReviewReadOnly ? (
          <p className="mt-3 text-sm leading-6 text-amber-700">
            {isReviewRoomCompleted
              ? "PR이 종료되어 이 리뷰 공간은 읽기 전용입니다."
              : "새 커밋이 감지되어 이 리뷰 버전은 읽기 전용입니다."}
          </p>
        ) : decisionDisabledReason ? (
          <p className="mt-3 text-sm leading-6 text-amber-700">
            {decisionDisabledReason}
          </p>
        ) : decisionConflictMessage ? (
          <p className="mt-3 text-sm leading-6 text-blue-700">
            {decisionConflictMessage}
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
  conflictSuggestion,
  conflictSuggestionErrorMessage,
  conflictSuggestionStatus,
  conflictApplyDisabledReason,
  conflictApplyProgress,
  isConflictDraftEditing,
  isResolvedDraftCustomized,
  isReviewReadOnly,
  onApplyAllAiSuggestions,
  onCreateConflictSuggestion,
  onOpenResolvedDraft,
  onOpenConflictApply,
  reason,
  resolutionComplete,
  resolvedHunkCount,
  unsupportedConflictFile
}: {
  conflictFile: PrReviewConflictFile | null;
  conflictSuggestion: PrReviewConflictSuggestion | null;
  conflictSuggestionErrorMessage: string | null;
  conflictSuggestionStatus: ConflictSuggestionLoadStatus;
  conflictApplyDisabledReason: string | null;
  conflictApplyProgress: { ready: number; total: number };
  isConflictDraftEditing: boolean;
  isResolvedDraftCustomized: boolean;
  isReviewReadOnly: boolean;
  onApplyAllAiSuggestions: () => void;
  onCreateConflictSuggestion: () => void;
  onOpenResolvedDraft: () => void;
  onOpenConflictApply: () => void;
  reason: string;
  resolutionComplete: boolean;
  resolvedHunkCount: number;
  unsupportedConflictFile: PrReviewUnsupportedConflictFile | null;
}) {
  const isSuggestionLoading = conflictSuggestionStatus === "loading";

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
        <AlertCircle className="size-4 shrink-0" />
        Conflict 해결
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">{reason}</p>
      {unsupportedConflictFile ? (
        <p className="mt-2 text-xs leading-5 text-amber-800">
          이 파일은 후속 Conflict 유형 지원 단계에서 처리합니다.
        </p>
      ) : null}
      {conflictFile ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-800">
                  AI 초안
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {conflictSuggestion
                    ? conflictSuggestion.status === "invalid"
                      ? "검증 실패"
                      : "초안 준비됨"
                    : "초안 없음"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {conflictSuggestion ? (
                  <Button
                    disabled={
                      conflictSuggestion.status === "invalid" ||
                      isResolvedDraftCustomized ||
                      isReviewReadOnly ||
                      !isConflictDraftEditing
                    }
                    onClick={onApplyAllAiSuggestions}
                    size="sm"
                    type="button"
                  >
                    AI 해결안 전체 사용
                  </Button>
                ) : null}
                <Button
                  disabled={
                    isSuggestionLoading ||
                    isReviewReadOnly ||
                    !isConflictDraftEditing
                  }
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
                  {conflictSuggestion
                    ? "AI 해결안 다시 생성"
                    : "AI 해결안 생성"}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {isConflictDraftEditing
                ? "AI는 현재 hunk 선택과 직접 편집 내용을 참고해 새 해결안만 만듭니다. 기존 선택과 코드는 자동으로 바뀌지 않습니다."
                : "AI 해결안을 만들거나 전체 사용하려면 전체 코드 보기에서 코드 편집을 시작해 편집 권한을 얻어야 합니다."}
            </p>
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
                  해결 진행도
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-950">
                  {resolvedHunkCount} / {conflictFile.hunks.length} 구간 선택
                </p>
              </div>
              <Button onClick={onOpenResolvedDraft} size="sm" type="button" variant="outline">
                최종 코드 보기
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "rounded-lg border px-3 py-3",
              resolutionComplete
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-white text-amber-900"
            )}
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4" />
              {resolutionComplete ? "이 파일은 해결 준비됨" : "해결 선택 진행 중"}
            </p>
            <p className="mt-1 text-xs leading-5">
              {resolutionComplete
                ? "다른 Conflict 파일도 준비되면 상단에서 전체 적용할 수 있습니다."
                : "모든 Conflict 구간의 해결 방식을 선택해 주세요."}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  GitHub 적용
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-950">
                  {conflictApplyProgress.ready} / {conflictApplyProgress.total} 파일 준비됨
                </p>
              </div>
              <Button
                disabled={Boolean(conflictApplyDisabledReason)}
                onClick={onOpenConflictApply}
                size="sm"
                type="button"
              >
                <GitMerge className="size-3.5" />
                GitHub에 전체 적용
              </Button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              준비한 모든 Conflict 파일을 merge commit 하나로 PR 브랜치에 적용합니다.
            </p>
            {conflictApplyDisabledReason ? (
              <p className="mt-2 text-xs leading-5 text-amber-700">
                {conflictApplyDisabledReason}
              </p>
            ) : null}
          </div>
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
          Conflict 해결
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
          전체 코드 보기
        </button>
      </div>
      <p className="text-xs font-medium text-slate-500">
        해결 선택 {resolvedHunkCount} / {totalHunkCount}
      </p>
    </div>
  );
}

function ResolvedDraftWorkspace({
  canStartEditing,
  editingOwnerUserId,
  filePath,
  isCustomized,
  isEditClaimPending,
  isEditing,
  isRealtimeReady,
  isReviewReadOnly,
  onChange,
  onFinishEditing,
  onStartEditing,
  value
}: {
  canStartEditing: boolean;
  editingOwnerUserId: string | null;
  filePath: string;
  isCustomized: boolean;
  isEditClaimPending: boolean;
  isEditing: boolean;
  isRealtimeReady: boolean;
  isReviewReadOnly: boolean;
  onChange: (value: string) => void;
  onFinishEditing: () => void;
  onStartEditing: () => void;
  value: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{filePath}</p>
          <p className="mt-1 text-xs text-slate-500">
            선택한 해결 결과와 아직 해결하지 않은 Conflict marker를 함께 보여줍니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCustomized ? (
            <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
              직접 편집됨
            </span>
          ) : null}
          {!isReviewReadOnly ? (
            isEditing ? (
              <Button onClick={onFinishEditing} size="sm" type="button" variant="outline">
                편집 완료
              </Button>
            ) : (
              <Button
                disabled={!canStartEditing}
                onClick={onStartEditing}
                size="sm"
                type="button"
              >
                <Pencil className="size-3.5" />
                {isEditClaimPending
                  ? "편집 권한 확인 중"
                  : !isRealtimeReady
                    ? "실시간 연결 중"
                    : editingOwnerUserId
                      ? "다른 참여자가 편집 중"
                      : "코드 편집 시작"}
              </Button>
            )
          ) : null}
        </div>
      </header>
      <div className="flex shrink-0 items-center border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        {isEditing
          ? "코드 편집 중입니다. 저장된 변경 내용은 다른 참여자에게 바로 반영됩니다."
          : editingOwnerUserId
            ? "다른 참여자가 코드 편집 중입니다. 현재 내용은 읽기 전용입니다."
            : "전체 코드를 읽기 전용으로 보고 있습니다. 수정하려면 코드 편집을 시작하세요."}
      </div>
      <PrReviewResolvedCodeEditor
        changedLineNumbers={[]}
        filePath={filePath}
        onChange={onChange}
        readOnly={!isEditing}
        revealLine={null}
        revealRequestId={0}
        value={value}
      />
    </section>
  );
}

function ConflictHunkComparison({
  aiResolvedText,
  baseBranch,
  choice,
  filePath,
  headBranch,
  hunk,
  hunkCount,
  hunkIndex,
  isBaseComparisonOpen,
  isChoiceDisabled,
  manualResolvedText,
  onChoiceChange,
  onChoiceReset,
  onHunkIndexChange,
  onManualResolvedTextChange,
  onResetCustomizedDraft,
  onToggleBaseComparison
}: {
  aiResolvedText: string | null;
  baseBranch: string | null;
  choice: PrReviewConflictResolutionChoice | null;
  filePath: string;
  headBranch: string | null;
  hunk: PrReviewConflictHunk;
  hunkCount: number;
  hunkIndex: number;
  isBaseComparisonOpen: boolean;
  isChoiceDisabled: boolean;
  manualResolvedText: string;
  onChoiceChange: (choice: PrReviewConflictResolutionChoice) => void;
  onChoiceReset: () => void;
  onHunkIndexChange: (index: number) => void;
  onManualResolvedTextChange: (value: string) => void;
  onResetCustomizedDraft: () => void;
  onToggleBaseComparison: () => void;
}) {
  const targetBranchLabel = baseBranch ?? "대상 브랜치";
  const headBranchLabel = headBranch ?? "PR 브랜치";
  const choices: Array<{
    label: string;
    value: PrReviewConflictResolutionChoice;
    disabled?: boolean;
  }> = [
    {
      label: "AI 해결안 사용",
      value: "ai",
      disabled: aiResolvedText === null
    },
    { label: "PR 브랜치 선택", value: "pr" },
    { label: "대상 브랜치 선택", value: "target" },
    { label: "둘 다 선택", value: "both" }
  ];

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-amber-700">
            Conflict 구간
          </p>
          <p className="mt-1 font-mono text-xs text-slate-600">{hunk.header}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="이전 Conflict 구간"
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
            aria-label="다음 Conflict 구간"
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
            {isBaseComparisonOpen ? "공통 원본 숨기기" : "공통 원본 보기"}
          </Button>
        </div>
      </div>

      {hunkCount > 1 ? (
        <div aria-label="Conflict 구간 선택" className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: hunkCount }, (_, index) => (
            <Button
              key={index}
              onClick={() => onHunkIndexChange(index)}
              size="sm"
              type="button"
              variant={index === hunkIndex ? "default" : "outline"}
            >
              구간 {index + 1}
            </Button>
          ))}
        </div>
      ) : null}

      {isChoiceDisabled ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm leading-6 text-blue-900">
            전체 코드에서 직접 수정한 내용이 있습니다. hunk 해결 방식을 다시 선택하려면 직접 수정한 내용을 버리고 hunk 결과로 복원해야 합니다.
          </p>
          <Button onClick={onResetCustomizedDraft} size="sm" type="button" variant="outline">
            hunk 결과로 복원
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Conflict 구간 해결 방식">
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
        {choice ? (
          <Button
            disabled={isChoiceDisabled}
            onClick={onChoiceReset}
            size="sm"
            type="button"
            variant="outline"
          >
            선택 취소
          </Button>
        ) : null}
      </div>

      {aiResolvedText !== null ? (
        <ConflictAiResolutionPreview value={aiResolvedText} />
      ) : null}

      {choice === "manual" ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Pencil className="size-4" />
            이 hunk 직접 편집
          </p>
          <div className="mt-2 h-64 overflow-hidden rounded-md border border-slate-200 bg-white">
            <PrReviewResolvedCodeEditor
              changedLineNumbers={[]}
              filePath={filePath}
              key={hunk.id}
              onChange={onManualResolvedTextChange}
              readOnly={isChoiceDisabled}
              revealLine={null}
              revealRequestId={0}
              value={manualResolvedText}
            />
          </div>
        </div>
      ) : null}

      <ConflictUnifiedCodePane
        headBranchLabel={headBranchLabel}
        hunk={hunk}
        isBaseComparisonOpen={isBaseComparisonOpen}
        targetBranchLabel={targetBranchLabel}
      />
    </section>
  );
}

function ConflictAiResolutionPreview({ value }: { value: string }) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-violet-200 bg-white">
      <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-950">
        <Sparkles className="size-4" />
        AI 해결안
      </div>
      <div className="max-h-56 overflow-auto">
        <div className="min-w-max text-xs leading-5">
          <ConflictCodeRows lineStart={1} tone="ai" value={value} />
        </div>
      </div>
    </section>
  );
}

function ConflictUnifiedCodePane({
  headBranchLabel,
  hunk,
  isBaseComparisonOpen,
  targetBranchLabel
}: {
  headBranchLabel: string;
  hunk: PrReviewConflictHunk;
  isBaseComparisonOpen: boolean;
  targetBranchLabel: string;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="max-h-[calc(100vh-330px)] overflow-auto">
        <div className="min-w-max text-xs leading-5">
          <ConflictMarkerRow label={`<<<<<<< PR 브랜치: ${headBranchLabel}`} />
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
          <ConflictMarkerRow label={`>>>>>>> 대상 브랜치: ${targetBranchLabel}`} />
          {isBaseComparisonOpen ? (
            <>
              <ConflictMarkerRow label="공통 원본(Base)" tone="base" />
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
    emptyMessage: "변경 전 내용이 없습니다.",
    lineLabel: "이전",
    title: "변경 전"
  },
  new: {
    emptyMessage: "변경 후 내용이 없습니다.",
    lineLabel: "이후",
    title: "변경 후"
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
