import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AGENT_TOOL_SCHEMA_VERSION, AgentJobService } = require(
  "../../dist/modules/agent/agent-job.service.js"
);
const { AgentOutboxPublisherService } = require(
  "../../dist/modules/agent/agent-outbox-publisher.service.js"
);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { AgentDomainFeatureFlagService } = require(
  "../../dist/modules/agent/agent-domain-feature-flag.service.js"
);
const {
  buildAgentToolCapabilityCatalog,
  getAgentCapabilityToolNames,
  isTerminalAgentCapabilityTool,
  validateAgentToolCapabilityCatalog
} = require(
  "../../dist/modules/agent/agent-tool-capability-catalog.js"
);
const {
  AGENT_TOOL_INVENTORY_VERSION
} = require("../../dist/modules/agent/agent-tool-inventory.js");
const { CalendarAgentToolsService } = require(
  "../../dist/modules/agent/tools/calendar-agent-tools.service.js"
);
const { MeetingAgentToolsService } = require(
  "../../dist/modules/agent/tools/meeting-agent-tools.service.js"
);
const { BoardAgentToolsService } = require(
  "../../dist/modules/agent/tools/board-agent-tools.service.js"
);
const { SqlErdAgentToolsService } = require(
  "../../dist/modules/agent/tools/sql-erd-agent-tools.service.js"
);
const { DriveAgentToolsService } = require(
  "../../dist/modules/agent/tools/drive-agent-tools.service.js"
);
const { PrReviewAgentToolsService } = require(
  "../../dist/modules/agent/tools/pr-review-agent-tools.service.js"
);
const { CanvasAgentDelegationToolsService } = require(
  "../../dist/modules/agent/tools/canvas-agent-delegation-tools.service.js"
);

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  SQS_AGENT_JOBS_QUEUE_URL: process.env.SQS_AGENT_JOBS_QUEUE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT
};

{
  const parameterTypes = Reflect.getMetadata(
    "design:paramtypes",
    AgentToolRegistryService
  );

  assert.equal(
    parameterTypes?.[7],
    AgentDomainFeatureFlagService,
    "AgentToolRegistryService must retain AgentDomainFeatureFlagService Nest DI metadata"
  );
}

const AGENT_TOOL_INVENTORY_BASELINE_SHA256 =
  "5e4c914a927773f9ca354c3ca1e9bebc66a9d7a3e6147819d8ca371289e68d29";

const payload = {
  jobType: "agent_run_requested",
  runId: "33333333-3333-3333-3333-333333333333",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  requestedByUserId: "11111111-1111-1111-1111-111111111111",
  requestContext: null,
  turnSequence: 1,
  toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION,
  tools: [
    {
      name: "list_calendar_events",
      description: "Calendar 일정 목록을 날짜 범위 기준으로 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: {
            type: "string",
            format: "date"
          },
          end: {
            type: "string",
            format: "date"
          }
        }
      }
    }
  ]
};

