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

class FakeDatabase {
  constructor() {
    this.queries = [];
  }

  async query(text, values) {
    this.queries.push({ text, values });
    if (text.includes("meeting_report_activity_evidence_chunks")) {
      return [
        {
          id: ACTIVITY_ID,
          meeting_report_id: REPORT_ID,
          occurred_at: "2026-07-16T01:00:00.000Z",
          action: "calendar_event_updated",
          summary: "디자인 리뷰 일정을 다음 주로 변경했습니다.",
          content: "실제 사용자 활동: 디자인 리뷰 일정을 다음 주로 변경했습니다.",
          distance: 0.9,
          directly_referenced: true
        }
      ];
    }
    return [
      {
        id: TRANSCRIPT_ID,
        meeting_report_id: REPORT_ID,
        started_at_ms: 1000,
        ended_at_ms: 2000,
        content: "다음 주로 미루기로 했습니다.",
        distance: 0.1
      }
    ];
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }]
}), { status: 200 });
process.env.OPENAI_API_KEY = "test-key";

try {
  const database = new FakeDatabase();
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

  assert.deepEqual(sources.map((source) => source.sourceId), [
    `activity:${ACTIVITY_ID}`,
    `transcript:${TRANSCRIPT_ID}`
  ]);
  assert.equal(sources[0].sourceType, "activity");
  assert.equal(sources[0].summary, "디자인 리뷰 일정을 다음 주로 변경했습니다.");
  assert.equal(sources[1].sourceType, "transcript");
  assert.deepEqual(service.normalizeSourceIds([TRANSCRIPT_ID, `activity:${ACTIVITY_ID}`, "invalid"]), [
    `transcript:${TRANSCRIPT_ID}`,
    `activity:${ACTIVITY_ID}`
  ]);
  assert.equal(database.queries.length, 2);
  assert.match(database.queries[1].text, /meeting_report_activity_evidence_chunks/);
  assert.match(database.queries[1].text, /source_type IN \('decision', 'action_item'\)/);
  assert.equal(workspaceService.calls.length, 1);
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
