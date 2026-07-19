import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CanvasAgentDelegationToolsService } = require(
  "../../dist/modules/agent/tools/canvas-agent-delegation-tools.service.js"
);
const { AgentCanvasDelegationCompletionService } = require(
  "../../dist/modules/agent/agent-canvas-delegation-completion.service.js"
);
const { CanvasAgentService } = require(
  "../../dist/modules/canvas/agent/canvas-agent.service.js"
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_RUN_ID = "33333333-3333-4333-8333-333333333333";
const CANVAS_ID = "44444444-4444-4444-8444-444444444444";
const CANVAS_RUN_ID = "55555555-5555-4555-8555-555555555555";

{
  const calls = [];
  const service = new CanvasAgentService(
    {
      async execute() {
        return {
          summary: "대시보드 프레임을 찾았습니다.",
          resourceRefs: ["shape:dashboard"],
          shouldContinue: false,
          progress: null,
        };
      },
    },
    {},
    {},
    {},
    {
      async claimNextPendingStep(runId) {
        calls.push(["claim", runId]);
        return {
          run: { id: CANVAS_RUN_ID },
          step: { id: "canvas-step-1" },
        };
      },
      async statusForRun() {
        return "executing";
      },
      async completeStep(stepId, output, resourceRefs) {
        calls.push(["completeStep", stepId, output, resourceRefs]);
      },
      async completeRun(runId, summary) {
        calls.push(["completeRun", runId, summary]);
      },
    },
    {},
  );

  await service.processPendingAction(CANVAS_RUN_ID);

  assert.deepEqual(calls[0], ["claim", CANVAS_RUN_ID]);
  assert.deepEqual(calls.at(-1), [
    "completeRun",
    CANVAS_RUN_ID,
    "대시보드 프레임을 찾았습니다.",
  ]);
}

const database = {
  async query(sql, parameters) {
    if (sql.includes("FROM canvas") && sql.includes("LIMIT 2")) {
      assert.deepEqual(parameters, [WORKSPACE_ID]);
      return [{ id: CANVAS_ID, title: "대시보드" }];
    }
    return [];
  },
  async queryOne(sql) {
    if (sql.includes("FROM agent_runs AS run")) {
      return { prompt: "선택한 화면을 HTML로 만들어줘" };
    }
    return null;
  },
};
const delegatedCalls = [];
const canvasAgentService = {
  async createDelegatedRun(...args) {
    delegatedCalls.push(args);
    return { id: CANVAS_RUN_ID, status: "planning" };
  },
};
const tools = new CanvasAgentDelegationToolsService(canvasAgentService, database);
const [definition] = tools.listDefinitions();
assert.equal(definition.name, "delegate_canvas_agent");
assert.equal(definition.executionMode, "contextual");
assert.doesNotMatch(JSON.stringify(definition.inputSchema), /prompt/);
assert.deepEqual(definition.inputSchema.properties, {});

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: AGENT_RUN_ID,
  requestContext: {
    surface: "canvas",
    canvasId: CANVAS_ID,
    canvasContext: {
      presentationMode: "interactive",
      selectedShapeIds: ["shape:frame"],
      toolHelpMode: false,
    },
  },
};
assert.deepEqual(await definition.prepareExecution(context, {}), { kind: "execute" });
const result = await definition.execute(context, {});
assert.equal(result.status, "delegated");
assert.equal(result.outputSummary.canvasAgentRunId, CANVAS_RUN_ID);
assert.equal(delegatedCalls.length, 1);
assert.equal(delegatedCalls[0][0], USER_ID);
assert.equal(delegatedCalls[0][1], WORKSPACE_ID);
assert.equal(delegatedCalls[0][2], CANVAS_ID);
assert.equal(delegatedCalls[0][3], AGENT_RUN_ID);
assert.equal(delegatedCalls[0][4].prompt, "선택한 화면을 HTML로 만들어줘");
assert.deepEqual(delegatedCalls[0][4].selectedShapeIds, ["shape:frame"]);