{
  const suite = JSON.parse(
    readFileSync(
      new URL("../../../ai-worker/evals/agent_planner_korean_v1.json", import.meta.url),
      "utf8"
    )
  );
  const sqlErdFocusEvaluation = suite.cases.find(
    (candidate) => candidate.id === "sql_erd_focus_payment_tables"
  );
  assert.equal(
    sqlErdFocusEvaluation?.expected?.requiresConfirmation,
    false,
    "read-only SQLtoERD focus must not require confirmation"
  );
  const registry = new AgentToolRegistryService(
    new CalendarAgentToolsService({}),
    new MeetingAgentToolsService({}),
    new BoardAgentToolsService({}),
    new SqlErdAgentToolsService({}),
    undefined,
    undefined,
    new DriveAgentToolsService({})
  );
  const actualSnapshot = registry.listDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    riskLevel: definition.riskLevel,
    executionMode: definition.executionMode,
    inputSchema: definition.inputSchema
  }));

  assert.ok(
    registry.getDefinition("search_workspace_documents"),
    "Drive document search must be registered for Agent planning"
  );
  assert.deepEqual(suite.tools, actualSnapshot);

  const capabilityCatalog = registry.listCapabilityCatalogForContext(null);
  assert.equal(capabilityCatalog.version, "agent-tool-capabilities:v2");
  assert.match(capabilityCatalog.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    capabilityCatalog.descriptors.map((descriptor) => descriptor.toolName),
    registry
      .listDefinitionsForContext(null)
      .map((definition) => definition.name)
      .sort()
  );
  assert.deepEqual(
    capabilityCatalog.capabilities.find(
      (capability) => capability.id === "meeting.report.hybrid_search"
    )?.toolNames,
    ["list_meeting_reports", "search_meeting_transcript"]
  );
  assert.deepEqual(
    capabilityCatalog.capabilities.find(
      (capability) => capability.id === "calendar.events.get"
    )?.toolNames,
    ["get_calendar_event"]
  );
  assert.deepEqual(getAgentCapabilityToolNames("meeting.report.hybrid_search"), [
    "list_meeting_reports",
    "search_meeting_transcript"
  ]);
  assert.equal(
    isTerminalAgentCapabilityTool(
      ["meeting.report.hybrid_search"],
      "list_meeting_reports",
      []
    ),
    false,
    "the exact-title lookup must not complete the hybrid workflow"
  );
  assert.equal(
    isTerminalAgentCapabilityTool(
      ["meeting.report.hybrid_search"],
      "search_meeting_transcript",
      ["list_meeting_reports"]
    ),
    true
  );
  assert.equal(
    capabilityCatalog.descriptors.find(
      (descriptor) => descriptor.toolName === "list_calendar_events"
    )?.domain,
    "calendar"
  );
  assert.deepEqual(
    capabilityCatalog.descriptors.find(
      (descriptor) => descriptor.toolName === "list_calendar_events"
    )?.acceptedSelectorFields,
    ["end", "start"]
  );
  assert.ok(
    capabilityCatalog.descriptors.every(
      (descriptor) =>
      descriptor.whenToUse &&
        descriptor.mustNotUseFor.length > 0 &&
        descriptor.capabilityIds.length > 0 &&
        descriptor.selectorKinds.length > 0 &&
        descriptor.requiresConfirmation ===
          (descriptor.executionMode === "confirmation_required")
    )
  );
  assert.ok(
    capabilityCatalog.capabilities.every(
      (capability) =>
        capability.examples.length === 5 &&
        new Set(capability.examples.map((example) => example.kind)).size === 5 &&
        capability.selectorKinds.length > 0
    ),
    "every capability must carry DB-independent canonical and variation fixtures"
  );
  assert.ok(
    capabilityCatalog.capabilities.some(
      (capability) =>
        capability.id === "meeting.action_items.create" &&
        capability.availability === "unsupported" &&
        capability.toolNames.length === 0
    ),
    "unsupported boundaries must remain explicit instead of becoming executable tools"
  );
  assert.deepEqual(
    registry.listCapabilityCatalogForContext(null),
    capabilityCatalog,
    "capability snapshot must be deterministic for the same eligible tools"
  );
  assert.deepEqual(
    capabilityCatalog.capabilities.find(
      (capability) => capability.id === "meeting.action_items.transfer_and_approve"
    )?.toolNames,
    [
      "find_action_items",
      "update_meeting_report_action_item",
      "approve_meeting_report_action_item"
    ]
  );
  assert.deepEqual(
    capabilityCatalog.capabilities.find(
      (capability) => capability.id === "meeting.report.summary"
    )?.toolNames,
    ["summarize_meeting_report"],
    "meeting report summary must not require the optional list lookup"
  );
  const updateActionItem = capabilityCatalog.descriptors.find(
    (descriptor) => descriptor.toolName === "update_meeting_report_action_item"
  );
  assert.ok(
    updateActionItem?.capabilityIds.includes(
      "meeting.action_items.transfer_and_approve"
    )
  );
  assert.ok(updateActionItem?.prerequisiteToolNames.includes("find_action_items"));
  assert.ok(
    updateActionItem?.followUpToolNames.includes(
      "approve_meeting_report_action_item"
    )
  );
  assert.ok(updateActionItem?.mustNotUseFor.includes("후속 작업 승인 또는 반려 요청"));

