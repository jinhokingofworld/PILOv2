import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { SqlErdAgentToolsService } = require(
  "../../dist/modules/agent/tools/sql-erd-agent-tools.service.js"
);
const {
  buildSqlErdAgentSchemaProjection,
  createSqlErdModelFingerprint,
  partitionSqlErdAgentContextTableRefs,
  resolveSqlErdAgentTableFocus
} = require("../../dist/modules/agent/tools/sql-erd-table-focus.js");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

assert.equal(
  createSqlErdModelFingerprint({
    schema: { relations: [], tables: [{ id: "table-orders" }] },
    version: 1
  }),
  "fnv1a32:276fb69c"
);

function column(key, name, kind = "bigint") {
  return {
    key,
    name,
    dataType: {
      kind,
      length: null,
      precision: null,
      scale: null
    },
    nullable: false,
    autoIncrement: kind === "bigint",
    defaultValue: null
  };
}

function schemaSpec(overrides = {}) {
  return {
    version: 1,
    title: "주문 관리",
    requestedDialect: "postgresql",
    tables: [
      {
        key: "users",
        name: "users",
        schemaName: null,
        columns: [column("id", "id")],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [],
    unsupportedFeatures: [],
    ...overrides
  };
}

function sessionPayload(overrides = {}) {
  return {
    id: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    title: "주문 관리",
    sourceFormat: "sql",
    dialect: "postgresql",
    sourceText: "CREATE TABLE users (id BIGINT PRIMARY KEY);",
    modelJson: { version: 1 },
    layoutJson: { version: 1 },
    settingsJson: {},
    tableCount: 1,
    relationCount: 0,
    revision: 1,
    writeProtocol: "operations_v1",
    latestOpSeq: 0,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
}

function focusModelJson() {
  const table = (id, name, columns, comment = null) => ({
    id,
    name,
    schemaName: "public",
    columns,
    constraints: [],
    comment
  });
  const modelColumn = (
    id,
    name,
    {
      primaryKey = false,
      foreignKey = false,
      comment = null,
      dataType = "bigint"
    } = {}
  ) => ({
    id,
    name,
    dataType,
    nullable: false,
    primaryKey,
    foreignKey,
    unique: false,
    defaultValue: null,
    comment
  });

  return {
    version: 1,
    schema: {
      tables: [
        table(
          "internal-orders-id",
          "orders",
          [
            modelColumn("internal-orders-pk", "id", { primaryKey: true }),
            modelColumn("internal-orders-user", "user_id", {
              foreignKey: true
            }),
            modelColumn("internal-orders-total", "total_amount")
          ],
          "고객 주문"
        ),
        table(
          "internal-payments-id",
          "payments",
          [
            modelColumn("internal-payments-pk", "id", { primaryKey: true }),
            modelColumn("internal-payments-order", "order_id", {
              foreignKey: true
            }),
            modelColumn("internal-payments-status", "payment_status", {
              comment: "결제 상태"
            })
          ],
          "주문 결제"
        ),
        table(
          "internal-attempts-id",
          "payment_attempts",
          [
            modelColumn("internal-attempts-pk", "id", { primaryKey: true }),
            modelColumn("internal-attempts-payment", "payment_id", {
              foreignKey: true
            })
          ],
          "결제 시도"
        ),
        table(
          "internal-users-id",
          "users",
          [modelColumn("internal-users-pk", "id", { primaryKey: true })],
          "사용자"
        ),
        table(
          "internal-activity-logs-id",
          "activity_logs",
          [
            modelColumn("internal-activity-logs-pk", "id", {
              primaryKey: true,
              dataType: "uuid"
            }),
            modelColumn("internal-activity-logs-action", "action", {
              dataType: "activity_log_action",
              comment: "기능별 활동 유형"
            }),
            modelColumn("internal-activity-logs-target", "target_id", {
              dataType: "text"
            })
          ],
          "워크스페이스 활동 이력"
        )
      ],
      relations: [
        {
          id: "internal-order-payment-relation",
          kind: "foreign_key",
          fromTableId: "internal-payments-id",
          fromColumnIds: ["internal-payments-order"],
          toTableId: "internal-orders-id",
          toColumnIds: ["internal-orders-pk"],
          constraintName: "payments_order_fk"
        },
        {
          id: "internal-payment-attempt-relation",
          kind: "foreign_key",
          fromTableId: "internal-attempts-id",
          fromColumnIds: ["internal-attempts-payment"],
          toTableId: "internal-payments-id",
          toColumnIds: ["internal-payments-pk"],
          constraintName: "attempts_payment_fk"
        },
        {
          id: "internal-order-user-relation",
          kind: "foreign_key",
          fromTableId: "internal-orders-id",
          fromColumnIds: ["internal-orders-user"],
          toTableId: "internal-users-id",
          toColumnIds: ["internal-users-pk"],
          constraintName: "orders_user_fk"
        }
      ]
    }
  };
}

const focusProjection = buildSqlErdAgentSchemaProjection(
  focusModelJson(),
  "회의 기능",
  `CREATE TYPE activity_log_action AS ENUM (
    'workspace_created',
    'meeting_started',
    'meeting_ended',
    'meeting_report_completed'
  );`
);
assert.deepEqual(
  focusProjection.tables.map((table) => [table.ref, table.name]),
  [
    ["t1", "orders"],
    ["t2", "payments"],
    ["t3", "payment_attempts"],
    ["t4", "users"],
    ["t5", "activity_logs"]
  ]
);
assert.deepEqual(focusProjection.edges, [
  ["t2", "t1"],
  ["t3", "t2"],
  ["t1", "t4"]
]);
assert.equal(
  focusProjection.tables[1].columns.some(
    (column) => column.name === "payment_status"
  ),
  true
);
assert.deepEqual(
  focusProjection.tables[4].columns.find((column) => column.name === "action"),
  {
    name: "action",
    dataType: "activity_log_action",
    enumValues: [
      "workspace_created",
      "meeting_started",
      "meeting_ended",
      "meeting_report_completed"
    ],
    primaryKey: false,
    foreignKey: false,
    comment: "기능별 활동 유형"
  }
);
assert.equal(JSON.stringify(focusProjection).length <= 9_000, true);
assert.equal(JSON.stringify(focusProjection).includes("internal-payments-id"), false);
assert.equal(JSON.stringify(focusProjection).includes("internal-payments-pk"), false);

const quotedEnumModel = structuredClone(focusModelJson());
quotedEnumModel.schema.tables[4].columns[1].dataType = '"Activity Type"';
const quotedEnumProjection = buildSqlErdAgentSchemaProjection(
  quotedEnumModel,
  "회의 기능",
  `CREATE TYPE "Activity Type" AS ENUM ('Meeting  Started', 'O''Brien');
  -- CREATE TYPE "Activity Type" AS ENUM ('meeting_deleted');`
);
assert.deepEqual(
  quotedEnumProjection.tables[4].columns.find(
    (column) => column.name === "action"
  ).enumValues,
  ["Meeting  Started", "O'Brien"]
);

const boundedEvidenceModel = structuredClone(focusModelJson());
const boundedEvidenceTable = boundedEvidenceModel.schema.tables[4];
boundedEvidenceTable.name = `activity_${"logs_".repeat(20)}`;
boundedEvidenceTable.comment = `  meeting   activity ${"history ".repeat(20)}`;
boundedEvidenceTable.columns[1].name = `action_${"kind_".repeat(20)}`;
boundedEvidenceTable.columns[1].comment = `  meeting   action ${"comment ".repeat(20)}`;
boundedEvidenceTable.columns[2].dataType = `  ${"custom_type_".repeat(20)}  `;
const longEnumValue = `meeting_${"started_".repeat(20)}`;
const boundedEvidenceSource = `CREATE TYPE activity_log_action AS ENUM ('${longEnumValue}');`;
const boundedEvidenceProjection = buildSqlErdAgentSchemaProjection(
  boundedEvidenceModel,
  "meeting activity",
  boundedEvidenceSource
);
const projectedEvidenceTable = boundedEvidenceProjection.tables[4];
const projectedActionColumn = projectedEvidenceTable.columns.find((column) =>
  column.name.startsWith("action_")
);
const projectedTargetColumn = projectedEvidenceTable.columns.find(
  (column) => column.name === "target_id"
);
const boundedEvidenceCases = [
  { kind: "table_name", value: projectedEvidenceTable.name },
  { kind: "table_comment", value: projectedEvidenceTable.comment },
  { kind: "column_name", value: projectedActionColumn.name },
  {
    kind: "column_comment",
    columnName: projectedActionColumn.name,
    value: projectedActionColumn.comment
  },
  {
    kind: "data_type",
    columnName: projectedTargetColumn.name,
    value: projectedTargetColumn.dataType
  },
  {
    kind: "enum_value",
    columnName: projectedActionColumn.name,
    value: projectedActionColumn.enumValues[0]
  }
];
for (const evidence of boundedEvidenceCases) {
  assert.deepEqual(
    partitionSqlErdAgentContextTableRefs(
      boundedEvidenceModel,
      boundedEvidenceSource,
      new Map([["t5", [evidence]]]),
      ["t5"]
    ),
    { acceptedRefs: ["t5"], ignoredTables: [] }
  );
}

const largeProjection = buildSqlErdAgentSchemaProjection(
  {
    version: 1,
    schema: {
      tables: Array.from({ length: 100 }, (_, index) => ({
        id: `internal-large-table-${index}`,
        name: `table_${index}_${"x".repeat(240)}`,
        schemaName: `schema_${"y".repeat(240)}`,
        columns: Array.from({ length: 10 }, (_column, columnIndex) => ({
          id: `internal-large-column-${index}-${columnIndex}`,
          name: `column_${columnIndex}_${"z".repeat(240)}`,
          dataType: "text",
          nullable: true,
          primaryKey: columnIndex === 0,
          foreignKey: false,
          unique: false,
          defaultValue: null,
          comment: "설명".repeat(1_000)
        })),
        constraints: [],
        comment: "테이블 설명".repeat(1_000)
      })),
      relations: Array.from({ length: 300 }, (_, index) => ({
        id: `internal-large-relation-${index}`,
        kind: "foreign_key",
        fromTableId: `internal-large-table-${index % 100}`,
        fromColumnIds: [],
        toTableId: `internal-large-table-${(index + 1) % 100}`,
        toColumnIds: [],
        constraintName: null
      }))
    }
  },
  "대형 기능"
);
assert.equal(JSON.stringify(largeProjection).length <= 9_000, true);
assert.equal(largeProjection.tables.length, 100);
assert.equal(largeProjection.truncated, true);

const resolvedFocus = resolveSqlErdAgentTableFocus(focusModelJson(), {
  primaryTableRefs: ["t2"],
  relatedTableRefs: ["t1", "t3"],
  contextTableRefs: ["t5"]
});
assert.deepEqual(resolvedFocus.primaryTableIds, ["internal-payments-id"]);
assert.deepEqual(resolvedFocus.relatedTableIds, [
  "internal-orders-id",
  "internal-attempts-id"
]);
assert.deepEqual(resolvedFocus.contextTableIds, ["internal-activity-logs-id"]);
assert.deepEqual(resolvedFocus.relationIds, [
  "internal-order-payment-relation",
  "internal-payment-attempt-relation"
]);
assert.deepEqual(
  resolvedFocus.tables.map((table) => [table.ref, table.name, table.role]),
  [
    ["t2", "payments", "primary"],
    ["t1", "orders", "related"],
    ["t3", "payment_attempts", "related"],
    ["t5", "activity_logs", "context"]
  ]
);

for (const invalidSelection of [
  { primaryTableRefs: [], relatedTableRefs: [], contextTableRefs: [] },
  {
    primaryTableRefs: ["t2", "t2"],
    relatedTableRefs: [],
    contextTableRefs: []
  },
  {
    primaryTableRefs: ["t2"],
    relatedTableRefs: ["t2"],
    contextTableRefs: []
  },
  {
    primaryTableRefs: ["t2"],
    relatedTableRefs: [],
    contextTableRefs: ["t2"]
  },
  {
    primaryTableRefs: ["t2"],
    relatedTableRefs: ["t3"],
    contextTableRefs: ["t3"]
  },
  { primaryTableRefs: ["t99"], relatedTableRefs: [], contextTableRefs: [] },
  {
    primaryTableRefs: ["t2"],
    relatedTableRefs: ["t4"],
    contextTableRefs: []
  }
]) {
  assert.throws(
    () => resolveSqlErdAgentTableFocus(focusModelJson(), invalidSelection),
    (error) =>
      /primary|related|context|reference|direct/i.test(
        error.getResponse().error.message
      )
  );
}

class FakeSqlErdService {
  constructor() {
    this.calls = [];
    this.session = sessionPayload();
    this.sessions = [this.session];
  }

  async getSession(currentUserId, workspaceId, sessionId) {
    this.calls.push({ method: "getSession", currentUserId, workspaceId, sessionId });
    if (this.session.id === sessionId) {
      return this.session;
    }
    return this.sessions.find((session) => session.id === sessionId) ?? this.session;
  }

  async listSessions(currentUserId, workspaceId, query) {
    this.calls.push({ method: "listSessions", currentUserId, workspaceId, query });
    return {
      items: this.sessions.map(
        ({
          id,
          workspaceId: itemWorkspaceId,
          title,
          sourceFormat,
          dialect,
          tableCount,
          relationCount,
          revision,
          createdBy,
          updatedBy,
          createdAt,
          updatedAt
        }) => ({
          id,
          workspaceId: itemWorkspaceId,
          title,
          sourceFormat,
          dialect,
          tableCount,
          relationCount,
          revision,
          createdBy,
          updatedBy,
          createdAt,
          updatedAt
        })
      ),
      nextCursor: null
    };
  }

  async createAgentGeneratedSession(
    currentUserId,
    workspaceId,
    agentRunId,
    input
  ) {
    this.calls.push({
      method: "createAgentGeneratedSession",
      currentUserId,
      workspaceId,
      agentRunId,
      input
    });
    return {
      session: this.session,
      warnings: [
        {
          code: "UNSUPPORTED_FEATURE",
          feature: "indexes",
          message: "인덱스는 생성 범위에서 제외되었습니다."
        }
      ]
    };
  }

  async replaceAgentGeneratedSchema(
    currentUserId,
    workspaceId,
    sessionId,
    agentRunId,
    input,
    expectedState
  ) {
    this.calls.push({
      method: "replaceAgentGeneratedSchema",
      currentUserId,
      workspaceId,
      sessionId,
      agentRunId,
      input,
      expectedState
    });
    this.session = sessionPayload({ revision: 2, latestOpSeq: 1 });
    return {
      warnings: [],
      revision: 2,
      latestOpSeq: 1
    };
  }
}

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID,
  requestContext: null
};
const sqlErdService = new FakeSqlErdService();
const adapter = new SqlErdAgentToolsService(sqlErdService);
const [definition] = adapter.listDefinitions();

assert.equal(definition.name, "generate_sql_erd");
assert.equal(definition.riskLevel, "medium");
assert.equal(definition.executionMode, "contextual");
assert.deepEqual(definition.inputSchema.required, [
  "version",
  "title",
  "requestedDialect",
  "tables",
  "relations",
  "unsupportedFeatures"
]);
assert.equal(definition.inputSchema.additionalProperties, false);
assert.equal(definition.inputSchema.$defs.keyConstraint.type, "object");
assert.deepEqual(
  definition.inputSchema.$defs.table.properties.primaryKey.oneOf,
  [{ $ref: "#/$defs/keyConstraint" }, { type: "null" }]
);

assert.deepEqual(definition.validateInput(schemaSpec()), schemaSpec());
assert.throws(
  () => definition.validateInput({ ddl: "DROP TABLE users" }),
  (error) => /schemaSpec|ddl/i.test(error.getResponse().error.message)
);
assert.throws(
  () => definition.validateInput({ ...schemaSpec(), workspaceId: WORKSPACE_ID }),
  (error) => /field|workspaceId/i.test(error.getResponse().error.message)
);

assert.deepEqual(
  await definition.prepareExecution(context, schemaSpec()),
  { kind: "execute" }
);

const contextualPreparation = await definition.prepareExecution(
  {
    ...context,
    requestContext: { surface: "sql_erd", sessionId: SESSION_ID }
  },
  schemaSpec()
);
assert.equal(contextualPreparation.kind, "confirmation");
assert.equal(contextualPreparation.plan.kind, "choice");
assert.equal(contextualPreparation.plan.toolName, "generate_sql_erd");
assert.deepEqual(
  contextualPreparation.plan.choices.map((choice) => choice.id),
  ["new_session", "replace_current"]
);
assert.equal(contextualPreparation.plan.call.currentSessionId, SESSION_ID);
assert.equal(contextualPreparation.plan.call.expectedSessionRevision, 1);
assert.equal(
  contextualPreparation.plan.call.expectedModelFingerprint,
  createSqlErdModelFingerprint({ version: 1 })
);

const snapshotSqlErdService = new FakeSqlErdService();
snapshotSqlErdService.session = sessionPayload({ writeProtocol: "snapshot" });
const [snapshotDefinition] = new SqlErdAgentToolsService(
  snapshotSqlErdService
).listDefinitions();
const snapshotPreparation = await snapshotDefinition.prepareExecution(
  {
    ...context,
    requestContext: { surface: "sql_erd", sessionId: SESSION_ID }
  },
  schemaSpec()
);
assert.equal(snapshotPreparation.kind, "confirmation");
assert.deepEqual(
  snapshotPreparation.plan.choices.map((choice) => choice.id),
  ["new_session"]
);
assert.throws(
  () =>
    snapshotDefinition.buildConfirmationInput(
      snapshotPreparation.plan,
      "replace_current"
    ),
  (error) => /choice/i.test(error.getResponse().error.message)
);

assert.deepEqual(
  definition.buildConfirmationInput(
    contextualPreparation.plan,
    "replace_current"
  ),
  {
    schemaSpec: schemaSpec(),
    currentSessionId: SESSION_ID,
    expectedSessionRevision: 1,
    expectedModelFingerprint: createSqlErdModelFingerprint({ version: 1 }),
    targetMode: "replace_current"
  }
);
const legacyReplacePlan = structuredClone(contextualPreparation.plan);
delete legacyReplacePlan.call.expectedSessionRevision;
delete legacyReplacePlan.call.expectedModelFingerprint;
assert.throws(
  () => definition.buildConfirmationInput(legacyReplacePlan, "replace_current"),
  (error) => /revision|fingerprint|stale/i.test(error.getResponse().error.message)
);
assert.throws(
  () =>
    definition.buildConfirmationInput(
      contextualPreparation.plan,
      "not-a-choice"
    ),
  (error) => /choice/i.test(error.getResponse().error.message)
);

const created = await definition.execute(context, schemaSpec());
assert.deepEqual(sqlErdService.calls.at(-1), {
  method: "createAgentGeneratedSession",
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  agentRunId: RUN_ID,
  input: schemaSpec()
});
assert.deepEqual(created.outputSummary, {
  action: "created",
  title: "주문 관리",
  dialect: "postgresql",
  tableCount: 1,
  relationCount: 0,
  warningCodes: ["UNSUPPORTED_FEATURE"]
});
assert.equal(JSON.stringify(created).includes("CREATE TABLE"), false);
assert.deepEqual(created.resourceRefs, [
  {
    domain: "sqltoerd",
    resourceType: "session",
    resourceId: SESSION_ID,
    label: "주문 관리",
    url: `/sql-erd/session?sessionId=${SESSION_ID}`,
    status: "created",
    metadata: {
      dialect: "postgresql",
      tableCount: 1,
      relationCount: 0
    }
  }
]);

const confirmedInput = definition.validateConfirmationInput(
  definition.buildConfirmationInput(
    contextualPreparation.plan,
    "replace_current"
  )
);
const replaced = await definition.execute(
  {
    ...context,
    requestContext: { surface: "sql_erd", sessionId: SESSION_ID }
  },
  confirmedInput
);
assert.deepEqual(
  sqlErdService.calls.find((call) => call.method === "replaceAgentGeneratedSchema"),
  {
    method: "replaceAgentGeneratedSchema",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
    agentRunId: RUN_ID,
    input: schemaSpec(),
    expectedState: {
      revision: 1,
      modelFingerprint: createSqlErdModelFingerprint({ version: 1 })
    }
  }
);
assert.equal(replaced.outputSummary.action, "replaced");
assert.equal(replaced.resourceRefs[0].resourceId, SESSION_ID);

const focusSqlErdService = new FakeSqlErdService();
focusSqlErdService.session = sessionPayload({
  sourceText: `CREATE TYPE activity_log_action AS ENUM (
    'workspace_created',
    'meeting_started',
    'meeting_ended',
    'meeting_report_completed'
  );`,
  modelJson: focusModelJson(),
  tableCount: 5,
  relationCount: 3,
  revision: 7
});
focusSqlErdService.sessions = [focusSqlErdService.session];
const focusAdapter = new SqlErdAgentToolsService(focusSqlErdService);
const focusDefinitions = focusAdapter.listDefinitions();
const inspectDefinition = focusDefinitions.find(
  (candidate) => candidate.name === "inspect_sql_erd_schema"
);
const focusDefinition = focusDefinitions.find(
  (candidate) => candidate.name === "focus_sql_erd_tables"
);

assert.ok(inspectDefinition);
assert.ok(focusDefinition);
assert.equal(inspectDefinition.riskLevel, "low");
assert.equal(inspectDefinition.executionMode, "contextual");
assert.equal(focusDefinition.riskLevel, "low");
assert.equal(focusDefinition.executionMode, "auto");
assert.deepEqual(inspectDefinition.inputSchema.required, ["featureQuery"]);
assert.equal(inspectDefinition.inputSchema.additionalProperties, false);
assert.deepEqual(focusDefinition.inputSchema.required, [
  "sessionId",
  "sessionRevision",
  "modelFingerprint",
  "featureLabel",
  "primaryTableRefs",
  "relatedTableRefs",
  "contextTableRefs",
  "confidence",
  "reasons"
]);
const focusEvidenceSchema =
  focusDefinition.inputSchema.properties.reasons.items.properties.evidence.items;
assert.deepEqual(
  focusEvidenceSchema.oneOf.map((candidate) => ({
    kinds: candidate.properties.kind.enum,
    required: candidate.required
  })),
  [
    {
      kinds: ["table_name", "table_comment", "column_name"],
      required: ["kind", "value"]
    },
    {
      kinds: ["column_comment", "data_type", "enum_value"],
      required: ["kind", "columnName", "value"]
    }
  ]
);

const inspectInput = inspectDefinition.validateInput({
  featureQuery: "결제 기능"
});
assert.deepEqual(await inspectDefinition.prepareExecution(context, inspectInput), {
  kind: "execute"
});
const inspected = await inspectDefinition.execute(context, inspectInput);
assert.equal(inspected.outputSummary.sessionId, SESSION_ID);
assert.equal(inspected.outputSummary.sessionRevision, 7);
assert.equal(
  inspected.outputSummary.modelFingerprint,
  createSqlErdModelFingerprint(focusModelJson())
);
assert.equal(inspected.outputSummary.title, focusSqlErdService.session.title);
assert.equal(inspected.outputSummary.projection.tables.length, 5);
assert.deepEqual(
  inspected.outputSummary.projection.tables[4].columns.find(
    (column) => column.name === "action"
  ).enumValues,
  [
    "workspace_created",
    "meeting_started",
    "meeting_ended",
    "meeting_report_completed"
  ]
);
assert.equal(JSON.stringify(inspected.outputSummary).includes("CREATE TABLE"), false);
assert.equal(JSON.stringify(inspected.outputSummary).includes("internal-payments-id"), false);
assert.deepEqual(inspected.resourceRefs, []);

const secondSessionId = "55555555-5555-4555-8555-555555555555";
const multipleSqlErdService = new FakeSqlErdService();
multipleSqlErdService.sessions = [
  sessionPayload({
    id: SESSION_ID,
    title: "  주문\n\tERD\u0000 ",
    updatedAt: "2026-07-16T00:00:00.000Z",
    modelJson: focusModelJson(),
    tableCount: 4,
    relationCount: 3
  }),
  sessionPayload({
    id: secondSessionId,
    title: "결제 ERD",
    updatedAt: "2026-07-17T00:00:00.000Z",
    modelJson: focusModelJson(),
    tableCount: 4,
    relationCount: 3
  })
];
const multipleAdapter = new SqlErdAgentToolsService(multipleSqlErdService);
const multipleInspect = multipleAdapter
  .listDefinitions()
  .find((candidate) => candidate.name === "inspect_sql_erd_schema");
const ambiguousPreparation = await multipleInspect.prepareExecution(
  context,
  multipleInspect.validateInput({ featureQuery: "결제 기능" })
);
assert.equal(ambiguousPreparation.kind, "needs_clarification");
assert.equal(ambiguousPreparation.outputSummary.reason, "multiple_sessions");
assert.match(
  ambiguousPreparation.outputSummary.question,
  /1\. 주문 ERD · 수정 2026-07-16T00:00:00\.000Z · 테이블 4개 · 관계 3개/
);
assert.match(
  ambiguousPreparation.outputSummary.question,
  /2\. 결제 ERD · 수정 2026-07-17T00:00:00\.000Z · 테이블 4개 · 관계 3개/
);
assert.deepEqual(
  ambiguousPreparation.outputSummary.candidates.map((candidate) => ({
    title: candidate.title,
    updatedAt: candidate.updatedAt,
    tableCount: candidate.tableCount
  })),
  [
    {
      title: "주문 ERD",
      updatedAt: "2026-07-16T00:00:00.000Z",
      tableCount: 4
    },
    {
      title: "결제 ERD",
      updatedAt: "2026-07-17T00:00:00.000Z",
      tableCount: 4
    }
  ]
);
assert.equal(ambiguousPreparation.resourceRefs.length, 0);
assert.deepEqual(
  ambiguousPreparation.candidateResources.map(({ reference, candidate }) => ({
    reference,
    label: candidate.label
  })),
  [
    {
      reference: {
        domain: "sqltoerd",
        resourceType: "session",
        resourceId: SESSION_ID
      },
      label: "주문 ERD"
    },
    {
      reference: {
        domain: "sqltoerd",
        resourceType: "session",
        resourceId: secondSessionId
      },
      label: "결제 ERD"
    }
  ]
);
assert.equal(
  JSON.stringify(ambiguousPreparation.outputSummary).includes(SESSION_ID),
  false
);

assert.deepEqual(
  await multipleInspect.prepareExecution(
    context,
    multipleInspect.validateInput({
      featureQuery: "결제 기능",
      sessionTitle: "결제 ERD"
    })
  ),
  { kind: "execute" }
);
const titledInspection = await multipleInspect.execute(
  context,
  multipleInspect.validateInput({
    featureQuery: "결제 기능",
    sessionTitle: "결제 ERD"
  })
);
assert.equal(titledInspection.outputSummary.sessionId, secondSessionId);

multipleSqlErdService.sessions = multipleSqlErdService.sessions.map((session) => ({
  ...session,
  title: "Untitled ERD"
}));
const duplicateTitlePreparation = await multipleInspect.prepareExecution(
  context,
  multipleInspect.validateInput({ featureQuery: "payment feature" })
);
assert.equal(duplicateTitlePreparation.kind, "needs_clarification");
assert.deepEqual(
  duplicateTitlePreparation.candidateResources.map(
    ({ reference }) => reference.resourceId
  ),
  [SESSION_ID, secondSessionId]
);
assert.deepEqual(
  await multipleInspect.prepareExecution(
    context,
    multipleInspect.validateInput({
      featureQuery: "payment feature",
      sessionSelectionToken: secondSessionId
    })
  ),
  { kind: "execute" }
);
const tokenSelectedInspection = await multipleInspect.execute(
  context,
  multipleInspect.validateInput({
    featureQuery: "payment feature",
    sessionSelectionToken: secondSessionId
  })
);
assert.equal(tokenSelectedInspection.outputSummary.sessionId, secondSessionId);

const manySqlErdService = new FakeSqlErdService();
manySqlErdService.sessions = Array.from({ length: 6 }, (_, index) =>
  sessionPayload({
    id: `55555555-5555-4555-8555-55555555555${index}`,
    title: `ERD ${index + 1}`,
    updatedAt: `2026-07-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
    modelJson: focusModelJson(),
    tableCount: 4,
    relationCount: 3
  })
);
const manyInspect = new SqlErdAgentToolsService(manySqlErdService)
  .listDefinitions()
  .find((candidate) => candidate.name === "inspect_sql_erd_schema");
const manyPreparation = await manyInspect.prepareExecution(
  context,
  manyInspect.validateInput({ featureQuery: "payment feature" })
);
assert.equal(manyPreparation.kind, "needs_clarification");
assert.equal(manyPreparation.outputSummary.candidates.length, 5);
assert.match(manyPreparation.outputSummary.question, /5\. ERD 5/);
assert.doesNotMatch(manyPreparation.outputSummary.question, /6\. ERD 6/);

const emptySqlErdService = new FakeSqlErdService();
emptySqlErdService.sessions = [];
const emptyInspect = new SqlErdAgentToolsService(emptySqlErdService)
  .listDefinitions()
  .find((candidate) => candidate.name === "inspect_sql_erd_schema");
const emptyPreparation = await emptyInspect.prepareExecution(
  context,
  emptyInspect.validateInput({ featureQuery: "결제 기능" })
);
assert.equal(emptyPreparation.kind, "needs_clarification");
assert.equal(emptyPreparation.outputSummary.reason, "no_sessions");

const focusInput = focusDefinition.validateInput({
  sessionId: SESSION_ID,
  sessionRevision: 7,
  modelFingerprint: inspected.outputSummary.modelFingerprint,
  featureLabel: "결제 기능",
  primaryTableRefs: ["t2"],
  relatedTableRefs: ["t1", "t3"],
  contextTableRefs: ["t5"],
  confidence: "medium",
  reasons: [
    { tableRef: "t2", reason: "결제 정보를 저장합니다." },
    { tableRef: "t1", reason: "결제 대상 주문입니다." },
    { tableRef: "t3", reason: "결제 시도 이력입니다." },
    {
      tableRef: "t5",
      reason: "회의 활동 이력을 기록합니다.",
      evidence: [
        {
          kind: "enum_value",
          columnName: "action",
          value: "meeting_started"
        }
      ]
    }
  ]
});
assert.throws(
  () =>
    focusDefinition.validateInput({
      ...focusInput,
      modelFingerprint: "fnv1a32:not-valid"
    }),
  (error) =>
    /modelFingerprint is invalid/.test(error.getResponse().error.message)
);
const focused = await focusDefinition.execute(context, focusInput);
assert.equal(focused.outputSummary.action, "focused");
assert.deepEqual(
  focused.outputSummary.primaryTables.map((table) => table.name),
  ["payments"]
);
assert.deepEqual(
  focused.outputSummary.relatedTables.map((table) => table.name),
  ["orders", "payment_attempts"]
);
assert.deepEqual(
  focused.outputSummary.contextTables.map((table) => table.name),
  ["activity_logs"]
);
assert.deepEqual(focused.outputSummary.ignoredContextTables, []);
assert.deepEqual(focused.resourceRefs, [
  {
    domain: "sqltoerd",
    resourceType: "session",
    resourceId: SESSION_ID,
    label: focusSqlErdService.session.title,
    url: `/sql-erd/session?sessionId=${SESSION_ID}`,
    status: "focused",
    metadata: {
      version: 1,
      view: "table_focus",
      sessionRevision: 7,
      modelFingerprint: createSqlErdModelFingerprint(focusModelJson()),
      featureLabel: "결제 기능",
      primaryTableIds: ["internal-payments-id"],
      relatedTableIds: ["internal-orders-id", "internal-attempts-id"],
      contextTableIds: ["internal-activity-logs-id"],
      relationIds: [
        "internal-order-payment-relation",
        "internal-payment-attempt-relation"
      ],
      confidence: "medium"
    }
  }
]);
assert.equal(JSON.stringify(focused).includes("CREATE TABLE"), false);
assert.equal(JSON.stringify(focused).includes('"modelJson"'), false);

const focusWithUnverifiedContext = await focusDefinition.execute(
  context,
  focusDefinition.validateInput({
    ...focusInput,
    reasons: focusInput.reasons.map((reason) =>
      reason.tableRef === "t5"
        ? {
            ...reason,
            evidence: [
              {
                kind: "enum_value",
                columnName: "action",
                value: "meeting_deleted"
              }
            ]
          }
        : reason
    )
  })
);
assert.deepEqual(focusWithUnverifiedContext.outputSummary.contextTables, []);
assert.deepEqual(focusWithUnverifiedContext.outputSummary.ignoredContextTables, [
  {
    name: "activity_logs",
    reason: "schema_evidence_not_found"
  }
]);
assert.deepEqual(
  focusWithUnverifiedContext.resourceRefs[0].metadata.contextTableIds,
  []
);

focusSqlErdService.session = sessionPayload({
  ...focusSqlErdService.session,
  revision: 8
});
focusSqlErdService.sessions = [focusSqlErdService.session];
const focusedAfterLayoutRevision = await focusDefinition.execute(
  context,
  focusInput
);
assert.equal(focusedAfterLayoutRevision.outputSummary.sessionRevision, 8);
assert.equal(
  focusedAfterLayoutRevision.resourceRefs[0].metadata.modelFingerprint,
  focusInput.modelFingerprint
);

const changedFocusModelJson = structuredClone(focusModelJson());
changedFocusModelJson.schema.tables[0].name = "renamed_orders";
focusSqlErdService.session = sessionPayload({
  ...focusSqlErdService.session,
  modelJson: changedFocusModelJson,
  revision: 9
});
focusSqlErdService.sessions = [focusSqlErdService.session];
await assert.rejects(
  () => focusDefinition.execute(context, focusInput),
  (error) =>
    error.getStatus() === 409 &&
    /model changed; inspect/i.test(error.getResponse().error.message) &&
    !/revision/i.test(error.getResponse().error.message)
);

const registry = new AgentToolRegistryService(
  undefined,
  undefined,
  undefined,
  adapter
);
assert.equal(
  registry.getDefinition("generate_sql_erd").name,
  "generate_sql_erd"
);
assert.equal(
  new AgentToolRegistryService(
    undefined,
    undefined,
    undefined,
    focusAdapter
  ).getDefinition("focus_sql_erd_tables").name,
  "focus_sql_erd_tables"
);

const [agentApiContract, sqlErdApiContract] = await Promise.all([
  readFile(new URL("../../../../docs/api/agent-api.md", import.meta.url), "utf8"),
  readFile(new URL("../../../../docs/api/sqltoerd-api.md", import.meta.url), "utf8")
]);
const tableFocusImplementation = await readFile(
  new URL(
    "../../src/modules/agent/tools/sql-erd-table-focus.ts",
    import.meta.url
  ),
  "utf8"
);
assert.doesNotMatch(tableFocusImplementation, /activity_logs|meeting_started/);
for (const contract of [agentApiContract, sqlErdApiContract]) {
  assert.match(contract, /generate_sql_erd/);
  assert.match(contract, /inspect_sql_erd_schema/);
  assert.match(contract, /focus_sql_erd_tables/);
  assert.match(contract, /table_focus/);
  assert.match(contract, /primaryTableIds/);
  assert.match(contract, /relatedTableIds/);
  assert.match(contract, /contextTableRefs/);
  assert.match(contract, /contextTableIds/);
  assert.match(contract, /ignoredContextTables/);
  assert.match(contract, /schema evidence/i);
  assert.match(contract, /sessionRevision/);
  assert.match(contract, /sessionSelectionToken/);
  assert.match(contract, /modelFingerprint/);
  assert.match(contract, /SqlErdSchemaSpecV1/);
  assert.match(contract, /new_session/);
  assert.match(contract, /replace_current/);
  assert.match(contract, /`snapshot` session에서는 `new_session`만/);
  assert.match(
    contract,
    /`operations_v1` session에서는\s+`replace_current`도/
  );
  assert.match(contract, /ERD 및 DDL 열기/);
}
assert.match(agentApiContract, /executionMode=contextual|`contextual`/);
assert.match(sqlErdApiContract, /sourceText, DDL, modelJson, layoutJson/);

console.log("SQLtoERD Agent tool tests passed.");
