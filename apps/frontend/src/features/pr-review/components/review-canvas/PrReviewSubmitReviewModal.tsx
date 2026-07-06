"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  ShieldCheck,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { createPrReviewApiClient } from "@/features/pr-review/api/client";
import type {
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewSession,
  PrReviewSessionResult,
  PrReviewSubmission,
  PrReviewSubmitType
} from "@/features/pr-review/types";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;
type LoadStatus = "idle" | "loading" | "ready" | "error";
type SubmitStatus = "idle" | "submitting" | "submitted" | "error";
type GuardKind = "oauth_required" | "stale" | "already_submitted" | "generic";
type CreateStatus = "idle" | "creating" | "error";

type PrReviewSubmitReviewModalProps = {
  apiClient: PrReviewApiClient;
  onClose: () => void;
  onCreateNewReview: () => Promise<void>;
  onGoToGithub: () => void;
  onSubmitted: (submission: PrReviewSubmission) => void;
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  session: PrReviewSession;
  workspaceId: string;
};

const submitOptions: Array<{
  submitType: PrReviewSubmitType;
  label: string;
  description: string;
  icon: typeof MessageSquare;
}> = [
  {
    submitType: "COMMENT",
    label: "Comment",
    description: "일반 피드백만 남깁니다.",
    icon: MessageSquare
  },
  {
    submitType: "APPROVE",
    label: "Approve",
    description: "merge를 승인합니다.",
    icon: ShieldCheck
  },
  {
    submitType: "REQUEST_CHANGES",
    label: "Request changes",
    description: "merge 전 반영할 변경을 요청합니다.",
    icon: AlertCircle
  }
];

const statusLabels = {
  approved: "Approved",
  discussion_needed: "Discuss",
  not_reviewed: "Not reviewed",
  unknown: "Unknown"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Review를 제출하지 못했습니다.";
}

function getGuardKind(message: string): GuardKind {
  if (message.includes("GitHub OAuth connection is required")) {
    return "oauth_required";
  }

  if (message.includes("Review session head SHA is stale")) {
    return "stale";
  }

  if (message.includes("already been submitted")) {
    return "already_submitted";
  }

  return "generic";
}

function isKnownStaleSession(
  session: PrReviewSession,
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null
) {
  return Boolean(pullRequest?.headSha && pullRequest.headSha !== session.headSha);
}

function buildDefaultReviewBody(result: PrReviewSessionResult) {
  const lines = [
    "## PILO PR Review",
    "",
    result.reviewResultSummary,
    "",
    "### File decisions"
  ];

  for (const file of result.fileReviewResults) {
    const status = statusLabels[file.status];
    const comment = file.comment ? ` - ${file.comment}` : "";
    lines.push(`- ${status}: ${file.filePath}${comment}`);
  }

  return lines.join("\n");
}

function getCountItems(result: PrReviewSessionResult) {
  return [
    {
      label: "Approved",
      value: result.counts.approved,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700"
    },
    {
      label: "Discuss",
      value: result.counts.discussionNeeded,
      className: "border-amber-200 bg-amber-50 text-amber-700"
    },
    {
      label: "Unknown",
      value: result.counts.unknown,
      className: "border-violet-200 bg-violet-50 text-violet-700"
    },
    {
      label: "Not reviewed",
      value: result.counts.notReviewed,
      className: "border-slate-200 bg-slate-100 text-slate-700"
    }
  ];
}

