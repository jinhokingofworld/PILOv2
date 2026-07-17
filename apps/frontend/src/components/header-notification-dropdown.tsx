"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Inbox, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { useAuthSession } from "@/features/auth";
import {
  acceptCurrentUserWorkspaceInvitation,
  listCurrentUserWorkspaceInvitations,
  rejectCurrentUserWorkspaceInvitation,
  type CurrentUserWorkspaceInvitation
} from "@/features/auth/api/client";
import { useChatRuntime } from "@/features/chat/realtime/chat-runtime-provider";
import {
  formatChatNotificationBadgeCount,
  formatChatNotificationDateTime,
  formatChatNotificationTime,
  getNotificationUnreadCount,
  navigateToChatMention
} from "@/features/chat/utils/chat-notification";
import { useMeetingRuntime } from "@/features/meeting/runtime/meeting-runtime-provider";
import {
  createMeetingApiClient,
  type MeetingNotification
} from "@/features/meeting/api/client";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";
import { enqueueMeetingConnectionAction } from "@/features/meeting/stores/meeting-connection-action-store";
import { cn } from "@/lib/utils";

const ACTIVE_MEETING_LEAVE_FAILED_MESSAGE =
  "진행 중인 회의에서 나가지 못했습니다. 회의 상태를 확인한 뒤 다시 시도해주세요.";
const READ_INVITATIONS_STORAGE_PREFIX = "pilo:read-workspace-invitations";

type InvitationAction = "accepting" | "rejecting" | null;

