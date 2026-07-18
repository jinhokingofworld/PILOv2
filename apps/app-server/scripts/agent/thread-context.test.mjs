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
  assert.match(database.calls[0].text, /prior_run\.workspace_id = \$2/);
  assert.match(database.calls[0].text, /prior_run\.requested_by_user_id = \$3/);
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