export function PrReviewSubmitReviewModal({
  apiClient,
  onClose,
  onCreateNewReview,
  onGoToGithub,
  onSubmitted,
  pullRequest,
  session,
  workspaceId
}: PrReviewSubmitReviewModalProps) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [result, setResult] = useState<PrReviewSessionResult | null>(null);
  const [submitType, setSubmitType] = useState<PrReviewSubmitType>("COMMENT");
  const [reviewBody, setReviewBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(
    null
  );
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
    null
  );
  const [guardKind, setGuardKind] = useState<GuardKind | null>(null);
  const [submission, setSubmission] = useState<PrReviewSubmission | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const knownStaleSession = isKnownStaleSession(session, pullRequest);
  const countItems = useMemo(() => (result ? getCountItems(result) : []), [result]);
  const canSubmit =
    loadStatus === "ready" &&
    Boolean(result) &&
    Boolean(reviewBody.trim()) &&
    submitStatus !== "submitting" &&
    !knownStaleSession &&
    guardKind !== "oauth_required" &&
    guardKind !== "stale";

  useEffect(() => {
    let cancelled = false;

    async function loadResult() {
      setLoadStatus("loading");
      setErrorMessage(null);
      setSubmitErrorMessage(null);
      setCreateErrorMessage(null);
      setGuardKind(knownStaleSession ? "stale" : null);
      setSubmission(null);

      try {
        const nextResult = await apiClient.getReviewSessionResult(
          workspaceId,
          session.id
        );

        if (cancelled) {
          return;
        }

        setResult(nextResult);
        setReviewBody(buildDefaultReviewBody(nextResult));
        setLoadStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = getErrorMessage(error);
        setErrorMessage(message);
        setGuardKind(getGuardKind(message));
        setLoadStatus("error");
      }
    }

    void loadResult();

    return () => {
      cancelled = true;
    };
  }, [apiClient, knownStaleSession, reloadVersion, session.id, workspaceId]);

  async function submitReview() {
    if (!canSubmit) {
      return;
    }

    setSubmitStatus("submitting");
    setSubmitErrorMessage(null);
    setGuardKind(null);

    try {
      const nextSubmission = await apiClient.submitReviewSession(
        workspaceId,
        session.id,
        {
          reviewBody: reviewBody.trim(),
          submitType
        }
      );

      setSubmission(nextSubmission);
      setSubmitStatus("submitted");
      onSubmitted(nextSubmission);
    } catch (error) {
      const message = getErrorMessage(error);
      setSubmitStatus("error");
      setSubmitErrorMessage(message);
      setGuardKind(getGuardKind(message));
    }
  }

  async function createNewReview() {
    setCreateStatus("creating");
    setCreateErrorMessage(null);

    try {
      await onCreateNewReview();
    } catch (error) {
      setCreateStatus("error");
      setCreateErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[3px]"
      role="dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">
        <header className="flex min-h-16 items-center gap-3 border-b border-slate-800 px-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Finish your review</h2>
          </div>
          <Button onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <X className="size-4" />
            <span className="sr-only">닫기</span>
          </Button>
        </header>

        {loadStatus === "loading" || loadStatus === "idle" ? (
          <ModalLoadingState />
        ) : loadStatus === "error" ? (
          <ModalErrorState
            guardKind={guardKind}
            message={errorMessage}
            onCreateNewReview={() => void createNewReview()}
            onGoToGithub={onGoToGithub}
            onRetry={() => setReloadVersion((version) => version + 1)}
            createErrorMessage={createErrorMessage}
            createStatus={createStatus}
          />
        ) : result ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {knownStaleSession || guardKind === "stale" ? (
                <StaleSessionNotice
                  createErrorMessage={createErrorMessage}
                  createStatus={createStatus}
                  onCreateNewReview={() => void createNewReview()}
                />
              ) : null}

              {submission ? (
                <SubmissionSuccess submission={submission} />
              ) : null}

              {submitErrorMessage ? (
                <SubmissionError
                  createErrorMessage={createErrorMessage}
                  createStatus={createStatus}
                  guardKind={guardKind}
                  message={submitErrorMessage}
                  onCreateNewReview={() => void createNewReview()}
                  onGoToGithub={onGoToGithub}
                />
              ) : null}

              <div className="grid gap-3 sm:grid-cols-4">
                {countItems.map((item) => (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      item.className
                    )}
                    key={item.label}
                  >
                    <p className="text-xs font-medium">{item.label}</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatNumber(item.value)}
                    </p>
                  </div>
                ))}
              </div>

              {result.counts.notReviewed > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm leading-6 text-amber-100">
                  아직 판단하지 않은 파일 {formatNumber(result.counts.notReviewed)}
                  개가 남아 있습니다.
                </div>
              ) : null}

              <textarea
                aria-label="Review body"
                className="mt-4 min-h-72 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-400 focus:ring-3 focus:ring-blue-500/20"
                disabled={submitStatus === "submitting" || Boolean(submission)}
                onChange={(event) => {
                  setReviewBody(event.target.value);
                  setSubmitStatus("idle");
                  setSubmitErrorMessage(null);
                  setGuardKind(knownStaleSession ? "stale" : null);
                }}
                placeholder="Leave a comment"
                value={reviewBody}
              />

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {submitOptions.map((option) => {
                  const Icon = option.icon;
                  const selected = submitType === option.submitType;

                  return (
                    <button
                      className={cn(
                        "rounded-lg border px-3 py-3 text-left transition-colors",
                        selected
                          ? "border-blue-400 bg-blue-500/15 text-white"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                      )}
                      disabled={submitStatus === "submitting" || Boolean(submission)}
                      key={option.submitType}
                      onClick={() => setSubmitType(option.submitType)}
                      type="button"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <Icon className="size-4" />
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <Button onClick={onClose} type="button" variant="secondary">
                Cancel
              </Button>
              <Button
                disabled={!canSubmit || Boolean(submission)}
                onClick={() => void submitReview()}
                type="button"
              >
                {submitStatus === "submitting" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Submit review
              </Button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ModalLoadingState() {
  return (
    <div className="flex min-h-96 items-center justify-center">
      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">
        <Loader2 className="size-4 animate-spin text-blue-400" />
        Review 결과 불러오는 중
      </div>
    </div>
  );
}

function ModalErrorState({
  createErrorMessage,
  createStatus,
  guardKind,
  message,
  onCreateNewReview,
  onGoToGithub,
  onRetry
}: {
  createErrorMessage: string | null;
  createStatus: CreateStatus;
  guardKind: GuardKind | null;
  message: string | null;
  onCreateNewReview: () => void;
  onGoToGithub: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-96 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-rose-300/30 bg-rose-300/10 px-5 py-4 text-center">
        <AlertCircle className="mx-auto size-8 text-rose-300" />
        <h3 className="mt-3 text-base font-semibold">
          Review 정보를 불러오지 못했습니다.
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {message ?? "잠시 후 다시 시도해 주세요."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {guardKind === "oauth_required" ? (
            <Button onClick={onGoToGithub} type="button">
              <GitPullRequest className="size-4" />
              GitHub로 이동
            </Button>
          ) : guardKind === "stale" ? (
            <Button
              disabled={createStatus === "creating"}
              onClick={onCreateNewReview}
              type="button"
            >
              {createStatus === "creating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              새 리뷰 시작
            </Button>
          ) : (
            <Button onClick={onRetry} type="button" variant="outline">
              <RefreshCcw className="size-4" />
              다시 시도
            </Button>
          )}
        </div>
        {createErrorMessage ? (
          <p className="mt-3 text-sm text-rose-200">{createErrorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

function StaleSessionNotice({
  createErrorMessage,
  createStatus,
  onCreateNewReview
}: {
  createErrorMessage: string | null;
  createStatus: CreateStatus;
  onCreateNewReview: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-amber-300/35 bg-amber-300/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-amber-100">PR이 수정되었습니다.</p>
          <p className="mt-1 text-sm leading-6 text-amber-100/80">
            현재 session은 이전 head SHA 기준입니다.
          </p>
        </div>
        <Button
          disabled={createStatus === "creating"}
          onClick={onCreateNewReview}
          type="button"
        >
          {createStatus === "creating" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCcw className="size-4" />
          )}
          새 리뷰 시작
        </Button>
      </div>
      {createErrorMessage ? (
        <p className="mt-3 text-sm text-rose-200">{createErrorMessage}</p>
      ) : null}
    </div>
  );
}

function SubmissionError({
  createErrorMessage,
  createStatus,
  guardKind,
  message,
  onCreateNewReview,
  onGoToGithub
}: {
  createErrorMessage: string | null;
  createStatus: CreateStatus;
  guardKind: GuardKind | null;
  message: string;
  onCreateNewReview: () => void;
  onGoToGithub: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-rose-300/30 bg-rose-300/10 px-4 py-3">
      <p className="font-semibold text-rose-100">Review 제출 실패</p>
      <p className="mt-1 text-sm leading-6 text-rose-100/80">{message}</p>
      {guardKind === "oauth_required" || guardKind === "stale" ? (
        <div className="mt-3">
          {guardKind === "oauth_required" ? (
            <Button onClick={onGoToGithub} type="button">
              <GitPullRequest className="size-4" />
              GitHub로 이동
            </Button>
          ) : (
            <Button
              disabled={createStatus === "creating"}
              onClick={onCreateNewReview}
              type="button"
            >
              {createStatus === "creating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              새 리뷰 시작
            </Button>
          )}
        </div>
      ) : null}
      {createErrorMessage ? (
        <p className="mt-3 text-sm text-rose-200">{createErrorMessage}</p>
      ) : null}
    </div>
  );
}

function SubmissionSuccess({
  submission
}: {
  submission: PrReviewSubmission;
}) {
  return (
    <div className="mb-4 rounded-lg border border-emerald-300/35 bg-emerald-300/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold text-emerald-100">
            <CheckCircle2 className="size-4" />
            Review 제출 완료
          </p>
          <p className="mt-1 text-sm leading-6 text-emerald-100/80">
            {submission.reviewResultSummary ?? "GitHub Review가 제출되었습니다."}
          </p>
        </div>
        {submission.githubReviewUrl ? (
          <a
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-200 hover:underline"
            href={submission.githubReviewUrl}
            rel="noreferrer"
            target="_blank"
          >
            GitHub에서 보기
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      <Separator className="my-3 bg-emerald-300/20" />
      <p className="text-xs text-emerald-100/70">
        {submission.submittedByGithubLogin
          ? `submitted by ${submission.submittedByGithubLogin}`
          : submission.githubSubmitStatus}
      </p>
    </div>
  );
}
