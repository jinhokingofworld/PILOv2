"use client";

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ChevronsUpDown,
  ChevronRight,
  GalleryVerticalEnd,
  Loader2,
  LogOut,
  Sparkles,
  UserRound
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar
} from "@/components/ui/sidebar";
import { useAuthSession } from "@/features/auth";
import { useMeetingRuntime } from "@/features/meeting/runtime/meeting-runtime-provider";
import type { FeatureNavigationItem } from "@/features/navigation-types";
import { cn } from "@/lib/utils";

export type AppSidebarItem = Pick<
  FeatureNavigationItem,
  "description" | "href" | "icon" | "id" | "items" | "title"
>;

type AppSidebarProps = {
  items: AppSidebarItem[];
  selectedItemId: string;
  onSelectItem?: (itemId: string) => void;
};

const workspaces = [
  {
    name: "PILO",
    description: "AI Project OS",
    icon: GalleryVerticalEnd
  },
  {
    name: "Frontend",
    description: "Main page sprint",
    icon: Sparkles
  },
  {
    name: "Review Lab",
    description: "PR review flow",
    icon: BadgeCheck
  }
];

const currentUser = {
  name: "동현",
  email: "donghyun@pilo.local",
  initials: "DH",
  avatarUrl: null
};
const ACTIVE_MEETING_LEAVE_FAILED_MESSAGE =
  "진행 중인 회의에서 나가지 못했습니다. 회의 상태를 확인한 뒤 다시 시도해주세요.";