const fullRegistry = new AgentToolRegistryService(
    new CalendarAgentToolsService({}),
    new MeetingAgentToolsService({}),
    new BoardAgentToolsService({}),
    new SqlErdAgentToolsService({}),
    new PrReviewAgentToolsService({}),
    new CanvasAgentDelegationToolsService({}, {}),
  new DriveAgentToolsService({})
);
{
  const fullCapabilityCatalog = fullRegistry.listCapabilityCatalogForContext(null);
  const canvasDriveImageImport = fullCapabilityCatalog.capabilities.find(
    (capability) => capability.id === "canvas.drive_images.import"
  );
  assert.deepEqual(canvasDriveImageImport?.toolNames, ["delegate_canvas_agent"]);
  assert.ok(
    canvasDriveImageImport?.positiveExamples.includes(
      "드라이브에서 아키텍처 이미지를 캔버스에 올려줘"
    )
  );
  assert.ok(
    fullCapabilityCatalog.descriptors
      .find((descriptor) => descriptor.toolName === "delegate_canvas_agent")
      ?.capabilityIds.includes("canvas.drive_images.import")
  );
  const sqlErdCapabilityCatalog = fullRegistry.listCapabilityCatalogForContext({
    surface: "sql_erd",
    sessionId: "77777777-7777-4777-8777-777777777777"
  });
  const sqlErdInspect = sqlErdCapabilityCatalog.capabilities.find(
    (capability) => capability.id === "sql_erd.inspect"
  );
  const sqlErdGenerate = sqlErdCapabilityCatalog.capabilities.find(
    (capability) => capability.id === "sql_erd.generate"
  );
  assert.ok(
    sqlErdInspect?.positiveExamples.includes(
      "현재 ERD에서 회의 관련 테이블만 보여줘"
    )
  );
  assert.ok(
    sqlErdInspect?.positiveExamples.includes(
      "회의 관련 테이블만 집중적으로 보여줘"
    )
  );
  assert.ok(
    sqlErdInspect?.mustNotUseFor.some((boundary) =>
      boundary.includes("새 ERD")
    )
  );
  assert.ok(
    sqlErdGenerate?.positiveExamples.includes(
      "햄버거 가게 관련 ERD를 생성해줘"
    )
  );
  assert.ok(
    sqlErdGenerate?.positiveExamples.includes(
      "학생, 강의, 수강 신청 ERD를 만들어줘"
    )
  );
  assert.match(sqlErdGenerate?.whenToUse ?? "", /자연어/);
  assert.ok(
    sqlErdGenerate?.mustNotUseFor.some((boundary) =>
      boundary.includes("집중 표시")
    )
  );
}
{
  const sqlErdContext = {
    surface: "sql_erd",
    sessionId: "77777777-7777-4777-8777-777777777777"
  };
  assert.deepEqual(
    fullRegistry
      .listDefinitionsForContext(sqlErdContext)
      .map((definition) => definition.name)
      .sort(),
    ["focus_sql_erd_tables", "generate_sql_erd"],
    "a surface context must expose only tools owned by its domain"
  );
  assert.equal(
    fullRegistry.getDefinitionForContext("list_calendar_events", sqlErdContext),
    null,
    "execution lookup must enforce the same surface domain"
  );
  assert.equal(
    fullRegistry.getDefinitionForContext("focus_sql_erd_tables", null),
    null,
    "SQLtoERD focus must not be shortlisted outside the current SQLtoERD screen"
  );
}
{
  const previousRead = process.env.AGENT_DOMAIN_MEETING_READ_ENABLED;
  const previousWrite = process.env.AGENT_DOMAIN_MEETING_WRITE_ENABLED;
  try {
    process.env.AGENT_DOMAIN_MEETING_READ_ENABLED = "false";
    process.env.AGENT_DOMAIN_MEETING_WRITE_ENABLED = "false";
    const gatedRegistry = new AgentToolRegistryService(
      undefined,
      new MeetingAgentToolsService({}),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AgentDomainFeatureFlagService()
    );
    assert.equal(
      gatedRegistry.getDefinitionForContext("list_meeting_reports", null),
      null,
      "an explicit read flag must keep Meeting reads out of planning and execution"
    );
    assert.equal(
      gatedRegistry.getDefinitionForContext("leave_meeting", null),
      null,
      "an explicit write flag must also reject pending execution"
    );
  } finally {
    if (previousRead === undefined) {
      delete process.env.AGENT_DOMAIN_MEETING_READ_ENABLED;
    } else {
      process.env.AGENT_DOMAIN_MEETING_READ_ENABLED = previousRead;
    }
    if (previousWrite === undefined) {
      delete process.env.AGENT_DOMAIN_MEETING_WRITE_ENABLED;
    } else {
      process.env.AGENT_DOMAIN_MEETING_WRITE_ENABLED = previousWrite;
    }
  }
}
{
  const previousAppEnv = process.env.APP_ENV;
  const previousMeetingRead = process.env.AGENT_DOMAIN_MEETING_READ_ENABLED;
  const previousBoardRead = process.env.AGENT_DOMAIN_BOARD_READ_ENABLED;
  try {
    process.env.APP_ENV = "dev";
    delete process.env.AGENT_DOMAIN_MEETING_READ_ENABLED;
    delete process.env.AGENT_DOMAIN_BOARD_READ_ENABLED;
    const flags = new AgentDomainFeatureFlagService();
    assert.equal(flags.isEnabled("meeting", "read"), true);
    assert.equal(
      flags.isEnabled("board", "read"),
      false,
      "dev must fail closed to the Terraform rollout when task env flags drift"
    );
  } finally {
    if (previousAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousAppEnv;
    if (previousMeetingRead === undefined)
      delete process.env.AGENT_DOMAIN_MEETING_READ_ENABLED;
    else process.env.AGENT_DOMAIN_MEETING_READ_ENABLED = previousMeetingRead;
    if (previousBoardRead === undefined)
      delete process.env.AGENT_DOMAIN_BOARD_READ_ENABLED;
    else process.env.AGENT_DOMAIN_BOARD_READ_ENABLED = previousBoardRead;
  }
}
const inventory = fullRegistry.listToolInventory();
  const legacyFixtureToolNames = new Set(suite.tools.map((tool) => tool.name));
  const legacyExpectedToolSelections = Object.fromEntries(
    suite.cases
      .filter((candidate) => candidate.expected?.toolName)
      .reduce((counts, candidate) => {
        const toolName = candidate.expected.toolName;
        counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
        return counts;
      }, new Map())
      .entries()
  );
  const legacyToolSchemaBytes = Buffer.byteLength(JSON.stringify(suite.tools));
  const legacySuiteSha256 = createHash("sha256")
    .update(JSON.stringify(suite))
    .digest("hex");
  const missingLegacyFixtureToolNames = inventory.tools
    .filter((tool) => !legacyFixtureToolNames.has(tool.toolName))
    .map((tool) => tool.toolName);
  assert.equal(inventory.version, AGENT_TOOL_INVENTORY_VERSION);
  assert.equal(
    inventory.sha256,
    AGENT_TOOL_INVENTORY_BASELINE_SHA256,
    "registered tool inventory drift must update the recorded legacy baseline"
  );
  assert.equal(inventory.totalTools, 36);
  assert.equal(inventory.tools.length, 36);
  assert.equal(
    inventory.tools.filter((tool) => tool.operation === "write").length,
    16
  );
  assert.deepEqual(missingLegacyFixtureToolNames, [
    "delegate_canvas_agent",
    "recommend_pr_review_focus"
  ]);
  assert.ok(
    inventory.tools.every(
      (tool) =>
        tool.domain &&
        tool.action &&
        (tool.operation === "read" || tool.operation === "write") &&
        tool.riskLevel &&
        tool.executionMode &&
        Number.isInteger(tool.schemaBytes) &&
        tool.schemaBytes > 0 &&
        Number.isInteger(tool.estimatedSchemaTokens) &&
        tool.estimatedSchemaTokens > 0 &&
        tool.capabilityIds.length > 0
    )
  );
  console.info(
    "Agent tool inventory baseline",
    JSON.stringify({
      inventoryVersion: inventory.version,
      inventorySha256: inventory.sha256,
      catalogVersion: inventory.catalogVersion,
      catalogSha256: inventory.catalogSha256,
      totalTools: inventory.totalTools,
      totalSchemaBytes: inventory.totalSchemaBytes,
      totalEstimatedSchemaTokens: inventory.totalEstimatedSchemaTokens,
      legacyPlannerBaseline: {
        suiteSha256: legacySuiteSha256,
        catalogSha256: capabilityCatalog.sha256,
        toolCount: legacyFixtureToolNames.size,
        toolSchemaBytes: legacyToolSchemaBytes,
        estimatedToolSchemaTokens: Math.ceil(legacyToolSchemaBytes / 4),
        expectedToolSelections: legacyExpectedToolSelections
      },
      missingLegacyFixtureToolNames
    })
  );

  const calendarDefinition = registry.getDefinition("list_calendar_events");
  const changedSelectorSchema = buildAgentToolCapabilityCatalog([
    {
      ...calendarDefinition,
      inputSchema: {
        ...calendarDefinition.inputSchema,
        required: ["start"]
      }
    }
  ]);
  assert.notEqual(
    changedSelectorSchema.sha256,
    buildAgentToolCapabilityCatalog([calendarDefinition]).sha256,
    "selector schema constraints must affect the capability catalog SHA"
  );
  const oneToolCatalog = buildAgentToolCapabilityCatalog([calendarDefinition]);
  assert.throws(
    () =>
      validateAgentToolCapabilityCatalog(
        [
          {
            ...oneToolCatalog.capabilities[0],
            toolNames: ["list_calendar_events", "list_calendar_events"]
          }
        ],
        oneToolCatalog.descriptors,
        [calendarDefinition]
      ),
    /invalid capability/,
    "duplicate tool names in a capability chain must fail closed"
  );
  assert.throws(
    () =>
      validateAgentToolCapabilityCatalog(
        [
          {
            ...oneToolCatalog.capabilities[0],
            domain: "meeting"
          }
        ],
        oneToolCatalog.descriptors,
        [calendarDefinition]
      ),
    /domain mismatch/,
    "a capability domain must match every tool in its explicit chain"
  );
  assert.throws(
    () =>
      validateAgentToolCapabilityCatalog(
        oneToolCatalog.capabilities,
        [
          {
            ...oneToolCatalog.descriptors[0],
            domain: "meeting"
          }
        ],
        [calendarDefinition]
      ),
    /domain mismatch/,
    "a descriptor domain must match the registered tool domain"
  );
}

