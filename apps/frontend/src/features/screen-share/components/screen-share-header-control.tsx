"use client";

import { Eye, Loader2, MonitorUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useScreenShareRuntime } from "@/features/screen-share/runtime/screen-share-runtime-provider";
import type { PublicScreenShareSession } from "@/features/screen-share/types";
import { cn } from "@/lib/utils";

// <screen-share-header-pure>
type HeaderPolicySession = {
  id: string;
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: string;
};

type HeaderScreenShareAction =
  | { kind: "start"; label: "화면 공유" }
  | { kind: "starting"; label: "공유 준비 중" }
  | { kind: "stop"; label: "공유 종료" }
  | { kind: "view"; label: string; sessionId: string };

export function getHeaderScreenShareAction({
  activeSession,
  currentUserId,
  publisherStatus
}: {
  activeSession: HeaderPolicySession | null;
  currentUserId: string | null;
  publisherStatus:
    | "idle"
    | "selecting"
    | "reserving"
    | "connecting"
    | "sharing"
    | "stopping";
}): HeaderScreenShareAction {
  if (
    publisherStatus !== "idle" &&
    publisherStatus !== "sharing"
  ) {
    return { kind: "starting", label: "공유 준비 중" };
  }
  if (
    publisherStatus === "sharing" ||
    (activeSession !== null &&
      activeSession.sharer.userId === currentUserId)
  ) {
    return { kind: "stop", label: "공유 종료" };
  }
  if (activeSession) {
    return {
      kind: "view",
      label: `${activeSession.sharer.displayName}님 공유 중`,
      sessionId: activeSession.id
    };
  }
  return { kind: "start", label: "화면 공유" };
}
// </screen-share-header-pure>

export function ScreenShareHeaderControl({
  mode
}: {
  mode: "floating" | "header";
}) {
  const {
    activeSession,
    currentUserId,
    publisherStatus,
    startSharing,
    startViewing,
    stopSharing
  } = useScreenShareRuntime();
  const action = getHeaderScreenShareAction({
    activeSession: activeSession as PublicScreenShareSession | null,
    currentUserId,
    publisherStatus
  });
  const isStarting = action.kind === "starting";

  return (
    <Button
      aria-label={action.label}
      className={cn(
        "shrink-0",
        mode === "floating" && "bg-background/95 shadow-lg backdrop-blur"
      )}
      disabled={isStarting}
      onClick={() => {
        if (action.kind === "start") startSharing();
        if (action.kind === "stop") stopSharing();
        if (action.kind === "view") startViewing(action.sessionId);
      }}
      size={mode === "header" ? "icon" : "sm"}
      type="button"
      variant={action.kind === "stop" ? "destructive" : "outline"}
    >
      {action.kind === "start" ? <MonitorUp aria-hidden="true" /> : null}
      {action.kind === "starting" ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : null}
      {action.kind === "stop" ? <Square aria-hidden="true" /> : null}
      {action.kind === "view" ? <Eye aria-hidden="true" /> : null}
      {mode === "floating" ? <span>{action.label}</span> : null}
    </Button>
  );
}
