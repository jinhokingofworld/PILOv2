"use client";

import {
  AlertCircle,
  CircleUserRound,
  Clock3,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  X
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

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
import {
  createMeetingApiClient,
  MeetingApiError
} from "@/features/meeting/api/client";
import {
  MeetingAudioPreflightDialog
} from "@/features/meeting/components/meeting-audio-preflight-dialog";
import {
  MeetingReportSection,
  type MeetingReportStatusFilter
} from "@/features/meeting/components/meeting-report-section";
import { useMeetingRooms } from "@/features/meeting/hooks/use-meeting-rooms";
import { MeetingWorkspaceLocationAdapter } from "@/features/meeting/meeting-workspace-location-adapter";
import { useMeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import { meetingNavigation } from "@/features/meeting/navigation";
import { useMeetingRuntime } from "@/features/meeting/runtime/meeting-runtime-provider";
import { setHeaderMeetingRecordingStatus } from "@/features/meeting/stores/header-meeting-status-store";
import { useMeetingStateInvalidation } from "@/features/meeting/stores/meeting-state-invalidation-store";
import type {
  MeetingParticipant,
  MeetingRecording,
  MeetingReportListQuery,
  RecordingConsentInput
} from "@/features/meeting/types";
import { cn } from "@/lib/utils";

type EntryAction = "start" | "join" | "reconnect";
type ActionStatus =
  | "idle"
  | "joining"
  | "leaving"
  | "starting-recording"
  | "ending-recording";
type MeetingSection = "room" | "report";

const MEETING_REPORT_PAGE_SIZE = 20;
const WORKSPACE_RECORDING_CONSENT_POLICY_VERSION = "v1";
const LIVEKIT_CONNECTION_ERROR_MESSAGE =
  "음성 회의 연결에 실패했습니다. 마이크 권한과 네트워크 상태를 확인해주세요.";
const LEAVE_FAILED_MESSAGE =
  "회의 나가기에 실패했습니다. 문제가 반복되면 녹음을 종료한 뒤 다시 시도해주세요.";
const ACTIVE_MEETING_IN_PROGRESS_ERROR_CODE =
  "MEETING_ALREADY_IN_PROGRESS";
const WORKSPACE_RECORDING_CONSENT_REQUIRED_ERROR_CODE =
  "WORKSPACE_RECORDING_CONSENT_REQUIRED";
const CURRENT_MEETING_RELOAD_FAILED_MESSAGE =
  "진행 중인 회의를 다시 찾지 못했습니다. 새로고침 후 다시 시도해주세요.";

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
      error.message === LIVEKIT_CONNECTION_ERROR_MESSAGE ||
      error.message === LEAVE_FAILED_MESSAGE ||
      error.message === CURRENT_MEETING_RELOAD_FAILED_MESSAGE
    ) {
      return error.message;
    }
  }

  return "회의 상태를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function isActiveMeetingInProgressError(error: unknown) {
  return (
    error instanceof MeetingApiError &&
    error.status === 400 &&
    error.code === ACTIVE_MEETING_IN_PROGRESS_ERROR_CODE
  );
}

