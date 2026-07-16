import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MeetingTranscriptRagService
} = require("../../dist/modules/meeting/meeting-transcript-rag.service.js");
const {
  AgentGroundedAnswerService
} = require("../../dist/modules/agent/agent-grounded-answer.service.js");

const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const TRANSCRIPT_ID = "55555555-5555-4555-8555-555555555555";
const ACTIVITY_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_TRANSCRIPT_ID = "77777777-7777-4777-8777-777777777777";
const SECOND_ACTIVITY_ID = "88888888-8888-4888-8888-888888888888";

class FakeDatabase {
  constructor({ transcripts, activities, duplicatePairs = [] }) {
    this.queries = [];
    this.transcripts = transcripts;
    this.activities = activities;
    this.duplicatePairs = duplicatePairs;
  }

  async query(text, values) {
    this.queries.push({ text, values });
    if (text.includes("SELECT transcript.id AS transcript_id")) return this.duplicatePairs;
    if (text.includes("meeting_report_activity_evidence_chunks")) {
      return this.activities;
    }
    return this.transcripts;
  }
}

const transcript = (id, distance) => ({
  id,
  meeting_report_id: REPORT_ID,
  started_at_ms: 1000,
  ended_at_ms: 2000,
  content: "다음 주로 미루기로 했습니다.",
  distance
});
const activity = (id, distance, directlyReferenced = true) => ({
  id,
  meeting_report_id: REPORT_ID,
  occurred_at: "2026-07-16T01:00:00.000Z",
  action: "calendar_event_updated",
  summary: "디자인 리뷰 일정을 다음 주로 변경했습니다.",
  content: "실제 사용자 활동: 디자인 리뷰 일정을 다음 주로 변경했습니다.",
  distance,
  directly_referenced: directlyReferenced
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }]
}), { status: 200 });
process.env.OPENAI_API_KEY = "test-key";

