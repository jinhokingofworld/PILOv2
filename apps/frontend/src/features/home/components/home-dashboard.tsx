"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronRight,
  FileText,
  GitPullRequest,
  ListChecks,
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
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
import { createBoardApiClient } from "@/features/board/api/client";
import type {
  BoardIssueCardPayload,
  BoardPayload
} from "@/features/board/types";
import { createCalendarApiClient } from "@/features/calendar/api/client";
import type { CalendarEvent } from "@/features/calendar/types";
import {
  createCanvasClient,
  type CanvasBoardSummary
} from "@/features/canvas/api/canvas-client";
import { createGithubIntegrationApiClient } from "@/features/github-integration/api/client";
import type {
  GithubOAuthStatus,
  GithubPullRequest,
  GithubRepository
} from "@/features/github-integration/types";
import { readGithubBoardSelection } from "@/features/github-integration/utils/github-board-selection";
import { createMeetingApiClient } from "@/features/meeting/api/client";
import type { MeetingReportSummary } from "@/features/meeting/types";
import { createSqlErdApiClient } from "@/features/sql-erd/api/client";
import type { SqltoerdSessionPayload } from "@/features/sql-erd/types";

const calendarWeekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const homeIssueListLimit = 5;
const homePullRequestListLimit = 3;
const homeMeetingReportListLimit = 4;
const homeMeetingReportFetchLimit = 100;

type HomeIssuesMode = "assigned" | "recent";

type HomeIssuesState = {
  error: Error | null;
  githubLogin: string | null;
  issues: BoardIssueCardPayload[];
  mode: HomeIssuesMode;
  status: "idle" | "loading" | "success" | "error";
  total: number;
};

type HomePullRequestsState = {
  error: Error | null;
  pullRequests: GithubPullRequest[];
  status: "idle" | "loading" | "success" | "error";
  total: number;
};

type HomeMeetingReportsState = {
  error: Error | null;
  reports: MeetingReportSummary[];
  status: "idle" | "loading" | "success" | "error";
  todayCount: number;
};

type HomeCanvasState = {
  error: Error | null;
  recentBoard: CanvasBoardSummary | null;
  status: "idle" | "loading" | "success" | "error";
};

type HomeSqlErdState = {
  error: Error | null;
  session: SqltoerdSessionPayload | null;
  status: "idle" | "loading" | "success" | "error";
};

type HomeGithubOAuthState = {
  error: Error | null;
  status: "idle" | "loading" | "success" | "error";
  value: GithubOAuthStatus | null;
};

