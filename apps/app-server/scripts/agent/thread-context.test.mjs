import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentThreadContextService } = require(
  "../../dist/modules/agent/agent-thread-context.service.js"
);

const context = {
  currentUserId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  runId: "33333333-3333-4333-8333-333333333333",
  requestContext: null
};
const threadId = "44444444-4444-4444-8444-444444444444";
const priorRunId = "55555555-5555-4555-8555-555555555555";
const stepId = "66666666-6666-4666-8666-666666666666";
const reportId = "77777777-7777-4777-8777-777777777777";

function contextRef(index) {
  const digest = createHash("sha256")
    .update(`${threadId}:${priorRunId}:${stepId}:${index}`, "utf8")
    .digest("hex");
  return `ctx_${digest.slice(0, 24)}`;
}

function contextGeneration(runId, scopedStepId) {
  const digest = createHash("sha256")
    .update(`${runId}:${scopedStepId}`, "utf8")
    .digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16) || 1;
}

class FakeDatabase {
  constructor(rows) {
    this.rows = rows;
    this.calls = [];
  }

  async query(text, values) {
    this.calls.push({ text, values });
    return this.rows;
  }
}

class FakeScopeDatabase {
  constructor(scope, priorState = null) {
    this.scope = scope;
    this.priorState = priorState;
    this.calls = [];
  }

  async queryOne(text, values) {
    this.calls.push({ text, values });
    if (text.includes("FROM agent_steps")) {
      return this.priorState ? { context_state: this.priorState } : null;
    }
    return this.scope;
  }
}

class FakeCandidateDatabase {
  constructor(rows) {
    this.rows = rows;
    this.calls = [];
  }

  async query(text, values) {
    this.calls.push({ text, values });
    return this.rows;
  }
}

{
  const database = new FakeDatabase([
    {
      thread_id: threadId,
      run_id: priorRunId,
      step_id: stepId,
      resource_refs: [
        {
          domain: "meeting",
          resourceType: "meeting_report",
          resourceId: reportId,
          label: "최근 회의록"
        }
      ]
    }
  ]);
  const service = new AgentThreadContextService(database);

  assert.deepEqual(await service.resolveMeetingReference(context, contextRef(0)), {
    resourceType: "meeting_report",
    resourceId: reportId
  });
  assert.equal(
    await service.resolveMeetingReference(context, "ctx_000000000000000000000000"),
    null
  );
  assert.equal(await service.resolveMeetingReference(context, reportId), null);
  assert.deepEqual(database.calls[0].values, [
    context.runId,
    context.workspaceId,
    context.currentUserId,
    6
  ]);
  assert.match(database.calls[0].text, /scoped_run\.workspace_id = \$2/);
  assert.match(database.calls[0].text, /scoped_run\.requested_by_user_id = \$3/);
  assert.match(
    database.calls[0].text,
    /ORDER BY scoped_run\.created_at DESC, scoped_run\.id DESC/
  );
  assert.match(database.calls[0].text, /recent_run\.id DESC/);
  assert.match(database.calls[0].text, /step\.step_order DESC/);
  assert.match(database.calls[0].text, /step\.id DESC/);
  assert.match(database.calls[0].text, /LIMIT \$4/);
}

{
  const actionItemId = "88888888-8888-4888-8888-888888888888";
  const database = new FakeDatabase([
    {
      thread_id: threadId,
      run_id: priorRunId,
      step_id: stepId,
      resource_refs: [
        {
          domain: "meeting",
          resourceType: "meeting_report_action_item",
          resourceId: actionItemId,
          metadata: { reportId }
        }
      ]
    }
  ]);
  const service = new AgentThreadContextService(database);

  assert.deepEqual(await service.resolveMeetingReference(context, contextRef(0)), {
    resourceType: "meeting_report_action_item",
    resourceId: actionItemId,
    reportId
  });
}