try {
  const database = new FakeDatabase({
    transcripts: [transcript(TRANSCRIPT_ID, 0.1)],
    activities: [activity(ACTIVITY_ID, 0.9)],
    duplicatePairs: [{ transcript_id: TRANSCRIPT_ID, activity_id: ACTIVITY_ID }]
  });
  const workspaceService = {
    calls: [],
    async assertWorkspaceAccess(userId, workspaceId) {
      this.calls.push({ userId, workspaceId });
    }
  };
  const service = new MeetingTranscriptRagService(database, workspaceService);
  const sources = await service.search(USER_ID, WORKSPACE_ID, {
    query: "일정이 왜 미뤄졌어?"
  });

  assert.deepEqual(new Set(sources.map((source) => source.sourceId)), new Set([
    `activity:${ACTIVITY_ID}`,
    `transcript:${TRANSCRIPT_ID}`
  ]));
  assert.equal(sources.find((source) => source.sourceType === "activity")?.summary, "디자인 리뷰 일정을 다음 주로 변경했습니다.");
  assert.equal(sources.find((source) => source.sourceType === "transcript")?.sourceId, `transcript:${TRANSCRIPT_ID}`);
  assert.deepEqual(service.normalizeSourceIds([TRANSCRIPT_ID, `activity:${ACTIVITY_ID}`, "invalid"]), [
    `transcript:${TRANSCRIPT_ID}`,
    `activity:${ACTIVITY_ID}`
  ]);
  assert.equal(database.queries.length, 3);
  assert.match(database.queries[1].text, /meeting_report_activity_evidence_chunks/);
  assert.match(database.queries[1].text, /source_type IN \('decision', 'action_item'\)/);
  assert.match(database.queries[2].text, /transcript\.embedding <=> activity\.embedding <= \$3/);
  assert.equal(workspaceService.calls.length, 1);

  const crowdedDatabase = new FakeDatabase({
    transcripts: [transcript(TRANSCRIPT_ID, 0.7)],
    activities: [
      activity(ACTIVITY_ID, 0.1),
      activity(SECOND_ACTIVITY_ID, 0.11),
      activity("99999999-9999-4999-8999-999999999999", 0.12),
      activity("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0.13),
      activity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 0.14)
    ]
  });
  const crowdedSources = await new MeetingTranscriptRagService(crowdedDatabase, workspaceService).search(USER_ID, WORKSPACE_ID, {
    query: "일정이 왜 미뤄졌어?"
  });
  assert.equal(crowdedSources.length, 5);
  assert.ok(crowdedSources.some((source) => source.sourceId === `transcript:${TRANSCRIPT_ID}`));
  assert.ok(crowdedSources.some((source) => source.sourceType === "activity"));

  const transcriptOnlySources = await new MeetingTranscriptRagService(new FakeDatabase({
    transcripts: [transcript(TRANSCRIPT_ID, 0.1)],
    activities: []
  }), workspaceService).search(USER_ID, WORKSPACE_ID, {
    query: "무슨 말을 했어?"
  });
  assert.deepEqual(transcriptOnlySources.map((source) => source.sourceId), [`transcript:${TRANSCRIPT_ID}`]);

  const activityOnlySources = await new MeetingTranscriptRagService(new FakeDatabase({
    transcripts: [],
    activities: [activity(ACTIVITY_ID, 0.1)]
  }), workspaceService).search(USER_ID, WORKSPACE_ID, {
    query: "실제로 무엇을 했어?"
  });
  assert.deepEqual(activityOnlySources.map((source) => source.sourceId), [`activity:${ACTIVITY_ID}`]);

  const duplicateDatabase = new FakeDatabase({
    transcripts: [transcript(TRANSCRIPT_ID, 0.1), transcript(SECOND_TRANSCRIPT_ID, 0.11)],
    activities: [activity(ACTIVITY_ID, 0.12)],
    duplicatePairs: [
      { transcript_id: TRANSCRIPT_ID, activity_id: ACTIVITY_ID },
      { transcript_id: SECOND_TRANSCRIPT_ID, activity_id: ACTIVITY_ID }
    ]
  });
  const duplicateSources = await new MeetingTranscriptRagService(duplicateDatabase, workspaceService).search(USER_ID, WORKSPACE_ID, {
    query: "일정이 왜 미뤄졌어?"
  });
  assert.deepEqual(duplicateSources.map((source) => source.sourceId).sort(), [
    `activity:${ACTIVITY_ID}`,
    `transcript:${TRANSCRIPT_ID}`
  ].sort());

  const deniedDatabase = {
    async query() {
      throw new Error("a denied search must not query evidence");
    }
  };
  const deniedWorkspaceService = {
    async assertWorkspaceAccess() {
      throw new Error("workspace access denied");
    }
  };
  await assert.rejects(
    () => new MeetingTranscriptRagService(deniedDatabase, deniedWorkspaceService).search(USER_ID, WORKSPACE_ID, {
      query: "권한 없는 회의 내용"
    }),
    /workspace access denied/
  );
} finally {
  globalThis.fetch = originalFetch;
}

{
  const sourceId = `activity:${ACTIVITY_ID}`;
  const database = {
    async queryOne() {
      return {
        workspace_id: WORKSPACE_ID,
        requested_by_user_id: USER_ID,
        source_ids: [sourceId]
      };
    },
    async transaction() {
      throw new Error("unknown citation must be rejected before an Agent run is updated");
    }
  };
  const ragService = {
    normalizeSourceIds(sourceIds) {
      return sourceIds;
    },
    async loadAuthorizedSources() {
      throw new Error("unknown citation must not load source content");
    }
  };
  const service = new AgentGroundedAnswerService(database, ragService);

  await assert.rejects(
    () => service.complete("77777777-7777-4777-8777-777777777777", "근거 답변", [
      `transcript:${TRANSCRIPT_ID}`
    ]),
    /unknown citation/
  );
}
