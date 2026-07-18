"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthSession } from "@/features/auth";
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "@/features/auth/api/client";
import {
  useWorkspacePresence,
} from "@/shared/workspace-presence/workspace-presence-provider";
import { cn } from "@/lib/utils";
import {
  buildWorkspaceAvatarEntries,
  getWorkspacePresencePageLabel,
  splitWorkspaceAvatarEntries,
  type WorkspaceAvatarEntry,
} from "../workspace-member-profiles";

const HEADER_AVATAR_LIMIT = 4;

export function WorkspaceMemberAvatars({
  mode,
}: {
  mode: "floating" | "header";
}) {
  const authSession = useAuthSession();
  const {
    clearJumpError,
    followingUserId,
    jumpError,
    onlineUsers,
    toggleFollow,
  } = useWorkspacePresence();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    if (!authSession) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    void listWorkspaceMembers(
      authSession.accessToken,
      authSession.activeWorkspaceId,
    )
      .then((nextMembers) => {
        if (!cancelled) setMembers(nextMembers);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken, authSession?.activeWorkspaceId]);

  useEffect(() => {
    if (!jumpError) return;
    toast.error(jumpError);
    clearJumpError();
  }, [clearJumpError, jumpError]);

  const entries = useMemo(
    () =>
      buildWorkspaceAvatarEntries({
        currentUserId: authSession?.user.id ?? null,
        members,
        onlineUsers,
      }),
    [authSession?.user.id, members, onlineUsers],
  );
  const { all, overflowCount, visible } = splitWorkspaceAvatarEntries(
    entries,
    HEADER_AVATAR_LIMIT,
  );
  const followingEntry = entries.find(
    (entry) => entry.userId === followingUserId,
  );

  if (entries.length === 0) return null;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex items-center",
          mode === "floating" &&
            "fixed right-4 top-4 z-50 rounded-full border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur",
        )}
        data-mode={mode}
      >
        {followingEntry ? (
          <p
            className="mr-2 whitespace-nowrap text-xs font-medium text-primary"
            role="status"
          >
            {followingEntry.displayName}님 따라가는 중 · Esc로 종료
          </p>
        ) : null}
        <AvatarGroup>
          {visible.map((entry) => (
            <WorkspaceAvatarButton
              entry={entry}
              isFollowing={followingUserId === entry.userId}
              key={entry.userId}
              onSelect={() => void toggleFollow(entry.userId)}
            />
          ))}

          {overflowCount > 0 ? (
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    aria-label={`온라인 팀원 ${all.length}명 모두 보기`}
                    className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    type="button"
                  />
                }
              >
                <AvatarGroupCount>+{overflowCount}</AvatarGroupCount>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                  접속 중인 팀원 {all.length}명
                </p>
                <div className="max-h-72 overflow-y-auto">
                  {all.map((entry) => (
                    <button
                      aria-pressed={followingUserId === entry.userId}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                        followingUserId === entry.userId && "bg-primary/10",
                      )}
                      disabled={!entry.location}
                      data-workspace-follow-trigger
                      key={entry.userId}
                      onClick={() => void toggleFollow(entry.userId)}
                      type="button"
                    >
                      <WorkspaceAvatar
                        entry={entry}
                        isFollowing={followingUserId === entry.userId}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {entry.displayName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.location
                            ? `${getWorkspacePresencePageLabel(entry.location.page)} 화면으로 이동`
                            : "위치 준비 중"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </AvatarGroup>
      </div>
    </TooltipProvider>
  );
}

function WorkspaceAvatarButton({
  entry,
  isFollowing,
  onSelect,
}: {
  entry: WorkspaceAvatarEntry;
  isFollowing: boolean;
  onSelect: () => void;
}) {
  const pageLabel = entry.location
    ? getWorkspacePresencePageLabel(entry.location.page)
    : null;
  const label = entry.location
    ? `${entry.displayName}의 ${pageLabel} 화면으로 이동`
    : `${entry.displayName} 위치 준비 중`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            aria-pressed={isFollowing}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-workspace-follow-trigger
            disabled={!entry.location}
            onClick={onSelect}
            type="button"
          />
        }
      >
        <WorkspaceAvatar entry={entry} isFollowing={isFollowing} />
      </TooltipTrigger>
      <TooltipContent>
        {entry.location ? (
          <span>
            <strong>{entry.displayName}</strong> · {pageLabel} 화면으로 이동
          </span>
        ) : (
          <span>{entry.displayName} · 위치 준비 중</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function WorkspaceAvatar({
  entry,
  isFollowing,
}: {
  entry: WorkspaceAvatarEntry;
  isFollowing: boolean;
}) {
  return (
    <Avatar
      className={cn(
        "ring-2 ring-background",
        isFollowing && "bg-primary/10 ring-primary",
      )}
      size="sm"
    >
      {entry.avatarUrl ? (
        <AvatarImage alt={entry.displayName} src={entry.avatarUrl} />
      ) : null}
      <AvatarFallback>{entry.initials}</AvatarFallback>
      <AvatarBadge className="bg-emerald-500" />
    </Avatar>
  );
}
