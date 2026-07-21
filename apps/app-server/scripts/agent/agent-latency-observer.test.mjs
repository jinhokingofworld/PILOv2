import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AgentLatencyObserver,
  agentLatencyTraceKey,
  buildAgentLatencyEvent
} = require("../../dist/modules/agent/agent-latency-observer.js");

const RUN_ID = "33333333-3333-3333-3333-333333333333";

const event = buildAgentLatencyEvent({
  runId: RUN_ID,
  stage: "tool_execution",
  outcome: "success",
  elapsedMs: 250.4,
  surface: "sql_erd",
  toolName: "focus_sql_erd_tables",
  turnSequence: 2
});

assert.deepEqual(event, {
  event: "agent_latency",
  component: "app_server",
  stage: "tool_execution",
  outcome: "success",
  elapsed_ms: 250,
  trace_key: agentLatencyTraceKey(RUN_ID),
  turn_sequence: 2,
  surface: "sql_erd",
  tool_name: "focus_sql_erd_tables"
});
assert.equal(JSON.stringify(event).includes(RUN_ID), false);

assert.equal(
  buildAgentLatencyEvent({
    runId: RUN_ID,
    stage: "tool_execution",
    outcome: "success",
    elapsedMs: 1,
    surface: "calendar",
    toolName: "list_calendar_events"
  }),
  null
);
assert.equal(
  buildAgentLatencyEvent({
    runId: RUN_ID,
    stage: "tool_execution",
    outcome: "success",
    elapsedMs: 1,
    surface: "sql_erd",
    toolName: "generate_sql_erd"
  }),
  null
);

const sanitized = buildAgentLatencyEvent({
  runId: RUN_ID,
  stage: "tool_preparation",
  outcome: "unexpected",
  elapsedMs: -10,
  surface: "sql_erd",
  toolName: "focus_sql_erd_tables",
  failureType: "provider-secret-message"
});
assert.equal(sanitized.outcome, "failure");
assert.equal(sanitized.elapsed_ms, 0);
assert.equal(sanitized.failure_type, "unknown");
assert.equal(JSON.stringify(sanitized).includes("provider-secret-message"), false);

const focusResolverFailure = buildAgentLatencyEvent({
  runId: RUN_ID,
  stage: "focus_resolver",
  outcome: "failure",
  elapsedMs: 812.4,
  surface: "sql_erd",
  toolName: "focus_sql_erd_tables",
  failureType: "provider_error",
  failureDetail: "http_error",
  httpStatus: 429
});
assert.deepEqual(focusResolverFailure, {
  event: "agent_latency",
  component: "app_server",
  stage: "focus_resolver",
  outcome: "failure",
  elapsed_ms: 812,
  trace_key: agentLatencyTraceKey(RUN_ID),
  surface: "sql_erd",
  tool_name: "focus_sql_erd_tables",
  failure_type: "provider_error",
  failure_detail: "http_error",
  http_status: 429
});

for (const failureDetail of [
  "http_error",
  "network_error",
  "timeout",
  "empty_output",
  "json_parse_error",
  "validation_error"
]) {
  const classified = buildAgentLatencyEvent({
    runId: RUN_ID,
    stage: "focus_resolver",
    outcome: "failure",
    elapsedMs: 1,
    surface: "sql_erd",
    toolName: "focus_sql_erd_tables",
    failureType: "provider_error",
    failureDetail
  });
  assert.equal(classified.failure_detail, failureDetail);
}

const sanitizedResolverFailure = buildAgentLatencyEvent({
  runId: RUN_ID,
  stage: "focus_resolver",
  outcome: "failure",
  elapsedMs: 1,
  surface: "sql_erd",
  toolName: "focus_sql_erd_tables",
  failureType: "provider_error",
  failureDetail: "provider-secret-message",
  httpStatus: 999
});
assert.equal(sanitizedResolverFailure.failure_detail, "unknown");
assert.equal("http_status" in sanitizedResolverFailure, false);
assert.equal(
  JSON.stringify(sanitizedResolverFailure).includes("provider-secret-message"),
  false
);

const observer = new AgentLatencyObserver();
observer.logger = {
  log() {
    throw new Error("logger unavailable");
  }
};
assert.doesNotThrow(() =>
  observer.observe({
    runId: RUN_ID,
    stage: "tool_advance",
    outcome: "failure",
    elapsedMs: 5,
    surface: "sql_erd",
    toolName: "focus_sql_erd_tables",
    failureType: "domain_error"
  })
);
