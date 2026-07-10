"use client";

import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { useAuthSession } from "@/features/auth/auth-session";
import {
  useHomeCanvasSummary,
  useHomeSqlErdSession
} from "../hooks/use-home-dashboard-data";
import { formatRelativeTimeFromNow } from "../utils/home-date";

export function GithubWorkspaceCards() {
  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-2 2xl:col-span-3 2xl:col-start-1 2xl:row-start-3">
      <CanvasShortcutCard />
      <SqlErdShortcutCard />
    </div>
  );
}

function CanvasShortcutCard() {
  const router = useRouter();
  const authSession = useAuthSession();
  const canvasState = useHomeCanvasSummary({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const updatedLabel =
    canvasState.status === "loading"
      ? "불러오는 중"
      : canvasState.recentBoard
        ? formatRelativeTimeFromNow(canvasState.recentBoard.updatedAt)
        : "-";

  const handleNavigateToCanvas = () => {
    router.push("/canvas");
  };

  return (
    <Card
      aria-label="Canvas로 이동"
      className="relative min-h-0 cursor-pointer overflow-hidden border-slate-900/10 bg-slate-950 text-white shadow-sm transition-shadow hover:shadow-md"
      onClick={handleNavigateToCanvas}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleNavigateToCanvas();
        }
      }}
      role="link"
      size="sm"
      tabIndex={0}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_38%,#64748b_72%,#020617_100%)]" />
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(15,23,42,0.13)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.13)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="absolute left-7 top-5 h-10 w-24 rotate-[-3deg] rounded-md border border-amber-200 bg-amber-50/95 p-2 shadow-sm">
        <div className="h-1.5 w-10 rounded-full bg-amber-300" />
        <div className="mt-2 h-1.5 w-16 rounded-full bg-amber-200" />
      </div>
      <div className="absolute right-8 top-6 h-11 w-28 rotate-2 rounded-md border border-sky-200 bg-white/95 p-2 shadow-sm">
        <div className="h-1.5 w-12 rounded-full bg-sky-300" />
        <div className="mt-2 h-1.5 w-20 rounded-full bg-slate-200" />
      </div>
      <div className="absolute left-24 top-16 h-9 w-28 rotate-1 rounded-md border border-violet-200 bg-white/90 p-2 shadow-sm">
        <div className="h-1.5 w-14 rounded-full bg-violet-300" />
        <div className="mt-2 h-1.5 w-16 rounded-full bg-slate-200" />
      </div>
      <div className="absolute left-16 top-12 h-px w-32 rotate-[18deg] bg-slate-400/50" />
      <div className="absolute right-20 top-14 h-px w-28 rotate-[-16deg] bg-slate-400/50" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/25 to-slate-950/90" />

      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-row items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-5">Canvas</p>
          <p className="truncate text-xs leading-4 text-white/70">
            최근 작업 보드로 바로 이동
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[0.7rem] font-medium leading-4 text-white/60">
            마지막 수정
          </p>
          <p className="text-xs font-medium leading-4 text-white">
            {updatedLabel}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SqlErdShortcutCard() {
  const router = useRouter();
  const authSession = useAuthSession();
  const sqlErdState = useHomeSqlErdSession({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const recentErdTitle = sqlErdState.session?.title ?? "-";
  const updatedLabel =
    sqlErdState.status === "loading"
      ? "불러오는 중"
      : sqlErdState.session
        ? formatRelativeTimeFromNow(sqlErdState.session.updatedAt)
        : "-";

  const handleNavigateToSqlErd = () => {
    router.push("/sql-erd");
  };

  return (
    <Card
      aria-label="SQL to ERD로 이동"
      className="relative min-h-0 cursor-pointer overflow-hidden border-slate-900/10 bg-slate-950 text-white shadow-sm transition-shadow hover:shadow-md"
      onClick={handleNavigateToSqlErd}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleNavigateToSqlErd();
        }
      }}
      role="link"
      size="sm"
      tabIndex={0}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#ecfeff_32%,#64748b_72%,#020617_100%)]" />
      <div className="absolute inset-0 opacity-55 [background-image:linear-gradient(to_right,rgba(8,47,73,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(8,47,73,0.14)_1px,transparent_1px)] [background-size:18px_18px]" />

      <div className="absolute left-6 top-5 h-14 w-28 rounded-md border border-cyan-200 bg-white/95 shadow-sm">
        <div className="rounded-t-md border-b border-cyan-100 bg-cyan-50 px-2 py-1">
          <div className="h-1.5 w-10 rounded-full bg-cyan-500" />
        </div>
        <div className="space-y-1.5 p-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-300" />
          <div className="h-1.5 w-14 rounded-full bg-slate-200" />
        </div>
      </div>
      <div className="absolute right-16 top-4 h-16 w-32 rounded-md border border-emerald-200 bg-white/95 shadow-sm">
        <div className="rounded-t-md border-b border-emerald-100 bg-emerald-50 px-2 py-1">
          <div className="h-1.5 w-12 rounded-full bg-emerald-500" />
        </div>
        <div className="space-y-1.5 p-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-300" />
          <div className="h-1.5 w-16 rounded-full bg-slate-200" />
          <div className="h-1.5 w-12 rounded-full bg-slate-200" />
        </div>
      </div>
      <div className="absolute left-[8.5rem] top-[4.5rem] h-14 w-28 rounded-md border border-violet-200 bg-white/90 shadow-sm">
        <div className="rounded-t-md border-b border-violet-100 bg-violet-50 px-2 py-1">
          <div className="h-1.5 w-14 rounded-full bg-violet-500" />
        </div>
        <div className="space-y-1.5 p-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-300" />
          <div className="h-1.5 w-12 rounded-full bg-slate-200" />
        </div>
      </div>
      <div className="absolute left-[7.5rem] top-12 h-px w-24 rotate-[2deg] bg-cyan-700/45" />
      <div className="absolute left-[12.5rem] top-[4.45rem] h-px w-24 rotate-[32deg] bg-cyan-700/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/25 to-slate-950/90" />

      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-row items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-5">SQL to ERD</p>
          <p className="truncate text-xs leading-4 text-white/70">
            DDL을 ERD 캔버스로 변환
          </p>
        </div>
        <div className="min-w-0 shrink-0 text-right">
          <p className="text-[0.7rem] font-medium leading-4 text-white/60">
            마지막 수정
          </p>
          <p className="max-w-28 truncate text-xs font-medium leading-4 text-white">
            {updatedLabel}
          </p>
          <p className="max-w-28 truncate text-[0.7rem] font-medium leading-4 text-white/60">
            {recentErdTitle}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
