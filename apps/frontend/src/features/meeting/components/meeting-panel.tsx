"use client";

import {
  AlertCircle,
  CircleUserRound,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAuthSession } from "@/features/auth";
import { MeetingApiError } from "@/features/meeting/api/client";
import { useLiveKitMeetingRoom } from "@/features/meeting/hooks/use-livekit-meeting-room";
import type { LiveKitMeetingRoomStatus } from "@/features/meeting/hooks/use-livekit-meeting-room";
import { useMeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import { meetingNavigation } from "@/features/meeting/navigation";
import type {
  MeetingParticipant,
  RecordingStatus
} from "@/features/meeting/types";
import { cn } from "@/lib/utils";

type EntryAction = "start" | "join";
type ActionStatus =
  | "idle"
  | "joining"
  | "leaving"
  | "starting-recording"
  | "ending-recording";

const MEETING_STATUS_POLL_INTERVAL_MS = 5000;
const RECORDING_CONSENT_STORAGE_KEY = "recordingConsentAccepted";
const MIC_PERMISSION_ERROR_MESSAGE =
  "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용한 뒤 다시 참여해주세요.";
const LIVEKIT_CONNECTION_ERROR_MESSAGE =
  "음성 회의 연결에 실패했습니다. 마이크 권한과 네트워크 상태를 확인해주세요.";
const LEAVE_FAILED_MESSAGE =
  "회의 나가기에 실패했습니다. 문제가 반복되면 녹음을 종료한 뒤 다시 시도해주세요.";

function getInitial(name: string | null | undefined) {
  return (name?.trim().slice(0, 1) || "?").toUpperCase();
}

function getParticipantName(participant: MeetingParticipant) {
  return participant.user.name?.trim() || "이름 없는 참여자";
}

function getErrorMessage(error: unknown) {
  if (error instanceof MeetingApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (
      error.message === MIC_PERMISSION_ERROR_MESSAGE ||
      error.message === LIVEKIT_CONNECTION_ERROR_MESSAGE ||
      error.message === LEAVE_FAILED_MESSAGE
    ) {
      return error.message;
    }
  }

  return "회의 상태를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(MIC_PERMISSION_ERROR_MESSAGE);
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    throw new Error(MIC_PERMISSION_ERROR_MESSAGE);
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getRecordingStatusLabel(status: RecordingStatus | null | undefined) {
  switch (status) {
    case "RUNNING":
      return "녹음중";
    case "COMPLETED":
      return "녹음 완료";
    case "FAILED":
      return "녹음 실패";
    default:
      return "녹음 대기";
  }
}

function getConnectionStatusLabel(
  status: LiveKitMeetingRoomStatus
) {
  switch (status) {
    case "connected":
      return "음성 연결중";
    case "connecting":
      return "연결중";
    case "reconnecting":
      return "재연결중";
    case "disconnected":
      return "연결 끊김";
    case "error":
      return "연결 실패";
    case "idle":
      return "음성 미연결";
  }
}

function StatusIndicator({
  label,
  tone
}: {
  label: string;
  tone: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        tone === "default" && "border-border bg-background text-muted-foreground",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "default" && "bg-muted-foreground",
          tone === "success" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-destructive"
        )}
      />
      {label}
    </span>
  );
}

function MeetingPanelSkeleton() {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center gap-5 rounded-xl border bg-card p-5">
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-8 w-52" />
        <Skeleton className="mx-auto h-4 w-72" />
      </div>
      <div className="w-full max-w-2xl space-y-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <div className="w-full max-w-2xl space-y-3">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    </div>
  );
}

