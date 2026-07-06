"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquareWarning,
  RefreshCcw,
  Save,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { createPrReviewApiClient } from "@/features/pr-review/api/client";
import type {
  PrReviewDiffRow,
  PrReviewFile,
  PrReviewFileDecisionStatus,
  PrReviewFileDiff
} from "@/features/pr-review/types";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type DrawerStatus = "idle" | "loading" | "ready" | "error";
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
    label: "Approve",
    description: "이 파일 변경은 바로 통과해도 됩니다.",
    icon: CheckCircle2
  },
  {
    status: "discussion_needed",
    label: "Discuss",
    description: "확인하거나 수정해야 할 지점이 있습니다.",
    icon: MessageSquareWarning
  },
  {
    status: "unknown",
    label: "Unknown",
    description: "지금은 판단을 보류합니다.",
    icon: HelpCircle
  }
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "파일 리뷰 정보를 불러오지 못했습니다.";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function getInitialDecisionStatus(file: PrReviewFile) {
  return file.currentStatus === "not_reviewed" ? "approved" : file.currentStatus;
}

function getRowClassName(type: PrReviewDiffRow["type"]) {
  switch (type) {
    case "added":
      return "bg-emerald-50/80";
    case "deleted":
      return "bg-rose-50/80";
    case "unchanged":
      return "bg-white";
  }
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

export function PrReviewFileDiffDrawer({
  apiClient,
  onClose,
  onDecisionSaved,
  reviewFileId,
  workspaceId
}: PrReviewFileDiffDrawerProps) {
  const [status, setStatus] = useState<DrawerStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [file, setFile] = useState<PrReviewFile | null>(null);
  const [diff, setDiff] = useState<PrReviewFileDiff | null>(null);
  const [decisionStatus, setDecisionStatus] =
    useState<PrReviewFileDecisionStatus>("approved");
  const [comment, setComment] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReviewFile() {
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
  }, [apiClient, reloadVersion, reviewFileId, workspaceId]);

  const selectedDecision = useMemo(
    () => decisionOptions.find((option) => option.status === decisionStatus),
    [decisionStatus]
  );

  async function saveDecision() {
    setSaveStatus("saving");
    setSaveErrorMessage(null);

    try {
      const updatedFile = await apiClient.updateReviewFileDecision(
        workspaceId,
        reviewFileId,
        {
          comment: comment.trim() || null,
          status: decisionStatus
        }
      );

      setFile(updatedFile);
      setDecisionStatus(getInitialDecisionStatus(updatedFile));
      setComment(updatedFile.comment ?? "");
      setSaveStatus("saved");
      onDecisionSaved(updatedFile);
    } catch (error) {
      setSaveStatus("error");
      setSaveErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-4xl flex-col border-l border-slate-200 bg-white shadow-2xl md:w-[72%]">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-blue-600">
            Review file
          </p>
          <h2 className="truncate text-base font-semibold text-slate-950">
            {file?.filePath ?? "파일 리뷰"}
          </h2>
        </div>
        <Button onClick={onClose} size="icon-sm" type="button" variant="ghost">
          <X className="size-4" />
          <span className="sr-only">닫기</span>
        </Button>
      </header>

      {status === "loading" || status === "idle" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin text-blue-600" />
            파일 diff 불러오는 중
          </div>
        </div>
      ) : status === "error" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-rose-200 px-5 py-4 text-center">
            <AlertCircle className="mx-auto size-8 text-rose-600" />
            <h3 className="mt-3 text-base font-semibold">
              파일 리뷰 정보를 불러오지 못했습니다
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {errorMessage ?? "잠시 후 다시 시도해 주세요."}
            </p>
            <Button
              className="mt-4"
              onClick={() => setReloadVersion((version) => version + 1)}
              type="button"
              variant="outline"
            >
              <RefreshCcw className="size-4" />
              다시 시도
            </Button>
          </div>
        </div>
      ) : file && diff ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileSummary file={file} />
            <Separator />
            <DiffView diff={diff} />
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
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
                        onClick={() => {
                          setDecisionStatus(option.status);
                          setSaveStatus("idle");
                        }}
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
                <textarea
                  className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                  onChange={(event) => {
                    setComment(event.target.value);
                    setSaveStatus("idle");
                  }}
                  placeholder="파일 리뷰 코멘트를 남겨주세요."
                  value={comment}
                />
                {saveErrorMessage ? (
                  <p className="text-sm text-rose-600">{saveErrorMessage}</p>
                ) : saveStatus === "saved" ? (
                  <p className="text-sm text-emerald-600">
                    파일 판단이 저장되었습니다.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Current decision
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {selectedDecision?.label ?? decisionStatus}
                  </p>
                </div>
                <Button
                  disabled={saveStatus === "saving"}
                  onClick={() => void saveDecision()}
                  type="button"
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  판단 저장
                </Button>
              </div>
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}

function FileSummary({ file }: { file: PrReviewFile }) {
  return (
    <section className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
          <FileText className="size-3.5" />
          {file.fileStatus}
        </span>
        <span className="text-emerald-600">+{formatNumber(file.additions)}</span>
        <span className="text-rose-500">-{formatNumber(file.deletions)}</span>
        {file.previousFilePath ? (
          <span className="truncate">from {file.previousFilePath}</span>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            변경 이유
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {file.changeReason ?? "변경 이유 분석 결과가 아직 없습니다."}
          </p>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            변경 요약
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {file.changeSummary ?? "변경 요약 분석 결과가 아직 없습니다."}
          </p>
        </section>
      </div>

      {file.reviewPoints.length ? (
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            리뷰 포인트
          </p>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {file.reviewPoints.map((point, index) => (
              <li className="flex gap-2" key={`${point}-${index}`}>
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-blue-500" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function DiffView({ diff }: { diff: PrReviewFileDiff }) {
  if (diff.mode !== "side_by_side") {
    return (
      <section className="p-4">
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
      <section className="p-4">
        <div className="rounded-lg border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          표시할 diff row가 없습니다.
        </div>
      </section>
    );
  }

  return (
    <section className="p-4">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[64px_minmax(0,1fr)_64px_minmax(0,1fr)] border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-500">
          <span className="px-2 py-2 text-right">Old</span>
          <span className="px-3 py-2">Before</span>
          <span className="px-2 py-2 text-right">New</span>
          <span className="px-3 py-2">After</span>
        </div>
        <div className="max-h-[58vh] overflow-auto">
          {diff.rows.map((row, index) => (
            <div
              className={cn(
                "grid grid-cols-[64px_minmax(0,1fr)_64px_minmax(0,1fr)] border-b border-slate-100 last:border-b-0",
                getRowClassName(row.type)
              )}
              key={`${row.oldLineNumber ?? "x"}-${row.newLineNumber ?? "x"}-${index}`}
            >
              <span className="select-none px-2 py-1.5 text-right font-mono text-xs text-slate-400">
                {row.oldLineNumber ?? ""}
              </span>
              <code
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-xs leading-5",
                  getCodeClassName(row.type)
                )}
              >
                {row.oldText ?? ""}
              </code>
              <span className="select-none px-2 py-1.5 text-right font-mono text-xs text-slate-400">
                {row.newLineNumber ?? ""}
              </span>
              <code
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-xs leading-5",
                  getCodeClassName(row.type)
                )}
              >
                {row.newText ?? ""}
              </code>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
