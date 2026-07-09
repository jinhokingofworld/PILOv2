"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ChevronRight,
  LogOut,
  Send,
  UserPlus,
  Users,
  XIcon
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  createWorkspaceInvitation,
  leaveWorkspace,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  type WorkspaceInvitation,
  type WorkspaceMember
} from "@/features/auth/api/client";
import { useAuthSession } from "@/features/auth/auth-session";
import { DashboardCard } from "./dashboard-card";

export function MembersCard() {
  const authSession = useAuthSession();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isInvitePopoverOpen, setIsInvitePopoverOpen] = useState(false);
  const [isInviteSubmitting, setIsInviteSubmitting] = useState(false);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isLeavingWorkspace, setIsLeavingWorkspace] = useState(false);
  const [leaveWorkspaceError, setLeaveWorkspaceError] = useState<string | null>(
    null
  );
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersStatus, setMembersStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [pendingInvitations, setPendingInvitations] = useState<
    WorkspaceInvitation[]
  >([]);
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);
  const [removingMemberUserId, setRemovingMemberUserId] = useState<string | null>(
    null
  );
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(
    null
  );
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(
    null
  );
  const [memberPresenceView, setMemberPresenceView] = useState<
    "offline" | "online"
  >("online");
  const activeWorkspace = authSession?.activeWorkspace;
  const canManageWorkspace =
    activeWorkspace?.role === "owner" || activeWorkspace?.isOwner === true;
  const currentUserId = authSession?.user.id ?? null;
  const onlineMembers = activeWorkspace
    ? members.filter(
        (member) =>
          member.user.activeWorkspaceId === activeWorkspace.id ||
          member.userId === currentUserId
      )
    : [];
  const offlineMembers = activeWorkspace
    ? members.filter(
        (member) =>
          member.user.activeWorkspaceId !== activeWorkspace.id &&
          member.userId !== currentUserId
      )
    : [];
  const canLeaveWorkspace = Boolean(activeWorkspace) && !canManageWorkspace;

  useEffect(() => {
    let active = true;

    async function loadWorkspaceMembers() {
      if (!authSession || !activeWorkspace) {
        setMembers([]);
        setMembersError(null);
        setMembersStatus("idle");
        setPendingInvitations([]);
        return;
      }

      setMembersStatus("loading");
      setMembersError(null);

      try {
        const workspaceMembers = await listWorkspaceMembers(
          authSession.accessToken,
          activeWorkspace.id
        );

        if (!active) {
          return;
        }

        setMembers(workspaceMembers);
        setMembersStatus("success");

        if (canManageWorkspace) {
          try {
            const invitations = await listWorkspaceInvitations(
              authSession.accessToken,
              activeWorkspace.id
            );

            if (active) {
              setPendingInvitations(invitations);
            }
          } catch {
            if (active) {
              setPendingInvitations([]);
            }
          }
        } else {
          setPendingInvitations([]);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setMembers([]);
        setMembersStatus("error");
        setMembersError(
          error instanceof Error ? error.message : "멤버 목록을 불러오지 못했습니다"
        );
        setPendingInvitations([]);
      }
    }

    void loadWorkspaceMembers();

    return () => {
      active = false;
    };
  }, [activeWorkspace, authSession, canManageWorkspace]);

  const handleSubmitInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !authSession ||
      !activeWorkspace ||
      !canManageWorkspace ||
      isInviteSubmitting ||
      inviteEmail.trim() === ""
    ) {
      return;
    }

    setInviteError(null);
    setInviteStatus(null);
    setInviteUrl(null);
    setIsInviteSubmitting(true);

    void createWorkspaceInvitation(
      authSession.accessToken,
      activeWorkspace.id,
      inviteEmail.trim()
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

  const handleRemoveMember = (member: WorkspaceMember) => {
    if (
      !authSession ||
      !activeWorkspace ||
      !canManageWorkspace ||
      removingMemberUserId ||
      member.userId === authSession.user.id ||
      member.role === "owner"
    ) {
      return;
    }

    setRemoveMemberError(null);
    setRemovingMemberUserId(member.userId);

    void removeWorkspaceMember(
      authSession.accessToken,
      activeWorkspace.id,
      member.userId
    )
      .then(() => {
        setMembers((currentMembers) =>
          currentMembers.filter(
            (currentMember) => currentMember.userId !== member.userId
          )
        );
        setSelectedMember(null);
      })
      .catch((error: unknown) => {
        setRemoveMemberError(
          error instanceof Error ? error.message : "멤버 추방에 실패했습니다"
        );
      })
      .finally(() => {
        setRemovingMemberUserId(null);
      });
  };

  const handleRevokeInvitation = (invitation: WorkspaceInvitation) => {
    if (
      !authSession ||
      !activeWorkspace ||
      !canManageWorkspace ||
      revokingInvitationId
    ) {
      return;
    }

    setInviteError(null);
    setRevokingInvitationId(invitation.id);

    void revokeWorkspaceInvitation(
      authSession.accessToken,
      activeWorkspace.id,
      invitation.id
    )
      .then(() => {
        setPendingInvitations((currentInvitations) =>
          currentInvitations.filter(
            (currentInvitation) => currentInvitation.id !== invitation.id
          )
        );
      })
      .catch((error: unknown) => {
        setInviteError(
          error instanceof Error ? error.message : "초대 취소에 실패했습니다"
        );
      })
      .finally(() => {
        setRevokingInvitationId(null);
      });
  };

  const handleLeaveWorkspace = () => {
    if (!authSession || !activeWorkspace || !canLeaveWorkspace) {
      return;
    }

    const nextWorkspaceId = authSession.workspaces.find(
      (workspace) => workspace.id !== activeWorkspace.id
    )?.id;

    setLeaveWorkspaceError(null);
    setIsLeavingWorkspace(true);

    void leaveWorkspace(authSession.accessToken, activeWorkspace.id)
      .then(async () => {
        setIsLeaveDialogOpen(false);
        await authSession.refreshSession(nextWorkspaceId);
      })
      .catch((error: unknown) => {
        setLeaveWorkspaceError(
          error instanceof Error ? error.message : "워크스페이스 나가기에 실패했습니다"
        );
      })
      .finally(() => {
        setIsLeavingWorkspace(false);
      });
  };

  return (
    <>
      <DashboardCard
        className="overflow-hidden border-[#1E1F22] bg-[#2B2D31] text-[#F2F3F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_24px_rgba(15,23,42,0.12)] xl:row-start-1 [&_[data-slot=card-action]_button]:border-[#3F4147] [&_[data-slot=card-action]_button]:bg-[#313338] [&_[data-slot=card-action]_button]:text-[#F2F3F5] [&_[data-slot=card-action]_button:hover]:bg-[#404249] [&_[data-slot=card-title]>span]:border-[#3F4147] [&_[data-slot=card-title]>span]:bg-[#313338] [&_[data-slot=card-title]>span]:text-[#B5BAC1] [&_[data-slot=card-title]]:text-[#F2F3F5]"
        action={
          canManageWorkspace ? (
            <Popover
              open={isInvitePopoverOpen}
              onOpenChange={(open) => {
                setIsInvitePopoverOpen(open);
                if (open) {
                  setInviteError(null);
                  setInviteStatus(null);
                  setInviteUrl(null);
                }
              }}
            >
              <PopoverTrigger
                render={
                  <Button aria-label="멤버 초대 열기" size="sm" variant="outline" />
                }
              >
                <UserPlus />
                초대
              </PopoverTrigger>
              <PopoverContent
                align="center"
                className="z-[100] w-64 border-[#3F4147] bg-[#313338] p-2.5 text-[#F2F3F5] shadow-xl shadow-slate-950/25"
                side="right"
                sideOffset={10}
              >
                <form className="grid gap-2" onSubmit={handleSubmitInvitation}>
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="초대 이메일"
                      className="h-7 rounded-lg border-[#3F4147] bg-[#1E1F22] text-xs text-[#F2F3F5] placeholder:text-[#80848E] focus-visible:border-[#5865F2] focus-visible:ring-[#5865F2]/35"
                      disabled={isInviteSubmitting}
                      inputMode="email"
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="이메일"
                      type="email"
                      value={inviteEmail}
                    />
                    <Button
                      className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
                      disabled={isInviteSubmitting || inviteEmail.trim() === ""}
                      size="sm"
                      type="submit"
                    >
                      <Send />
                      {isInviteSubmitting ? "초대 중" : "초대"}
                    </Button>
                  </div>
                  {inviteError ? (
                    <p className="text-xs text-[#F23F42]">{inviteError}</p>
                  ) : null}
                  {inviteStatus ? (
                    <p className="text-xs text-[#B5BAC1]">{inviteStatus}</p>
                  ) : null}
                  {inviteUrl ? (
                    <p className="break-all rounded-lg border border-[#3F4147] bg-[#1E1F22] p-2 text-xs text-[#B5BAC1]">
                      {inviteUrl}
                    </p>
                  ) : null}
                </form>
              </PopoverContent>
            </Popover>
          ) : (
            <Button
              aria-label="워크스페이스 나가기"
              disabled={!canLeaveWorkspace}
              onClick={() => {
                setLeaveWorkspaceError(null);
                setIsLeaveDialogOpen(true);
              }}
              size="sm"
              variant="outline"
            >
              <LogOut />
              나가기
            </Button>
          )
        }
        description={null}
        icon={<Users className="size-4" />}
        title="멤버"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {membersStatus === "loading" ? (
            <MemberCardMessage>멤버 불러오는 중</MemberCardMessage>
          ) : membersStatus === "error" ? (
            <MemberCardMessage tone="danger">
              {membersError ?? "멤버 목록을 불러오지 못했습니다"}
            </MemberCardMessage>
          ) : (
            <MemberPresencePanel
              offlineMembers={offlineMembers}
              onlineMembers={onlineMembers}
              onSelectMember={setSelectedMember}
              selectedView={memberPresenceView}
              setSelectedView={setMemberPresenceView}
            />
          )}
          {pendingInvitations
            .filter((invitation) => invitation.status === "pending")
            .map((invitation) => (
              <div
                key={invitation.id}
                className="flex w-full items-center gap-3 rounded-md border border-[#3F4147] bg-[#313338] px-1.5 py-1 shadow-sm"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-[#5865F2] text-white">
                    {getInitial(invitation.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {invitation.email}
                  </p>
                  <p className="truncate text-xs text-[#B5BAC1]">
                    대기중
                  </p>
                </div>
                <Button
                  aria-label={`${invitation.email} 초대 취소`}
                  className="text-[#B5BAC1] hover:bg-[#35373C] hover:text-[#F2F3F5]"
                  disabled={revokingInvitationId === invitation.id}
                  onClick={() => handleRevokeInvitation(invitation)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </div>
            ))}
        </div>
      </DashboardCard>

      <MemberProfileDialog
        canRemoveMember={canManageWorkspace}
        currentUserId={currentUserId}
        error={removeMemberError}
        isRemoving={removingMemberUserId === selectedMember?.userId}
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
        onRemoveMember={handleRemoveMember}
      />
      <AlertDialog
        open={isLeaveDialogOpen}
        onOpenChange={(open) => {
          if (!isLeavingWorkspace) {
            setIsLeaveDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>워크스페이스에서 나갈까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeWorkspace?.name ?? "현재 workspace"}에서 나가면 이 workspace의
              기능과 데이터에 접근할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {leaveWorkspaceError ? (
            <p className="text-sm text-destructive">{leaveWorkspaceError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeavingWorkspace}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isLeavingWorkspace || !canLeaveWorkspace}
              onClick={handleLeaveWorkspace}
              variant="destructive"
            >
              {isLeavingWorkspace ? "나가는 중" : "나가기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MemberCardMessage({
  children,
  tone = "muted"
}: {
  children: ReactNode;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center rounded-md border border-[#3F4147] bg-[#313338] p-3 text-center text-xs font-medium ${
        tone === "danger" ? "text-[#F23F42]" : "text-[#B5BAC1]"
      }`}
    >
      {children}
    </div>
  );
}

function MemberPresencePanel({
  offlineMembers,
  onlineMembers,
  onSelectMember,
  selectedView,
  setSelectedView
}: {
  offlineMembers: WorkspaceMember[];
  onlineMembers: WorkspaceMember[];
  onSelectMember: (member: WorkspaceMember) => void;
  selectedView: "offline" | "online";
  setSelectedView: (view: "offline" | "online") => void;
}) {
  const onlineHeader = (
    <MemberPresenceHeader
      active={selectedView === "online"}
      count={onlineMembers.length}
      onClick={() => setSelectedView("online")}
      type="online"
    />
  );
  const offlineHeader = (
    <MemberPresenceHeader
      active={selectedView === "offline"}
      count={offlineMembers.length}
      onClick={() => setSelectedView("offline")}
      type="offline"
    />
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {onlineHeader}
      <MemberPresenceList
        expanded={selectedView === "online"}
        members={onlineMembers}
        onSelectMember={onSelectMember}
      />
      {offlineHeader}
      <MemberPresenceList
        expanded={selectedView === "offline"}
        members={offlineMembers}
        onSelectMember={onSelectMember}
      />
    </section>
  );
}

function MemberPresenceHeader({
  active,
  count,
  onClick,
  type
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  type: "offline" | "online";
}) {
  const isOnline = type === "online";
  const title = isOnline ? "워크스페이스 접속중" : "오프라인";
  const presenceClassName = isOnline
    ? "bg-[#23A55A] ring-4 ring-[#23A55A]/20"
    : "bg-[#80848E] ring-4 ring-[#80848E]/18";

  return (
    <button
      className={[
        "flex w-full shrink-0 items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[#35373C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]/60",
        active ? "text-[#F2F3F5]" : "text-[#B5BAC1]"
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`size-2.5 shrink-0 rounded-full ${presenceClassName}`} />
        <span className="truncate text-xs font-medium">
          {title} - {count}
        </span>
      </span>
      <ChevronRight
        className={[
          "size-4 shrink-0 transition-transform",
          active ? "rotate-90 text-[#F2F3F5]" : "text-[#80848E]"
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </button>
  );
}

function MemberPresenceList({
  expanded,
  members,
  onSelectMember
}: {
  expanded: boolean;
  members: WorkspaceMember[];
  onSelectMember: (member: WorkspaceMember) => void;
}) {
  return (
    <div
      className={[
        "grid min-h-0 overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out",
        expanded
          ? "flex-1 grid-rows-[1fr] opacity-100"
          : "shrink-0 grid-rows-[0fr] opacity-0"
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="grid min-h-0 content-start gap-1.5 overflow-y-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {members.length === 0 ? (
          <div className="rounded-md border border-[#3F4147] bg-[#313338] px-2 py-3 text-center text-xs text-[#B5BAC1]">
            표시할 멤버가 없습니다
          </div>
        ) : null}
        {members.map((member) => (
          <button
            key={member.id}
            className="flex min-w-0 items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[#35373C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]/60"
            onClick={() => onSelectMember(member)}
            tabIndex={expanded ? 0 : -1}
            type="button"
          >
            <Avatar size="sm">
              {member.user.avatarUrl ? (
                <AvatarImage
                  alt={member.user.name ?? "Workspace member"}
                  src={member.user.avatarUrl}
                />
              ) : null}
              <AvatarFallback className="bg-[#5865F2] text-white">
                {getInitial(member.user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#F2F3F5]">
                {member.user.name ?? "이름 없음"}
              </p>
              <p className="truncate text-xs text-[#B5BAC1]">
                {formatWorkspaceRole(member.role)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberProfileDialog({
  canRemoveMember,
  currentUserId,
  error,
  isRemoving,
  member,
  onClose,
  onRemoveMember
}: {
  canRemoveMember: boolean;
  currentUserId: string | null;
  error: string | null;
  isRemoving: boolean;
  member: WorkspaceMember | null;
  onClose: () => void;
  onRemoveMember: (member: WorkspaceMember) => void;
}) {
  const isActive = Boolean(member);
  const canRemoveSelectedMember =
    Boolean(member) &&
    canRemoveMember &&
    member?.userId !== currentUserId &&
    member?.role !== "owner";
  const showRemoveAction = member?.role !== "owner";

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {member ? (
          <>
            <DialogHeader>
              <DialogTitle>Profile</DialogTitle>
              <DialogDescription>Workspace member profile</DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3">
              <Avatar>
                {member.user.avatarUrl ? (
                  <AvatarImage
                    alt={member.user.name ?? "Workspace member"}
                    src={member.user.avatarUrl}
                  />
                ) : null}
                <AvatarFallback>{getInitial(member.user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.user.name ?? "Unknown"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.user.email ?? "No email"}
                </p>
              </div>
            </div>

            <Separator />

            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="font-medium">{formatWorkspaceRole(member.role)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="flex items-center gap-2 font-medium">
                  <WorkspacePresenceIndicator active={isActive} />
                  {isActive ? "In workspace" : "Away"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="font-medium">{formatProfileDate(member.joinedAt)}</dd>
              </div>
            </dl>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {showRemoveAction ? (
              <div className="flex justify-end">
                <Button
                  disabled={!canRemoveSelectedMember || isRemoving}
                  onClick={() => onRemoveMember(member)}
                  variant="destructive"
                >
                  {isRemoving ? "추방 중" : "추방"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}



function WorkspacePresenceIndicator({ active }: { active: boolean }) {
  const label = active ? "In workspace" : "Away";

  return (
    <span
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border bg-background"
      title={label}
    >
      <span
        className={`size-2.5 rounded-full ${
          active
            ? "bg-emerald-500 ring-4 ring-emerald-500/15"
            : "bg-muted-foreground/35 ring-4 ring-muted"
        }`}
      />
    </span>
  );
}

function getInitial(name: string | null) {
  return name?.trim().slice(0, 1) || "?";
}

function formatWorkspaceRole(role: WorkspaceMember["role"]) {
  return role;
}

function formatProfileDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}
