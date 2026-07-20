"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, LogOut, Send, UserPlus, Users } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  createWorkspaceInvitation,
  leaveWorkspace,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  removeWorkspaceMember,
  type WorkspaceInvitation,
  type WorkspaceMember
} from "@/features/auth/api/client";
import { useAuthSession } from "@/features/auth/auth-session";
import { DashboardCard } from "./dashboard-card";
import { MemberProfileDialog } from "./member-profile-dialog";

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
  const teamStats = [
    { label: "전체", value: membersStatus === "success" ? members.length : "–" },
    {
      label: "접속 중",
      value: membersStatus === "success" ? onlineMembers.length : "–"
    },
    {
      label: "오프라인",
      value: membersStatus === "success" ? offlineMembers.length : "–"
    }
  ];

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
        className="min-h-[430px]"
        cursorTarget={{ id: "members", label: "멤버", type: "home_card" }}
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
                className="z-[100] w-72 rounded-[12px] border-[#e7e9ee] bg-white p-3 text-[#202124] shadow-xl shadow-slate-950/10"
                side="right"
                sideOffset={10}
              >
                <form className="grid gap-2" onSubmit={handleSubmitInvitation}>
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="초대 이메일"
                      className="h-8 rounded-[9px] border-[#e7e9ee] bg-[#f8f9fb] text-[13px] text-[#202124] placeholder:text-[#6b6f78]"
                      disabled={isInviteSubmitting}
                      inputMode="email"
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="이메일"
                      type="email"
                      value={inviteEmail}
                    />
                    <Button
                      disabled={isInviteSubmitting || inviteEmail.trim() === ""}
                      size="sm"
                      type="submit"
                    >
                      <Send />
                      {isInviteSubmitting ? "초대 중" : "초대"}
                    </Button>
                  </div>
                  {inviteError ? (
                    <p className="text-[12px] text-destructive">{inviteError}</p>
                  ) : null}
                  {inviteStatus ? (
                    <p className="text-[12px] text-[#6b6f78]">{inviteStatus}</p>
                  ) : null}
                  {inviteUrl ? (
                    <p className="break-all rounded-[9px] border border-[#e7e9ee] bg-[#f8f9fb] p-2 text-[12px] text-[#6b6f78]">
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
        title="팀 현황"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="grid grid-cols-3 gap-2">
            {teamStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[10px] border border-[#e7e9ee] bg-[#f8f9fb] px-2 py-2.5 text-center"
              >
                <p className="text-[17px] font-semibold leading-5 text-[#202124]">
                  {stat.value}
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[#6b6f78]">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
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
                className="flex w-full items-center gap-3 rounded-[10px] border border-[#e7e9ee] bg-[#f8f9fb] px-2.5 py-2"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-[#eef0ff] text-[#4855d4]">
                    {getInitial(invitation.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#202124]">
                    {invitation.email}
                  </p>
                  <p className="truncate text-[12px] text-[#6b6f78]">
                    대기중
                  </p>
                </div>
              </div>
            ))}
        </div>
      </DashboardCard>

      <MemberProfileDialog
        activeWorkspaceId={activeWorkspace?.id ?? null}
        canRemoveMember={canManageWorkspace}
        currentUserId={currentUserId}
        error={removeMemberError}
        isRemoving={removingMemberUserId === selectedMember?.userId}
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
        onRemoveMember={handleRemoveMember}
        workspaceName={activeWorkspace?.name ?? "Workspace"}
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
      className={`flex min-h-0 flex-1 items-center justify-center rounded-[10px] border border-[#e7e9ee] bg-[#f8f9fb] p-3 text-center text-[12px] font-medium ${
        tone === "danger" ? "text-destructive" : "text-[#6b6f78]"
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
  const title = isOnline ? "워크스페이스 접속 중" : "오프라인";
  const presenceClassName = isOnline
    ? "bg-emerald-500 ring-4 ring-emerald-500/10"
    : "bg-[#a8adb7] ring-4 ring-[#a8adb7]/10";

  return (
    <button
      className={[
        "flex w-full shrink-0 items-center justify-between gap-3 rounded-[9px] px-2 py-2 text-left transition hover:bg-[#f6f7f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "text-[#202124]" : "text-[#6b6f78]"
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`size-2.5 shrink-0 rounded-full ${presenceClassName}`} />
        <span className="truncate text-[12px] font-medium">
          {title} - {count}
        </span>
      </span>
      <ChevronRight
        className={[
          "size-4 shrink-0 transition-transform",
          active ? "rotate-90 text-[#202124]" : "text-[#a8adb7]"
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
      <div className="grid min-h-0 content-start gap-1 overflow-y-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {members.length === 0 ? (
          <div className="rounded-[9px] border border-[#e7e9ee] bg-[#f8f9fb] px-2 py-3 text-center text-[12px] text-[#6b6f78]">
            표시할 멤버가 없습니다
          </div>
        ) : null}
        {members.map((member) => (
          <button
            key={member.id}
            className="flex min-w-0 items-center gap-3 rounded-[9px] px-2 py-2 text-left transition hover:bg-[#f6f7f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
              <AvatarFallback className="bg-[#eef0ff] text-[#4855d4]">
                {getInitial(member.user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#202124]">
                {member.user.name ?? "이름 없음"}
              </p>
              <p className="truncate text-[12px] text-[#6b6f78]">
                {formatWorkspaceRole(member.role)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function getInitial(name: string | null) {
  return name?.trim().slice(0, 1) || "?";
}

function formatWorkspaceRole(role: WorkspaceMember["role"]) {
  return role === "owner" ? "Owner" : "Member";
}