export function AppSidebar({
  items,
  selectedItemId,
  onSelectItem
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();
  const authSession = useAuthSession();
  const meetingRuntime = useMeetingRuntime();
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [activeSubItemHref, setActiveSubItemHref] = useState<
    string | undefined
  >(items[0]?.href);
  const [openMenuIds, setOpenMenuIds] = useState<Record<string, boolean>>({
    [selectedItemId]: true
  });
  const [sessionActionError, setSessionActionError] = useState<string | null>(
    null
  );
  const [sessionActionStatus, setSessionActionStatus] = useState<
    "idle" | "logging-out" | "switching-workspace"
  >("idle");
  const isSessionActionPending = sessionActionStatus !== "idle";
  const workspaceOptions =
    authSession?.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      description:
        workspace.role === "owner" || workspace.isOwner
          ? "Owner 워크스페이스"
          : "Member 워크스페이스",
      icon: GalleryVerticalEnd
    })) ?? workspaces.map((workspace) => ({ ...workspace, id: workspace.name }));
  const activeWorkspace =
    workspaceOptions.find(
      (workspace) => workspace.id === authSession?.activeWorkspaceId
    ) ??
    workspaceOptions[activeWorkspaceIndex] ??
    workspaceOptions[0] ?? {
      id: "PILO",
      name: "PILO",
      description: "AI Project OS",
      icon: GalleryVerticalEnd
    };
  const displayUser = authSession
    ? {
        name: authSession.user.name ?? "PILO 사용자",
        email: authSession.user.email ?? "이메일 없음",
        initials: getUserInitials(authSession.user.name, authSession.user.email),
        avatarUrl: authSession.user.avatarUrl
      }
    : currentUser;
  const selectedItem = items.find((item) => item.id === selectedItemId);

  useEffect(() => {
    setOpenMenuIds((currentOpenMenuIds) => ({
      ...currentOpenMenuIds,
      [selectedItemId]: true
    }));
    setActiveSubItemHref(selectedItem?.href);
  }, [selectedItem?.href, selectedItemId]);

  const handleSelectItem = (
    itemId: string,
    href: string,
    options: { closeMobile?: boolean } = {}
  ) => {
    onSelectItem?.(itemId);
    setActiveSubItemHref(href);
    router.push(href);

    if (isMobile && options.closeMobile !== false) {
      setOpenMobile(false);
    }
  };

  const handleSelectSubItem = (
    itemId: string,
    href: string,
    event: MouseEvent<HTMLAnchorElement>
  ) => {
    event.preventDefault();
    handleSelectItem(itemId, href);
  };

  const handleSelectWorkspace = (workspaceId: string, index: number) => {
    if (isSessionActionPending) {
      return;
    }

    if (authSession) {
      if (authSession.activeWorkspaceId === workspaceId) {
        return;
      }

      setSessionActionError(null);
      setSessionActionStatus("switching-workspace");

      void meetingRuntime
        .leaveActiveMeeting()
        .then(() => {
          authSession.setActiveWorkspaceId(workspaceId);
        })
        .catch(() => {
          setSessionActionError(ACTIVE_MEETING_LEAVE_FAILED_MESSAGE);
        })
        .finally(() => {
          setSessionActionStatus("idle");
        });
      return;
    }

    setActiveWorkspaceIndex(index);
  };

  const handleLogout = () => {
    if (!authSession || isSessionActionPending) {
      return;
    }

    setSessionActionError(null);
    setSessionActionStatus("logging-out");

    void meetingRuntime
      .leaveActiveMeeting()
      .then(() => authSession.logout())
      .catch(() => {
        setSessionActionError(ACTIVE_MEETING_LEAVE_FAILED_MESSAGE);
      })
      .finally(() => {
        setSessionActionStatus("idle");
      });
  };

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <activeWorkspace.icon className="size-5!" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {activeWorkspace.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {activeWorkspace.description}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-56 rounded-lg"
                side="bottom"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>워크스페이스</DropdownMenuLabel>
                  {workspaceOptions.map((workspace, index) => (
                    <DropdownMenuItem
                      className="gap-2 p-2"
                      disabled={isSessionActionPending}
                      key={workspace.id}
                      onClick={() => handleSelectWorkspace(workspace.id, index)}
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                        <workspace.icon className="size-3.5" />
                      </div>
                      <div className="grid flex-1 leading-tight">
                        <span className="font-medium">{workspace.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {workspace.description}
                        </span>
                      </div>
                      <DropdownMenuShortcut>
                        Alt+{index + 1}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>주요 기능</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive = selectedItemId === item.id;
                const isOpen = openMenuIds[item.id] ?? false;
                const hasSubItems = item.items.length > 0;

                if (!hasSubItems) {
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        aria-current={isActive ? "page" : undefined}
                        className="transition-colors group-data-[collapsible=icon]:justify-center data-[active=true]:shadow-sm"
                        isActive={isActive}
                        onClick={() => handleSelectItem(item.id, item.href)}
                        size="lg"
                        tooltip={item.title}
                      >
                        <item.icon />
                        <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                          <span className="truncate">{item.title}</span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.id}>
                    <Collapsible
                      className="group/collapsible"
                      onOpenChange={(open) =>
                        setOpenMenuIds((currentOpenMenuIds) => ({
                          ...currentOpenMenuIds,
                          [item.id]: open
                        }))
                      }
                      open={isOpen}
                    >
                      <CollapsibleTrigger
                        onClick={() => handleSelectItem(item.id, item.href)}
                        render={
                          <SidebarMenuButton
                            aria-current={isActive ? "page" : undefined}
                            className="transition-colors group-data-[collapsible=icon]:justify-center data-[active=true]:shadow-sm"
                            isActive={isActive}
                            size="lg"
                            tooltip={item.title}
                          />
                        }
                      >
                        <item.icon />
                        <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                          <span className="truncate">{item.title}</span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "ml-auto size-4 transition-transform group-data-[collapsible=icon]:hidden",
                            isOpen && "rotate-90"
                          )}
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items?.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.href}>
                              <SidebarMenuSubButton
                                href={subItem.href}
                                isActive={activeSubItemHref === subItem.href}
                                onClick={(event) =>
                                  handleSelectSubItem(
                                    item.id,
                                    subItem.href,
                                    event
                                  )
                                }
                              >
                                <span>{subItem.title}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {sessionActionError ? (
          <p className="px-2 text-xs leading-5 text-destructive group-data-[collapsible=icon]:hidden">
            {sessionActionError}
          </p>
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar size="sm">
                  <AvatarImage
                    alt={displayUser.name}
                    src={displayUser.avatarUrl || undefined}
                  />
                  <AvatarFallback>{displayUser.initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {displayUser.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {displayUser.email}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar>
                        <AvatarImage
                          alt={displayUser.name}
                          src={displayUser.avatarUrl || undefined}
                        />
                        <AvatarFallback>{displayUser.initials}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 leading-tight">
                        <span className="font-medium">{displayUser.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {displayUser.email}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="gap-2">
                    <BadgeCheck />
                    계정
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <UserRound />
                    프로필
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="gap-2"
                    disabled={isSessionActionPending}
                    onClick={handleLogout}
                  >
                    {sessionActionStatus === "logging-out" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LogOut />
                    )}
                    {sessionActionStatus === "logging-out"
                      ? "로그아웃 중"
                      : "로그아웃"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function getUserInitials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.trim() || "PILO";
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "P";
}