class FakeSqsClient {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.commands = [];
    this.destroyCalls = 0;
  }

  async send(command) {
    this.commands.push(command);

    if (this.shouldFail) {
      throw new Error("raw AWS queue failure with queue url");
    }

    return {
      MessageId: "message-1"
    };
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class TestAgentJobService extends AgentJobService {
  constructor(client) {
    super();
    this.client = client;
    this.configs = [];
  }

  createSqsClient(config) {
    this.configs.push(config);
    return this.client;
  }
}

class FakeOutboxDatabaseService {
  constructor({ claim, dueRows = [], stalePlanningRuns = [], terminalRun = null } = {}) {
    this.claim = claim ?? null;
    this.dueRows = dueRows;
    this.stalePlanningRuns = stalePlanningRuns;
    this.terminalRun = terminalRun;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    if (text.includes("WITH stale_runs")) {
      return this.stalePlanningRuns;
    }
    return this.dueRows;
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "queryOne", text, values });

        if (text.includes("WITH candidate")) {
          return this.claim;
        }

        if (text.includes("RETURNING run_id, workspace_id")) {
          return this.claim
            ? {
                run_id: this.claim.run_id,
                workspace_id: this.claim.workspace_id
              }
            : null;
        }

        if (text.includes("UPDATE agent_runs")) {
          return this.terminalRun;
        }

        throw new Error(`Unhandled outbox queryOne: ${text}`);
      },
      execute: async (text, values = []) => {
        this.calls.push({ method: "transaction.execute", text, values });
        return { rows: [] };
      }
    });
  }
}

class FakeOutboxJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async enqueueAgentRunRequestedJob(job) {
    this.calls.push(job);

    if (this.shouldFail) {
      throw new Error("SQS unavailable");
    }
  }
}

class FakeOutboxToolRegistryService {
  constructor() {
    this.calls = [];
  }

  listDefinitions() {
    return this.definitions();
  }

  listDefinitionsForContext(requestContext) {
    this.calls.push({ method: "listDefinitionsForContext", requestContext });
    return this.definitions().filter(
      (definition) =>
        !definition.contextRequirement ||
        definition.contextRequirement.surface === requestContext?.surface
    );
  }

  listCapabilityCatalogForContext(requestContext) {
    this.calls.push({ method: "listCapabilityCatalogForContext", requestContext });
    const descriptors = this.listDefinitionsForContext(requestContext).map(
      (definition) => ({
        toolName: definition.name,
        domain: definition.name.includes("calendar") ? "calendar" : "pr_review",
        action: definition.name,
        capabilityIds: [definition.name],
        whenToUse: definition.description,
        mustNotUseFor: ["다른 도메인의 요청"],
        acceptedSelectorFields: [],
        selectorKinds: ["date_range"],
        prerequisiteToolNames: [],
        followUpToolNames: [],
        riskLevel: definition.riskLevel,
        executionMode: definition.executionMode,
        requiresConfirmation: false,
        contextSurface: definition.contextRequirement?.surface ?? null
      })
    );
    return {
      version: "agent-tool-capabilities:v2",
      sha256: "a".repeat(64),
      descriptors
    };
  }

