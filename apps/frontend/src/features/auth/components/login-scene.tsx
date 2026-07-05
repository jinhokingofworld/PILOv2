"use client";

import type { ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  GalleryVerticalEnd,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  Mic2,
  PanelLeft,
  Palette
} from "lucide-react";

import { cn } from "@/lib/utils";

type LoginSceneProps = {
  children: ReactNode;
  decorations?: ReactNode;
  focused?: boolean;
};

export function LoginScene({
  decorations,
  children,
  focused = false
}: LoginSceneProps) {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-sidebar p-5 sm:p-6">
      <LoginBackdropPreview focused={focused} />
      <div
        className={cn(
          "absolute inset-0 z-[2] bg-background/70 transition-opacity duration-700",
          focused ? "opacity-0" : "opacity-100"
        )}
      />
      {decorations}
      <div className="pointer-events-none relative z-10 flex w-full justify-center">
        <div className="pointer-events-auto w-full max-w-lg">{children}</div>
      </div>
    </main>
  );
}

function LoginBackdropPreview({ focused }: { focused: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="login-backdrop-preview absolute inset-0 z-0 overflow-hidden bg-sidebar"
      data-focused={focused ? "true" : "false"}
    >
      <div className="flex h-full min-h-svh">
        <aside className="hidden w-64 shrink-0 bg-sidebar p-2 text-sidebar-foreground md:flex md:flex-col">
          <div className="flex h-11 items-center gap-3 px-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <GalleryVerticalEnd className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">PILO</div>
              <div className="truncate text-xs text-muted-foreground">
                AI Project OS
              </div>
            </div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </div>

          <div className="my-4 h-px bg-sidebar-border" />

          <nav className="flex-1 space-y-4">
            <div>
              <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                주요 기능
              </div>
              <div className="space-y-1">
                <SidebarPreviewItem
                  active
                  description="캘린더 화면에서 Workspace ..."
                  icon={CalendarDays}
                  title="캘린더"
                />
                <div className="ml-9 space-y-2 py-1 text-sm text-foreground/80">
                  <div>월간 일정</div>
                  <div>오늘 일정</div>
                  <div>새 일정</div>
                </div>
                <SidebarPreviewItem
                  description="Repository, Issue, PR, Proje..."
                  icon={GitBranch}
                  title="GitHub"
                />
                <SidebarPreviewItem
                  description="GitHub ProjectV2 기반 칸반..."
                  icon={PanelLeft}
                  title="보드"
                />
                <SidebarPreviewItem
                  description="Open PR을 선택해 AI 분석 ..."
                  icon={GitPullRequest}
                  title="PR 리뷰"
                />
                <SidebarPreviewItem
                  description="회의 참여, 녹음 상태, 회의..."
                  icon={Mic2}
                  title="음성채팅"
                />
                <SidebarPreviewItem
                  description="메모, 도형, 코드블럭을 배치..."
                  icon={Palette}
                  title="캔버스"
                />
              </div>
            </div>
          </nav>

          <div className="flex h-12 items-center gap-3 rounded-md px-2">
            <div className="flex size-6 items-center justify-center rounded-full border bg-background text-[10px]">
              DH
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">동현</div>
              <div className="truncate text-xs text-muted-foreground">
                donghyun@pilo.local
              </div>
            </div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </div>
        </aside>

        <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-sm">
          <header className="flex h-14 shrink-0 items-center gap-2 bg-background px-4">
            <div className="flex size-8 items-center justify-center rounded-md border bg-background">
              <PanelLeft className="size-4 text-muted-foreground" />
            </div>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2 text-sm font-medium">
              <LayoutDashboard className="size-4 text-muted-foreground" />
              캘린더
            </div>
          </header>

          <section className="flex flex-1 flex-col gap-6 p-6">
            <div className="rounded-xl border border-primary/20 bg-primary p-4 text-primary-foreground shadow-sm">
              <div className="text-base font-semibold">캘린더 시작 영역</div>
              <div className="mt-1 text-sm text-primary-foreground/75">Calendar</div>
              <p className="mt-4 text-sm leading-6 text-primary-foreground/80">
                월간 화면에서 Workspace 일정을 확인하고 관리합니다.
              </p>
            </div>

            <section className="grid gap-4 md:grid-cols-3" aria-label="캘린더 영역 미리보기">
              <CalendarPreviewCard
                description="Workspace 전체 일정 흐름을 월 단위로 확인합니다."
                title="월간 일정"
              />
              <CalendarPreviewCard
                description="오늘 진행할 일정과 선택 날짜의 작업을 확인합니다."
                title="오늘 일정"
              />
              <CalendarPreviewCard
                description="새 Workspace 일정을 등록하는 흐름을 연결합니다."
                title="새 일정"
              />
            </section>

            <div className="flex-1 rounded-xl border bg-background shadow-sm" />
          </section>
        </div>
      </div>
    </div>
  );
}

function SidebarPreviewItem({
  active = false,
  description,
  icon: Icon,
  title
}: {
  active?: boolean;
  description: string;
  icon: typeof CalendarDays;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 items-center gap-2 rounded-md px-2 py-2 text-sm",
        active ? "bg-sidebar-accent shadow-sm" : "text-foreground/85"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate leading-tight">{title}</div>
        <div className="truncate text-xs leading-tight text-muted-foreground">
          {description}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function CalendarPreviewCard({
  description,
  title
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="text-base font-medium">{title}</div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
