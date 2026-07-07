"use client";

import type { ReactNode } from "react";
import { LayoutDashboard } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { AuthGate } from "@/features/auth";
import {
  featureNavigationItems,
  getFeatureNavigationItem
} from "@/features/navigation";

type MainShellProps = {
  activeFeatureId: string;
  children: ReactNode;
};

export function MainShell({ activeFeatureId, children }: MainShellProps) {
  const activeFeature = getFeatureNavigationItem(activeFeatureId);

  return (
    <AuthGate>
      <SidebarProvider>
        <AppSidebar
          items={featureNavigationItems}
          selectedItemId={activeFeature.id}
        />

        <SidebarInset className="md:peer-data-[variant=inset]:!m-0 md:peer-data-[variant=inset]:!rounded-none md:peer-data-[variant=inset]:!shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:!ml-0">
          <header className="flex h-14 shrink-0 items-center gap-2 bg-background px-4">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2 text-sm font-medium">
              <LayoutDashboard className="size-4 text-muted-foreground" />
              {activeFeature.title}
            </div>
          </header>

          <main className="flex flex-1 flex-col gap-6 p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGate>
  );
}