  definitions() {
    return [
      {
        name: "list_calendar_events",
        description: "Calendar 일정 목록을 조회합니다.",
        riskLevel: "low",
        executionMode: "auto",
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      },
      {
        name: "pr_review_fixture",
        description: "PR Review fixture",
        riskLevel: "low",
        executionMode: "contextual",
        contextRequirement: {
          surface: "pr_review"
        },
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      }
    ];
  }
}

function createOutboxClaim(overrides = {}) {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    run_id: payload.runId,
    workspace_id: payload.workspaceId,
    requested_by_user_id: payload.requestedByUserId,
    request_context_json: payload.requestContext,
    attempt_count: 1,
    claim_token: "55555555-5555-5555-5555-555555555555",
    turn_sequence: 1,
    ...overrides
  };
}

try {
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.SQS_AGENT_JOBS_QUEUE_URL =
    "http://localhost:4566/000000000000/pilo-dev-agent-jobs";
  process.env.SQS_ENDPOINT = "http://localhost:4566";

  {
    const client = new FakeSqsClient();
    const service = new TestAgentJobService(client);

    await service.enqueueAgentRunRequestedJob(payload);
    await service.enqueueAgentRunRequestedJob({
      ...payload,
      runId: "44444444-4444-4444-4444-444444444444"
    });

    assert.deepEqual(service.configs, [
      {
        awsRegion: "ap-northeast-2",
        queueUrl: "http://localhost:4566/000000000000/pilo-dev-agent-jobs",
        endpoint: "http://localhost:4566"
      }
    ]);
    assert.equal(client.commands.length, 2);
    assert.equal(client.commands[0].constructor.name, "SendMessageCommand");
    assert.equal(
      client.commands[0].input.QueueUrl,
      "http://localhost:4566/000000000000/pilo-dev-agent-jobs"
    );
    assert.deepEqual(JSON.parse(client.commands[0].input.MessageBody), payload);
    assert.deepEqual(JSON.parse(client.commands[1].input.MessageBody), {
      ...payload,
      runId: "44444444-4444-4444-4444-444444444444"
    });
    assert.equal(client.commands[0].input.MessageGroupId, undefined);
    assert.equal(client.commands[0].input.MessageDeduplicationId, undefined);

    service.onModuleDestroy();
    assert.equal(client.destroyCalls, 1);
  }

  {
    delete process.env.SQS_AGENT_JOBS_QUEUE_URL;
    const client = new FakeSqsClient();
    const service = new TestAgentJobService(client);

    try {
      await service.enqueueAgentRunRequestedJob(payload);
      assert.fail("Expected missing SQS queue config failure");
    } catch (error) {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Agent job queue is not configured"
        }
      });
    }
    assert.equal(client.commands.length, 0);
    assert.equal(service.configs.length, 0);
  }

  {
    process.env.SQS_AGENT_JOBS_QUEUE_URL =
      "http://localhost:4566/000000000000/pilo-dev-agent-jobs";
    const client = new FakeSqsClient({ shouldFail: true });
    const service = new TestAgentJobService(client);

    try {
      await service.enqueueAgentRunRequestedJob(payload);
      assert.fail("Expected SQS publish failure");
    } catch (error) {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Agent job could not be enqueued"
        }
      });
      assert.doesNotMatch(
        JSON.stringify(error.getResponse()),
        /raw AWS queue failure|pilo-dev-agent-jobs/
      );
    }
  }

  {
    const database = new FakeOutboxDatabaseService({
      stalePlanningRuns: [
        {
          id: payload.runId,
          workspace_id: payload.workspaceId,
          turn_sequence: 1
        }
      ]
    });
    const publisher = new AgentOutboxPublisherService(
      database,
      new FakeOutboxJobService(),
      new FakeOutboxToolRegistryService()
    );

    await publisher.recoverStalePlanningRuns();

    const terminalize = database.calls.find(
      (call) => call.method === "query" && call.text.includes("WITH stale_runs")
    );
    assert.match(
      terminalize.text,
      /outbox\.planning_started_at <= now\(\) - \(\$1 \* INTERVAL '1 second'\)/
    );
    assert.match(terminalize.text, /FOR UPDATE OF run, outbox SKIP LOCKED/);
    assert.match(terminalize.text, /outbox\.turn_sequence/);
    assert.match(terminalize.text, /SET status = 'failed'/);
    assert.match(terminalize.text, /AND step\.status IN \('pending', 'running'\)/);
    assert.match(terminalize.text, /'planning_timeout'/);
    assert.deepEqual(terminalize.values, [
      240,
      20,
      "AGENT_PLANNING_TIMEOUT",
      "요청 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
    ]);
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim(),
      dueRows: [{ run_id: payload.runId }]
    });
    const jobService = new FakeOutboxJobService();
    const registry = new FakeOutboxToolRegistryService();
    const publisher = new AgentOutboxPublisherService(
      database,
      jobService,
      registry
    );

    await publisher.publishDueEvents();

    assert.equal(jobService.calls.length, 1);
    assert.equal(jobService.calls[0].runId, payload.runId);
    assert.equal(jobService.calls[0].turnSequence, 1);
    assert.equal(jobService.calls[0].toolSchemaVersion, AGENT_TOOL_SCHEMA_VERSION);
    assert.equal(jobService.calls[0].requestContext, null);
    assert.deepEqual(jobService.calls[0].tools, [
      {
        name: "list_calendar_events",
        description: "Calendar 일정 목록을 조회합니다.",
        riskLevel: "low",
        executionMode: "auto",
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      }
    ]);
    assert.deepEqual(jobService.calls[0].toolCapabilityCatalog, {
      version: "agent-tool-capabilities:v2",
      sha256: "a".repeat(64),
      descriptors: [
        {
          toolName: "list_calendar_events",
          domain: "calendar",
          action: "list_calendar_events",
          capabilityIds: ["list_calendar_events"],
          whenToUse: "Calendar 일정 목록을 조회합니다.",
          mustNotUseFor: ["다른 도메인의 요청"],
          acceptedSelectorFields: [],
          selectorKinds: ["date_range"],
          prerequisiteToolNames: [],
          followUpToolNames: [],
          riskLevel: "low",
          executionMode: "auto",
          requiresConfirmation: false,
          contextSurface: null
        }
      ]
    });
    assert.deepEqual(registry.calls, [
      { method: "listDefinitionsForContext", requestContext: null },
      { method: "listCapabilityCatalogForContext", requestContext: null },
      { method: "listDefinitionsForContext", requestContext: null }
    ]);
    assert.match(
      database.calls.find((call) => call.method === "queryOne").text,
      /FOR UPDATE OF outbox SKIP LOCKED/
    );
    assert.match(
      database.calls.find((call) => call.method === "queryOne").text,
      /outbox\.turn_sequence/
    );
    assert.match(
      database.calls.find(
        (call) =>
          call.method === "query" && call.text.includes("next_attempt_at <= now()")
      ).text,
      /outbox.status = 'publishing'/
    );
    const delivered = database.calls.find(
      (call) => call.method === "execute" && call.text.includes("delivered_at")
    );
    assert.match(
      delivered.text,
      /SET status = 'delivered'/
    );
    assert.deepEqual(delivered.values, [
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555"
    ]);
  }

  {
    const requestContext = {
      surface: "pr_review",
      sessionId: "77777777-7777-4777-8777-777777777777"
    };
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ request_context_json: requestContext }),
      dueRows: [{ run_id: payload.runId }]
    });
    const jobService = new FakeOutboxJobService();
    const registry = new FakeOutboxToolRegistryService();
    const publisher = new AgentOutboxPublisherService(
      database,
      jobService,
      registry
    );

    await publisher.publishDueEvents();

    assert.deepEqual(
      jobService.calls[0].tools.map((tool) => tool.name),
      ["list_calendar_events", "pr_review_fixture"]
    );
    assert.deepEqual(registry.calls, [
      { method: "listDefinitionsForContext", requestContext },
      { method: "listCapabilityCatalogForContext", requestContext },
      { method: "listDefinitionsForContext", requestContext }
    ]);
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ attempt_count: 1 })
    });
    const publisher = new AgentOutboxPublisherService(
      database,
      new FakeOutboxJobService({ shouldFail: true }),
      new FakeOutboxToolRegistryService()
    );

    await publisher.publishCreatedRun(payload.runId);

    const retry = database.calls.find(
      (call) =>
        call.method === "execute" && call.text.includes("next_attempt_at = $2")
    );
    assert.equal(retry.values[2], "AGENT_OUTBOX_PUBLISH_FAILED");
    assert.equal(retry.values[3], "Agent planning job could not be published");
    assert.equal(retry.values[4], "55555555-5555-5555-5555-555555555555");
    assert.ok(retry.values[1] instanceof Date);
    assert.ok(retry.values[1].getTime() > Date.now());
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ attempt_count: 5 }),
      terminalRun: { id: payload.runId }
    });
    const publisher = new AgentOutboxPublisherService(
      database,
      new FakeOutboxJobService({ shouldFail: true }),
      new FakeOutboxToolRegistryService()
    );

    await publisher.publishCreatedRun(payload.runId);

    assert.match(
      database.calls.find(
        (call) =>
          call.method === "queryOne" &&
          call.text.includes("RETURNING run_id, workspace_id")
      ).text,
      /SET status = 'failed'/
    );
    assert.match(
      database.calls.find(
        (call) => call.method === "queryOne" && call.text.includes("UPDATE agent_runs")
      ).text,
      /AND status = 'planning'/
    );
    assert.match(
      database.calls.find(
        (call) => call.method === "transaction.execute"
      ).text,
      /outbox_publish_exhausted/
    );
  }
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
