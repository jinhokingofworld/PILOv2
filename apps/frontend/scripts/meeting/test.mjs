import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const meetingTypes = await readFile(
  new URL("../../src/features/meeting/types/index.ts", import.meta.url),
  "utf8"
);
const meetingApiClient = await readFile(
  new URL("../../src/features/meeting/api/client.ts", import.meta.url),
  "utf8"
);
const meetingHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-meeting-workspace-data.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingRoomsHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-meeting-rooms.ts",
    import.meta.url
  ),
  "utf8"
);
const liveKitHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-livekit-meeting-room.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingReportRealtimeHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-meeting-report-realtime.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingStateRealtimeHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-meeting-state-realtime.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingStateInvalidationStore = await readFile(
  new URL(
    "../../src/features/meeting/stores/meeting-state-invalidation-store.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingConnectionActionStore = await readFile(
  new URL(
    "../../src/features/meeting/stores/meeting-connection-action-store.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingAudioPreflightHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-meeting-audio-preflight.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingAudioPreflightDialog = await readFile(
  new URL(
    "../../src/features/meeting/components/meeting-audio-preflight-dialog.tsx",
    import.meta.url
  ),
  "utf8"
);
const meetingRuntimeProvider = await readFile(
  new URL(
    "../../src/features/meeting/runtime/meeting-runtime-provider.tsx",
    import.meta.url
  ),
  "utf8"
);
const headerMeetingStatusStore = await readFile(
  new URL(
    "../../src/features/meeting/stores/header-meeting-status-store.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingReportSection = await readFile(
  new URL(
    "../../src/features/meeting/components/meeting-report-section.tsx",
    import.meta.url
  ),
  "utf8"
);
const headerMeetingStatus = await readFile(
  new URL(
    "../../src/features/meeting/components/header-meeting-status.tsx",
    import.meta.url
  ),
  "utf8"
);
const meetingPanel = await readFile(
  new URL(
    "../../src/features/meeting/components/meeting-panel.tsx",
    import.meta.url
  ),
  "utf8"
);
const meetingNavigation = await readFile(
  new URL("../../src/features/meeting/navigation.ts", import.meta.url),
  "utf8"
);
const homeRouting = await readFile(
  new URL("../../src/features/home/utils/home-routing.ts", import.meta.url),
  "utf8"
);
const packageJson = await readFile(
  new URL("../../package.json", import.meta.url),
  "utf8"
);

assert.match(meetingTypes, /export type Meeting =/);
assert.match(meetingTypes, /export type MeetingRoom =/);
assert.match(meetingTypes, /export type MeetingRoomListPayload =/);
assert.match(meetingTypes, /export type CurrentUserActiveMeetingPayload =/);
assert.match(meetingTypes, /export type MeetingParticipant =/);
assert.match(meetingTypes, /export type LiveKitJoin =/);
assert.match(meetingTypes, /export type MeetingRecording =/);
assert.match(meetingTypes, /export type MeetingReportSummary =/);
assert.match(meetingTypes, /participantSummary\?:/);
assert.match(meetingTypes, /export type MeetingReportDetail =/);
assert.match(meetingTypes, /export type RecordingStatus = "RUNNING"/);
assert.match(meetingTypes, /"COMPLETED" \| "FAILED"/);
assert.match(meetingTypes, /export type MeetingReportStatus =/);
assert.match(meetingTypes, /"QUEUED"/);
assert.match(meetingTypes, /"TRANSCRIBING"/);
assert.match(meetingTypes, /"SUMMARIZING"/);
assert.match(meetingTypes, /"COMPLETED" \| "FAILED"/);
assert.match(meetingTypes, /export type MeetingReportFailedStep = "RECORDING"/);
assert.match(meetingTypes, /"STT" \| "LLM"/);
assert.match(meetingTypes, /actionItemCandidates: unknown\[\]/);
assert.match(meetingTypes, /export type CurrentMeetingPayload/);
assert.match(meetingTypes, /export type RecordingConsentInput/);
assert.match(meetingTypes, /export type JoinMeetingInput/);
assert.match(meetingTypes, /export type StartMeetingPayload/);
assert.match(meetingTypes, /export type JoinMeetingPayload/);
assert.match(meetingTypes, /export type LeaveMeetingPayload/);
assert.match(meetingTypes, /export type MeetingReportRegenerationPayload/);

assert.match(meetingApiClient, /createMeetingApiClient/);
assert.match(meetingApiClient, /\/api\/v1/);
assert.match(meetingApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(meetingApiClient, /Authorization/);
assert.match(meetingApiClient, /credentials: "same-origin"/);
assert.match(meetingApiClient, /success === true/);
assert.match(meetingApiClient, /buildMeetingApiUrl/);
assert.match(meetingApiClient, /getCurrentMeeting/);
assert.match(meetingApiClient, /listMeetingRooms/);
assert.match(meetingApiClient, /createMeetingRoom/);
assert.match(meetingApiClient, /updateMeetingRoom/);
assert.match(meetingApiClient, /deleteMeetingRoom/);
assert.match(meetingApiClient, /getCurrentUserActiveMeeting/);
assert.match(meetingApiClient, /getCurrentMeetingInRoom/);
assert.match(meetingApiClient, /startMeetingInRoom/);
assert.match(meetingApiClient, /withJsonBody\(body, \{ method: "POST" \}\)/);
assert.match(meetingApiClient, /workspaceMeetingRoomsPath/);
assert.match(meetingApiClient, /startMeeting/);
assert.match(meetingApiClient, /joinMeeting/);
assert.match(meetingApiClient, /getMeeting/);
assert.match(meetingApiClient, /leaveMeeting/);
assert.match(meetingApiClient, /startRecording/);
assert.match(meetingApiClient, /endRecording/);
assert.match(meetingApiClient, /listRecordings/);
assert.match(meetingApiClient, /getCurrentRecording/);
assert.match(meetingApiClient, /listParticipants/);
assert.match(meetingApiClient, /listMeetingReports/);
assert.match(meetingApiClient, /getMeetingReport/);
assert.match(meetingApiClient, /deleteMeetingReport/);
assert.match(meetingApiClient, /listMeetingReportsByMeeting/);
assert.match(meetingApiClient, /regenerateMeetingReport/);
assert.match(meetingApiClient, /workspaceMeetingsPath/);
assert.match(meetingApiClient, /\/current/);
assert.match(meetingApiClient, /\/participants\/me/);
assert.match(meetingApiClient, /meetingRecordingsPath/);
assert.match(meetingApiClient, /\/recordings/);
assert.match(meetingApiClient, /\/meeting-reports/);
assert.match(meetingApiClient, /\/regeneration-jobs/);
assert.doesNotMatch(meetingApiClient, /credentials: "include"/);
assert.doesNotMatch(meetingApiClient, /features\/board/);
assert.doesNotMatch(meetingApiClient, /features\/calendar/);
assert.doesNotMatch(meetingApiClient, /features\/github-integration/);

assert.match(meetingHook, /"use client"/);
assert.match(meetingHook, /useMeetingWorkspaceData/);
assert.match(meetingHook, /createMeetingApiClient/);
assert.match(meetingHook, /MeetingWorkspaceDataStatus/);
assert.match(meetingHook, /reportsEnabled/);
assert.match(meetingHook, /reloadCurrentMeeting/);
assert.match(meetingHook, /meetingRoomId\?: string \| null/);
assert.match(meetingHook, /usesRoomScopedApi/);
assert.match(meetingHook, /getCurrentMeetingInRoom/);
assert.match(meetingHook, /startMeetingInRoom/);
assert.match(meetingHook, /reloadReports/);
assert.match(meetingHook, /startMeeting/);
assert.match(meetingHook, /joinMeeting/);
assert.match(meetingHook, /leaveMeeting/);
assert.match(meetingHook, /startRecording/);
assert.match(meetingHook, /endRecording/);
assert.match(meetingHook, /regenerateMeetingReport/);
assert.match(meetingHook, /deleteMeetingReport/);
assert.match(meetingHook, /Meeting action requires an authenticated workspace/);
assert.doesNotMatch(meetingHook, /livekit-client/);
assert.doesNotMatch(meetingHook, /@livekit\/components-react/);

assert.match(meetingRoomsHook, /useMeetingRooms/);
assert.match(meetingRoomsHook, /listMeetingRooms/);
assert.match(meetingRoomsHook, /selectedMeetingRoomId/);
assert.match(meetingRoomsHook, /room\.isDefault/);
assert.match(meetingRoomsHook, /reloadMeetingRooms/);
assert.match(meetingRoomsHook, /requestGenerationRef/);
assert.match(meetingRoomsHook, /loadedWorkspaceId/);
assert.match(meetingRoomsHook, /isCurrentWorkspaceResult/);
const meetingRoomsLoadStart = meetingRoomsHook.slice(
  meetingRoomsHook.indexOf('setStatus("loading")') - 120,
  meetingRoomsHook.indexOf("try {", meetingRoomsHook.indexOf('setStatus("loading")'))
);
assert.doesNotMatch(meetingRoomsLoadStart, /setSelectedMeetingRoomId\(null\)/);
assert.match(
  meetingRoomsHook,
  /result\.rooms\.some\(\(room\) => room\.id === currentMeetingRoomId\)/
);

assert.match(packageJson, /"livekit-client":/);
assert.match(liveKitHook, /useLiveKitMeetingRoom/);
assert.match(liveKitHook, /new Room\(/);
assert.match(liveKitHook, /RoomEvent\.TrackSubscribed/);
assert.match(liveKitHook, /RoomEvent\.TrackUnsubscribed/);
assert.match(liveKitHook, /RoomEvent\.ConnectionQualityChanged/);
assert.match(liveKitHook, /mapConnectionQuality/);
assert.match(liveKitHook, /participant\.identity !== room\.localParticipant\.identity/);
assert.match(liveKitHook, /hasActiveSession: roomName !== null/);
assert.match(liveKitHook, /setMicrophoneEnabled\(\s*true,/);
assert.match(liveKitHook, /remoteAudioContainerRef/);
assert.match(liveKitHook, /track\.attach\(\)/);
assert.doesNotMatch(liveKitHook, /@livekit\/components-react/);

assert.match(meetingRuntimeProvider, /MeetingRuntimeProvider/);
assert.match(meetingRuntimeProvider, /useMeetingRuntime/);
assert.match(meetingRuntimeProvider, /useLiveKitMeetingRoom/);
assert.match(meetingRuntimeProvider, /createMeetingApiClient/);
assert.match(meetingRuntimeProvider, /connectToMeeting/);
assert.match(meetingRuntimeProvider, /disconnectFromMeeting/);
assert.match(meetingRuntimeProvider, /leaveActiveMeeting/);
assert.match(meetingRuntimeProvider, /activeSessionRef/);
assert.match(meetingRuntimeProvider, /const leaveSession = useCallback/);
assert.match(meetingRuntimeProvider, /previousSession\.meetingId !== meeting\.id/);
assert.match(meetingRuntimeProvider, /await leaveSession\(previousSession\)/);
assert.match(meetingRuntimeProvider, /setHeaderMeetingConnectionState/);
assert.match(meetingRuntimeProvider, /hasConnectionSession: hasActiveSession/);
assert.match(meetingRuntimeProvider, /connectionStatus: liveKitRoomStatus/);
assert.match(meetingRuntimeProvider, /setHeaderMeetingRecordingStatus\(null\)/);
assert.match(meetingRuntimeProvider, /useMeetingStateRealtime/);
assert.match(meetingRuntimeProvider, /notifyMeetingStateInvalidated/);
assert.match(meetingRuntimeProvider, /remoteAudioContainerRef/);
assert.match(meetingRuntimeProvider, /data-livekit-audio-sink="true"/);

assert.match(meetingNavigation, /title: "음성회의"/);
assert.match(meetingNavigation, /회의 참여, 녹음, 회의록 확인과 재생성/);
assert.match(meetingNavigation, /href: "\/meeting"/);
assert.match(meetingNavigation, /href: "\/report"/);
assert.doesNotMatch(meetingNavigation, /#room|#report/);
assert.match(homeRouting, /buildMeetingReportHref\(reportId: string\)/);
assert.match(homeRouting, /\/report\?reportId=\$\{encodeURIComponent\(reportId\)\}/);

assert.match(meetingPanel, /"use client"/);
assert.match(meetingPanel, /useAuthSession/);
assert.match(meetingPanel, /useMeetingWorkspaceData/);
assert.match(meetingPanel, /useMeetingRooms/);
assert.match(meetingPanel, /meetingRoomId: selectedMeetingRoomId/);
assert.match(meetingPanel, /회의방 목록/);
assert.match(meetingPanel, /border-r px-6 text-base font-semibold/);
assert.match(meetingPanel, /getCurrentUserActiveMeeting/);
assert.match(meetingPanel, /createMeetingRoom/);
assert.match(meetingPanel, /updateMeetingRoom/);
assert.match(meetingPanel, /deleteMeetingRoom/);
assert.match(meetingPanel, /isWorkspaceOwner/);
assert.match(meetingPanel, /function handleMeetingRoomChange/);
assert.match(meetingPanel, /await leaveActiveMeeting\(\)/);
assert.match(meetingPanel, /기존 음성 연결을 종료하고 회의방을 전환하는 중입니다/);
assert.match(meetingPanel, /회의방 다시 불러오기/);
assert.match(meetingPanel, /useMeetingRuntime/);
assert.match(meetingPanel, /connectToMeeting/);
assert.match(meetingPanel, /disconnectFromMeeting/);
assert.match(meetingPanel, /setHeaderMeetingRecordingStatus/);
assert.match(meetingPanel, /setHeaderMeetingRecordingStatus\(currentRecording\?\.status \?\? null\)/);
assert.match(meetingPanel, /currentStatus === "success"/);
assert.doesNotMatch(meetingPanel, /useLiveKitMeetingRoom/);
assert.doesNotMatch(meetingPanel, /setHeaderMeetingConnectionStatus/);
assert.match(meetingPanel, /ACTIVE_MEETING_IN_PROGRESS_ERROR_CODE/);
assert.match(meetingPanel, /MEETING_ALREADY_IN_PROGRESS/);
assert.match(meetingPanel, /CURRENT_MEETING_RELOAD_FAILED_MESSAGE/);
assert.match(meetingPanel, /isActiveMeetingInProgressError/);
assert.match(meetingPanel, /WORKSPACE_RECORDING_CONSENT_REQUIRED/);
assert.match(meetingPanel, /isWorkspaceRecordingConsentRequiredError/);
assert.match(meetingPanel, /policyVersion: WORKSPACE_RECORDING_CONSENT_POLICY_VERSION/);
assert.match(meetingPanel, /error instanceof MeetingApiError/);
assert.match(meetingPanel, /return joinCurrentMeeting\(null\)/);
assert.match(meetingPanel, /currentStatus === "loading"/);
assert.doesNotMatch(meetingPanel, /recordingConsentAccepted/);
assert.doesNotMatch(meetingPanel, /RECORDING_CONSENT_STORAGE_KEY/);
assert.doesNotMatch(meetingPanel, /localStorage\.setItem/);
assert.doesNotMatch(meetingPanel, /getUserMedia/);
assert.match(meetingPanel, /회의 참여/);
assert.match(meetingPanel, /회의 나가기/);
assert.match(meetingPanel, /shouldLeaveMeeting = isCurrentUserActive/);
assert.match(meetingPanel, /if \(shouldLeaveMeeting\)/);
assert.match(meetingPanel, /녹음 시작/);
assert.match(meetingPanel, /녹음 종료/);
assert.match(meetingPanel, /현재 참여 인원/);
assert.doesNotMatch(meetingPanel, /remoteAudioContainerRef/);
assert.match(meetingPanel, /MeetingReportSection/);
assert.match(meetingPanel, /activeSection/);
assert.match(meetingPanel, /section = "room"/);
assert.match(meetingPanel, /window\.location\.replace\("\/report"\)/);
assert.match(meetingPanel, /window\.history\.replaceState\(null, "", "\/meeting"\)/);
assert.match(meetingPanel, /reportsEnabled: activeSection === "report"/);
assert.match(meetingPanel, /reportStatusFilter/);
assert.match(meetingPanel, /MEETING_REPORT_PAGE_SIZE = 20/);
assert.match(meetingPanel, /reportCursorHistory/);
assert.match(meetingPanel, /nextReportCursor/);
assert.match(meetingPanel, /onListFiltersChange/);
assert.match(meetingPanel, /nextReportCursor/);
assert.match(meetingPanel, /onListFiltersChange/);
assert.match(meetingPanel, /60초 이하 녹음은 회의록이 생성되지 않습니다/);
assert.match(meetingPanel, /useRecordingElapsedSeconds/);
assert.match(meetingPanel, /setInterval/);
assert.match(meetingPanel, /useMeetingStateInvalidation/);
assert.match(meetingPanel, /consumeMeetingConnectionAction/);
assert.match(meetingPanel, /subscribeMeetingConnectionAction/);
assert.match(meetingPanel, /action\.workspaceId !== workspaceId/);
assert.match(meetingPanel, /meetingRoomsWorkspaceId !== action\.workspaceId/);
assert.match(meetingPanel, /setActiveWorkspaceId\(action\.workspaceId\)/);
assert.match(
  meetingPanel,
  /activeMeetingId && activeMeetingId !== action\.meetingId[\s\S]*disconnectFromMeeting\(\)/
);
assert.match(meetingPanel, /reconcilingMeetingConnectionActionId/);
assert.match(meetingPanel, /setPrejoinAction\("reconnect"\)/);
assert.match(meetingPanel, /Agent가 선택한 회의방을 찾을 수 없습니다/);
assert.doesNotMatch(meetingPanel, /MEETING_STATUS_POLL_INTERVAL_MS/);
assert.match(meetingPanel, /Math\.max\(0, Math\.floor/);
assert.match(meetingPanel, /녹음 진행 중/);
assert.match(meetingPanel, /녹음을 종료할까요\?/);
assert.match(meetingPanel, /녹음만 종료하며 회의와 참여자는 계속 유지됩니다/);
assert.match(meetingPanel, /targetRecording\.id !== targetRecordingId/);
assert.match(meetingPanel, /result\.recording\.durationSec/);
assert.match(meetingPanel, /result\.recording\.status === "FAILED"/);

assert.match(meetingStateRealtimeHook, /meeting:state:updated/);
assert.match(meetingStateRealtimeHook, /meeting:subscribed/);
assert.match(meetingStateRealtimeHook, /isMeetingStateRealtimeEvent/);
assert.match(meetingStateRealtimeHook, /socket\.emit\("meeting:subscribe"/);
assert.match(meetingStateInvalidationStore, /useMeetingStateInvalidation/);
assert.match(meetingStateInvalidationStore, /reloadQueued/);
assert.match(meetingConnectionActionStore, /enqueueMeetingConnectionAction/);
assert.match(meetingConnectionActionStore, /consumeMeetingConnectionAction/);
assert.match(meetingConnectionActionStore, /subscribeMeetingConnectionAction/);
assert.match(meetingConnectionActionStore, /handledActionExpirations/);
assert.doesNotMatch(meetingConnectionActionStore, /localStorage|sessionStorage/);
assert.doesNotMatch(headerMeetingStatus, /HEADER_MEETING_STATUS_POLL_INTERVAL_MS/);
assert.match(meetingPanel, /result\.recording\.durationSec <= 60/);
assert.doesNotMatch(meetingPanel, /window\.confirm/);
assert.doesNotMatch(meetingPanel, /AvatarImage/);
assert.doesNotMatch(meetingPanel, /aria-label="회의 상태"/);
assert.doesNotMatch(meetingPanel, /fixed top-3 right-4/);

assert.match(headerMeetingStatus, /HeaderMeetingStatus/);
assert.match(headerMeetingStatus, /useSyncExternalStore/);
assert.doesNotMatch(headerMeetingStatus, /HEADER_MEETING_STATUS_POLL_INTERVAL_MS/);
assert.match(headerMeetingStatus, /음성 미연결/);
assert.match(headerMeetingStatus, /음성 품질 낮음/);
assert.match(headerMeetingStatus, /음성 연결 불안정/);
assert.match(headerMeetingStatus, /hasConnectionSession/);
assert.match(headerMeetingStatus, /if \(!headerMeetingStatus\.hasConnectionSession\)/);
assert.match(headerMeetingStatus, /녹음 대기/);
assert.match(headerMeetingStatus, /flex-nowrap/);
assert.doesNotMatch(headerMeetingStatus, /useLiveKitMeetingRoom/);
assert.doesNotMatch(
  headerMeetingStatus,
  /const connectionStatus: .* = "idle"/
);

assert.match(headerMeetingStatusStore, /HeaderMeetingStatusSnapshot/);
assert.match(headerMeetingStatusStore, /subscribeHeaderMeetingStatus/);
assert.match(headerMeetingStatusStore, /setHeaderMeetingConnectionStatus/);
assert.match(headerMeetingStatusStore, /setHeaderMeetingConnectionState/);
assert.match(headerMeetingStatusStore, /setHeaderMeetingRecordingStatus/);
assert.match(headerMeetingStatusStore, /connectionStatus: "idle"/);
assert.match(headerMeetingStatusStore, /connectionQuality: "unknown"/);
assert.match(headerMeetingStatusStore, /hasConnectionSession: false/);

assert.match(meetingPanel, /type EntryAction = "start" \| "join" \| "reconnect"/);
assert.match(meetingPanel, /liveKitRoom\.status === "idle"/);
assert.match(meetingPanel, /function handleReconnect/);
assert.match(meetingPanel, /setPrejoinAction\("reconnect"\)/);
assert.match(meetingPanel, /action !== "reconnect"/);
assert.match(meetingPanel, /다시 연결/);

assert.match(meetingReportSection, /MeetingReportSection/);
assert.match(meetingReportSection, /if \(!summary \|\| summary\.totalCount === 0\) return null/);
assert.match(meetingReportSection, /MeetingReportStatusFilter/);
assert.match(meetingReportSection, /REPORT_POLL_INTERVAL_MS = 10000/);
assert.match(meetingReportSection, /useMeetingReportRealtime/);
assert.match(meetingReportSection, /selectedReportId === event\.reportId/);
assert.match(meetingReportSection, /활동 근거/);
assert.match(meetingReportSection, /report\.activityEvidence/);
assert.match(meetingReportSection, /getReportIdFromLocation/);
assert.match(meetingReportSection, /new URLSearchParams\(window\.location\.search\)/);
assert.match(meetingReportSection, /openedDeepLinkReportIdRef/);
assert.match(meetingReportSection, /void loadReportDetail\(reportId\)/);
assert.match(meetingReportSection, /회의록 상세를 찾을 수 없습니다/);
assert.doesNotMatch(meetingReportSection, /from "socket\.io-client"/);
assert.doesNotMatch(meetingReportSection, /useRouter/);
assert.doesNotMatch(meetingReportSection, /buildCalendarDraftHref/);
assert.match(meetingReportSection, /수정 & 승인/);
assert.match(meetingReportSection, /생성 대상 선택/);
assert.match(meetingReportSection, /일정/);
assert.match(meetingReportSection, /이슈/);
assert.match(meetingReportSection, /DELIVERY_FAILED/);
assert.match(meetingReportSection, /saveThenDeliverActionItem/);
assert.match(meetingReportSection, /후속 작업 제목/);
assert.match(meetingReportSection, /후속 작업 설명/);
assert.match(meetingReportSection, /승인/);
assert.match(meetingReportSection, /editing/);
assert.match(meetingReportSection, /endDate: endDate \|\| startDate/);
assert.match(meetingReportSection, /종료 날짜 \(비우면 시작 날짜\)/);
assert.match(meetingReportSection, /deliverMeetingReportActionItem/);
assert.match(meetingReportSection, /getMeetingReportActionItemDeliveryOptions/);
assert.doesNotMatch(meetingReportSection, /from "@\/features\/board/);
assert.match(meetingReportSection, /formatReportTitle/);
assert.match(meetingReportSection, /createdAt/);
assert.match(meetingReportSection, /회의록 검색/);
assert.match(meetingReportSection, /회의록 시작일/);
assert.match(meetingReportSection, /회의록 종료일/);
assert.match(meetingReportSection, /toDayBoundary/);
assert.match(meetingReportSection, /onNextPage/);
assert.match(meetingReportSection, /onPreviousPage/);
assert.doesNotMatch(meetingReportSection, /buildReportSearchText/);
assert.match(meetingReportSection, /PROCESSING/);
assert.match(meetingReportSection, /ReportProgress/);
assert.match(meetingReportSection, /TRANSCRIBING/);
assert.match(meetingReportSection, /SUMMARIZING/);
assert.match(meetingReportSection, /COMPLETED/);
assert.match(meetingReportSection, /FAILED/);
assert.match(meetingReportSection, /DialogPrimitive/);
assert.match(meetingReportSection, /MeetingReportDetailModal/);
assert.match(meetingReportSection, /회의록 상세 닫기/);
assert.match(meetingReportSection, /getMeetingReport/);
assert.match(meetingReportSection, /regenerateMeetingReport/);
assert.match(meetingReportSection, /window\.confirm/);
assert.match(meetingReportSection, /actionItemCandidates/);
assert.match(meetingReportSection, /actionItems = report\?\.actionItems \?\? \[\]/);
assert.match(meetingReportSection, /ActionItemReviewCard/);
assert.doesNotMatch(meetingReportSection, /approveMeetingReportActionItem/);
assert.match(meetingReportSection, /deliverMeetingReportActionItem/);
assert.match(meetingReportSection, /dismissMeetingReportActionItem/);
assert.match(meetingReportSection, /updateMeetingReportActionItem/);
assert.match(meetingReportSection, /AI 후보 #\{actionItem\.sourceIndex \+ 1\}/);
assert.match(meetingReportSection, /getEvidenceSegments/);
assert.match(meetingReportSection, /sourceIndex\?: number/);
assert.match(
  meetingReportSection,
  /sourceIndex !== undefined && evidence\.sourceIndex !== sourceIndex/
);
assert.match(meetingReportSection, /getEvidenceSegments\(report, "summary"\)/);
assert.match(meetingReportSection, /getEvidenceSegments\(report, "discussion"\)/);
assert.match(meetingReportSection, /getEvidenceSegments\(report, "decision"\)/);
assert.doesNotMatch(
  meetingReportSection,
  /getEvidenceSegments\(report, "(?:summary|discussion|decision)", 0\)/
);
assert.match(meetingReportSection, /formatTranscriptTimestamp/);
assert.match(meetingReportSection, /EvidenceTimeButtons/);
assert.match(meetingReportSection, /근거 Transcript/);
assert.match(meetingReportSection, /selectedEvidenceSegment/);
assert.match(meetingReportSection, /selectedEvidencePanelRef/);
assert.match(
  meetingReportSection,
  /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/
);
assert.match(meetingReportSection, /evidenceSegments/);
assert.match(meetingReportSection, /회의록 삭제/);
assert.match(meetingReportSection, /Transcript 전문 보기/);
assert.match(meetingReportSection, /회의록 상세로 돌아가기/);
assert.match(meetingReportSection, /detailView === "transcript"/);
assert.match(meetingReportSection, /report\.transcriptText/);
assert.doesNotMatch(meetingReportSection, /TranscriptSegmentViewer/);
assert.match(meetingReportSection, /60초 이하 녹음은 회의록이 생성되지 않습니다/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/sheet/);
assert.doesNotMatch(meetingReportSection, /MeetingReportDetailSheet/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/badge/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/tabs/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/dialog/);
assert.doesNotMatch(meetingReportSection, /일정 생성 액션을 선택했습니다/);

assert.match(meetingReportRealtimeHook, /useMeetingReportRealtime/);
assert.match(meetingReportRealtimeHook, /meeting:subscribe/);
assert.match(meetingReportRealtimeHook, /meeting:unsubscribe/);
assert.match(meetingReportRealtimeHook, /meeting:report:updated/);
assert.match(meetingReportRealtimeHook, /workspaceId: normalizedWorkspaceId/);
assert.match(meetingReportRealtimeHook, /socket\.on\("connect", subscribe\)/);
assert.match(meetingReportRealtimeHook, /socket\.disconnect\(\)/);
assert.match(meetingReportRealtimeHook, /isMeetingReportRealtimeEvent/);

assert.match(meetingAudioPreflightHook, /useMeetingAudioPreflight/);
assert.match(meetingAudioPreflightHook, /getUserMedia/);
assert.match(meetingAudioPreflightHook, /enumerateDevices/);
assert.match(meetingAudioPreflightHook, /AudioContext/);
assert.match(meetingAudioPreflightHook, /requestAnimationFrame/);
assert.match(meetingAudioPreflightHook, /getTracks\(\)\.forEach/);
assert.match(meetingAudioPreflightDialog, /MeetingAudioPreflightDialog/);
assert.match(meetingAudioPreflightDialog, /입력 장치/);
assert.match(meetingAudioPreflightDialog, /입력 감도/);
assert.match(meetingAudioPreflightDialog, /이 장치로 참여/);
assert.match(meetingAudioPreflightDialog, /min-w-0 max-w-md overflow-hidden/);
assert.match(meetingAudioPreflightDialog, /w-full min-w-0 max-w-full truncate/);
assert.match(meetingAudioPreflightDialog, /title=\{selectedDevice/);
assert.match(meetingPanel, /MeetingAudioPreflightDialog/);
assert.match(meetingPanel, /prejoinAction/);
assert.match(meetingRuntimeProvider, /audioDeviceId/);
assert.match(liveKitHook, /audioDeviceId \? \{ deviceId: audioDeviceId \} : undefined/);
assert.match(liveKitHook, /RemoteParticipantAudioSettings/);
assert.match(liveKitHook, /participantIdentity/);
assert.match(liveKitHook, /RoomEvent\.ParticipantDisconnected/);
assert.match(liveKitHook, /element\.muted = settings\.muted/);
assert.match(liveKitHook, /element\.volume = settings\.volume \/ 100/);
assert.match(liveKitHook, /setRemoteParticipantAudioSettings/);
assert.match(liveKitHook, /preserveRemoteParticipantAudioSettings = false/);
assert.match(liveKitHook, /await disconnect\(preserveRemoteParticipantAudioSettings\)/);
assert.match(meetingPanel, /수신 음량/);
assert.match(meetingPanel, /participant-volume-/);
assert.match(meetingPanel, /VolumeX/);
assert.match(meetingPanel, /setRemoteParticipantAudioSettings/);
assert.match(meetingRuntimeProvider, /refreshHeaderRecordingStatus/);
assert.match(meetingRuntimeProvider, /getCurrentRecording\(session\.workspaceId, session\.meetingId\)/);
assert.match(meetingRuntimeProvider, /onStateInvalidated: handleMeetingStateInvalidated/);
assert.match(meetingRuntimeProvider, /previousSession\?\.workspaceId === workspaceId/);
