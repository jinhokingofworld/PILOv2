"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  MessageCircle,
  RefreshCw,
  Wifi,
  WifiOff
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth";
import {
  listWorkspaceMembers,
  type WorkspaceMember
} from "@/features/auth/api/client";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useChatRuntime } from "@/features/chat/realtime/chat-runtime-provider";
import type { ChatMentionMember } from "@/features/chat/utils/chat-message-text";

export function ChatPage() {
  const authSession = useAuthSession();
  const searchParams = useSearchParams();
  const messageId = searchParams.get("messageId")?.trim() || null;
  const {
    connectionState,
    errorMessage,
    loadMessageContext,
    loadMessagePage,
    markRead,
    markMentionRead,
    mentionErrorMessage,
    mentions,
    refreshMentions,
    refreshSummary,
    removeMessage,
    retryMessage,
    sendMessage,
    state,
    summary
  } = useChatRuntime();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const accessToken = authSession?.accessToken ?? "";
  const currentUserId = authSession?.user.id ?? "";
  const workspaceId = authSession?.activeWorkspaceId ?? "";

  useEffect(() => {
    let active = true;
    setIsInitialLoading(true);
    void refreshSummary().finally(() => {
      if (active) setIsInitialLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshSummary, workspaceId]);

  useEffect(() => {
    if (!accessToken || !workspaceId) {
      setMembers([]);
      setMembersError(null);
      return;
    }

    let active = true;
    setMembers([]);
    setMembersError(null);
    void listWorkspaceMembers(accessToken, workspaceId)
      .then((nextMembers) => {
        if (!active) return;
        setMembers(
          nextMembers.filter(
            (member) => member.workspaceId === workspaceId
          )
        );
      })
      .catch(() => {
        if (!active) return;
        setMembers([]);
        setMembersError("멘션할 Workspace 멤버를 불러오지 못했습니다.");
      });

    return () => {
      active = false;
    };
  }, [accessToken, workspaceId]);

  const mentionMembers = useMemo<ChatMentionMember[]>(
    () => members.map(toChatMentionMember),
    [members]
  );

  const retryLoad = async () => {
    setIsInitialLoading(true);
    try {
      await refreshSummary();
    } finally {
      setIsInitialLoading(false);
    }
  };

  const showEmptyState = state.messages.length === 0 && !messageId;

  return (
    <section className="flex h-[calc(100svh-6.5rem)] min-h-[30rem] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate font-heading text-base font-semibold">
            {authSession?.activeWorkspace.name ?? "Workspace"} 채팅
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Workspace 멤버와 실시간으로 대화하세요.
          </p>
        </div>
        <ConnectionBadge connectionState={connectionState} />
      </header>

      {isInitialLoading ? (
        <ChatLoadingState />
      ) : errorMessage ? (
        <ChatErrorState message={errorMessage} onRetry={retryLoad} />
      ) : showEmptyState ? (
        <ChatEmptyState />
      ) : (
        <ChatMessageList
          currentUserId={currentUserId}
          loadMessageContext={loadMessageContext}
          loadMessagePage={loadMessagePage}
          markRead={markRead}
          markMentionRead={markMentionRead}
          mentions={mentions}
          messages={state.messages}
          onDelete={removeMessage}
          onRetry={retryMessage}
          summary={summary}
          targetMessageId={messageId}
          workspaceId={workspaceId}
        />
      )}

      {membersError ? (
        <p className="border-t bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          {membersError} 메시지는 멘션 없이 보낼 수 있습니다.
        </p>
      ) : null}
      {mentionErrorMessage ? (
        <div className="flex items-center justify-between gap-3 border-t bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <span>{mentionErrorMessage} 채팅은 계속 사용할 수 있습니다.</span>
          <Button
            className="shrink-0"
            onClick={() => void refreshMentions()}
            size="xs"
            type="button"
            variant="ghost"
          >
            다시 시도
          </Button>
        </div>
      ) : null}
      <ChatComposer
        currentUserId={currentUserId}
        disabled={!authSession}
        key={workspaceId}
        members={mentionMembers}
        onSend={sendMessage}
      />
    </section>
  );
}

function ConnectionBadge({
  connectionState
}: {
  connectionState: "connected" | "reconnecting" | "offline";
}) {
  if (connectionState === "connected") {
    return (
      <Badge className="gap-1" variant="outline">
        <Wifi className="text-emerald-500" />
        실시간 연결됨
      </Badge>
    );
  }

  if (connectionState === "reconnecting") {
    return (
      <Badge className="gap-1" variant="outline">
        <Loader2 className="animate-spin" />
        다시 연결 중
      </Badge>
    );
  }

  return (
    <Badge className="gap-1" variant="outline">
      <WifiOff />
      오프라인
    </Badge>
  );
}

function ChatLoadingState() {
  return (
    <div
      aria-label="채팅을 불러오는 중"
      className="flex min-h-0 flex-1 flex-col justify-end gap-4 p-5"
      role="status"
    >
      {["w-2/3", "w-1/2", "w-3/4"].map((width) => (
        <div className="flex items-start gap-3" key={width}>
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className={`h-4 ${width}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatErrorState({
  message,
  onRetry
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertCircle />
      </div>
      <div>
        <p className="font-medium">채팅을 불러오지 못했습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={() => void onRetry()} type="button" variant="outline">
        <RefreshCw />
        다시 시도
      </Button>
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-full bg-primary/10 p-4 text-primary">
        <MessageCircle />
      </div>
      <div>
        <p className="font-medium">아직 메시지가 없습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace의 첫 대화를 시작해보세요.
        </p>
      </div>
    </div>
  );
}

function toChatMentionMember(member: WorkspaceMember): ChatMentionMember {
  const name = member.user.name?.trim();
  const emailName = member.user.email?.split("@")[0]?.trim();
  return {
    userId: member.userId,
    displayName: name || emailName || "이름 없음",
    secondaryText: member.user.email?.trim() || `ID ${member.userId}`,
    avatarUrl: member.user.avatarUrl
  };
}
