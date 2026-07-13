"use client";

import type { ReactNode } from "react";
import {
  CalendarDays,
  Clock3,
  Mail,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { WorkspaceMember } from "@/features/auth/api/client";

type MemberProfileDialogProps = {
  activeWorkspaceId: string | null;
  canRemoveMember: boolean;
  currentUserId: string | null;
  error: string | null;
  isRemoving: boolean;
  member: WorkspaceMember | null;
  onClose: () => void;
  onRemoveMember: (member: WorkspaceMember) => void;
  workspaceName: string;
};

export function MemberProfileDialog({
  activeWorkspaceId,
  canRemoveMember,
  currentUserId,
  error,
  isRemoving,
  member,
  onClose,
  onRemoveMember,
  workspaceName
}: MemberProfileDialogProps) {
  const isActive = Boolean(
    member &&
      activeWorkspaceId &&
      (member.user.activeWorkspaceId === activeWorkspaceId ||
        member.userId === currentUserId)
  );
  const canRemoveSelectedMember = Boolean(
    member &&
      canRemoveMember &&
      member.userId !== currentUserId &&
      member.role !== "owner"
  );

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-[calc(100vh-3rem)] max-h-[36rem] w-[calc(100vw-3rem)] max-w-4xl gap-0 overflow-hidden rounded-xl border-0 bg-background p-0 shadow-2xl"
        showCloseButton={false}
      >
        {member ? (
          <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)]">
            <Button
              aria-label="닫기"
              className="absolute right-3 top-3 z-20 border-0 bg-transparent shadow-none"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <X />
            </Button>

            <aside className="hidden min-h-0 flex-col bg-muted px-3 py-5 md:flex">
              <p className="px-3 text-xs font-medium text-muted-foreground">프로필</p>
              <div className="mt-3 flex items-center gap-2 px-3 py-2">
                <Avatar size="sm">
                  <AvatarImage
                    alt={member.user.name ?? "Workspace 멤버"}
                    src={member.user.avatarUrl || undefined}
                  />
                  <AvatarFallback>{getInitial(member.user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.user.name ?? "이름 없음"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.user.email ?? "이메일 없음"}
                  </p>
                </div>
              </div>
              <Button
                className="mt-2 h-9 w-full justify-start gap-3 border-0 bg-muted px-3 font-normal shadow-none"
                variant="ghost"
              >
                <UserRound className="size-4 text-muted-foreground" />
                멤버 프로필
              </Button>
            </aside>

            <main className="min-h-0 overflow-y-auto bg-background">
              <div className="mx-auto w-full max-w-3xl px-6 pb-14 pt-10 sm:px-10 lg:px-12 lg:pt-12">
                <DialogHeader className="pr-10">
                  <DialogTitle className="text-3xl font-semibold tracking-tight">
                    프로필
                  </DialogTitle>
                  <DialogDescription className="mt-2 text-base text-foreground/80">
                    {workspaceName}에서 함께 작업하는 멤버 정보입니다.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-center">
                  <Avatar className="size-20 ring-4 ring-background shadow-sm">
                    <AvatarImage
                      alt={member.user.name ?? "Workspace 멤버"}
                      src={member.user.avatarUrl || undefined}
                    />
                    <AvatarFallback className="text-xl">
                      {getInitial(member.user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-xl font-semibold">
                        {member.user.name ?? "이름 없음"}
                      </h3>
                      <Badge variant="secondary">
                        {formatWorkspaceRole(member.role)}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="size-4" />
                      {member.user.email ?? "이메일 없음"}
                    </p>
                  </div>
                </div>

                <Separator className="my-8" />

                <section aria-labelledby="workspace-profile-heading">
                  <div>
                    <h3 className="font-medium" id="workspace-profile-heading">
                      Workspace 정보
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      역할과 현재 협업 상태를 확인할 수 있습니다.
                    </p>
                  </div>
                  <dl className="mt-5 divide-y">
                    <MemberProfileRow
                      icon={<ShieldCheck />}
                      label="역할"
                      value={formatWorkspaceRole(member.role)}
                    />
                    <MemberProfileRow
                      icon={<WorkspacePresenceIndicator active={isActive} />}
                      label="상태"
                      value={isActive ? "Workspace 접속 중" : "오프라인"}
                    />
                    <MemberProfileRow
                      icon={<CalendarDays />}
                      label="참여일"
                      value={formatProfileDate(member.joinedAt)}
                    />
                    <MemberProfileRow
                      icon={<Clock3 />}
                      label="마지막 활동"
                      value={formatProfileDateTime(member.user.lastSeenAt)}
                    />
                  </dl>
                </section>

                {error ? (
                  <p className="mt-6 text-xs text-destructive">{error}</p>
                ) : null}

                {canRemoveSelectedMember ? (
                  <div className="mt-8 flex items-center justify-between gap-4 border-t pt-6">
                    <div>
                      <p className="text-sm font-medium">Workspace에서 제거</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        이 멤버의 Workspace 접근 권한을 제거합니다.
                      </p>
                    </div>
                    <Button
                      disabled={isRemoving}
                      onClick={() => onRemoveMember(member)}
                      variant="destructive"
                    >
                      {isRemoving ? "제거 중" : "멤버 제거"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </main>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MemberProfileRow({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-4 text-sm">
      <dt className="flex items-center gap-3 text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function WorkspacePresenceIndicator({ active }: { active: boolean }) {
  const label = active ? "Workspace 접속 중" : "오프라인";

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
  return role === "owner" ? "Owner" : "Member";
}

function formatProfileDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function formatProfileDateTime(value: string | null) {
  if (!value) {
    return "활동 기록 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}