export function HomeDashboard() {
  const authSession = useAuthSession();
  const today = useMemo(() => new Date(), []);
  const calendarDates = useMemo(() => getCalendarRangeDates(today, 14), [today]);
  const calendarRange = useMemo(
    () => ({
      end: formatCalendarDate(calendarDates[calendarDates.length - 1]),
      start: formatCalendarDate(calendarDates[0])
    }),
    [calendarDates]
  );
  const calendarEventsState = useHomeWeekCalendarEvents({
    accessToken: authSession?.accessToken ?? null,
    range: calendarRange,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const issuesState = useHomeIssues({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const pullRequestsState = useHomePullRequests({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const meetingReportsState = useHomeMeetingReports({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[0.9fr_1.75fr_1fr] xl:grid-rows-[minmax(0,330px)_minmax(272px,1fr)_128px]">
        <MembersCard />
        <CalendarCard
          calendarDates={calendarDates}
          calendarEventsState={calendarEventsState}
          today={today}
        />
        <SummaryMetricsPanel
          calendarEventsState={calendarEventsState}
          issuesState={issuesState}
          meetingReportsState={meetingReportsState}
          pullRequestsState={pullRequestsState}
          today={today}
        />
        <MiddleDashboardCards
          issuesState={issuesState}
          meetingReportsState={meetingReportsState}
          pullRequestsState={pullRequestsState}
        />
        <GithubWorkspaceCards />
      </div>
    </section>
  );
}

function MembersCard() {
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

function CalendarCard({
  calendarDates,
  calendarEventsState,
  today
}: {
  calendarDates: Date[];
  calendarEventsState: HomeWeekCalendarEventsState;
  today: Date;
}) {
  return (
    <div className="h-full min-h-0 overflow-hidden xl:col-start-2 xl:row-start-1">
      <ReadonlyCalendar
        calendarDates={calendarDates}
        calendarEventsState={calendarEventsState}
        today={today}
      />
    </div>
  );
}

function SummaryMetricsPanel({
  calendarEventsState,
  issuesState,
  meetingReportsState,
  pullRequestsState,
  today
}: {
  calendarEventsState: HomeWeekCalendarEventsState;
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
  today: Date;
}) {
  const summaryItems = getHomeSummaryItems({
    calendarEventsState,
    issuesState,
    meetingReportsState,
    pullRequestsState,
    today
  });

  return (
    <div className="grid h-full min-h-0 grid-rows-4 gap-3 overflow-hidden xl:col-start-3 xl:row-start-1">
      {summaryItems.map((item) => (
        <SummaryMetricCard key={item.label} item={item} variant="compact" />
      ))}
    </div>
  );
}

function MiddleDashboardCards({
  issuesState,
  meetingReportsState,
  pullRequestsState
}: {
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
}) {
  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-3 xl:col-span-3 xl:col-start-1 xl:row-start-2">
      <IssuesCard issuesState={issuesState} />
      <PullRequestsCard pullRequestsState={pullRequestsState} />
      <MeetingReportsCard meetingReportsState={meetingReportsState} />
    </div>
  );
}

function MeetingReportsCard({
  meetingReportsState
}: {
  meetingReportsState: HomeMeetingReportsState;
}) {
  const router = useRouter();
  const visibleMeetingReports = meetingReportsState.reports.slice(
    0,
    homeMeetingReportListLimit
  );
  const isLoading = meetingReportsState.status === "loading";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction
          ariaLabel="회의록으로 이동"
          href="/meeting#report"
        />
      }
      background={<MeetingReportsBackground />}
      className="border-[#CBEFBD] bg-[#F5FCF2] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<FileText className="size-4" />}
      title="회의록"
      titleClassName="text-[#1F7A00]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(4,minmax(0,1fr))] gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage rowSpanClassName="row-span-4">
            회의록 불러오는 중
          </DashboardCardMessage>
        ) : meetingReportsState.status === "error" ? (
          <DashboardCardMessage rowSpanClassName="row-span-4" tone="danger">
            회의록을 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visibleMeetingReports.length > 0 ? (
          visibleMeetingReports.map((report) => (
            <button
              key={report.id}
              aria-label={`${formatMeetingReportTitle(report)} 회의록으로 이동`}
              className="flex min-h-0 flex-col justify-center overflow-hidden rounded-lg border bg-background/90 p-2.5 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => router.push(buildMeetingReportHref(report.id))}
              type="button"
            >
              <p className="min-w-0 truncate text-sm font-medium leading-5">
                {formatMeetingReportTitle(report)}
              </p>
              <p className="mt-0.5 min-w-0 truncate text-xs leading-4 text-muted-foreground">
                {report.summary?.trim() || getMeetingReportFallbackSummary(report)}
              </p>
            </button>
          ))
        ) : (
          <DashboardCardMessage rowSpanClassName="row-span-4">
            표시할 회의록이 없습니다
          </DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}

function buildMeetingReportHref(reportId: string) {
  const searchParams = new URLSearchParams({
    reportId
  });

  return `/meeting?${searchParams.toString()}#report`;
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

function IssuesCard({ issuesState }: { issuesState: HomeIssuesState }) {
  const visibleTodoIssues = issuesState.issues.slice(0, homeIssueListLimit);
  const isLoading = issuesState.status === "loading";
  const isRecentMode = issuesState.mode === "recent";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="이슈로 이동" href="/board#issues" />
      }
      background={<IssuesBackground />}
      className="border-[#D8D1FF] bg-[#F7F5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<ListChecks className="size-4" />}
      title={isRecentMode ? "최근 이슈" : "내 이슈"}
      titleAdornment={
        isRecentMode ? (
          <span className="min-w-0 truncate text-[0.7rem] font-medium text-destructive">
            GitHub 연결 시 내 담당 이슈만 볼 수 있어요
          </span>
        ) : null
      }
      titleClassName="text-[#5B4BC4]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(5,minmax(0,1fr))] gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage>이슈 불러오는 중</DashboardCardMessage>
        ) : issuesState.status === "error" ? (
          <DashboardCardMessage tone="danger">
            이슈를 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visibleTodoIssues.length > 0 ? (
          visibleTodoIssues.map((issue) => (
            <IssueTodoRow key={issue.id} issue={issue} />
          ))
        ) : (
          <DashboardCardMessage>표시할 open 이슈가 없습니다</DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}

function GithubWorkspaceCards() {
  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-2 xl:col-span-3 xl:col-start-1 xl:row-start-3">
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

function PullRequestsCard({
  pullRequestsState
}: {
  pullRequestsState: HomePullRequestsState;
}) {
  const visiblePullRequests = pullRequestsState.pullRequests.slice(
    0,
    homePullRequestListLimit
  );
  const isLoading = pullRequestsState.status === "loading";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="PR 리뷰로 이동" href="/pr-review" />
      }
      background={<PullRequestsBackground />}
      className="border-[#C8CCF2] bg-[#F5F6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<GitPullRequest className="size-4" />}
      title="PR"
      titleClassName="text-[#000080]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(3,minmax(0,1fr))] gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage rowSpanClassName="row-span-3">
            PR 불러오는 중
          </DashboardCardMessage>
        ) : pullRequestsState.status === "error" ? (
          <DashboardCardMessage rowSpanClassName="row-span-3" tone="danger">
            PR을 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visiblePullRequests.length > 0 ? (
          visiblePullRequests.map((pullRequest) => (
            <PullRequestRow key={pullRequest.id} pullRequest={pullRequest} />
          ))
        ) : (
          <DashboardCardMessage rowSpanClassName="row-span-3">
            표시할 open PR이 없습니다
          </DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}

function DashboardCard({
  background,
  children,
  className,
  description,
  icon,
  action,
  title,
  titleAdornment,
  titleClassName
}: {
  background?: ReactNode;
  children: ReactNode;
  className?: string;
  description: string | null;
  icon: ReactNode;
  action?: ReactNode;
  title: string;
  titleAdornment?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <Card className={`relative h-full min-h-0 ${className ?? ""} shadow-sm`} size="sm">
      {background ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {background}
        </div>
      ) : null}
      <CardHeader className="relative z-10">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg border bg-background text-muted-foreground">
            {icon}
          </span>
          <span className={titleClassName}>{title}</span>
          {titleAdornment}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <CardAction>
          {action ?? (
            <Button variant="ghost" size="icon-sm" aria-label={`${title} 열기`}>
              <ChevronRight />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-4">
        {children}
      </CardContent>
    </Card>
  );
}

function DashboardNavigationAction({
  ariaLabel,
  href
}: {
  ariaLabel: string;
  href: string;
}) {
  const router = useRouter();

  return (
    <Button
      aria-label={ariaLabel}
      onClick={() => router.push(href)}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <ChevronRight />
    </Button>
  );
}

function CalendarBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F4FBFA]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#2EC4B6]" />
      <div className="absolute inset-x-6 top-16 grid grid-cols-7 gap-2 opacity-35">
        {Array.from({ length: 14 }, (_, item) => (
          <span
            key={item}
            className="h-5 rounded border border-[#B7DCD7] bg-white/50"
          />
        ))}
      </div>
      <div className="absolute right-7 top-8 grid grid-cols-4 gap-2 opacity-25">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#0F766E]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

function MeetingReportsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5FCF2]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#2DB400]" />
      <div className="absolute right-5 top-6 h-24 w-28 rotate-2 rounded-lg border border-[#CBEFBD] bg-white/55 shadow-sm" />
      <div className="absolute right-9 top-11 h-1.5 w-16 rounded-full bg-[#2DB400]/35" />
      <div className="absolute right-9 top-[3.75rem] h-1.5 w-20 rounded-full bg-[#2DB400]/22" />
      <div className="absolute right-9 top-[5.25rem] h-1.5 w-14 rounded-full bg-[#2DB400]/18" />
      <div className="absolute left-6 top-24 grid grid-cols-4 gap-2 opacity-18">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#1F7A00]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

function IssuesBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F7F5FF]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#9986F4]" />
      <div className="absolute right-6 top-7 grid gap-2 opacity-35">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="size-3 rounded border border-[#D8D1FF] bg-white/65" />
            <span className="h-1.5 w-20 rounded-full bg-[#9986F4]/35" />
          </div>
        ))}
      </div>
      <div className="absolute left-6 top-20 grid grid-cols-4 gap-2 opacity-20">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#5B4BC4]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

function PullRequestsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5F6FF]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#000080]" />
      <div className="absolute right-4 top-6 grid w-28 gap-1.5 opacity-35">
        <div className="h-1.5 rounded-full bg-[#000080]/45" />
        <div className="h-1.5 w-20 rounded-full bg-[#000080]/25" />
        <div className="h-1.5 w-24 rounded-full bg-[#000080]/30" />
        <div className="h-1.5 w-16 rounded-full bg-[#000080]/20" />
      </div>
      <div className="absolute left-7 top-20 h-px w-28 rotate-[-8deg] bg-[#000080]/25" />
      <div className="absolute left-8 top-[5.35rem] size-2.5 rounded-full bg-[#000080]/30" />
      <div className="absolute right-12 top-[4.4rem] size-2.5 rounded-full bg-[#000080]/20" />
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

function ReadonlyCalendar({
  calendarDates,
  calendarEventsState,
  today
}: {
  calendarDates: Date[];
  calendarEventsState: HomeWeekCalendarEventsState;
  today: Date;
}) {
  const router = useRouter();
  const {
    events: calendarEvents,
    error: calendarEventsError,
    status: calendarEventsStatus
  } = calendarEventsState;
  const calendarTitle = formatCalendarRangeMonthTitle(calendarDates);

  return (
    <>
      <Card
        className="relative h-full min-h-0 border-[#B7DCD7] bg-[#F4FBFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
        size="sm"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <CalendarBackground />
        </div>
        <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
              <CalendarDays className="size-4" />
            </span>
            <p className="text-sm font-semibold text-foreground">{calendarTitle}</p>
            {calendarEventsStatus === "error" ? (
              <span
                className="truncate text-xs text-destructive"
                title={calendarEventsError?.message}
              >
                일정 불러오기 실패
              </span>
            ) : null}
            <Button
              aria-label="캘린더로 이동"
              className="ml-auto"
              onClick={() => router.push("/calendar")}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-2 gap-1.5">
            {calendarDates.map((date) => {
              const isToday = isSameCalendarDate(date, today);
              const dateValue = formatCalendarDate(date);
              const dateEvents = calendarEvents.filter((event) =>
                isCalendarEventOnDate(event, dateValue)
              );
              const visibleEvents = dateEvents.slice(0, 3);
              const hiddenEventCount = Math.max(
                0,
                dateEvents.length - visibleEvents.length
              );

              return (
                <button
                  key={date.toISOString()}
                  aria-label={`${dateValue} 캘린더로 이동`}
                  onClick={() => router.push(`/calendar?date=${dateValue}`)}
                  className={[
                    "flex min-h-0 min-w-0 flex-col items-stretch justify-between gap-1 rounded-md border bg-background/80 p-1.5 text-left text-xs shadow-sm transition hover:bg-muted/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isToday ? "border-primary text-primary" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[0.65rem] font-medium leading-none text-muted-foreground">
                      {calendarWeekdayLabels[date.getDay()]}
                    </span>
                    <span
                      className={
                        isToday
                          ? "flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                          : "flex size-5 items-center justify-center font-medium"
                      }
                    >
                      {date.getDate()}
                    </span>
                  </span>
                  <span className="flex min-h-0 flex-1 flex-col justify-center gap-1">
                    {visibleEvents.length > 0 ? (
                      <>
                        {visibleEvents.map((event) => (
                          <span
                            key={event.id}
                            className="block min-w-0 truncate rounded-sm px-1 py-0.5 text-center text-[0.65rem] leading-none text-white"
                            style={{ backgroundColor: event.color }}
                          >
                            {event.isAllDay ? "종일" : event.startTime}{" "}
                            {event.title}
                          </span>
                        ))}
                        {hiddenEventCount > 0 ? (
                          <span
                            aria-label={`${hiddenEventCount}개 일정 더 있음`}
                            className="self-center rounded-full border border-[#B7DCD7] bg-[#2EC4B6]/10 px-1.5 py-0.5 text-[0.6rem] font-semibold leading-none text-[#0F766E]"
                          >
                            +{hiddenEventCount}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function getHomeSummaryItems({
  calendarEventsState,
  issuesState,
  meetingReportsState,
  pullRequestsState,
  today
}: {
  calendarEventsState: HomeWeekCalendarEventsState;
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
  today: Date;
}) {
  const todayDate = formatCalendarDate(today);
  const todayEventCount = calendarEventsState.events.filter((event) =>
    isCalendarEventOnDate(event, todayDate)
  ).length;
  const issueCount =
    issuesState.status === "loading" ? "-" : String(issuesState.total);
  const issueSummaryLabel =
    issuesState.mode === "assigned" ? "내 이슈" : "최근 이슈";
  const pullRequestCount =
    pullRequestsState.status === "loading" ? "-" : String(pullRequestsState.total);
  const meetingReportCount =
    meetingReportsState.status === "loading"
      ? "-"
      : String(meetingReportsState.todayCount);

  return [
    {
      icon: <CalendarDays className="size-4" />,
      label: "오늘 일정",
      value: String(todayEventCount),
      background: <SummaryCalendarBackground />,
      className:
        "border-[#B7DCD7] bg-[#F4FBFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress: getCappedProgressPercent(todayEventCount, 5),
      tone: "calendar"
    },
    {
      icon: <ListChecks className="size-4" />,
      label: issueSummaryLabel,
      value: issueCount,
      background: <SummaryIssuesBackground />,
      className:
        "border-[#D8D1FF] bg-[#F7F5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        issuesState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(issuesState.total, homeIssueListLimit),
      tone: "issues"
    },
    {
      icon: <GitPullRequest className="size-4" />,
      label: "리뷰 대기",
      value: pullRequestCount,
      background: <SummaryPullRequestsBackground />,
      className:
        "border-[#C8CCF2] bg-[#F5F6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        pullRequestsState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(
              pullRequestsState.total,
              homePullRequestListLimit
            ),
      tone: "pullRequests"
    },
    {
      icon: <FileText className="size-4" />,
      label: "최근 생성된 회의록",
      value: meetingReportCount,
      background: <SummaryMeetingReportsBackground />,
      className:
        "border-[#CBEFBD] bg-[#F5FCF2] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        meetingReportsState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(
              meetingReportsState.todayCount,
              homeMeetingReportListLimit
            ),
      tone: "meetingReports"
    }
  ] satisfies SummaryMetricItem[];
}

function SummaryCalendarBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F4FBFA]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#2EC4B6]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.055)]" />
    </>
  );
}

function SummaryIssuesBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F7F5FF]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#9986F4]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}

function SummaryPullRequestsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5F6FF]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#000080]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}

function SummaryMeetingReportsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5FCF2]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#2DB400]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}

type SummaryMetricTone =
  | "calendar"
  | "issues"
  | "meetingReports"
  | "pullRequests";

type SummaryMetricItem = {
  background: ReactNode;
  className?: string;
  icon: ReactNode;
  label: string;
  progress: string;
  tone: SummaryMetricTone;
  value: string;
};

function SummaryMetricCard({
  item,
  variant = "default"
}: {
  item: SummaryMetricItem;
  variant?: "compact" | "default";
}) {
  const tone = getSummaryMetricTone(item.tone);

  if (variant === "compact") {
    return (
      <Card
        className={`relative min-h-0 overflow-hidden shadow-sm ${tone.borderClassName} ${tone.surfaceClassName} ${item.className ?? ""}`}
        size="sm"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {item.background}
        </div>
        <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col justify-between gap-1.5">
          <div className="flex min-h-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background/90 text-muted-foreground backdrop-blur ${tone.iconBorderClassName}`}
              >
                {item.icon}
              </span>
              <p
                className={`min-w-0 truncate text-sm font-semibold ${tone.labelClassName}`}
              >
                {item.label}
              </p>
            </div>
            <div className="flex shrink-0 items-baseline gap-1 text-right">
              <span
                className={`text-3xl font-semibold leading-none ${tone.valueClassName}`}
              >
                {item.value}
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none ${tone.unitClassName}`}
              >
                개
              </span>
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-950/5">
            <div
              className={`h-full rounded-full ${tone.progressClassName}`}
              style={{ width: item.progress }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`relative min-h-0 overflow-hidden shadow-sm ${tone.borderClassName} ${tone.surfaceClassName} ${item.className ?? ""}`}
      size="sm"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {item.background}
      </div>
      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background/90 text-muted-foreground backdrop-blur ${tone.iconBorderClassName}`}
          >
            {item.icon}
          </span>
          <p className={`min-w-0 truncate text-sm font-semibold ${tone.labelClassName}`}>
            {item.label}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-end">
          <div className="flex items-baseline gap-1 text-right">
            <span className={`text-4xl font-semibold leading-none ${tone.valueClassName}`}>
              {item.value}
            </span>
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none ${tone.unitClassName}`}
            >
              개
            </span>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-950/5">
          <div
            className={`h-full rounded-full ${tone.progressClassName}`}
            style={{ width: item.progress }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function getSummaryMetricTone(tone: SummaryMetricTone) {
  return {
    calendar: {
      borderClassName: "border-[#B7DCD7]",
      iconBorderClassName: "border-[#B7DCD7]",
      progressClassName: "bg-[#2EC4B6]",
      surfaceClassName: "bg-[#F4FBFA]",
      labelClassName: "text-[#0F766E]",
      unitClassName: "border-[#B7DCD7] bg-[#2EC4B6]/10 text-[#0F766E]",
      valueClassName: "text-[#134E4A]"
    },
    issues: {
      borderClassName: "border-[#D8D1FF]",
      iconBorderClassName: "border-[#D8D1FF]",
      progressClassName: "bg-[#9986F4]",
      surfaceClassName: "bg-[#F7F5FF]",
      labelClassName: "text-[#5B4BC4]",
      unitClassName: "border-[#D8D1FF] bg-[#9986F4]/10 text-[#5B4BC4]",
      valueClassName: "text-[#372A8C]"
    },
    meetingReports: {
      borderClassName: "border-[#CBEFBD]",
      iconBorderClassName: "border-[#CBEFBD]",
      progressClassName: "bg-[#2DB400]",
      surfaceClassName: "bg-[#F5FCF2]",
      labelClassName: "text-[#1F7A00]",
      unitClassName: "border-[#CBEFBD] bg-[#2DB400]/10 text-[#1F7A00]",
      valueClassName: "text-[#174F00]"
    },
    pullRequests: {
      borderClassName: "border-[#C8CCF2]",
      iconBorderClassName: "border-[#C8CCF2]",
      progressClassName: "bg-[#000080]",
      surfaceClassName: "bg-[#F5F6FF]",
      labelClassName: "text-[#000080]",
      unitClassName: "border-[#C8CCF2] bg-[#000080]/10 text-[#000080]",
      valueClassName: "text-[#00004D]"
    }
  }[tone];
}

function DashboardCardMessage({
  children,
  rowSpanClassName = "row-span-5",
  tone = "muted"
}: {
  children: ReactNode;
  rowSpanClassName?: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={`${rowSpanClassName} flex min-h-0 items-center justify-center rounded-lg border bg-background/80 p-3 text-center text-xs font-medium shadow-sm backdrop-blur ${
        tone === "danger" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}

function IssueTodoRow({ issue }: { issue: BoardIssueCardPayload }) {
  const router = useRouter();
  const boardIssueHref = `/board?boardId=${encodeURIComponent(
    issue.boardId
  )}&issueId=${encodeURIComponent(issue.id)}#issues`;

  return (
    <button
      aria-label={`${issue.title} 이슈로 이동`}
      className="flex min-h-0 min-w-0 items-center overflow-hidden rounded-lg border bg-background/90 p-3 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => router.push(boardIssueHref)}
      type="button"
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {issue.title}
        </p>
        <StatusPill label={issue.issueNumber} tone="neutral" />
      </div>
    </button>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: GithubPullRequest }) {
  const router = useRouter();

  const handleOpenPullRequest = () => {
    const searchParams = new URLSearchParams({
      pullRequestId: pullRequest.id,
      repositoryId: pullRequest.repositoryId
    });

    router.push(`/pr-review?${searchParams.toString()}`);
  };

  return (
    <button
      aria-label={`${pullRequest.title} PR 리뷰로 이동`}
      className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden rounded-lg border bg-background/90 p-3 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={handleOpenPullRequest}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {pullRequest.title}
        </p>
        <StatusPill
          label={pullRequest.draft ? "Draft" : `#${pullRequest.githubNumber}`}
          tone={pullRequest.draft ? "muted" : "neutral"}
        />
      </div>
      <p className="mt-1 min-w-0 truncate text-xs text-muted-foreground">
        {pullRequest.headBranch} → {pullRequest.baseBranch} ·{" "}
        {pullRequest.changedFilesCount} files
      </p>
    </button>
  );
}

function getCalendarRangeDates(anchorDate: Date, dayCount: number) {
  const rangeStartDate = new Date(anchorDate);
  rangeStartDate.setDate(anchorDate.getDate() - anchorDate.getDay());

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(rangeStartDate);
    date.setDate(rangeStartDate.getDate() + index);
    return date;
  });
}

function formatCalendarRangeMonthTitle(dates: Date[]) {
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  if (!firstDate || !lastDate) {
    return "";
  }

  const firstMonth = `${firstDate.getMonth() + 1}월`;
  const lastMonth = `${lastDate.getMonth() + 1}월`;

  return firstMonth === lastMonth ? firstMonth : `${firstMonth} - ${lastMonth}`;
}

const emptyHomeIssuesState: HomeIssuesState = {
  error: null,
  githubLogin: null,
  issues: [],
  mode: "recent",
  status: "idle",
  total: 0
};

const emptyHomePullRequestsState: HomePullRequestsState = {
  error: null,
  pullRequests: [],
  status: "idle",
  total: 0
};

const emptyHomeMeetingReportsState: HomeMeetingReportsState = {
  error: null,
  reports: [],
  status: "idle",
  todayCount: 0
};

const emptyHomeCanvasState: HomeCanvasState = {
  error: null,
  recentBoard: null,
  status: "idle"
};

const emptyHomeSqlErdState: HomeSqlErdState = {
  error: null,
  session: null,
  status: "idle"
};

const emptyHomeGithubOAuthState: HomeGithubOAuthState = {
  error: null,
  status: "idle",
  value: null
};

function useHomeGithubOAuthStatus({
  accessToken
}: {
  accessToken: string | null;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeGithubOAuthState>(
    emptyHomeGithubOAuthState
  );

  useEffect(() => {
    let active = true;

    async function loadGithubOAuthStatus() {
      if (!normalizedAccessToken) {
        setState(emptyHomeGithubOAuthState);
        return;
      }

      setState({
        ...emptyHomeGithubOAuthState,
        status: "loading"
      });

      try {
        const value = await githubClient.getGithubOAuthStatus();

        if (active) {
          setState({
            error: null,
            status: "success",
            value
          });
        }
      } catch (error) {
        if (active) {
          setState({
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
            value: null
          });
        }
      }
    }

    void loadGithubOAuthStatus();

    return () => {
      active = false;
    };
  }, [githubClient, normalizedAccessToken]);

  return state;
}

function useHomeIssues({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeIssuesState>(emptyHomeIssuesState);

  useEffect(() => {
    let active = true;

    async function loadIssues() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeIssuesState);
        return;
      }

      setState({
        ...emptyHomeIssuesState,
        status: "loading"
      });

      try {
        const [boards, githubStatus] = await Promise.all([
          boardClient.listBoards(normalizedWorkspaceId, {
            limit: 50
          }),
          githubClient.getGithubOAuthStatus().catch(() => null)
        ]);
        const board = selectHomeBoard(boards.data, normalizedWorkspaceId);
        const githubLogin = githubStatus?.githubLogin?.trim() || null;
        const mode: HomeIssuesMode = githubLogin ? "assigned" : "recent";

        if (!board) {
          if (active) {
            setState({
              error: null,
              githubLogin,
              issues: [],
              mode,
              status: "success",
              total: 0
            });
          }
          return;
        }

        const issues = await boardClient.listBoardIssues(
          normalizedWorkspaceId,
          board.id,
          {
            assignee: githubLogin ?? undefined,
            limit: homeIssueListLimit,
            page: 1,
            state: "open"
          }
        );

        if (active) {
          setState({
            error: null,
            githubLogin,
            issues: issues.data,
            mode,
            status: "success",
            total: issues.meta.total
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeIssuesState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadIssues();

    return () => {
      active = false;
    };
  }, [boardClient, githubClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

function useHomePullRequests({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomePullRequestsState>(
    emptyHomePullRequestsState
  );

  useEffect(() => {
    let active = true;

    async function loadPullRequests() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomePullRequestsState);
        return;
      }

      setState({
        ...emptyHomePullRequestsState,
        status: "loading"
      });

      try {
        const repositories = await githubClient.listGithubRepositories(
          normalizedWorkspaceId,
          {
            includeArchived: false,
            limit: 100
          }
        );
        const repositoryId = selectHomeRepositoryId(
          repositories.data,
          normalizedWorkspaceId
        );

        if (!repositoryId) {
          if (active) {
            setState({
              error: null,
              pullRequests: [],
              status: "success",
              total: 0
            });
          }
          return;
        }

        const pullRequests = await githubClient.listGithubPullRequests(
          normalizedWorkspaceId,
          repositoryId,
          {
            limit: homePullRequestListLimit,
            page: 1,
            state: "open"
          }
        );

        if (active) {
          setState({
            error: null,
            pullRequests: pullRequests.data,
            status: "success",
            total: pullRequests.meta.total
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomePullRequestsState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadPullRequests();

    return () => {
      active = false;
    };
  }, [githubClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

function useHomeMeetingReports({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const meetingClient = useMemo(
    () =>
      createMeetingApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeMeetingReportsState>(
    emptyHomeMeetingReportsState
  );

  useEffect(() => {
    let active = true;

    async function loadMeetingReports() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeMeetingReportsState);
        return;
      }

      setState({
        ...emptyHomeMeetingReportsState,
        status: "loading"
      });

      try {
        const reports = await meetingClient.listMeetingReports(
          normalizedWorkspaceId,
          {
            limit: homeMeetingReportFetchLimit
          }
        );

        if (active) {
          setState({
            error: null,
            reports: reports.reports.slice(0, homeMeetingReportListLimit),
            status: "success",
            todayCount: countTodayMeetingReports(reports.reports)
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeMeetingReportsState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadMeetingReports();

    return () => {
      active = false;
    };
  }, [meetingClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

function useHomeCanvasSummary({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const canvasClient = useMemo(
    () =>
      createCanvasClient({
        authToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeCanvasState>(emptyHomeCanvasState);

  useEffect(() => {
    let active = true;

    async function loadCanvasSummary() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeCanvasState);
        return;
      }

      setState({
        ...emptyHomeCanvasState,
        status: "loading"
      });

      try {
        const boards = (await canvasClient.listBoards(
          normalizedWorkspaceId
        )) as CanvasBoardSummary[];

        if (active) {
          setState({
            error: null,
            recentBoard: selectRecentlyUpdatedCanvasBoard(boards),
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeCanvasState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadCanvasSummary();

    return () => {
      active = false;
    };
  }, [canvasClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

function useHomeSqlErdSession({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const sqlErdClient = useMemo(
    () =>
      createSqlErdApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeSqlErdState>(emptyHomeSqlErdState);

  useEffect(() => {
    let active = true;

    async function loadSqlErdSession() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeSqlErdState);
        return;
      }

      setState({
        ...emptyHomeSqlErdState,
        status: "loading"
      });

      try {
        const session = await sqlErdClient.getActiveSession(normalizedWorkspaceId);

        if (active) {
          setState({
            error: null,
            session,
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeSqlErdState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadSqlErdSession();

    return () => {
      active = false;
    };
  }, [normalizedAccessToken, normalizedWorkspaceId, sqlErdClient]);

  return state;
}

function selectHomeBoard(boards: BoardPayload[], workspaceId: string) {
  const selection = readGithubBoardSelection(workspaceId);

  if (selection) {
    const selectedBoard = boards.find(
      (board) =>
        board.repository.id === selection.repositoryId &&
        board.project.id === selection.projectV2Id
    );

    if (selectedBoard) {
      return selectedBoard;
    }
  }

  return boards[0] ?? null;
}

function selectHomeRepositoryId(
  repositories: GithubRepository[],
  workspaceId: string
) {
  const selection = readGithubBoardSelection(workspaceId);

  if (
    selection &&
    repositories.some((repository) => repository.id === selection.repositoryId)
  ) {
    return selection.repositoryId;
  }

  return repositories[0]?.id ?? null;
}

type HomeWeekCalendarEventsState = {
  error: Error | null;
  events: CalendarEvent[];
  status: "idle" | "loading" | "success" | "error";
};

const idleHomeWeekCalendarEventsState: HomeWeekCalendarEventsState = {
  error: null,
  events: [],
  status: "idle"
};

function useHomeWeekCalendarEvents({
  accessToken,
  range,
  workspaceId
}: {
  accessToken: string | null;
  range: {
    end: string;
    start: string;
  };
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const calendarClient = useMemo(
    () => createCalendarApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeWeekCalendarEventsState>(
    idleHomeWeekCalendarEventsState
  );

  useEffect(() => {
    let active = true;

    async function loadWeekEvents() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(idleHomeWeekCalendarEventsState);
        return;
      }

      setState((currentState) => ({
        ...currentState,
        error: null,
        status: "loading"
      }));

      try {
        const events = await calendarClient.listEvents(normalizedWorkspaceId, range);

        if (active) {
          setState({
            error: null,
            events,
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            error: errorFromUnknown(error),
            events: [],
            status: "error"
          });
        }
      }
    }

    void loadWeekEvents();

    return () => {
      active = false;
    };
  }, [
    calendarClient,
    normalizedAccessToken,
    normalizedWorkspaceId,
    range
  ]);

  return state;
}

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Home data could not be loaded");
}

function selectRecentlyUpdatedCanvasBoard(boards: CanvasBoardSummary[]) {
  return boards.reduce<CanvasBoardSummary | null>((selectedBoard, board) => {
    if (!board.updatedAt) {
      return selectedBoard;
    }

    if (!selectedBoard) {
      return board;
    }

    return new Date(board.updatedAt).getTime() >
      new Date(selectedBoard.updatedAt).getTime()
      ? board
      : selectedBoard;
  }, null);
}

function countTodayMeetingReports(reports: MeetingReportSummary[]) {
  const today = new Date();

  return reports.filter((report) =>
    isSameCalendarDate(new Date(report.createdAt), today)
  ).length;
}

function formatMeetingReportTitle(report: MeetingReportSummary) {
  return `${formatMeetingReportDateTime(report.createdAt)} 회의록`;
}

function formatMeetingReportDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "long"
  }).format(new Date(value));
}

function getMeetingReportFallbackSummary(report: MeetingReportSummary) {
  if (report.errorMessage?.trim()) {
    return report.errorMessage;
  }

  return report.status === "PROCESSING" ? "요약 생성 중" : "요약이 없습니다";
}

function formatRelativeTimeFromNow(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "-";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}일 전`;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    month: "short"
  }).format(new Date(timestamp));
}

function isCalendarEventOnDate(event: CalendarEvent, date: string) {
  return event.startDate <= date && event.endDate >= date;
}

function getCappedProgressPercent(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return "0%";
  }

  return `${Math.min(100, Math.round((value / maxValue) * 100))}%`;
}

function isSameCalendarDate(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function StatusPill({
  className = "",
  label,
  tone
}: {
  className?: string;
  label: string;
  tone: "danger" | "muted" | "neutral" | "success";
}) {
  const toneClassName = {
    danger: "border border-red-200 bg-red-50 text-red-700",
    muted: "border bg-muted text-muted-foreground",
    neutral: "border bg-background text-foreground",
    success: "border border-emerald-200 bg-emerald-50 text-emerald-700"
  }[tone];

  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium ${toneClassName} ${className}`}
    >
      {label}
    </span>
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

function formatCalendarDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatProfileDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}