function ConsentOverlay({
  onAccept,
  onClose
}: {
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0 space-y-2">
            <h2 className="text-base font-semibold">음성 녹음 동의</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              회의 녹음은 회의록 생성을 위해 사용됩니다. 동의하지 않으면 음성
              회의에 참여할 수 없습니다.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={onAccept}>
            <ShieldCheck />
            동의합니다
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToastMessage({
  message,
  onClose
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm rounded-lg border bg-card p-4 text-sm shadow-lg">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="min-w-0 leading-5 text-card-foreground">{message}</p>
        <Button
          aria-label="알림 닫기"
          className="-mr-2 -mt-2"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function MeetingPanel() {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const currentUserId = authSession?.user.id ?? "";
  const meetingData = useMeetingWorkspaceData({
    accessToken,
    enabled: Boolean(workspaceId && accessToken),
    reportsQuery: { limit: 20 },
    workspaceId
  });
  const liveKitRoom = useLiveKitMeetingRoom();
  const {
    activeParticipantCount,
    canLoad,
    currentError,
    currentRecording,
    currentStatus,
    endRecording,
    joinMeeting,
    leaveMeeting,
    listParticipants,
    meeting,
    reloadCurrentMeeting,
    startMeeting,
    startRecording
  } = meetingData;

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [participantStatus, setParticipantStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pendingConsentAction, setPendingConsentAction] =
    useState<EntryAction | null>(null);
  const [recordingConsentAccepted, setRecordingConsentAccepted] =
    useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.isActive),
    [participants]
  );
  const currentUserActiveParticipant = activeParticipants.find(
    (participant) => participant.userId === currentUserId
  );
  const isCurrentUserActive = Boolean(currentUserActiveParticipant);
  const isBrowserJoined =
    isCurrentUserActive &&
    (liveKitRoom.status === "connected" || liveKitRoom.status === "reconnecting");
  const isActionPending = actionStatus !== "idle";
  const isInitialLoading = currentStatus === "loading" && meeting === null;
  const hasRunningRecording = currentRecording?.status === "RUNNING";
  const displayedActiveCount = activeParticipants.length || activeParticipantCount;

  const reloadParticipants = useCallback(
    async (targetMeetingId = meeting?.id) => {
      if (!targetMeetingId) {
        setParticipants([]);
        setParticipantStatus("idle");
        setParticipantError(null);
        return [];
      }

      setParticipantStatus("loading");
      setParticipantError(null);

      try {
        const result = await listParticipants(targetMeetingId);
        setParticipants(result.participants);
        setParticipantStatus("ready");
        return result.participants;
      } catch (error) {
        setParticipantError(getErrorMessage(error));
        setParticipantStatus("error");
        return [];
      }
    },
    [listParticipants, meeting?.id]
  );

  useEffect(() => {
    const storedValue = window.localStorage.getItem(
      RECORDING_CONSENT_STORAGE_KEY
    );
    setRecordingConsentAccepted(storedValue === "true");
  }, []);

  useEffect(() => {
    void reloadParticipants(meeting?.id);
  }, [meeting?.id, reloadParticipants]);

  useEffect(() => {
    if (!meeting?.id || !canLoad) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void reloadCurrentMeeting();
      void reloadParticipants(meeting.id);
    }, MEETING_STATUS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [canLoad, meeting?.id, reloadCurrentMeeting, reloadParticipants]);

  useEffect(() => {
    if (!meeting && liveKitRoom.status !== "idle") {
      void liveKitRoom.disconnect();
    }
  }, [liveKitRoom.disconnect, liveKitRoom.status, meeting]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToastMessage(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  async function runEntryAction(action: EntryAction) {
    const targetMeetingId = meeting?.id;

    setActionStatus("joining");
    setActionError(null);
    setToastMessage(null);

    let createdOrJoinedMeetingId: string | null = null;
    let failedStage: "permission" | "api" | "livekit" = "permission";

    try {
      await requestMicrophonePermission();

      failedStage = "api";
      const result =
        action === "start"
          ? await startMeeting()
          : await joinMeeting(targetMeetingId ?? "");
      createdOrJoinedMeetingId = result.meeting.id;

      failedStage = "livekit";
      await liveKitRoom.connect(result.livekit);

      await Promise.all([
        reloadCurrentMeeting(),
        reloadParticipants(result.meeting.id)
      ]);
    } catch (error) {
      if (createdOrJoinedMeetingId) {
        await leaveMeeting(createdOrJoinedMeetingId).catch(() => undefined);
        await liveKitRoom.disconnect();
        await reloadCurrentMeeting();
        await reloadParticipants(createdOrJoinedMeetingId);
      }

      const message =
        failedStage === "permission"
          ? MIC_PERMISSION_ERROR_MESSAGE
          : failedStage === "livekit"
            ? LIVEKIT_CONNECTION_ERROR_MESSAGE
            : getErrorMessage(error);
      setActionError(message);
      setToastMessage(message);
    } finally {
      setActionStatus("idle");
    }
  }

  function handleEntryAction() {
    const action: EntryAction = meeting ? "join" : "start";

    if (!recordingConsentAccepted) {
      setPendingConsentAction(action);
      return;
    }

    void runEntryAction(action);
  }

  function handleAcceptConsent() {
    const action = pendingConsentAction ?? (meeting ? "join" : "start");
    window.localStorage.setItem(RECORDING_CONSENT_STORAGE_KEY, "true");
    setRecordingConsentAccepted(true);
    setPendingConsentAction(null);
    void runEntryAction(action);
  }

  async function handleLeaveMeeting() {
    if (!meeting) {
      return;
    }

    setActionStatus("leaving");
    setActionError(null);
    setToastMessage(null);

    try {
      const result = await leaveMeeting(meeting.id);
      await liveKitRoom.disconnect();
      await reloadCurrentMeeting();
      await reloadParticipants(result.meetingEnded ? undefined : meeting.id);
      setToastMessage(
        result.meetingEnded
          ? "회의에서 나갔고 진행 중인 회의가 종료되었습니다."
          : "회의에서 나갔습니다."
      );
    } catch (error) {
      const message = LEAVE_FAILED_MESSAGE;
      setActionError(message);
      setToastMessage(message);
      await reloadCurrentMeeting();
      await reloadParticipants(meeting.id);
      void error;
    } finally {
      setActionStatus("idle");
    }
  }

  async function handleRecordingAction() {
    if (!meeting || !isCurrentUserActive) {
      return;
    }

    if (!hasRunningRecording) {
      setActionStatus("starting-recording");
      setActionError(null);
      setToastMessage(null);

      try {
        await startRecording(meeting.id);
        await Promise.all([reloadCurrentMeeting(), reloadParticipants(meeting.id)]);
        setToastMessage("녹음을 시작했습니다.");
      } catch (error) {
        const message = getErrorMessage(error);
        setActionError(message);
        setToastMessage(message);
      } finally {
        setActionStatus("idle");
      }
      return;
    }

    if (
      !currentRecording ||
      !window.confirm("녹음을 종료하고 회의록 생성을 시작할까요?")
    ) {
      return;
    }

    setActionStatus("ending-recording");
    setActionError(null);
    setToastMessage(null);

    try {
      await endRecording(meeting.id, currentRecording.id);
      await Promise.all([reloadCurrentMeeting(), reloadParticipants(meeting.id)]);
      setToastMessage("녹음을 종료하고 회의록 생성을 요청했습니다.");
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      setToastMessage(message);
    } finally {
      setActionStatus("idle");
    }
  }

  const joinButtonLabel = isBrowserJoined ? "회의 나가기" : "회의 참여";
  const joinButtonIcon = isBrowserJoined ? PhoneOff : Phone;
  const JoinButtonIcon = isActionPending ? Loader2 : joinButtonIcon;
  const RecordingButtonIcon = hasRunningRecording ? Square : Radio;
  const connectionTone =
    liveKitRoom.status === "connected"
      ? "success"
      : liveKitRoom.status === "error" || liveKitRoom.status === "disconnected"
        ? "danger"
        : liveKitRoom.status === "connecting" ||
            liveKitRoom.status === "reconnecting"
          ? "warning"
          : "default";
  const recordingTone =
    currentRecording?.status === "RUNNING"
      ? "danger"
      : currentRecording?.status === "FAILED"
        ? "warning"
        : "default";

  if (!accessToken || !workspaceId) {
    return (
      <section className="rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">{meetingNavigation.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          회의 기능을 사용하려면 로그인된 workspace가 필요합니다.
        </p>
      </section>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {toastMessage && (
          <ToastMessage
            message={toastMessage}
            onClose={() => setToastMessage(null)}
          />
        )}

        {pendingConsentAction && (
          <ConsentOverlay
            onAccept={handleAcceptConsent}
            onClose={() => setPendingConsentAction(null)}
          />
        )}

        <div
          aria-label="회의 상태"
          className="pointer-events-none fixed top-3 right-4 z-40 flex max-w-[calc(100vw-6rem)] flex-wrap justify-end gap-2"
        >
          <StatusIndicator
            label={getConnectionStatusLabel(liveKitRoom.status)}
            tone={connectionTone}
          />
          <StatusIndicator
            label={getRecordingStatusLabel(currentRecording?.status)}
            tone={recordingTone}
          />
        </div>

        <section
          id="room"
          className="flex min-h-[calc(100vh-8rem)] flex-col rounded-xl border bg-card"
        >
          {isInitialLoading ? (
            <MeetingPanelSkeleton />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
              <div className="w-full max-w-2xl text-center">
                <h2 className="text-2xl font-semibold">현재 참여 인원</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {displayedActiveCount}명 참여 중
                  {meeting ? ` · 시작 ${formatDateTime(meeting.startedAt)}` : ""}
                </p>
              </div>

              <div className="w-full max-w-2xl space-y-3">
                {participantStatus === "loading" && participants.length === 0 ? (
                  <>
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                  </>
                ) : activeParticipants.length > 0 ? (
                  activeParticipants.map((participant) => {
                    const isCurrentUser = participant.userId === currentUserId;
                    const isSpeaking = liveKitRoom.activeSpeakerIdentities.has(
                      participant.livekitIdentity
                    );
                    const hasKnownMicState =
                      isCurrentUser && liveKitRoom.status === "connected";
                    const isMicEnabled =
                      hasKnownMicState && liveKitRoom.isMicrophoneEnabled;

                    return (
                      <div
                        key={participant.id}
                        className={cn(
                          "flex min-h-16 items-center gap-4 rounded-lg border bg-background px-4 py-3",
                          isSpeaking && "border-emerald-300 bg-emerald-50/60"
                        )}
                      >
                        <Avatar>
                          <AvatarFallback>
                            {isSpeaking ? (
                              <CircleUserRound className="size-4 text-emerald-700" />
                            ) : (
                              getInitial(participant.user.name)
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="truncate text-lg font-semibold">
                              {getParticipantName(participant)}
                            </p>
                            {isCurrentUser && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                내 계정
                              </span>
                            )}
                            {isSpeaking && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                말하는 중
                              </span>
                            )}
                          </div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            aria-label={
                              isMicEnabled ? "마이크 켜짐" : "마이크 상태 대기"
                            }
                            className={cn(
                              "flex size-9 items-center justify-center rounded-full border",
                              isMicEnabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-border bg-card text-muted-foreground"
                            )}
                          >
                            {isMicEnabled ? (
                              <Mic className="size-4" />
                            ) : (
                              <MicOff className="size-4" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {isCurrentUser
                              ? isMicEnabled
                                ? "마이크 켜짐"
                                : "마이크 상태 대기"
                              : "원격 마이크 상태는 LiveKit 이벤트 기준으로 표시됩니다."}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-6 text-center">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">
                      현재 참여자가 없습니다.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      회의 참여 버튼으로 음성 회의에 들어갈 수 있습니다.
                    </p>
                  </div>
                )}
              </div>

              {(actionError ||
                participantError ||
                currentError ||
                liveKitRoom.errorMessage) && (
                <div className="w-full max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {actionError ??
                    participantError ??
                    currentError?.message ??
                    liveKitRoom.errorMessage}
                </div>
              )}

              <div className="grid w-full max-w-2xl gap-3">
                <Button
                  className="h-14 text-base"
                  disabled={isActionPending || liveKitRoom.isConnecting}
                  size="lg"
                  variant={isBrowserJoined ? "outline" : "default"}
                  onClick={() => {
                    if (isBrowserJoined) {
                      void handleLeaveMeeting();
                    } else {
                      handleEntryAction();
                    }
                  }}
                >
                  <JoinButtonIcon
                    className={cn(
                      isActionPending && "animate-spin",
                      !isActionPending && "size-4"
                    )}
                  />
                  {joinButtonLabel}
                </Button>

                <Button
                  className="h-14 text-base"
                  disabled={
                    !meeting ||
                    !isCurrentUserActive ||
                    isActionPending ||
                    liveKitRoom.isConnecting
                  }
                  size="lg"
                  variant={hasRunningRecording ? "destructive" : "secondary"}
                  onClick={() => void handleRecordingAction()}
                >
                  {actionStatus === "starting-recording" ||
                  actionStatus === "ending-recording" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RecordingButtonIcon />
                  )}
                  {hasRunningRecording ? "녹음 종료" : "녹음 시작"}
                </Button>
              </div>

              <Button
                aria-label="회의 상태 새로고침"
                disabled={isActionPending}
                size="icon"
                variant="ghost"
                onClick={() => {
                  void reloadCurrentMeeting();
                  void reloadParticipants(meeting?.id);
                }}
              >
                <RefreshCw />
              </Button>
            </div>
          )}

          <div
            ref={liveKitRoom.remoteAudioContainerRef}
            aria-hidden="true"
            className="hidden"
          />
        </section>

        <section
          id="report"
          className="rounded-xl border border-dashed bg-background p-5"
        >
          <h2 className="text-base font-semibold">회의록</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            회의록 목록, 상세, 재생성 UI는 #80에서 연결합니다.
          </p>
        </section>
      </div>
    </TooltipProvider>
  );
}
