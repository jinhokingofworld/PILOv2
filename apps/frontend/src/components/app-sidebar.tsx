"use client";

import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  ChevronRight,
  GalleryVerticalEnd,
  LogOut,
  Send,
  Sparkles,
  X,
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
import { Input } from "@/components/ui/input";
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
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
  type WorkspaceInvitation
} from "@/features/auth/api/client";
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

export function AppSidebar({
  items,
  selectedItemId,
  onSelectItem
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();
  const authSession = useAuthSession();
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [activeSubItemHref, setActiveSubItemHref] = useState<
    string | undefined
  >(items[0]?.href);
  const [openMenuIds, setOpenMenuIds] = useState<Record<string, boolean>>({
    [selectedItemId]: true
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<
    WorkspaceInvitation[]
  >([]);
  const [isInviteSubmitting, setIsInviteSubmitting] = useState(false);
  const activeWorkspaceDetail = authSession?.activeWorkspace;
  const canManageWorkspace = activeWorkspaceDetail?.role === "owner";
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

  useEffect(() => {
    let cancelled = false;

    if (!authSession || !activeWorkspaceDetail || !canManageWorkspace) {
      setPendingInvitations([]);
      return () => {
        cancelled = true;
      };
    }

    const accessToken = authSession.accessToken;
    const workspaceId = activeWorkspaceDetail.id;

    async function loadInvitations() {
      try {
        const invitations = await listWorkspaceInvitations(accessToken, workspaceId);

        if (!cancelled) {
          setPendingInvitations(
            invitations.filter((invitation) => invitation.status === "pending")
          );
        }
      } catch {
        if (!cancelled) {
          setPendingInvitations([]);
        }
      }
    }

    void loadInvitations();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceDetail?.id, authSession, canManageWorkspace]);

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
    if (authSession) {
      authSession.setActiveWorkspaceId(workspaceId);
      return;
    }

    setActiveWorkspaceIndex(index);
  };

  const handleSubmitInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      !authSession ||
      !activeWorkspaceDetail ||
      !canManageWorkspace ||
      isInviteSubmitting
    ) {
      return;
    }

    setInviteError(null);
    setInviteStatus(null);
    setInviteUrl(null);
    setIsInviteSubmitting(true);

    void createWorkspaceInvitation(
      authSession.accessToken,
      activeWorkspaceDetail.id,
      inviteEmail
    )
      .then((result) => {
        setInviteEmail("");
        setInviteStatus(`${result.invitation.email} 초대 생성됨`);
        setInviteUrl(result.acceptUrl);
        setPendingInvitations((currentInvitations) => [
          result.invitation,
          ...currentInvitations.filter(
            (invitation) => invitation.id !== result.invitation.id
          )
        ]);
      })
      .catch((error: unknown) => {
        setInviteError(
          error instanceof Error ? error.message : "초대 생성에 실패했습니다"
        );
      })
      .finally(() => {
        setIsInviteSubmitting(false);
      });
  };

  const handleRevokeInvitation = (invitationId: string) => {
    if (!authSession || !activeWorkspaceDetail || !canManageWorkspace) {
      return;
    }

    setInviteError(null);

    void revokeWorkspaceInvitation(
      authSession.accessToken,
      activeWorkspaceDetail.id,
      invitationId
    )
      .then((invitation) => {
        setPendingInvitations((currentInvitations) =>
          currentInvitations.filter(
            (currentInvitation) => currentInvitation.id !== invitation.id
          )
        );
        setInviteStatus(`${invitation.email} 초대 취소됨`);
      })
      .catch((error: unknown) => {
        setInviteError(
          error instanceof Error ? error.message : "초대 취소에 실패했습니다"
        );
      });
  };

  const handleLogout = () => {
    void authSession?.logout();
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
                {canManageWorkspace ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>멤버 관리</DropdownMenuLabel>
                      <div
                        className="space-y-2 px-2 pb-2"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <form
                          className="flex items-center gap-2"
                          onSubmit={handleSubmitInvitation}
                        >
                          <Input
                            aria-label="초대 이메일"
                            className="h-8"
                            onChange={(event) =>
                              setInviteEmail(event.target.value)
                            }
                            placeholder="member@example.com"
                            type="email"
                            value={inviteEmail}
                          />
                          <button
                            aria-label="멤버 초대"
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isInviteSubmitting || inviteEmail.trim() === ""}
                            type="submit"
                          >
                            <Send className="size-3.5" />
                            초대
                          </button>
                        </form>
                        {inviteError ? (
                          <p className="text-xs text-destructive">
                            {inviteError}
                          </p>
                        ) : null}
                        {inviteStatus ? (
                          <p className="text-xs text-muted-foreground">
                            {inviteStatus}
                          </p>
                        ) : null}
                        {inviteUrl ? (
                          <p className="line-clamp-2 break-all text-[11px] text-muted-foreground">
                            {inviteUrl}
                          </p>
                        ) : null}
                        {pendingInvitations.length > 0 ? (
                          <div className="space-y-1">
                            {pendingInvitations.slice(0, 3).map((invitation) => (
                              <div
                                className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                                key={invitation.id}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">
                                    {invitation.email}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    pending
                                  </p>
                                </div>
                                <button
                                  aria-label="초대 취소"
                                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  onClick={() =>
                                    handleRevokeInvitation(invitation.id)
                                  }
                                  type="button"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </DropdownMenuGroup>
                  </>
                ) : null}
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
                    <Bell />
                    알림
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <UserRound />
                    프로필
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="gap-2" onClick={handleLogout}>
                    <LogOut />
                    로그아웃
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