export function HeaderNotificationDropdown() {
  const router = useRouter();
  const authSession = useAuthSession();
  const { markMentionRead, mentions, summary } = useChatRuntime();
  const meetingRuntime = useMeetingRuntime();
  const socket = useRealtimeSocket();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [workspaceInvitations, setWorkspaceInvitations] = useState<
    CurrentUserWorkspaceInvitation[]
  >([]);
  const [selectedInvitation, setSelectedInvitation] =
    useState<CurrentUserWorkspaceInvitation | null>(null);
  const [readInvitationIds, setReadInvitationIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isReadStateReady, setIsReadStateReady] = useState(false);
  const [invitationAction, setInvitationAction] =
    useState<InvitationAction>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
  const [invitationActionError, setInvitationActionError] = useState<
    string | null
  >(null);
  const [isLoadingInvitations, setIsLoadingInvitations] = useState(false);
  const [meetingNotifications, setMeetingNotifications] = useState<
    MeetingNotification[]
  >([]);
  const [isLoadingMeetingNotifications, setIsLoadingMeetingNotifications] =
    useState(false);
  const [meetingNotificationError, setMeetingNotificationError] = useState<
    string | null
  >(null);
  const invitationUnreadCount = isReadStateReady
    ? workspaceInvitations.filter(
        (invitation) => !readInvitationIds.has(invitation.id)
      ).length
    : 0;
  const unreadCount = getNotificationUnreadCount({
    invitationUnread: invitationUnreadCount,
    mentionUnread: summary.mentionUnreadCount,
    meetingUnread: meetingNotifications.filter((item) => item.readAt === null)
      .length
  });
  const notificationLabel =
    unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}개` : "알림";

  useEffect(() => {
    if (!authSession) {
      setReadInvitationIds(new Set());
      setIsReadStateReady(false);
      return;
    }

    setReadInvitationIds(loadReadInvitationIds(authSession.user.id));
    setIsReadStateReady(true);
  }, [authSession?.user.id]);

  useEffect(() => {
    let cancelled = false;

    if (!authSession) {
      setWorkspaceInvitations([]);
      setIsLoadingInvitations(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingInvitations(true);

    void listCurrentUserWorkspaceInvitations(authSession.accessToken)
      .then((invitations) => {
        if (!cancelled) {
          setWorkspaceInvitations(invitations);
          setInvitationError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceInvitations([]);
          setInvitationError("워크스페이스 초대를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingInvitations(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken]);

  const reloadMeetingNotifications = useCallback(() => {
    if (!authSession) {
      setMeetingNotifications([]);
      return Promise.resolve();
    }
    setIsLoadingMeetingNotifications(true);
    return createMeetingApiClient({ accessToken: authSession.accessToken })
      .listCurrentUserMeetingNotifications()
      .then((result) => {
        setMeetingNotifications(result.items);
        setMeetingNotificationError(null);
      })
      .catch(() => {
        setMeetingNotificationError("회의 알림을 불러오지 못했습니다.");
      })
      .finally(() => setIsLoadingMeetingNotifications(false));
  }, [authSession]);

  useEffect(() => {
    void reloadMeetingNotifications();
  }, [reloadMeetingNotifications]);

  useEffect(() => {
    if (!socket) return;
    const reload = () => void reloadMeetingNotifications();
    socket.on("meeting:notification:created", reload);
    socket.on("meeting:notification:updated", reload);
    return () => {
      socket.off("meeting:notification:created", reload);
      socket.off("meeting:notification:updated", reload);
    };
  }, [reloadMeetingNotifications, socket]);

  function openMeetingNotification(notification: MeetingNotification) {
    if (!authSession) return;
    const client = createMeetingApiClient({ accessToken: authSession.accessToken });
    void client.markCurrentUserMeetingNotificationRead(notification.id).then((updated) => {
      setMeetingNotifications((items) =>
        items.map((item) => (item.id === updated.id ? updated : item))
      );
    });
    setIsPopoverOpen(false);
    if (notification.type === "meeting_report_completed" && notification.canOpenReport) {
      router.push("/report");
    }
  }

  function respondToMeetingInvitation(
    notification: MeetingNotification,
    response: "accept" | "decline"
  ) {
    if (!authSession || !notification.invitation?.canRespond) return;
    const client = createMeetingApiClient({ accessToken: authSession.accessToken });
    const request =
      response === "accept"
        ? client.acceptCurrentUserMeetingInvitation(notification.invitation.id)
        : client.declineCurrentUserMeetingInvitation(notification.invitation.id);
    void request
      .then((result) => {
        setMeetingNotifications((items) =>
          items.map((item) =>
            item.id === notification.id
              ? {
                  ...item,
                  readAt: new Date().toISOString(),
                  invitation: item.invitation
                    ? {
                        ...item.invitation,
                        status: response === "accept" ? "ACCEPTED" : "DECLINED",
                        canRespond: false
                      }
                    : null
                }
              : item
          )
        );
        if (response === "accept" && "meetingId" in result) {
          enqueueMeetingConnectionAction({
            actionId: `meeting-invitation:${notification.invitation?.id ?? notification.id}`,
            expiresAtMs: Date.now() + 5 * 60 * 1000,
            meetingId: result.meetingId,
            meetingRoomId: result.meetingRoomId,
            workspaceId: result.workspaceId
          });
          router.push("/meeting");
        }
      })
      .catch((error: unknown) => {
        setMeetingNotificationError(
          error instanceof Error ? error.message : "회의 초대 처리에 실패했습니다."
        );
      });
  }

  function markInvitationAsRead(invitationId: string) {
    if (!authSession) {
      return;
    }

    setReadInvitationIds((currentIds) => {
      if (currentIds.has(invitationId)) {
        return currentIds;
      }

      const nextIds = new Set(currentIds);
      nextIds.add(invitationId);
      saveReadInvitationIds(authSession.user.id, nextIds);
      return nextIds;
    });
  }

  function openInvitationDialog(invitation: CurrentUserWorkspaceInvitation) {
    setInvitationActionError(null);
    setSelectedInvitation(invitation);
    setIsPopoverOpen(false);
  }

  function closeInvitationDialogAsRead() {
    if (selectedInvitation) {
      markInvitationAsRead(selectedInvitation.id);
    }

    setSelectedInvitation(null);
    setInvitationActionError(null);
  }

  function removeInvitation(invitationId: string) {
    setWorkspaceInvitations((currentInvitations) =>
      currentInvitations.filter(
        (currentInvitation) => currentInvitation.id !== invitationId
      )
    );

    if (authSession) {
      setReadInvitationIds((currentIds) => {
        if (!currentIds.has(invitationId)) {
          return currentIds;
        }

        const nextIds = new Set(currentIds);
        nextIds.delete(invitationId);
        saveReadInvitationIds(authSession.user.id, nextIds);
        return nextIds;
      });
    }
  }

  function acceptSelectedInvitation() {
    if (!authSession || !selectedInvitation || invitationAction) {
      return;
    }

    const invitation = selectedInvitation;
    setInvitationAction("accepting");
    setInvitationActionError(null);
    setInvitationNotice(null);

    void (async () => {
      try {
        try {
          await meetingRuntime.leaveActiveMeeting();
        } catch {
          setInvitationActionError(ACTIVE_MEETING_LEAVE_FAILED_MESSAGE);
          return;
        }

        const result = await acceptCurrentUserWorkspaceInvitation(
          authSession.accessToken,
          invitation.id
        );

        removeInvitation(invitation.id);
        setSelectedInvitation(null);
        setInvitationNotice(`${result.workspace.name} 워크스페이스에 참여했습니다.`);
        await authSession.refreshSession(result.workspace.id);
        router.push("/calendar");
      } catch (error) {
        setInvitationActionError(
          error instanceof Error ? error.message : "초대 수락에 실패했습니다."
        );
      } finally {
        setInvitationAction(null);
      }
    })();
  }

  function rejectSelectedInvitation() {
    if (!authSession || !selectedInvitation || invitationAction) {
      return;
    }

    const invitation = selectedInvitation;
    setInvitationAction("rejecting");
    setInvitationActionError(null);
    setInvitationNotice(null);

    void rejectCurrentUserWorkspaceInvitation(
      authSession.accessToken,
      invitation.id
    )
      .then(() => {
        removeInvitation(invitation.id);
        setSelectedInvitation(null);
        setInvitationNotice(`${invitation.workspaceName} 초대를 거절했습니다.`);
      })
      .catch((error: unknown) => {
        setInvitationActionError(
          error instanceof Error ? error.message : "초대 거절에 실패했습니다."
        );
      })
      .finally(() => {
        setInvitationAction(null);
      });
  }

  return (
    <>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              aria-label={notificationLabel}
              className="relative"
              size="icon"
              variant="ghost"
            />
          }
        >
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
              {formatChatNotificationBadgeCount(unreadCount)}
            </span>
          ) : null}
        </PopoverTrigger>

        <PopoverContent
          align="end"
          aria-label="알림 목록"
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          side="bottom"
          sideOffset={8}
        >
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">알림</h2>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0
                ? `읽지 않은 알림 ${unreadCount}개`
                : "새 알림이 없습니다"}
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {isLoadingInvitations ? (
              <div className="flex items-center justify-center gap-2 border-b px-4 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                워크스페이스 초대를 불러오는 중
              </div>
            ) : null}

            {workspaceInvitations.map((invitation) => {
              const isUnread =
                isReadStateReady && !readInvitationIds.has(invitation.id);

              return (
                <button
                  className={cn(
                    "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    isUnread && "bg-primary/5"
                  )}
                  key={invitation.id}
                  onClick={() => openInvitationDialog(invitation)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      isUnread ? "bg-destructive" : "bg-transparent"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {invitation.workspaceName} 워크스페이스 초대
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {invitation.role} 권한으로 초대되었습니다.
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      만료: {formatInvitationDate(invitation.expiresAt)}
                    </span>
                  </span>
                </button>
              );
            })}

            {isLoadingMeetingNotifications ? (
              <div className="flex items-center justify-center gap-2 border-b px-4 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                회의 알림을 불러오는 중
              </div>
            ) : null}

            {meetingNotifications.map((notification) => {
              const isUnread = notification.readAt === null;
              return (
                <div
                  className={cn(
                    "border-b px-4 py-3",
                    isUnread && "bg-primary/5"
                  )}
                  key={notification.id}
                >
                  <button
                    className="flex w-full items-start gap-3 text-left"
                    onClick={() => openMeetingNotification(notification)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        isUnread ? "bg-destructive" : "bg-transparent"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {notification.title ?? "회의 알림"}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {notification.message}
                      </span>
                    </span>
                  </button>
                  {notification.invitation?.canRespond ? (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        onClick={() => respondToMeetingInvitation(notification, "decline")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        거절
                      </Button>
                      <Button
                        onClick={() => respondToMeetingInvitation(notification, "accept")}
                        size="sm"
                        type="button"
                      >
                        수락 후 참여
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {mentions.map((mention) => {
              const isUnread = mention.readAt === null;
              const actorName =
                mention.actor?.displayName ?? "알 수 없는 사용자";

              return (
                <button
                  className={cn(
                    "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    isUnread && "bg-primary/5"
                  )}
                  key={mention.id}
                  onClick={() =>
                    navigateToChatMention({
                      closePopover: () => setIsPopoverOpen(false),
                      markMentionRead,
                      mentionId: mention.id,
                      messageId: mention.messageId,
                      navigate: (href) => router.push(href)
                    })
                  }
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      isUnread ? "bg-destructive" : "bg-transparent"
                    )}
                  />
                  <MessageCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {actorName}님의 채팅 멘션
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {mention.excerpt}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
                      <span>{mention.workspaceName}</span>
                      <span aria-hidden="true">·</span>
                      <time
                        dateTime={mention.createdAt}
                        title={formatChatNotificationDateTime(
                          mention.createdAt
                        )}
                      >
                        {formatChatNotificationTime(mention.createdAt)}
                      </time>
                    </span>
                  </span>
                </button>
              );
            })}

            {invitationNotice ? (
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                {invitationNotice}
              </p>
            ) : null}
            {invitationError ? (
              <p className="border-b px-4 py-2 text-xs text-destructive">
                {invitationError}
              </p>
            ) : null}
            {meetingNotificationError ? (
              <p className="border-b px-4 py-2 text-xs text-destructive">
                {meetingNotificationError}
              </p>
            ) : null}

            {workspaceInvitations.length === 0 &&
            meetingNotifications.length === 0 &&
            mentions.length === 0 &&
            !isLoadingInvitations ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
                <Inbox className="size-7" />
                <p className="text-sm">표시할 알림이 없습니다.</p>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={selectedInvitation !== null}
        onOpenChange={(open) => {
          if (!open && invitationAction === null) {
            closeInvitationDialogAsRead();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>워크스페이스 초대</DialogTitle>
            <DialogDescription>
              초대를 수락하거나 거절할 수 있습니다. 나중에 확인하면 읽은 알림으로
              남습니다.
            </DialogDescription>
          </DialogHeader>

          {selectedInvitation ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="font-medium">{selectedInvitation.workspaceName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedInvitation.role} 권한으로 초대되었습니다.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                만료: {formatInvitationDate(selectedInvitation.expiresAt)}
              </p>
            </div>
          ) : null}

          {invitationActionError ? (
            <p className="text-sm text-destructive">{invitationActionError}</p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={invitationAction !== null}
              onClick={closeInvitationDialogAsRead}
              variant="outline"
            >
              나중에
            </Button>
            <Button
              disabled={invitationAction !== null}
              onClick={rejectSelectedInvitation}
              variant="destructive"
            >
              {invitationAction === "rejecting" ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {invitationAction === "rejecting" ? "거절 중" : "거절"}
            </Button>
            <Button
              disabled={invitationAction !== null}
              onClick={acceptSelectedInvitation}
            >
              {invitationAction === "accepting" ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {invitationAction === "accepting" ? "수락 중" : "수락"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getReadInvitationsStorageKey(userId: string) {
  return `${READ_INVITATIONS_STORAGE_PREFIX}:${userId}`;
}

function loadReadInvitationIds(userId: string) {
  try {
    const storedValue = window.localStorage.getItem(
      getReadInvitationsStorageKey(userId)
    );
    const parsedValue: unknown = storedValue ? JSON.parse(storedValue) : [];

    return new Set(
      Array.isArray(parsedValue)
        ? parsedValue.filter((value): value is string => typeof value === "string")
        : []
    );
  } catch {
    return new Set<string>();
  }
}

function saveReadInvitationIds(userId: string, invitationIds: Set<string>) {
  try {
    window.localStorage.setItem(
      getReadInvitationsStorageKey(userId),
      JSON.stringify(Array.from(invitationIds))
    );
  } catch {
    // 읽음 저장 실패가 초대 확인과 수락/거절을 막지 않도록 무시한다.
  }
}

function formatInvitationDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
