"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ChatMentionMember } from "@/features/chat/utils/chat-message-text";
import { cn } from "@/lib/utils";

export function ChatMentionMenu({
  id,
  members,
  onSelect,
  selectedIndex
}: {
  id: string;
  members: ChatMentionMember[];
  onSelect: (member: ChatMentionMember) => void;
  selectedIndex: number;
}) {
  const noticeId = `${id}-duplicate-name-notice`;

  return (
    <div
      className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg"
    >
      <p
        className="border-b px-3 py-2 text-xs text-muted-foreground"
        id={noticeId}
      >
        동일한 이름은 마지막으로 선택한 멤버가 적용됩니다.
      </p>
      <div
        aria-describedby={noticeId}
        aria-label="Workspace 멤버 멘션"
        className="max-h-56 overflow-y-auto p-1"
        id={id}
        role="listbox"
      >
        {members.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            일치하는 Workspace 멤버가 없습니다.
          </p>
        ) : (
          members.map((member, index) => (
            <Button
              aria-label={`${member.displayName}, ${member.secondaryText}`}
              aria-selected={index === selectedIndex}
              className={cn(
                "h-auto w-full justify-start gap-3 px-2 py-2",
                index === selectedIndex && "bg-muted"
              )}
              id={`${id}-option-${index}`}
              key={member.userId}
              onClick={() => onSelect(member)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
              variant="ghost"
            >
              <Avatar size="sm">
                {member.avatarUrl ? (
                  <AvatarImage alt="" src={member.avatarUrl} />
                ) : null}
                <AvatarFallback>{getInitials(member.displayName)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col items-start text-left">
                <span className="w-full truncate">{member.displayName}</span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {member.secondaryText}
                </span>
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
  );
}

function getInitials(displayName: string) {
  return displayName.trim().slice(0, 2).toUpperCase() || "?";
}
