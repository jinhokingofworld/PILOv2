import type {
  WorkspacePresencePage,
  WorkspacePresenceState,
} from "@/shared/workspace-presence/workspace-presence-types";

type WorkspaceMemberProfile = {
  userId: string;
  user: {
    avatarUrl: string | null;
    name: string | null;
  };
};

export type WorkspaceAvatarEntry = WorkspacePresenceState & {
  avatarUrl: string | null;
  displayName: string;
  initials: string;
};

const pageLabels: Record<WorkspacePresencePage, string> = {
  board: "보드",
  calendar: "캘린더",
  canvas: "캔버스",
  drive: "파일",
  home: "홈",
  meeting: "음성 회의",
  "pr-review": "PR 리뷰",
  "sql-erd": "ERD",
};

export function getWorkspacePresencePageLabel(page: WorkspacePresencePage) {
  return pageLabels[page];
}

export function getWorkspaceAvatarInitials(displayName: string) {
  return Array.from(displayName.replace(/\s+/g, "")).slice(0, 2).join("").toUpperCase();
}

export function buildWorkspaceAvatarEntries({
  currentUserId,
  members,
  onlineUsers,
}: {
  currentUserId: string | null;
  members: WorkspaceMemberProfile[];
  onlineUsers: WorkspacePresenceState[];
}) {
  const memberByUserId = new Map(
    members.map((member) => [member.userId, member]),
  );

  return onlineUsers
    .filter((presence) => presence.userId !== currentUserId)
    .map((presence): WorkspaceAvatarEntry => {
      const member = memberByUserId.get(presence.userId);
      const displayName = member?.user.name?.trim() || presence.displayName;
      return {
        ...presence,
        avatarUrl: member?.user.avatarUrl ?? null,
        displayName,
        initials: getWorkspaceAvatarInitials(displayName),
      };
    })
    .sort(
      (left, right) =>
        Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt),
    );
}

export function splitWorkspaceAvatarEntries<T>(entries: T[], limit: number) {
  return {
    all: entries,
    overflowCount: Math.max(entries.length - limit, 0),
    visible: entries.slice(0, limit),
  };
}