{
  const candidateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const candidateContextRef = `ctx_${createHash("sha256")
    .update(`candidate:${candidateId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
  const database = new FakeCandidateDatabase([
    {
      id: candidateId,
      domain: "drive",
      resource_type: "document",
      resource_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      report_id: null,
      label: "Selected document",
      status: "available"
    }
  ]);
  const service = new AgentThreadContextService(database);

  assert.deepEqual(
    await service.resolveCandidateReference(context, candidateContextRef),
    {
      domain: "drive",
      resourceType: "document",
      resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "Selected document",
      status: "available"
    }
  );
  assert.match(database.calls[0].text, /candidate\.consumed_at IS NOT NULL/);
  assert.match(database.calls[0].text, /candidate\.expires_at > now\(\)/);
  assert.match(database.calls[0].text, /thread\.expires_at > now\(\)/);
  assert.deepEqual(database.calls[0].values, [
    context.runId,
    context.workspaceId,
    context.currentUserId
  ]);
}

{
  const currentStepId = "99999999-9999-4999-8999-999999999999";
  const database = new FakeScopeDatabase({
    thread_id: threadId,
    run_id: context.runId,
    step_id: currentStepId,
    step_order: 4,
    turn_sequence: 2
  });
  const service = new AgentThreadContextService(database);
  const domains = [
    "meeting",
    "calendar",
    "board",
    "drive",
    "sqltoerd",
    "pr_review"
  ];
  const rawRefs = domains.map((domain, index) => ({
    domain,
    resourceType: `${domain}_resource`,
    resourceId: `raw-resource-${index}`,
    label: `${domain} result`,
    url: `/private/${index}`,
    metadata: { credential: `secret-${index}` }
  }));
  rawRefs.push(
    ...Array.from({ length: 10 }, (_, index) => ({
      domain: "calendar",
      resourceType: "event",
      resourceId: `overflow-${index}`,
      label: "x".repeat(500)
    }))
  );

  const state = await service.buildContextState(
    context,
    currentStepId,
    "cross_domain_search",
    rawRefs
  );

  assert.equal(state.version, 1);
  assert.deepEqual(state.provenance, { turnSequence: 2, stepOrder: 4 });
  assert.equal(
    state.resultSets[0].generation,
    contextGeneration(context.runId, currentStepId)
  );
  assert.equal(state.resultSets.length, 12);
  assert.deepEqual(
    state.resultSets.slice(0, domains.length).map((reference) => reference.domain),
    domains
  );
  assert.equal(Buffer.byteLength(state.resultSets.at(-1).label, "utf8") <= 300, true);
  assert.match(state.resultSets[0].contextRef, /^ctx_[0-9a-f]{24}$/);
  assert.equal(JSON.stringify(state).includes("raw-resource"), false);
  assert.equal(JSON.stringify(state).includes("credential"), false);
  assert.deepEqual(database.calls[0].values, [
    context.runId,
    context.workspaceId,
    context.currentUserId,
    currentStepId
  ]);

  const publicRefs = service.toPublicResourceRefs(
    threadId,
    context.runId,
    currentStepId,
    rawRefs
  );
  assert.equal(publicRefs.length, 12);
  assert.equal(JSON.stringify(publicRefs).includes("raw-resource"), false);
  assert.equal(JSON.stringify(publicRefs).includes("/private/"), false);
}

{
  const currentStepId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const candidateContextRef = "ctx_1234567890abcdef12345678";
  const service = new AgentThreadContextService(
    new FakeScopeDatabase({
      thread_id: threadId,
      run_id: context.runId,
      step_id: currentStepId,
      step_order: 5,
      turn_sequence: 3
    })
  );
  const state = await service.buildContextState(
    context,
    currentStepId,
    "find_meeting_reports",
    [],
    [
      {
        contextRef: candidateContextRef,
        domain: "meeting",
        resourceType: "meeting_report",
        label: "Weekly sync",
        status: "completed",
        ordinal: 2,
        generation: 42
      }
    ],
    "clarification"
  );

  assert.deepEqual(state.resultSets, [
    {
      contextRef: candidateContextRef,
      domain: "meeting",
      resourceType: "meeting_report",
      label: "Weekly sync",
      status: "completed",
      ordinal: 2,
      generation: 42,
      source: "candidate"
    }
  ]);
  assert.deepEqual(state.pendingState, { kind: "clarification" });
}

{
  const priorContextRef = "ctx_abcdefabcdefabcdefabcdef";
  const currentStepId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const database = new FakeScopeDatabase(
    {
      thread_id: threadId,
      run_id: context.runId,
      step_id: currentStepId,
      step_order: 6,
      turn_sequence: 3
    },
    {
      version: 1,
      resultSets: [
        {
          domain: "drive",
          resourceType: "document",
          contextRef: priorContextRef,
          label: "Prior document",
          ordinal: 1,
          generation: 5,
          source: "tool_result",
          resourceId: "must-not-survive"
        }
      ]
    }
  );
  const service = new AgentThreadContextService(database);

  const state = await service.buildContextState(
    context,
    currentStepId,
    "list_calendar_events",
    [
      {
        domain: "calendar",
        resourceType: "event",
        resourceId: "current-event",
        label: "Current event"
      }
    ],
    [],
    "completed",
    { contextRef: priorContextRef, generation: 5 }
  );

  assert.deepEqual(
    state.resultSets.map((reference) => reference.domain),
    ["drive", "calendar"]
  );
  assert.equal(JSON.stringify(state).includes("must-not-survive"), false);
  assert.equal(JSON.stringify(state).includes("current-event"), false);
  assert.deepEqual(state.selectedTarget, {
    contextRef: priorContextRef,
    generation: 5,
    source: "resolved_follow_up"
  });
}

{
  const firstRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const secondRunId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const firstStepId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const secondStepId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const reference = {
    domain: "drive",
    resourceType: "document",
    resourceId: "opaque-server-value",
    label: "Document"
  };
  const firstState = await new AgentThreadContextService(
    new FakeScopeDatabase({
      thread_id: threadId,
      run_id: firstRunId,
      step_id: firstStepId,
      step_order: 2,
      turn_sequence: 1
    })
  ).buildContextState(
    { ...context, runId: firstRunId },
    firstStepId,
    "search_drive_documents",
    [reference]
  );
  const secondState = await new AgentThreadContextService(
    new FakeScopeDatabase({
      thread_id: threadId,
      run_id: secondRunId,
      step_id: secondStepId,
      step_order: 2,
      turn_sequence: 1
    })
  ).buildContextState(
    { ...context, runId: secondRunId },
    secondStepId,
    "search_drive_documents",
    [reference]
  );

  assert.notEqual(
    firstState.resultSets[0].generation,
    secondState.resultSets[0].generation
  );
}
