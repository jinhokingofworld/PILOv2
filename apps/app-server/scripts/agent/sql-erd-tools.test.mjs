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
    { primaryKey = false, foreignKey = false, comment = null } = {}
  ) => ({
    id,
    name,
    dataType: "bigint",
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
  "결제 기능"
);
assert.deepEqual(
  focusProjection.tables.map((table) => [table.ref, table.name]),
  [
    ["t1", "orders"],
    ["t2", "payments"],
    ["t3", "payment_attempts"],
    ["t4", "users"]
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
assert.equal(JSON.stringify(focusProjection).length <= 9_000, true);
assert.equal(JSON.stringify(focusProjection).includes("internal-payments-id"), false);
assert.equal(JSON.stringify(focusProjection).includes("internal-payments-pk"), false);

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
  relatedTableRefs: ["t1", "t3"]
});
assert.deepEqual(resolvedFocus.primaryTableIds, ["internal-payments-id"]);
assert.deepEqual(resolvedFocus.relatedTableIds, [
  "internal-orders-id",
  "internal-attempts-id"
]);
assert.deepEqual(resolvedFocus.relationIds, [
  "internal-order-payment-relation",
  "internal-payment-attempt-relation"
]);
assert.deepEqual(
  resolvedFocus.tables.map((table) => [table.ref, table.name, table.role]),
  [
    ["t2", "payments", "primary"],
    ["t1", "orders", "related"],
    ["t3", "payment_attempts", "related"]
  ]
);

for (const invalidSelection of [
  { primaryTableRefs: [], relatedTableRefs: [] },
  { primaryTableRefs: ["t2", "t2"], relatedTableRefs: [] },
  { primaryTableRefs: ["t2"], relatedTableRefs: ["t2"] },
  { primaryTableRefs: ["t99"], relatedTableRefs: [] },
  { primaryTableRefs: ["t2"], relatedTableRefs: ["t4"] }
]) {
  assert.throws(
    () => resolveSqlErdAgentTableFocus(focusModelJson(), invalidSelection),
    (error) =>
      /primary|related|reference|direct/i.test(
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
    input
  ) {
    this.calls.push({
      method: "replaceAgentGeneratedSchema",
      currentUserId,
      workspaceId,
      sessionId,
      agentRunId,
      input
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
    targetMode: "replace_current"
  }
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
    input: schemaSpec()
  }
);
assert.equal(replaced.outputSummary.action, "replaced");
assert.equal(replaced.resourceRefs[0].resourceId, SESSION_ID);

const focusSqlErdService = new FakeSqlErdService();
focusSqlErdService.session = sessionPayload({
  modelJson: focusModelJson(),
  tableCount: 4,
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
  "featureLabel",
  "primaryTableRefs",
  "relatedTableRefs",
  "confidence",
  "reasons"
]);

const inspectInput = inspectDefinition.validateInput({
  featureQuery: "결제 기능"
});
assert.deepEqual(await inspectDefinition.prepareExecution(context, inspectInput), {
  kind: "execute"
});
const inspected = await inspectDefinition.execute(context, inspectInput);
assert.equal(inspected.outputSummary.sessionId, SESSION_ID);
assert.equal(inspected.outputSummary.sessionRevision, 7);
assert.equal(inspected.outputSummary.title, focusSqlErdService.session.title);
assert.equal(inspected.outputSummary.projection.tables.length, 4);
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
assert.match(ambiguousPreparation.outputSummary.question, /1\. 주문 ERD/);
assert.match(ambiguousPreparation.outputSummary.question, /2\. 결제 ERD/);
assert.match(ambiguousPreparation.outputSummary.question, /2026-07-16/);
assert.match(ambiguousPreparation.outputSummary.question, /2026-07-17/);
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
assert.equal(ambiguousPreparation.resourceRefs.length, 2);

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
  duplicateTitlePreparation.outputSummary.candidates.map(
    (candidate) => candidate.selectionToken
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
  featureLabel: "결제 기능",
  primaryTableRefs: ["t2"],
  relatedTableRefs: ["t1", "t3"],
  confidence: "medium",
  reasons: [
    { tableRef: "t2", reason: "결제 정보를 저장합니다." },
    { tableRef: "t1", reason: "결제 대상 주문입니다." },
    { tableRef: "t3", reason: "결제 시도 이력입니다." }
  ]
});
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

focusSqlErdService.session = sessionPayload({
  ...focusSqlErdService.session,
  revision: 8
});
focusSqlErdService.sessions = [focusSqlErdService.session];
await assert.rejects(
  () => focusDefinition.execute(context, focusInput),
  (error) =>
    error.getStatus() === 409 &&
    /revision|inspect/i.test(error.getResponse().error.message)
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
for (const contract of [agentApiContract, sqlErdApiContract]) {
  assert.match(contract, /generate_sql_erd/);
  assert.match(contract, /inspect_sql_erd_schema/);
  assert.match(contract, /focus_sql_erd_tables/);
  assert.match(contract, /table_focus/);
  assert.match(contract, /primaryTableIds/);
  assert.match(contract, /relatedTableIds/);
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
