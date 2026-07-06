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
