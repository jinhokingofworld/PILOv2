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
  ExternalLink,
  FileText,
  GitBranch,
  HelpCircle,
  Loader2,
  MessageSquareWarning,
  RefreshCcw
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { createPrReviewApiClient } from "@/features/pr-review/api/client";
import type {
  PrReviewDiffRow,
  PrReviewFile,
  PrReviewFileDecisionStatus,
  PrReviewFileDiff,
  PrReviewFileFlowMembership,
  PrReviewFileRiskLevel
} from "@/features/pr-review/types";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type FileReviewStatus = "idle" | "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type PrReviewFileDiffDrawerProps = {
  apiClient: PrReviewApiClient;
  onClose: () => void;
  onDecisionSaved: (file: PrReviewFile) => void;
  reviewFileId: string;
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

export function PrReviewFileDiffDrawer({
  apiClient,
  onClose,
  onDecisionSaved,
  reviewFileId,
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
  const [reloadVersion, setReloadVersion] = useState(0);
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
          onDecisionSaved(savedFile);
        })
        .catch((error) => {
          setSaveStatus("error");
          setSaveErrorMessage(getErrorMessage(error));
        });

      saveQueueRef.current = saveTask;

      return saveTask;
    },
    [apiClient, onDecisionSaved, reviewFileId, workspaceId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadReviewFile() {
      clearScheduledCommentSave();
      setStatus("loading");
      setSaveStatus("idle");
      setErrorMessage(null);
      setSaveErrorMessage(null);
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

  const selectedDecision = useMemo(
    () => decisionOptions.find((option) => option.status === decisionStatus),
    [decisionStatus]
  );

  function scheduleCommentSave(nextComment: string) {
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
    if (!decisionStatus) {
      return;
    }

    clearScheduledCommentSave();
    void enqueueDecisionSave(decisionStatus, comment);
  }

  function handleDecisionStatusChange(nextStatus: PrReviewFileDecisionStatus) {
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
          <span className="shrink-0 font-medium text-slate-500">파일 경로</span>
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
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50">
            <FileDiffHeader file={file} />
            <Separator />
            <DiffView diff={diff} />
          </section>

          <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-white lg:w-[400px] lg:border-l lg:border-t-0">
            <ReviewNodePanel
              comment={comment}
              decisionStatus={decisionStatus}
              file={file}
              onCommentChange={(value) => {
                setComment(value);
                setSaveStatus("idle");
                scheduleCommentSave(value);
              }}
              onCommentBlur={flushCommentSave}
              onDecisionStatusChange={handleDecisionStatusChange}
              saveErrorMessage={saveErrorMessage}
              saveStatus={saveStatus}
              selectedDecisionLabel={selectedDecision?.label ?? "아직 선택 안 됨"}
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
    <section className="space-y-4 bg-white px-5 py-4">
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
  decisionStatus,
  file,
  onCommentBlur,
  onCommentChange,
  onDecisionStatusChange,
  saveErrorMessage,
  saveStatus,
  selectedDecisionLabel
}: {
  comment: string;
  decisionStatus: PrReviewFileDecisionStatus | null;
  file: PrReviewFile;
  onCommentBlur: () => void;
  onCommentChange: (value: string) => void;
  onDecisionStatusChange: (status: PrReviewFileDecisionStatus) => void;
  saveErrorMessage: string | null;
  saveStatus: SaveStatus;
  selectedDecisionLabel: string;
}) {
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
            className="mt-2 min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
            onBlur={onCommentBlur}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="파일 리뷰 코멘트를 남겨주세요."
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
                  selected
                    ? "border-blue-500 bg-blue-50 text-blue-950"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
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
            {getSaveStatusLabel(saveStatus)}
          </p>
        </div>

        {saveErrorMessage ? (
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
