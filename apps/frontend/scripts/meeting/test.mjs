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
const liveKitHook = await readFile(
  new URL(
    "../../src/features/meeting/hooks/use-livekit-meeting-room.ts",
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
const packageJson = await readFile(
  new URL("../../package.json", import.meta.url),
  "utf8"
);

assert.match(meetingTypes, /export type Meeting =/);
assert.match(meetingTypes, /export type MeetingParticipant =/);
assert.match(meetingTypes, /export type LiveKitJoin =/);
assert.match(meetingTypes, /export type MeetingRecording =/);
assert.match(meetingTypes, /export type MeetingReportSummary =/);
assert.match(meetingTypes, /export type MeetingReportDetail =/);
assert.match(meetingTypes, /export type RecordingStatus = "RUNNING"/);
assert.match(meetingTypes, /"COMPLETED" \| "FAILED"/);
assert.match(meetingTypes, /export type MeetingReportStatus = "PROCESSING"/);
assert.match(meetingTypes, /"COMPLETED" \| "FAILED"/);
assert.match(meetingTypes, /export type MeetingReportFailedStep = "RECORDING"/);
assert.match(meetingTypes, /"STT" \| "LLM"/);
assert.match(meetingTypes, /actionItemCandidates: unknown\[\]/);
assert.match(meetingTypes, /export type CurrentMeetingPayload/);
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
assert.match(meetingHook, /reloadReports/);
assert.match(meetingHook, /startMeeting/);
assert.match(meetingHook, /joinMeeting/);
assert.match(meetingHook, /leaveMeeting/);
assert.match(meetingHook, /startRecording/);
assert.match(meetingHook, /endRecording/);
assert.match(meetingHook, /regenerateMeetingReport/);
assert.match(meetingHook, /Meeting action requires an authenticated workspace/);
assert.doesNotMatch(meetingHook, /livekit-client/);
assert.doesNotMatch(meetingHook, /@livekit\/components-react/);

assert.match(packageJson, /"livekit-client":/);
assert.match(liveKitHook, /useLiveKitMeetingRoom/);
assert.match(liveKitHook, /new Room\(/);
assert.match(liveKitHook, /RoomEvent\.TrackSubscribed/);
assert.match(liveKitHook, /RoomEvent\.TrackUnsubscribed/);
assert.match(liveKitHook, /setMicrophoneEnabled\(true\)/);
assert.match(liveKitHook, /remoteAudioContainerRef/);
assert.match(liveKitHook, /track\.attach\(\)/);
assert.doesNotMatch(liveKitHook, /@livekit\/components-react/);

assert.match(meetingNavigation, /title: "음성회의"/);
assert.match(meetingNavigation, /회의 참여, 녹음, 회의록 확인과 재생성/);
assert.match(meetingNavigation, /\/meeting\/#room/);
assert.match(meetingNavigation, /\/meeting\/#report/);
assert.doesNotMatch(meetingNavigation, /\/meeting#recording/);

assert.match(meetingPanel, /"use client"/);
assert.match(meetingPanel, /useAuthSession/);
assert.match(meetingPanel, /useMeetingWorkspaceData/);
assert.match(meetingPanel, /useLiveKitMeetingRoom/);
assert.match(meetingPanel, /setHeaderMeetingConnectionStatus/);
assert.match(meetingPanel, /setHeaderMeetingRecordingStatus/);
assert.match(meetingPanel, /setHeaderMeetingConnectionStatus\(liveKitRoom\.status\)/);
assert.match(meetingPanel, /setHeaderMeetingRecordingStatus\(currentRecording\?\.status \?\? null\)/);
assert.match(meetingPanel, /recordingConsentAccepted/);
assert.match(meetingPanel, /RECORDING_CONSENT_STORAGE_KEY/);
assert.match(meetingPanel, /localStorage\.setItem/);
assert.match(meetingPanel, /getUserMedia/);
assert.match(meetingPanel, /회의 참여/);
assert.match(meetingPanel, /회의 나가기/);
assert.match(meetingPanel, /shouldLeaveMeeting = isCurrentUserActive/);
assert.match(meetingPanel, /if \(shouldLeaveMeeting\)/);
assert.match(meetingPanel, /녹음 시작/);
assert.match(meetingPanel, /녹음 종료/);
assert.match(meetingPanel, /현재 참여 인원/);
assert.match(meetingPanel, /remoteAudioContainerRef/);
assert.match(meetingPanel, /MeetingReportSection/);
assert.match(meetingPanel, /getMeetingSectionFromHash/);
assert.match(meetingPanel, /activeSection/);
assert.match(meetingPanel, /useSyncExternalStore/);
assert.match(meetingPanel, /getMeetingSectionServerSnapshot/);
assert.match(meetingPanel, /hashchange/);
assert.match(meetingPanel, /popstate/);
assert.match(meetingPanel, /syncSectionAfterNavigationClick/);
assert.match(meetingPanel, /addEventListener\("click", syncSectionAfterNavigationClick, true\)/);
assert.match(meetingPanel, /reportsEnabled: activeSection === "report"/);
assert.match(meetingPanel, /reportStatusFilter/);
assert.match(meetingPanel, /limit: 100/);
assert.match(meetingPanel, /60초 이하 녹음은 회의록이 생성되지 않습니다/);
assert.doesNotMatch(meetingPanel, /AvatarImage/);
assert.doesNotMatch(meetingPanel, /aria-label="회의 상태"/);
assert.doesNotMatch(meetingPanel, /fixed top-3 right-4/);

assert.match(headerMeetingStatus, /HeaderMeetingStatus/);
assert.match(headerMeetingStatus, /useAuthSession/);
assert.match(headerMeetingStatus, /useMeetingWorkspaceData/);
assert.match(headerMeetingStatus, /useSyncExternalStore/);
assert.match(headerMeetingStatus, /usePathname/);
assert.match(headerMeetingStatus, /isMeetingRoute/);
assert.match(headerMeetingStatus, /reportsEnabled: false/);
assert.match(headerMeetingStatus, /enabled: Boolean\(workspaceId && accessToken && !isMeetingRoute\)/);
assert.match(headerMeetingStatus, /HEADER_MEETING_STATUS_POLL_INTERVAL_MS = 5000/);
assert.match(headerMeetingStatus, /reloadCurrentMeeting/);
assert.match(headerMeetingStatus, /음성 미연결/);
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
assert.match(headerMeetingStatusStore, /setHeaderMeetingRecordingStatus/);
assert.match(headerMeetingStatusStore, /connectionStatus: "idle"/);

assert.match(meetingReportSection, /MeetingReportSection/);
assert.match(meetingReportSection, /MeetingReportStatusFilter/);
assert.match(meetingReportSection, /REPORT_POLL_INTERVAL_MS = 10000/);
assert.match(meetingReportSection, /formatReportTitle/);
assert.match(meetingReportSection, /createdAt/);
assert.match(meetingReportSection, /회의록 검색/);
assert.match(meetingReportSection, /PROCESSING/);
assert.match(meetingReportSection, /COMPLETED/);
assert.match(meetingReportSection, /FAILED/);
assert.match(meetingReportSection, /Sheet/);
assert.match(meetingReportSection, /getMeetingReport/);
assert.match(meetingReportSection, /regenerateMeetingReport/);
assert.match(meetingReportSection, /window\.confirm/);
assert.match(meetingReportSection, /actionItemCandidates/);
assert.match(meetingReportSection, /60초 이하 녹음은 회의록이 생성되지 않습니다/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/badge/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/tabs/);
assert.doesNotMatch(meetingReportSection, /@\/components\/ui\/dialog/);
