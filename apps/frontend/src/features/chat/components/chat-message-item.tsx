"use client";

import { useState } from "react";
import { MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { ChatViewMessage } from "@/features/chat/types";
import { segmentChatMessage } from "@/features/chat/utils/chat-message-text";
import { cn } from "@/lib/utils";

export function ChatMessageItem({
  currentUserId,
  isHighlighted,
  message,
  onDelete,
  onRetry
}: {
  currentUserId: string;
  isHighlighted: boolean;
  message: ChatViewMessage;
  onDelete: (messageId: string) => Promise<void>;
  onRetry: (clientMessageId: string) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeleted = message.deletedAt !== null || message.content === null;
  const isAuthor = message.author?.id === currentUserId;
  const authorName = message.author?.displayName ?? "알 수 없는 사용자";
  const segments = isDeleted
    ? []
    : segmentChatMessage(message.content ?? "", message.mentions);

  const removeMessage = async () => {
    setIsDeleting(true);
    try {
      await onDelete(message.id);
    } catch {
      toast.error("메시지를 삭제하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <article
      aria-current={isHighlighted ? "true" : undefined}
      className={cn(
        "group relative flex scroll-m-24 gap-3 rounded-xl px-3 py-2.5 transition-colors",
        isHighlighted && "bg-primary/10 ring-2 ring-primary/30"
      )}
      data-message-id={message.id}
      id={`chat-message-${message.id}`}
      tabIndex={-1}
    >
      <Avatar className="mt-0.5" size="sm">
        {message.author?.avatarUrl ? (
          <AvatarImage alt="" src={message.author.avatarUrl} />
        ) : null}
        <AvatarFallback>{getInitials(authorName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{authorName}</span>
          <time
            className="text-xs text-muted-foreground"
            dateTime={message.createdAt}
          >
            {formatMessageTime(message.createdAt)}
          </time>
          {message.delivery === "pending" ? (
            <Badge variant="outline">전송 중</Badge>
          ) : null}
          {message.delivery === "failed" ? (
            <Badge variant="destructive">전송 실패</Badge>
          ) : null}
        </div>

        {isDeleted ? (
          <p className="mt-1 text-sm italic text-muted-foreground">
            삭제된 메시지입니다
          </p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
            {segments.map((segment, index) => {
              if (segment.kind === "link") {
                return (
                  <a
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                    href={segment.href}
                    key={`${segment.kind}-${index}`}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {segment.text}
                  </a>
                );
              }

              if (segment.kind === "mention") {
                return (
                  <mark
                    className="rounded bg-primary/10 px-0.5 font-medium text-primary"
                    key={`${segment.kind}-${segment.userId}-${index}`}
                  >
                    {segment.text}
                  </mark>
                );
              }

              return <span key={`${segment.kind}-${index}`}>{segment.text}</span>;
            })}
          </p>
        )}

        {message.delivery === "failed" ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span>{message.failureMessage ?? "메시지를 전송하지 못했습니다."}</span>
            <Button
              className="h-auto gap-1 p-0 text-xs"
              onClick={() => void onRetry(message.clientMessageId)}
              type="button"
              variant="link"
            >
              <RotateCcw />
              다시 시도
            </Button>
          </div>
        ) : null}
      </div>

      {isAuthor && message.delivery === "sent" && !isDeleted ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="메시지 작업"
                className="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                disabled={isDeleting}
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={isDeleting}
              onClick={() => void removeMessage()}
              variant="destructive"
            >
              <Trash2 />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </article>
  );
}

function getInitials(displayName: string) {
  return displayName.trim().slice(0, 2).toUpperCase() || "?";
}

const messageTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul"
});

function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시간 정보 없음" : messageTimeFormatter.format(date);
}
