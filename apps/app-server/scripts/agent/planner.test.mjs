import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentPlannerService } = require(
  "../../dist/modules/agent/agent-planner.service.js"
);

const planner = new AgentPlannerService();

function plan(prompt) {
  return planner.plan({
    prompt,
    timezone: "Asia/Seoul"
  });
}

{
  const result = plan("내일 오후 3시에 주간 회의 일정 만들어줘");

  assert.equal(result.status, "tool_candidate");
  assert.equal(result.intent, "calendar.create_event");
  assert.equal(result.toolCandidate.toolName, "create_calendar_event");
  assert.equal(result.toolCandidate.riskLevel, "medium");
  assert.equal(result.toolCandidate.executionMode, "confirmation_required");
  assert.equal(result.toolCandidate.requiresConfirmation, true);
  assert.equal(result.toolCandidate.toolInputValidation, "tool_adapter_required");
}

{
  const result = plan("내일 오후 3시에 일정 만들어줘");

  assert.equal(result.status, "needs_clarification");
  assert.equal(result.intent, "calendar.create_event");
  assert.deepEqual(result.missingFields, ["calendar_event_title"]);
}

{
  const result = plan("최근 회의록 요약해줘");

  assert.equal(result.status, "tool_candidate");
  assert.equal(result.intent, "meeting_report.summarize");
  assert.equal(result.toolCandidate.toolName, "summarize_meeting_report");
  assert.equal(result.toolCandidate.executionMode, "auto");
}

{
  const result = plan("Agent 관련 open issue 찾아줘");

  assert.equal(result.status, "tool_candidate");
  assert.equal(result.intent, "board.search_issues");
  assert.equal(result.toolCandidate.toolName, "search_board_issues");
  assert.equal(result.toolCandidate.riskLevel, "low");
}

{
  const result = plan("#365 이슈를 In Progress로 이동해줘");

  assert.equal(result.status, "tool_candidate");
  assert.equal(result.intent, "board.move_issue_status");
  assert.equal(result.toolCandidate.toolName, "move_board_issue_status");
  assert.equal(result.toolCandidate.executionMode, "confirmation_required");
}

{
  const result = plan("일정 삭제해줘");

  assert.equal(result.status, "unsupported");
  assert.equal(result.intent, "unsupported");
  assert.equal(result.unsupportedReason, "high_risk_or_excluded");
}

{
  const result = plan("오늘 점심 뭐 먹지");

  assert.equal(result.status, "unsupported");
  assert.equal(result.intent, "unsupported");
  assert.equal(result.unsupportedReason, "unknown_intent");
}
