"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

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
import {
  featureNavigationItems,
  getFeatureNavigationItemForPathname
} from "@/features/navigation";

type MainShellProps = {
  children: ReactNode;
};

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
      <main className="h-svh overflow-hidden bg-background">
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2 [&_[data-mode=floating]]:!static">
          <ScreenShareHeaderControl mode="floating" />
          <WorkspaceMemberAvatars mode="floating" />
        </div>
        {children}
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
          <div className="flex shrink-0 items-center gap-2">
            <ScreenShareHeaderControl mode="header" />
            <WorkspaceMemberAvatars mode="header" />
            <div className="hidden min-[480px]:block">
              <HeaderMeetingStatus />
            </div>
            <HeaderNotificationDropdown />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-6 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
