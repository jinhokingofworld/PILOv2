"use client";

import { useCallback, useEffect, useState } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
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
  acceptCurrentUserWorkspaceInvitation,
  createWorkspaceInvitation,
  listCurrentUserWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaceInvitations,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  type CurrentUserWorkspaceInvitation,
  type WorkspaceInvitation,
  type WorkspaceMember
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
  const [workspaceInvitations, setWorkspaceInvitations] = useState<
    WorkspaceInvitation[]
  >([]);
  const [hiddenInvitationIds, setHiddenInvitationIds] = useState<string[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(
    []
  );
  const [currentUserInvitations, setCurrentUserInvitations] = useState<
    CurrentUserWorkspaceInvitation[]
  >([]);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
  const [invitationNoticeError, setInvitationNoticeError] = useState<
    string | null
  >(null);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<
    string | null
  >(null);
  const [removingMemberUserId, setRemovingMemberUserId] = useState<
    string | null
  >(null);
  const [isInviteSubmitting, setIsInviteSubmitting] = useState(false);
  const activeWorkspaceDetail = authSession?.activeWorkspace;
  const canManageWorkspace = activeWorkspaceDetail?.role === "owner";
  const pendingInvitationCount = currentUserInvitations.length;
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
  const visibleWorkspaceInvitations = workspaceInvitations.filter(
    (invitation) => !hiddenInvitationIds.includes(invitation.id)
  );

  const refreshWorkspaceManagement = useCallback(async () => {
    if (!authSession || !activeWorkspaceDetail || !canManageWorkspace) {
      setWorkspaceInvitations([]);
      setWorkspaceMembers([]);
      return;
    }

    const [invitations, members] = await Promise.all([
      listWorkspaceInvitations(authSession.accessToken, activeWorkspaceDetail.id),
      listWorkspaceMembers(authSession.accessToken, activeWorkspaceDetail.id)
    ]);

    setWorkspaceInvitations(invitations);
    setWorkspaceMembers(members);
  }, [activeWorkspaceDetail, authSession, canManageWorkspace]);

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
      setWorkspaceInvitations([]);
      setWorkspaceMembers([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadWorkspaceManagement() {
      try {
        if (!cancelled) {
          await refreshWorkspaceManagement();
        }
      } catch {
        if (!cancelled) {
          setWorkspaceInvitations([]);
          setWorkspaceMembers([]);
        }
      }
    }

    void loadWorkspaceManagement();
    const intervalId = window.setInterval(() => {
      void loadWorkspaceManagement();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeWorkspaceDetail?.id,
    authSession,
    canManageWorkspace,
    refreshWorkspaceManagement
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!authSession) {
      setCurrentUserInvitations([]);
      return () => {
        cancelled = true;
      };
    }

    const accessToken = authSession.accessToken;

    async function loadCurrentUserInvitations() {
      try {
        const invitations = await listCurrentUserWorkspaceInvitations(accessToken);

        if (!cancelled) {
          setCurrentUserInvitations(invitations);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserInvitations([]);
        }
      }
    }

    void loadCurrentUserInvitations();

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken]);

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
        setWorkspaceInvitations((currentInvitations) => [
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

  const handleRemoveWorkspaceMember = (member: WorkspaceMember) => {
    if (
      !authSession ||
      !activeWorkspaceDetail ||
      !canManageWorkspace ||
      removingMemberUserId
    ) {
      return;
    }

    setInviteError(null);
    setRemovingMemberUserId(member.userId);

    void removeWorkspaceMember(
      authSession.accessToken,
      activeWorkspaceDetail.id,
      member.userId
    )
      .then(async () => {
        setInviteStatus(`${member.user.email ?? "멤버"} 추방됨`);
        await refreshWorkspaceManagement();
      })
      .catch((error: unknown) => {
        setInviteError(
          error instanceof Error ? error.message : "멤버 추방에 실패했습니다"
        );
      })
      .finally(() => {
        setRemovingMemberUserId(null);
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
        setWorkspaceInvitations((currentInvitations) =>
          currentInvitations.map((currentInvitation) =>
            currentInvitation.id === invitation.id
              ? invitation
              : currentInvitation
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

  const handleHideInvitation = (invitationId: string) => {
    setHiddenInvitationIds((currentInvitationIds) =>
      currentInvitationIds.includes(invitationId)
        ? currentInvitationIds
        : [...currentInvitationIds, invitationId]
    );
  };

  const handleOpenInvitations = () => {
    setInvitationNotice(null);
    setInvitationNoticeError(null);
    setIsInvitationModalOpen(true);
  };

  const handleAcceptCurrentUserInvitation = (
    invitation: CurrentUserWorkspaceInvitation
  ) => {
    if (!authSession || acceptingInvitationId) {
      return;
    }

    setInvitationNotice(null);
    setInvitationNoticeError(null);
    setAcceptingInvitationId(invitation.id);

    void acceptCurrentUserWorkspaceInvitation(
      authSession.accessToken,
      invitation.id
    )
      .then(async (result) => {
        setCurrentUserInvitations((currentInvitations) =>
          currentInvitations.filter(
            (currentInvitation) => currentInvitation.id !== invitation.id
          )
        );
        setInvitationNotice(`${result.workspace.name} 워크스페이스에 참여했습니다`);
        await authSession.refreshSession(result.workspace.id);
        router.push("/calendar");
      })
      .catch((error: unknown) => {
        setInvitationNoticeError(
          error instanceof Error ? error.message : "초대 수락에 실패했습니다"
        );
      })
      .finally(() => {
        setAcceptingInvitationId(null);
      });
  };

  const handleLogout = () => {
    void authSession?.logout();
  };

  return (
    <>
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
                        {visibleWorkspaceInvitations.length > 0 ? (
                          <div className="space-y-1">
                            {visibleWorkspaceInvitations
                              .slice(0, 5)
                              .map((invitation) => {
                                const acceptedMember =
                                  invitation.status === "accepted"
                                    ? findAcceptedInvitationMember(
                                        workspaceMembers,
                                        invitation
                                      )
                                    : null;

                                if (
                                  invitation.status === "accepted" &&
                                  !acceptedMember
                                ) {
                                  return null;
                                }

                                return (
                                  <div
                                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                                    key={invitation.id}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-medium">
                                        {invitation.email}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {getInvitationStatusLabel(
                                          invitation.status
                                        )}
                                      </p>
                                    </div>
                                    {acceptedMember ? (
                                      <button
                                        className="inline-flex h-6 shrink-0 items-center rounded-md bg-destructive/10 px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={
                                          removingMemberUserId ===
                                          acceptedMember.userId
                                        }
                                        onClick={() =>
                                          handleRemoveWorkspaceMember(
                                            acceptedMember
                                          )
                                        }
                                        type="button"
                                      >
                                        {removingMemberUserId ===
                                        acceptedMember.userId
                                          ? "추방 중"
                                          : "추방"}
                                      </button>
                                    ) : invitation.status === "pending" ? (
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
                                    ) : (
                                      <button
                                        aria-label="초대 내역 숨기기"
                                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                        onClick={() =>
                                          handleHideInvitation(invitation.id)
                                        }
                                        type="button"
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
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
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={handleOpenInvitations}
                  >
                    <Bell />
                    <span className="flex flex-1 items-center justify-between gap-3">
                      <span>알림</span>
                      {pendingInvitationCount > 0 ? (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                          {pendingInvitationCount}
                        </span>
                      ) : null}
                    </span>
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
    <AlertDialog
      onOpenChange={setIsInvitationModalOpen}
      open={isInvitationModalOpen}
    >
      <AlertDialogContent className="max-w-md" size="default">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Bell className="size-5" />
          </AlertDialogMedia>
          <AlertDialogTitle>초대 알림</AlertDialogTitle>
          <AlertDialogDescription>
            받은 workspace 초대를 확인하세요
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {currentUserInvitations.length > 0 ? (
            currentUserInvitations.map((invitation) => (
              <div
                className="rounded-md border bg-muted/30 p-3"
                key={invitation.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {invitation.workspaceName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.role} 초대
                    </p>
                  </div>
                  <AlertDialogAction
                    className="h-8 px-3 text-xs"
                    disabled={acceptingInvitationId !== null}
                    onClick={() => handleAcceptCurrentUserInvitation(invitation)}
                    type="button"
                  >
                    {acceptingInvitationId === invitation.id ? "수락 중" : "수락"}
                  </AlertDialogAction>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  만료: {formatInvitationDate(invitation.expiresAt)}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              받은 초대가 없습니다
            </div>
          )}
        </div>

        {invitationNotice ? (
          <p className="text-sm text-muted-foreground">{invitationNotice}</p>
        ) : null}
        {invitationNoticeError ? (
          <p className="text-sm text-destructive">{invitationNoticeError}</p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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

function findAcceptedInvitationMember(
  members: WorkspaceMember[],
  invitation: WorkspaceInvitation
) {
  return (
    members.find((member) => member.userId === invitation.acceptedByUserId) ??
    members.find(
      (member) =>
        member.user.email?.toLowerCase() === invitation.email.toLowerCase()
    ) ??
    null
  );
}

function getInvitationStatusLabel(status: WorkspaceInvitation["status"]) {
  if (status === "pending") {
    return "대기중";
  }

  if (status === "accepted") {
    return "수락됨";
  }

  if (status === "revoked") {
    return "취소됨";
  }

  return "만료됨";
}

function formatInvitationDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
