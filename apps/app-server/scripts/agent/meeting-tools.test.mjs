import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { MeetingAgentToolsService } = require(
  "../../dist/modules/agent/tools/meeting-agent-tools.service.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const MEETING_ID = "55555555-5555-5555-8555-555555555555";
const RECORDING_ID = "66666666-6666-6666-8666-666666666666";

function createReport(overrides = {}) {
  return {
    id: REPORT_ID,
    meetingId: MEETING_ID,
    recordingId: RECORDING_ID,
    status: "COMPLETED",
    failedStep: null,
    errorMessage: null,
    transcriptText: "회의 원문은 Agent outputSummary에 저장하면 안 된다.",
    summary: "회의 요약",
    discussionPoints: "논의사항",
    decisions: "결정사항",
    actionItemCandidates: [
      {
        title: "문서 정리",
        description: "회의 보고서를 정리한다.",
        assigneeUserId: USER_ID,
        priority: "MEDIUM",
        rawIgnored: "저장하지 않는다."
      }
    ],
    retryCount: 0,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides
  };
}

function toSummaryReport(report) {
  const { transcriptText, ...summary } = report;
  return summary;
}

class FakeMeetingService {
  constructor() {
    this.calls = [];
    this.reports = [createReport()];
  }

  async listReports(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listReports",
      currentUserId,
      workspaceId,
      query
    });

    return {
      reports: this.reports.map((report) => toSummaryReport(report))
    };
  }

  async getReport(currentUserId, workspaceId, reportId) {
    this.calls.push({
      method: "getReport",
      currentUserId,
      workspaceId,
      reportId
    });

    const report =
      this.reports.find((candidate) => candidate.id === reportId) ?? this.reports[0];

    return {
      report
    };
  }
}

function createRegistry() {
  const meetingService = new FakeMeetingService();
  const meetingTools = new MeetingAgentToolsService(meetingService);
  const registry = new AgentToolRegistryService(undefined, meetingTools);

  return {
    meetingService,
    registry
  };
}

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID
};

function errorCode(error) {
  return error.getResponse().error.code;
}

{
  const { registry } = createRegistry();
  const names = registry.listDefinitions().map((definition) => definition.name);

  assert.deepEqual(names, [
    "list_meeting_reports",
    "get_meeting_report",
    "summarize_meeting_report"
  ]);
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_reports");
  const input = tool.validateInput({
    status: "COMPLETED",
    limit: 20
  });
  const result = await tool.execute(context, input);
  const report = result.outputSummary.reports[0];

  assert.equal(result.outputSummary.count, 1);
  assert.equal(report.reportId, REPORT_ID);
  assert.equal(report.status, "COMPLETED");
  assert.deepEqual(
    report.sections.map((section) => section.key),
    ["summary", "discussionPoints", "decisions"]
  );
  assert.equal(report.transcript.available, false);
  assert.equal(report.transcript.stored, false);
  assert.equal(result.resourceRefs[0].domain, "meeting");
  assert.equal(result.resourceRefs[0].resourceType, "meeting_report");
  assert.deepEqual(meetingService.calls[0], {
    method: "listReports",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    query: {
      status: "COMPLETED",
      limit: 20
    }
  });
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");
  const input = tool.validateInput({
    reportId: REPORT_ID
  });
  const result = await tool.execute(context, input);
  const report = result.outputSummary.report;
  const serialized = JSON.stringify(result.outputSummary);

  assert.equal(result.status, "summarized");
  assert.equal(report.reportId, REPORT_ID);
  assert.equal(report.meetingId, MEETING_ID);
  assert.equal(report.transcript.available, true);
  assert.equal(report.transcript.stored, false);
  assert.equal(report.transcript.length > 0, true);
  assert.equal(serialized.includes("회의 원문은 Agent outputSummary"), false);
  assert.deepEqual(report.actionItems[0], {
    title: "문서 정리",
    description: "회의 보고서를 정리한다.",
    assigneeUserId: USER_ID,
    priority: "MEDIUM"
  });
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_report");
  const input = tool.validateInput({
    reportId: REPORT_ID
  });
  const result = await tool.execute(context, input);

  assert.equal(result.status, "completed");
  assert.equal(result.outputSummary.report.sections[0].title, "요약");
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport({
      status: "PROCESSING",
      transcriptText: null,
      summary: null,
      discussionPoints: null,
      decisions: null,
      actionItemCandidates: []
    })
  ];
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(context, { reportId: REPORT_ID });
  const report = result.outputSummary.report;

  assert.equal(report.status, "PROCESSING");
  assert.deepEqual(report.sections, []);
  assert.deepEqual(report.actionItems, []);
  assert.deepEqual(report.transcript, {
    available: false,
    stored: false,
    length: 0
  });
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport({
      status: "FAILED",
      failedStep: "LLM",
      errorMessage: "provider raw error must not be stored",
      transcriptText: null,
      summary: null,
      discussionPoints: null,
      decisions: null,
      actionItemCandidates: []
    })
  ];
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(context, { reportId: REPORT_ID });
  const serialized = JSON.stringify(result.outputSummary);

  assert.equal(result.outputSummary.report.status, "FAILED");
  assert.deepEqual(result.outputSummary.report.failure, {
    failedStep: "LLM"
  });
  assert.equal(serialized.includes("provider raw error"), false);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_report");

  assert.throws(
    () =>
      tool.validateInput({
        reportId: REPORT_ID,
        workspaceId: WORKSPACE_ID
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

for (const limit of [1.9, "1.9"]) {
  const { registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_reports");

  assert.throws(
    () =>
      tool.validateInput({
        limit
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /positive integer/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");

  assert.throws(
    () =>
      tool.validateInput({
        reportId: "not-a-uuid"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /reportId/);
      return true;
    }
  );
}
