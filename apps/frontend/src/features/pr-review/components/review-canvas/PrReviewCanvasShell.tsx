"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Send
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  PrReviewConflictStatus,
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewSession
} from "@/features/pr-review/types";

type PrReviewCanvasShellProps = {
  onBackToSelection: () => void;
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  session: PrReviewSession;
};

const DETAIL_PANEL_MIN_WIDTH = 360;
const DETAIL_PANEL_MAX_WIDTH = 620;
const DETAIL_PANEL_DEFAULT_WIDTH = 440;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

export function PrReviewCanvasShell({
  onBackToSelection,
  pullRequest,
  session
}: PrReviewCanvasShellProps) {
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    DETAIL_PANEL_DEFAULT_WIDTH
  );
  const progressLabel = `${formatNumber(session.reviewedCount)} / ${formatNumber(
    session.totalFileCount
  )}`;

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

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4">
        <Button onClick={onBackToSelection} type="button" variant="outline">
          <ArrowLeft className="size-4" />
          PR 선택으로 돌아가기
        </Button>
        <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium">
          <GitBranch className="size-4 shrink-0 text-slate-500" />
          <span className="max-w-44 truncate">
            {pullRequest?.headBranch ?? session.headSha.slice(0, 7)}
          </span>
          <span className="text-slate-400">→</span>
          <span className="max-w-32 truncate">
            {pullRequest?.baseBranch ?? "-"}
          </span>
        </div>
        <div className="hidden h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm md:flex">
          <GitPullRequest className="size-4 text-blue-600" />
          <span>리뷰 진행률:</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 items-center rounded-full border px-3 text-sm font-medium",
              getConflictClassName(session.conflictStatus)
            )}
          >
            {getConflictLabel(session.conflictStatus)}
          </span>
          <Button disabled title="#194에서 제출 modal을 연결합니다." type="button">
            <Send className="size-4" />
            Review 제출
          </Button>
          <Button disabled title="MVP 이후 지원 예정" type="button" variant="outline">
            <GitMerge className="size-4" />
            Merge
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden">
          <div
            className="absolute inset-0 bg-slate-50"
            style={{
              backgroundImage:
                "linear-gradient(rgba(15, 23, 42, 0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.055) 1px, transparent 1px)",
              backgroundSize: "32px 32px"
            }}
          />
          <div className="relative flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-lg border border-slate-200 bg-white/95 px-5 py-4 text-center shadow-sm">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <GitPullRequest className="size-5" />
              </div>
              <h1 className="text-base font-semibold">Review Canvas</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                리뷰 흐름을 준비하고 있습니다.
              </p>
            </div>
          </div>
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
          <ReviewDetailPanel pullRequest={pullRequest} session={session} />
        </aside>
      </main>
    </div>
  );
}

function ReviewDetailPanel({
  pullRequest,
  session
}: {
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  session: PrReviewSession;
}) {
  return (
    <div className="space-y-6 p-5">
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-700">안내</p>
        <p className="mt-2 text-sm font-medium leading-6 text-amber-950">
          데모 PR 리뷰 데이터로 워크플로우와 변경 차이를 표시합니다.
        </p>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">PR</p>
        <h2 className="mt-2 text-xl font-semibold leading-7">
          {pullRequest ? `#${pullRequest.githubNumber} ${pullRequest.title}` : "PR 정보"}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
            <GitBranch className="size-3.5" />
            {pullRequest?.headBranch ?? session.headSha.slice(0, 7)} →{" "}
            {pullRequest?.baseBranch ?? "-"}
          </span>
          <span>{formatNumber(pullRequest?.changedFilesCount ?? session.totalFileCount)} files</span>
          {pullRequest ? (
            <>
              <span className="text-emerald-600">
                +{formatNumber(pullRequest.additions)}
              </span>
              <span className="text-rose-500">
                -{formatNumber(pullRequest.deletions)}
              </span>
            </>
          ) : null}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">PR 의도</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {session.prPurpose ?? "PR 의도 분석 결과가 아직 없습니다."}
        </p>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase text-slate-500">AI 분석</p>
        {session.changeSummary.length ? (
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {session.changeSummary.map((item, index) => (
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
          {session.recommendedReviewOrder ??
            "추천 리뷰 순서 분석 결과가 아직 없습니다."}
        </p>
      </section>

      {session.cautionPoints.length ? (
        <section>
          <p className="text-xs font-semibold uppercase text-slate-500">
            주의할 점
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {session.cautionPoints.map((item, index) => (
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
        <Metric label="리뷰 진행률" value={`${session.reviewedCount}/${session.totalFileCount}`} />
        <Metric label="상태" value={session.status} />
        <Metric label="Conflict" value={getConflictLabel(session.conflictStatus)} />
        <Metric label="생성일" value={formatDateTime(session.createdAt)} />
      </section>

      {pullRequest?.githubUrl ? (
        <a
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline"
          href={pullRequest.githubUrl}
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
