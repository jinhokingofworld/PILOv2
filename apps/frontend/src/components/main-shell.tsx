"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutDashboard } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { HeaderNotificationDropdown } from "@/components/header-notification-dropdown";
import { useChatRuntime } from "@/features/chat/realtime/chat-runtime-provider";
import { WorkspaceMemberAvatars } from "@/features/workspace-presence/components/workspace-member-avatars";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { HeaderMeetingStatus } from "@/features/meeting/components/header-meeting-status";
import { ScreenShareHeaderControl } from "@/features/screen-share/components/screen-share-header-control";
import { SqlErdSessionHeaderTitle } from "@/features/sql-erd/session-header-title";
import {
  featureNavigationItems,
  getFeatureNavigationItemForPathname
} from "@/features/navigation";

type MainShellProps = {
  children: ReactNode;
};

function WorkspaceHeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ScreenShareHeaderControl mode="header" />
      <WorkspaceMemberAvatars mode="header" />
      <div className="hidden min-[480px]:block">
        <HeaderMeetingStatus />
      </div>
      <HeaderNotificationDropdown />
    </div>
  );
}

export function MainShell({ children }: MainShellProps) {
  const pathname = usePathname();
  const { summary } = useChatRuntime();
  const activeFeature = getFeatureNavigationItemForPathname(pathname);
  const isCanvasRoute = pathname.startsWith("/canvas");
  const isSqlErdImmersiveRoute = pathname.startsWith("/sql-erd/session");
  const [sidebarOpen, setSidebarOpen] = useState(() => !isCanvasRoute);

  useEffect(() => {
    if (isCanvasRoute) setSidebarOpen(false);
  }, [isCanvasRoute]);

  if (isSqlErdImmersiveRoute) {
    return (
      <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-background">
        <header
          className="z-30 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background px-4"
          data-sqltoerd-workspace-header
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              aria-label="홈으로 이동"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              href="/home"
            >
              <Home className="size-4" />
            </Link>
            <div className="h-5 w-px shrink-0 bg-border" />
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
              <SqlErdSessionHeaderTitle fallback={activeFeature.title} />
            </div>
          </div>
          <WorkspaceHeaderActions />
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    );
  }

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar
        itemBadges={{ chat: summary.unreadCount }}
        items={featureNavigationItems}
        selectedItemId={activeFeature.id}
      />

      <SidebarInset className="md:peer-data-[variant=inset]:!m-0 md:peer-data-[variant=inset]:!rounded-none md:peer-data-[variant=inset]:!shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:!ml-0">
        <header className="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-2 bg-background px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger className="shrink-0" />
            <div className="h-5 w-px shrink-0 bg-border" />
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{activeFeature.title}</span>
            </div>
          </div>
          <WorkspaceHeaderActions />
        </header>

        <main className="flex flex-1 flex-col gap-6 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