const outsideCanvasContext = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: AGENT_RUN_ID,
  requestContext: null,
};
assert.deepEqual(await definition.prepareExecution(outsideCanvasContext, {}), {
  kind: "execute",
});
const outsideCanvasResult = await definition.execute(outsideCanvasContext, {});
assert.equal(outsideCanvasResult.status, "delegated");
assert.equal(delegatedCalls.length, 2);
assert.equal(delegatedCalls[1][2], CANVAS_ID);
assert.equal(delegatedCalls[1][4].presentationMode, "background");
assert.equal("selectedShapeIds" in delegatedCalls[1][4], false);
assert.throws(
  () => definition.prepareExecution(outsideCanvasContext, { canvasTitle: "디자인" }),
  (error) =>
    error?.response?.error?.message ===
    "delegate_canvas_agent input field is invalid: canvasTitle",
);

for (const canvases of [
  [],
  [
    { id: CANVAS_ID, title: "대시보드" },
    { id: "77777777-7777-4777-8777-777777777777", title: "중복" },
  ],
]) {
  const [invalidDefinition] = new CanvasAgentDelegationToolsService(
    canvasAgentService,
    {
      async query() {
        return canvases;
      },
    },
  ).listDefinitions();
  await assert.rejects(
    () => invalidDefinition.prepareExecution(outsideCanvasContext, {}),
    (error) =>
      error?.response?.error?.message ===
      "Workspace must have exactly one freeform Canvas",
  );
}

await assert.rejects(
  () =>
    definition.prepareExecution(
      {
        ...context,
        requestContext: {
          ...context.requestContext,
          canvasId: "88888888-8888-4888-8888-888888888888",
        },
      },
      {},
    ),
  (error) =>
    error?.response?.error?.message ===
    "Canvas request context does not match the Workspace Canvas",
);

const settleCalls = [];
const completionDatabase = {
  async query() {
    return [
      {
        agent_run_id: AGENT_RUN_ID,
        agent_step_id: "66666666-6666-4666-8666-666666666666",
        workspace_id: WORKSPACE_ID,
        requested_by_user_id: USER_ID,
        canvas_agent_run_id: CANVAS_RUN_ID,
        canvas_id: CANVAS_ID,
        canvas_status: "completed",
        result_summary: "선택한 영역의 정적 HTML/CSS 초안을 만들었습니다.",
        error_message: null,
        has_artifact: true,
      },
    ];
  },
};
const completion = new AgentCanvasDelegationCompletionService(
  completionDatabase,
  {
    async settleDelegatedToolStep(...args) {
      settleCalls.push(args);
      return true;
    },
  },
);
await completion.processCompletedDelegations();
assert.equal(settleCalls.length, 1);
assert.equal(settleCalls[0][0], USER_ID);
assert.equal(
  settleCalls[0][2].finalAnswer,
  "선택한 영역의 정적 HTML/CSS 초안을 만들었습니다.",
);
assert.equal(settleCalls[0][2].outputSummary.hasArtifact, true);

const targetedSettleCalls = [];
const targetedActionCalls = [];
const targetedCompletion = new AgentCanvasDelegationCompletionService(
  {
    async queryOne() {
      return {
        canvas_agent_run_id: CANVAS_RUN_ID,
        canvas_status: "executing",
      };
    },
    async query() {
      return [
        {
          agent_run_id: AGENT_RUN_ID,
          agent_step_id: "66666666-6666-4666-8666-666666666666",
          workspace_id: WORKSPACE_ID,
          requested_by_user_id: USER_ID,
          canvas_agent_run_id: CANVAS_RUN_ID,
          canvas_id: CANVAS_ID,
          canvas_status: "completed",
          result_summary: "대시보드 프레임을 찾았습니다.",
          error_message: null,
          has_artifact: false,
        },
      ];
    },
  },
  {
    async settleDelegatedToolStep(...args) {
      targetedSettleCalls.push(args);
      return true;
    },
  },
  {
    async processPendingAction(runId) {
      targetedActionCalls.push(runId);
    },
  },
);
await targetedCompletion.reconcileRun({
  agentRunId: AGENT_RUN_ID,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
});
assert.deepEqual(targetedActionCalls, [CANVAS_RUN_ID]);
assert.equal(targetedSettleCalls.length, 1);
assert.equal(
  targetedSettleCalls[0][2].finalAnswer,
  "대시보드 프레임을 찾았습니다.",
);
