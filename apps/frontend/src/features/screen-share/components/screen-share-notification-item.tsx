"use client";

import { Eye, MonitorUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PublicScreenShareSession } from "@/features/screen-share/types";

// <screen-share-notification-pure>
type NotificationPolicySession = {
  id: string;
  sharer: { userId: string };
};

export function shouldShowScreenShareNotification(
  {
    activeSession,
    currentUserId
  }: {
    activeSession: NotificationPolicySession | null;
    currentUserId: string | null;
  }
) {
  return (
    activeSession !== null && activeSession.sharer.userId !== currentUserId
  );
}
// </screen-share-notification-pure>

export function ScreenShareNotificationItem({
  onWatch,
  session
}: {
  onWatch: () => void;
  session: PublicScreenShareSession;
}) {
  return (
    <div className="flex items-start gap-3 border-b bg-primary/5 px-4 py-3">
      <MonitorUp
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-primary"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {session.sharer.displayName}님이 화면 공유 중
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          현재 워크스페이스에서 진행 중인 공유입니다.
        </p>
      </div>
      <Button onClick={onWatch} size="sm" type="button" variant="outline">
        <Eye aria-hidden="true" />
        시청하기
      </Button>
    </div>
  );
}