function isWorkspaceRecordingConsentRequiredError(error: unknown) {
  return (
    error instanceof MeetingApiError &&
    error.status === 409 &&
    error.code === WORKSPACE_RECORDING_CONSENT_REQUIRED_ERROR_CODE
  );
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

function getRecordingElapsedSeconds(recording: MeetingRecording | null) {
  if (!recording || recording.status !== "RUNNING") {
    return 0;
  }

  const startedAt = Date.parse(recording.startedAt);
  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function formatRecordingElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function useRecordingElapsedSeconds(recording: MeetingRecording | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getRecordingElapsedSeconds(recording)
  );

  useEffect(() => {
    setElapsedSeconds(getRecordingElapsedSeconds(recording));

    if (!recording || recording.status !== "RUNNING") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(getRecordingElapsedSeconds(recording));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [recording]);

  return elapsedSeconds;
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
              이 Workspace의 회의 녹음은 회의록 생성을 위해 사용됩니다. 동의
              기록은 Workspace와 정책 버전별로 저장되며, 동의하지 않으면 음성
              회의를 시작하거나 참여할 수 없습니다.
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

export function MeetingPanel({ section = "room" }: { section?: MeetingSection }) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const currentUserId = authSession?.user.id ?? "";
  const isWorkspaceOwner = Boolean(
    authSession?.activeWorkspace.isOwner || authSession?.activeWorkspace.role === "owner"
  );
  const meetingClient = useMemo(
    () => createMeetingApiClient({ accessToken }),
    [accessToken]
  );
  const activeSection = section;
  const [reportStatusFilter, setReportStatusFilter] =
    useState<MeetingReportStatusFilter>("ALL");
  const [reportSearchQuery, setReportSearchQuery] = useState("");
  const [reportDateRange, setReportDateRange] = useState({
    from: "",
    to: ""
  });
  const [reportCursorHistory, setReportCursorHistory] = useState<string[]>([]);
  const reportCursor = reportCursorHistory.at(-1);
  const reportsQuery = useMemo<MeetingReportListQuery>(
    () => ({
      limit: MEETING_REPORT_PAGE_SIZE,
      ...(reportCursor ? { cursor: reportCursor } : {}),
      ...(reportDateRange.from ? { from: reportDateRange.from } : {}),
      ...(reportDateRange.to ? { to: reportDateRange.to } : {}),
      ...(reportSearchQuery ? { q: reportSearchQuery } : {}),
      ...(reportStatusFilter === "ALL" ? {} : { status: reportStatusFilter })
    }),
    [reportCursor, reportDateRange.from, reportDateRange.to, reportSearchQuery, reportStatusFilter]
  );
  const handleReportListFiltersChange = useCallback(
    (filters: { from: string; q: string; to: string }) => {
      setReportSearchQuery((current) => (current === filters.q ? current : filters.q));
      setReportDateRange((current) =>
        current.from === filters.from && current.to === filters.to
          ? current
          : { from: filters.from, to: filters.to }
      );
      setReportCursorHistory([]);
    },
    []
  );
  const meetingRoomsData = useMeetingRooms({
    accessToken,
    enabled: Boolean(workspaceId && accessToken),
    workspaceId
  });
  const {
    error: meetingRoomsError,
    reloadMeetingRooms,
    rooms: meetingRooms,
    selectMeetingRoom,
    selectedMeetingRoomId,
    status: meetingRoomsStatus
  } = meetingRoomsData;
  const meetingData = useMeetingWorkspaceData({
    accessToken,
    enabled: Boolean(workspaceId && accessToken),
    meetingRoomId: selectedMeetingRoomId,
    reportsEnabled: activeSection === "report",
    reportsQuery,
    workspaceId
  });
  const {
    activeMeetingId,
    connectToMeeting,
    disconnectFromMeeting,
    leaveActiveMeeting,
    liveKitRoom
  } = useMeetingRuntime();
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
  const [prejoinAction, setPrejoinAction] = useState<EntryAction | null>(null);
  const [consentSubmissionAction, setConsentSubmissionAction] =
    useState<EntryAction | null>(null);
  const [pendingEndRecordingId, setPendingEndRecordingId] = useState<string | null>(null);
  const [isMeetingRoomSwitching, setIsMeetingRoomSwitching] = useState(false);
  const [isMeetingRoomDialogOpen, setIsMeetingRoomDialogOpen] = useState(false);
  const [meetingRoomManagementError, setMeetingRoomManagementError] = useState<string | null>(null);
  const [meetingRoomManagementPending, setMeetingRoomManagementPending] = useState(false);
  const [newMeetingRoomName, setNewMeetingRoomName] = useState("");
  const [editingMeetingRoomId, setEditingMeetingRoomId] = useState<string | null>(null);
  const [editingMeetingRoomName, setEditingMeetingRoomName] = useState("");
  const [restoredMeetingRoomId, setRestoredMeetingRoomId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (section !== "room" || typeof window === "undefined") return;

    if (window.location.hash === "#report") {
      window.location.replace("/report");
      return;
    }
    if (window.location.hash === "#room") {
      window.history.replaceState(null, "", "/meeting");
    }
  }, [section]);

  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.isActive),
    [participants]
  );
  const currentUserActiveParticipant = activeParticipants.find(
    (participant) => participant.userId === currentUserId
  );
  const isCurrentUserActive = Boolean(currentUserActiveParticipant);
  const shouldLeaveMeeting = isCurrentUserActive;
  const canReconnect =
    isCurrentUserActive &&
    (liveKitRoom.status === "idle" ||
      liveKitRoom.status === "disconnected" ||
      liveKitRoom.status === "error");
  const isActionPending = actionStatus !== "idle";
  const isInitialLoading =
    meetingRoomsStatus === "loading" ||
    (currentStatus === "loading" && meeting === null);
  const hasRunningRecording = currentRecording?.status === "RUNNING";
  const recordingElapsedSeconds = useRecordingElapsedSeconds(currentRecording);
  const displayedActiveCount = activeParticipants.length || activeParticipantCount;
  const selectedMeetingRoom = meetingRooms.find(
    (room) => room.id === selectedMeetingRoomId
  );
  const availableMeetingRoomIds = useMemo(
    () => meetingRooms.map((room) => room.id),
    [meetingRooms]
  );

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let cancelled = false;
    void meetingClient
      .getCurrentUserActiveMeeting()
      .then((result) => {
        if (cancelled || !result.meeting || !result.meetingRoom) {
          return;
        }

        setRestoredMeetingRoomId(result.meetingRoom.id);
        if (result.meeting.workspaceId !== workspaceId) {
          authSession?.setActiveWorkspaceId(result.meeting.workspaceId);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [accessToken, authSession, meetingClient, workspaceId]);

  useEffect(() => {
    if (
      restoredMeetingRoomId &&
      meetingRooms.some((room) => room.id === restoredMeetingRoomId)
    ) {
      selectMeetingRoom(restoredMeetingRoomId);
    }
  }, [meetingRooms, restoredMeetingRoomId, selectMeetingRoom]);

  useEffect(() => {
    setHeaderMeetingRecordingStatus(currentRecording?.status ?? null);
  }, [currentRecording?.status]);

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

  const reloadMeetingState = useCallback(async () => {
    const currentMeeting = await reloadCurrentMeeting();
    await reloadParticipants(currentMeeting.meeting?.id);
  }, [reloadCurrentMeeting, reloadParticipants]);

  useMeetingStateInvalidation(canLoad, reloadMeetingState);

  useEffect(() => {
    void reloadParticipants(meeting?.id);
  }, [meeting?.id, reloadParticipants]);

  useEffect(() => {
    if (
      currentStatus === "success" &&
      !meeting &&
      liveKitRoom.status !== "idle"
    ) {
      void disconnectFromMeeting();
    }
  }, [currentStatus, disconnectFromMeeting, liveKitRoom.status, meeting]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToastMessage(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  async function handleMeetingRoomChange(nextMeetingRoomId: string) {
    if (!nextMeetingRoomId || nextMeetingRoomId === selectedMeetingRoomId) {
      return;
    }

    setIsMeetingRoomSwitching(true);
    setActionError(null);
    setToastMessage(null);

    try {
      if (activeMeetingId) {
        await leaveActiveMeeting();
      } else if (isCurrentUserActive && meeting) {
        await leaveMeeting(meeting.id);
        await disconnectFromMeeting();
      } else {
        await disconnectFromMeeting();
      }

      setParticipants([]);
      setParticipantError(null);
      setParticipantStatus("idle");
      selectMeetingRoom(nextMeetingRoomId);
      setIsMeetingRoomDialogOpen(false);
    } catch (error) {
      const message = "회의방을 전환하지 못했습니다. 기존 회의 연결을 유지합니다.";
      setActionError(message);
      setToastMessage(message);
      void error;
    } finally {
      setIsMeetingRoomSwitching(false);
    }
  }

  async function handleCreateMeetingRoom() {
    const name = newMeetingRoomName.trim();
    if (!name) {
      setMeetingRoomManagementError("회의방 이름을 입력해주세요.");
      return;
    }

    setMeetingRoomManagementPending(true);
    setMeetingRoomManagementError(null);
    try {
      await meetingClient.createMeetingRoom(workspaceId, { name });
      setNewMeetingRoomName("");
      await reloadMeetingRooms();
    } catch (error) {
      setMeetingRoomManagementError(getErrorMessage(error));
    } finally {
      setMeetingRoomManagementPending(false);
    }
  }

  async function handleUpdateMeetingRoom(meetingRoomId: string) {
    const name = editingMeetingRoomName.trim();
    if (!name) {
      setMeetingRoomManagementError("회의방 이름을 입력해주세요.");
      return;
    }

    setMeetingRoomManagementPending(true);
    setMeetingRoomManagementError(null);
    try {
      await meetingClient.updateMeetingRoom(workspaceId, meetingRoomId, { name });
      setEditingMeetingRoomId(null);
      setEditingMeetingRoomName("");
      await reloadMeetingRooms();
    } catch (error) {
      setMeetingRoomManagementError(getErrorMessage(error));
    } finally {
      setMeetingRoomManagementPending(false);
    }
  }

  async function handleDeleteMeetingRoom(meetingRoomId: string) {
    setMeetingRoomManagementPending(true);
    setMeetingRoomManagementError(null);
    try {
      await meetingClient.deleteMeetingRoom(workspaceId, meetingRoomId);
      const nextRooms = await reloadMeetingRooms();
      if (meetingRoomId === selectedMeetingRoomId) {
        selectMeetingRoom(nextRooms[0]?.id ?? "");
      }
    } catch (error) {
      setMeetingRoomManagementError(getErrorMessage(error));
    } finally {
      setMeetingRoomManagementPending(false);
    }
  }

  async function runEntryAction(
    action: EntryAction,
    audioDeviceId: string | null,
    shouldSubmitConsent: boolean
  ) {
    const targetMeetingId = meeting?.id ?? null;

    setActionStatus("joining");
    setActionError(null);
    setToastMessage(null);

    let createdOrJoinedMeetingId: string | null = null;
    let failedStage: "api" | "livekit" = "api";
    const recordingConsent: RecordingConsentInput | undefined =
      shouldSubmitConsent
        ? {
            accepted: true,
            policyVersion: WORKSPACE_RECORDING_CONSENT_POLICY_VERSION
          }
        : undefined;
    const entryInput = recordingConsent ? { recordingConsent } : {};

    try {
      const joinCurrentMeeting = async (meetingId: string | null) => {
        const currentMeetingId =
          meetingId ?? (await reloadCurrentMeeting()).meeting?.id ?? null;

        if (!currentMeetingId) {
          throw new Error(CURRENT_MEETING_RELOAD_FAILED_MESSAGE);
        }

        return joinMeeting(currentMeetingId, entryInput);
      };
      const result =
        action === "start"
          ? await startMeeting(entryInput).catch((error: unknown) => {
              if (!isActiveMeetingInProgressError(error)) {
                throw error;
              }

              return joinCurrentMeeting(null);
            })
          : await joinCurrentMeeting(targetMeetingId);
      createdOrJoinedMeetingId = result.meeting.id;

      failedStage = "livekit";
      await connectToMeeting({
        audioDeviceId,
        livekit: result.livekit,
        meeting: result.meeting
      });

      await Promise.all([
        reloadCurrentMeeting(),
        reloadParticipants(result.meeting.id)
      ]);
    } catch (error) {
      if (createdOrJoinedMeetingId && action !== "reconnect") {
        await leaveMeeting(createdOrJoinedMeetingId).catch(() => undefined);
        await disconnectFromMeeting();
        await reloadCurrentMeeting();
        await reloadParticipants(createdOrJoinedMeetingId);
      }

      if (
        failedStage === "api" &&
        isWorkspaceRecordingConsentRequiredError(error)
      ) {
        setPendingConsentAction(action);
        return;
      }

      const message =
        failedStage === "livekit"
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
    setPrejoinAction(action);
  }

  function handleReconnect() {
    if (!meeting || !canReconnect) {
      return;
    }

    setPrejoinAction("reconnect");
  }

  function handleAcceptConsent() {
    const action = pendingConsentAction ?? (meeting ? "join" : "start");
    setPendingConsentAction(null);
    setConsentSubmissionAction(action);
    setPrejoinAction(action);
  }

  function handlePrejoinConfirm(audioDeviceId: string | null) {
    const action = prejoinAction ?? (meeting ? "join" : "start");
    const shouldSubmitConsent = consentSubmissionAction === action;
    setPrejoinAction(null);
    setConsentSubmissionAction(null);
    void runEntryAction(action, audioDeviceId, shouldSubmitConsent);
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
      await disconnectFromMeeting();
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

    if (!currentRecording) {
      return;
    }

    setPendingEndRecordingId(currentRecording.id);
  }

  async function handleConfirmEndRecording() {
    const targetRecording = currentRecording;
    const targetRecordingId = pendingEndRecordingId;
    setPendingEndRecordingId(null);

    if (
      !meeting ||
      !targetRecording ||
      targetRecording.status !== "RUNNING" ||
      !targetRecordingId ||
      targetRecording.id !== targetRecordingId
    ) {
      setToastMessage("진행 중인 녹음 상태가 바뀌었습니다. 최신 상태를 다시 확인해주세요.");
      return;
    }

    setActionStatus("ending-recording");
    setActionError(null);
    setToastMessage(null);

    try {
      const result = await endRecording(meeting.id, targetRecordingId);
      await Promise.all([reloadCurrentMeeting(), reloadParticipants(meeting.id)]);
      setToastMessage(
        result.recording.status === "FAILED"
          ? "녹음 종료에 실패했습니다. 회의는 계속 참여할 수 있으며 잠시 후 다시 시도해주세요."
          : result.report
            ? "녹음을 종료했습니다. 회의는 계속 참여할 수 있으며 회의록 생성을 준비합니다."
            : result.recording.status === "COMPLETED" &&
                typeof result.recording.durationSec === "number" &&
                result.recording.durationSec <= 60
              ? `녹음을 ${result.recording.durationSec}초에 종료했습니다. 60초 이하 녹음은 회의록이 생성되지 않습니다.`
              : "녹음을 종료했습니다. 회의록 생성 상태는 회의록 목록에서 확인해주세요."
      );
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      setToastMessage(message);
    } finally {
      setActionStatus("idle");
    }
  }

  const joinButtonLabel = shouldLeaveMeeting ? "회의 나가기" : "회의 참여";
  const joinButtonIcon = shouldLeaveMeeting ? PhoneOff : Phone;
  const JoinButtonIcon = isActionPending ? Loader2 : joinButtonIcon;
  const RecordingButtonIcon = hasRunningRecording ? Square : Radio;
  const isEntryButtonDisabled =
    isActionPending ||
    isMeetingRoomSwitching ||
    meetingRoomsStatus !== "success" ||
    !selectedMeetingRoomId ||
    (!shouldLeaveMeeting &&
      (liveKitRoom.isConnecting || currentStatus === "loading"));

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
        <MeetingWorkspaceLocationAdapter
          availableRoomIds={availableMeetingRoomIds}
          roomsReady={meetingRoomsStatus === "success"}
          selectedMeetingRoomId={selectedMeetingRoomId || null}
          selectMeetingRoom={selectMeetingRoom}
        />
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

        {prejoinAction && (
          <MeetingAudioPreflightDialog
            onClose={() => {
              setPrejoinAction(null);
              setConsentSubmissionAction(null);
            }}
            onConfirm={handlePrejoinConfirm}
          />
        )}

        <DialogPrimitive.Root
          open={isMeetingRoomDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!meetingRoomManagementPending) {
              setIsMeetingRoomDialogOpen(nextOpen);
              if (!nextOpen) {
                setEditingMeetingRoomId(null);
                setMeetingRoomManagementError(null);
              }
            }
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs" />
            <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl outline-none">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogPrimitive.Title className="font-heading text-lg font-semibold">
                    회의방 목록
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                    회의방을 선택하면 현재 참여 중인 회의에서 먼저 나갑니다.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close render={<Button aria-label="회의방 목록 닫기" size="icon-sm" type="button" variant="ghost" />}>
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </div>

              {meetingRoomManagementError ? (
                <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {meetingRoomManagementError}
                </p>
              ) : null}

              <div className="mt-5 space-y-2">
                {meetingRooms.map((room) => (
                  <div key={room.id} className="rounded-lg border p-3">
                    {editingMeetingRoomId === room.id ? (
                      <div className="flex gap-2">
                        <input
                          aria-label={`${room.name} 회의방 이름`}
                          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                          disabled={meetingRoomManagementPending}
                          value={editingMeetingRoomName}
                          onChange={(event) => setEditingMeetingRoomName(event.target.value)}
                        />
                        <Button
                          disabled={meetingRoomManagementPending}
                          size="sm"
                          type="button"
                          onClick={() => void handleUpdateMeetingRoom(room.id)}
                        >
                          저장
                        </Button>
                        <Button
                          disabled={meetingRoomManagementPending}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => setEditingMeetingRoomId(null)}
                        >
                          취소
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          className="min-w-0 flex-1 text-left text-sm font-medium"
                          disabled={isMeetingRoomSwitching || meetingRoomManagementPending}
                          type="button"
                          onClick={() => void handleMeetingRoomChange(room.id)}
                        >
                          {room.name}
                          {room.isDefault ? " · 기본 회의방" : ""}
                        </button>
                        {isWorkspaceOwner ? (
                          <>
                            <Button
                              aria-label={`${room.name} 이름 변경`}
                              disabled={isMeetingRoomSwitching || meetingRoomManagementPending}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setEditingMeetingRoomId(room.id);
                                setEditingMeetingRoomName(room.name);
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              aria-label={`${room.name} 삭제`}
                              disabled={
                                room.isDefault ||
                                isMeetingRoomSwitching ||
                                meetingRoomManagementPending
                              }
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                              onClick={() => void handleDeleteMeetingRoom(room.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isWorkspaceOwner ? (
                <div className="mt-5 border-t pt-4">
                  <p className="text-sm font-medium">회의방 추가</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label="새 회의방 이름"
                      className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                      disabled={meetingRoomManagementPending}
                      placeholder="예: 디자인 검토"
                      value={newMeetingRoomName}
                      onChange={(event) => setNewMeetingRoomName(event.target.value)}
                    />
                    <Button
                      disabled={meetingRoomManagementPending}
                      size="sm"
                      type="button"
                      onClick={() => void handleCreateMeetingRoom()}
                    >
                      <Plus className="size-4" />
                      추가
                    </Button>
                  </div>
                </div>
              ) : null}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <DialogPrimitive.Root
          open={pendingEndRecordingId !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setPendingEndRecordingId(null);
            }
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs" />
            <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl outline-none">
              <DialogPrimitive.Title className="font-heading text-lg font-semibold">
                녹음을 종료할까요?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground">
                녹음만 종료하며 회의와 참여자는 계속 유지됩니다. 60초 이하 녹음은 회의록을 만들지 않습니다.
              </DialogPrimitive.Description>
              <div className="mt-5 flex justify-end gap-2">
                <DialogPrimitive.Close
                  render={<Button type="button" variant="outline" />}
                >
                  취소
                </DialogPrimitive.Close>
                <Button type="button" onClick={() => void handleConfirmEndRecording()}>
                  녹음 종료
                </Button>
              </div>
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {activeSection === "room" ? (
          <section
            id="room"
            className="flex min-h-[calc(100vh-8rem)] flex-col rounded-xl border bg-card"
          >
            {isInitialLoading ? (
              <MeetingPanelSkeleton />
            ) : (
              <>
                <div className="flex items-center border-b px-4 py-3 sm:px-6">
                  <Button
                    aria-haspopup="dialog"
                    className="h-9 rounded-none border-r px-6 text-base font-semibold"
                    disabled={
                      meetingRoomsStatus !== "success" ||
                      isActionPending ||
                      isMeetingRoomSwitching
                    }
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMeetingRoomManagementError(null);
                      setIsMeetingRoomDialogOpen(true);
                    }}
                  >
                    회의방 목록
                  </Button>
                  <h2 className="min-w-0 truncate pl-6 text-2xl font-semibold">
                    {selectedMeetingRoom?.name ?? "회의방을 선택하세요"}
                  </h2>
                </div>

                <div className="flex flex-1 flex-col items-center gap-6 px-4 py-12 sm:px-8">
                  <div className="w-full max-w-2xl text-center">
                    {isMeetingRoomSwitching ? (
                      <p className="text-sm text-muted-foreground">
                        기존 음성 연결을 종료하고 회의방을 전환하는 중입니다.
                      </p>
                    ) : selectedMeetingRoom ? (
                      <p className="text-sm text-muted-foreground">
                        {selectedMeetingRoom.name}의 회의 상태입니다.
                      </p>
                    ) : null}
                    <h3 className="mt-2 text-2xl font-semibold">현재 참여 인원</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {displayedActiveCount}명 참여 중
                      {meeting
                        ? ` · 시작 ${formatDateTime(meeting.startedAt)}`
                        : ""}
                    </p>
                  </div>

                <div className="w-full max-w-2xl space-y-3">
                  {hasRunningRecording ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                          <Radio className="size-4 animate-pulse" />
                        </span>
                        <div>
                          <p className="font-medium">녹음 진행 중</p>
                          <p className="text-sm text-muted-foreground">
                            60초를 초과하면 종료 뒤 회의록 생성을 준비합니다.
                          </p>
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-lg font-semibold tabular-nums">
                        <Clock3 className="size-4" />
                        {formatRecordingElapsed(recordingElapsedSeconds)}
                      </span>
                    </div>
                  ) : null}
                  {participantStatus === "loading" &&
                  participants.length === 0 ? (
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
                  meetingRoomsError ||
                  liveKitRoom.errorMessage) && (
                  <div className="w-full max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {actionError ??
                      participantError ??
                      currentError?.message ??
                      meetingRoomsError?.message ??
                      liveKitRoom.errorMessage}
                    {meetingRoomsError ? (
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        onClick={() => void reloadMeetingRooms()}
                      >
                        <RefreshCw />
                        회의방 다시 불러오기
                      </Button>
                    ) : null}
                  </div>
                )}

                <div className="grid w-full max-w-2xl gap-3">
                  {canReconnect ? (
                    <Button
                      className="h-14 text-base"
                      disabled={isActionPending}
                      size="lg"
                      onClick={handleReconnect}
                    >
                      <RefreshCw className="size-4" />
                      다시 연결
                    </Button>
                  ) : null}

                  <Button
                    className="h-14 text-base"
                    disabled={isEntryButtonDisabled}
                    size="lg"
                    variant={shouldLeaveMeeting ? "outline" : "default"}
                    onClick={() => {
                      if (shouldLeaveMeeting) {
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
                      isMeetingRoomSwitching ||
                      liveKitRoom.status !== "connected"
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
              </>
            )}

          </section>
        ) : (
          <MeetingReportSection
            meetingData={meetingData}
            statusFilter={reportStatusFilter}
            onStatusFilterChange={(status) => {
              setReportStatusFilter(status);
              setReportCursorHistory([]);
            }}
            onListFiltersChange={handleReportListFiltersChange}
            onNextPage={() => {
              if (meetingData.nextReportCursor) {
                setReportCursorHistory((history) => [
                  ...history,
                  meetingData.nextReportCursor as string
                ]);
              }
            }}
            onPreviousPage={() => {
              setReportCursorHistory((history) => history.slice(0, -1));
            }}
            onToastMessage={setToastMessage}
            hasPreviousPage={reportCursorHistory.length > 0}
            nextCursor={meetingData.nextReportCursor}
          />
        )}

      </div>
    </TooltipProvider>
  );
}
