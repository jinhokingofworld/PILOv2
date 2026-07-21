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
const { buildAgentReadResultAnswer } = require(
  "../../dist/modules/agent/agent-read-result-formatter.js"
);
const { forbidden } = require("../../dist/common/api-error.js");
const {
  buildSqlErdAgentSchemaProjection,
  createSqlErdModelFingerprint,
  partitionSqlErdAgentContextTableRefs,
  resolveSqlErdAgentTableFocus
} = require("../../dist/modules/agent/tools/sql-erd-table-focus.js");
const {
  resolveDeterministicSqlErdTableFocus,
  validateLlmSqlErdTableFocus
} = require("../../dist/modules/agent/tools/sql-erd-table-focus-resolver.js");

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
const resolverFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/sql-erd-focus-resolver-v1.json", import.meta.url),
    "utf8"
  )
);
assert.equal(resolverFixture.version, "sql-erd-focus-resolver:v1");
for (const testCase of resolverFixture.cases) {
  const resolution = resolveDeterministicSqlErdTableFocus(
    focusProjection,
    testCase.featureQuery
  );
  assert.deepEqual(
    resolution && {
      primaryTableRefs: resolution.primaryTableRefs,
      relatedTableRefs: resolution.relatedTableRefs,
      source: resolution.source
    },
    testCase.expected,
    testCase.id
  );
}

const boundaryProjection = {
  version: 1,
  tables: [
    { ref: "t1", name: "user", columns: [] },
    { ref: "t2", name: "users", columns: [] },
    { ref: "t3", name: "log", columns: [] },
    { ref: "t4", name: "catalog", columns: [] }
  ],
  edges: [],
  truncated: false
};
assert.deepEqual(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "users 테이블만 보여줘"
  )?.primaryTableRefs,
  ["t2"],
  "an exact plural table name must not also select its singular neighbor"
);
assert.deepEqual(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "catalog 테이블만 보여줘"
  )?.primaryTableRefs,
  ["t4"],
  "a table name inside another word must not count as an exact match"
);
assert.deepEqual(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "user와 users 테이블을 함께 보여줘"
  ),
  null,
  "multi-table requests must use the LLM resolver instead of assuming positive intent"
);
assert.equal(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "users 말고 orders만 보여줘"
  ),
  null,
  "exclusion intent must bypass deterministic matching instead of selecting the excluded table"
);
assert.equal(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "show orders, not users"
  ),
  null,
  "English negation must use the LLM resolver"
);
assert.equal(
  resolveDeterministicSqlErdTableFocus(
    boundaryProjection,
    "users table이 아니라 orders table만 보여줘"
  ),
  null,
  "Korean contrastive negation must use the LLM resolver"
);

const schemaCollisionProjection = {
  version: 1,
  tables: [
    { ref: "t1", name: "users", schemaName: "public", columns: [] },
    { ref: "t2", name: "users", schemaName: "auth", columns: [] }
  ],
  edges: [],
  truncatedTableRefs: [],
  truncated: false
};
assert.equal(
  resolveDeterministicSqlErdTableFocus(
    schemaCollisionProjection,
    "users 테이블만 보여줘"
  ),
  null,
  "an unqualified duplicate table name must remain ambiguous"
);
assert.deepEqual(
  resolveDeterministicSqlErdTableFocus(
    schemaCollisionProjection,
    "auth.users 테이블만 보여줘"
  )?.primaryTableRefs,
  ["t2"],
  "a schema-qualified table name may be resolved deterministically"
);

const primaryLimitProjection = {
  tables: Array.from({ length: 31 }, (_, index) => ({
    ref: `t${index + 1}`,
    name: `table_${index + 1}`,
    columns: []
  })),
  edges: [],
  truncatedTableRefs: [],
  truncated: false
};
const thirtyPrimaryRefs = primaryLimitProjection.tables
  .slice(0, 30)
  .map((table) => table.ref);
const thirtyPrimaryResolution = validateLlmSqlErdTableFocus(
  primaryLimitProjection,
  "업무 테이블",
  {
    status: "focused",
    featureLabel: "업무",
    primaryTableRefs: thirtyPrimaryRefs,
    confidence: "medium",
    question: null
  }
);
assert.equal(
  thirtyPrimaryResolution.kind,
  "focused",
  "the resolver may select up to 30 primary tables"
);
assert.deepEqual(
  thirtyPrimaryResolution.primaryTableRefs,
  thirtyPrimaryRefs,
  "the resolver must preserve all 30 accepted primary refs"
);
assert.equal(
  validateLlmSqlErdTableFocus(primaryLimitProjection, "업무 테이블", {
    status: "focused",
    featureLabel: "업무",
    primaryTableRefs: primaryLimitProjection.tables.map((table) => table.ref),
    confidence: "medium",
    question: null
  }).reason,
  "invalid_resolver_result",
  "more than 30 primary refs must be rejected instead of truncated"
);
assert.equal(
  validateLlmSqlErdTableFocus(primaryLimitProjection, "업무 테이블", {
    status: "focused",
    featureLabel: "업무",
    primaryTableRefs: ["t1", 2],
    confidence: "medium",
    question: null
  }).reason,
  "invalid_resolver_result",
  "a mixed-type primary ref array must be rejected instead of filtered"
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

const largeFocusModelJson = {
  version: 1,
  schema: {
    tables: Array.from({ length: 100 }, (_, index) => ({
      id: `internal-large-table-${index}`,
      name:
        index === 0
          ? "organization_membership_invitations"
          : index === 1
            ? "organization_membership_roles"
            : `table_${index}_${"x".repeat(240)}`,
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
};
const largeProjection = buildSqlErdAgentSchemaProjection(
  largeFocusModelJson,
  "대형 기능"
);
assert.equal(JSON.stringify(largeProjection).length <= 9_000, true);
assert.equal(largeProjection.tables.length, 100);
assert.equal(largeProjection.truncated, true);
assert.equal(largeProjection.tables[0].name, largeProjection.tables[1].name);
assert.deepEqual(largeProjection.truncatedTableRefs.slice(0, 2), ["t1", "t2"]);
assert.equal(
  resolveDeterministicSqlErdTableFocus(
    largeProjection,
    "organization_membership_invitations 테이블만 보여줘"
  ),
  null,
  "truncated table names must not become deterministic exact matches"
);

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
const focusResolverObservations = [];
const focusLatencyObserver = {
  start() {
    return performance.now();
  },
  observe(input) {
    focusResolverObservations.push(input);
  }
};
const focusAdapter = new SqlErdAgentToolsService(
  focusSqlErdService,
  focusLatencyObserver
);
const focusDefinitions = focusAdapter.listDefinitions();
const inspectDefinition = focusDefinitions.find(
  (candidate) => candidate.name === "inspect_sql_erd_schema"
);
const focusDefinition = focusDefinitions.find(
  (candidate) => candidate.name === "focus_sql_erd_tables"
);

assert.equal(inspectDefinition, undefined);
assert.ok(focusDefinition);
assert.equal(focusDefinition.riskLevel, "low");
assert.equal(focusDefinition.executionMode, "auto");
assert.deepEqual(focusDefinition.inputSchema.required, ["featureQuery"]);
assert.equal(focusDefinition.inputSchema.additionalProperties, false);
const focusInput = focusDefinition.validateInput({
  featureQuery: "payments 테이블만 집중적으로 보여줘"
});
assert.deepEqual(focusInput, {
  featureQuery: "payments 테이블만 집중적으로 보여줘"
});
assert.throws(
  () =>
    focusDefinition.validateInput({
      featureQuery: "payments",
      sessionId: SESSION_ID
    }),
  (error) => /sessionId/i.test(error.getResponse().error.message)
);
await assert.rejects(
  () => focusDefinition.execute(context, focusInput),
  (error) => /session context/i.test(error.getResponse().error.message)
);

const focusContext = {
  ...context,
  requestContext: { surface: "sql_erd", sessionId: SESSION_ID }
};
const focused = await focusDefinition.execute(focusContext, focusInput);
assert.equal(focused.outputSummary.action, "focused");
assert.deepEqual(
  focused.outputSummary.primaryTables.map((table) => table.name),
  ["payments"]
);
assert.deepEqual(
  focused.outputSummary.relatedTables.map((table) => table.name),
  ["orders", "payment_attempts"]
);
assert.deepEqual(focused.outputSummary.contextTables, []);
assert.deepEqual(focused.outputSummary.ignoredContextTables, []);
assert.deepEqual(focused.resourceRefs[0].metadata, {
  version: 1,
  view: "table_focus",
  sessionRevision: 7,
  modelFingerprint: createSqlErdModelFingerprint(focusModelJson()),
  featureLabel: "payments 테이블만 집중적으로 보여줘",
  primaryTableIds: ["internal-payments-id"],
  relatedTableIds: ["internal-orders-id", "internal-attempts-id"],
  contextTableIds: [],
  relationIds: [
    "internal-order-payment-relation",
    "internal-payment-attempt-relation"
  ],
  confidence: "high"
});
assert.equal(
  focusSqlErdService.calls.filter((call) => call.method === "getSession").length,
  2
);
assert.equal(JSON.stringify(focused).includes("CREATE TABLE"), false);
assert.equal(JSON.stringify(focused).includes('"modelJson"'), false);

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalFocusTimeout = process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS;
delete process.env.OPENAI_API_KEY;
const observationsBeforeMissingKey = focusResolverObservations.length;
const missingKeyResult = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "회의 관련 테이블" })
);
assert.equal(missingKeyResult.outputSummary.reason, "resolver_unavailable");
assert.equal(focusResolverObservations.length, observationsBeforeMissingKey);
process.env.OPENAI_API_KEY = "test-key";
let capturedResolverBody;
globalThis.fetch = async (_url, init) => {
  capturedResolverBody = JSON.parse(init.body);
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        status: "focused",
        featureLabel: "회의",
        primaryTableRefs: ["t5"],
        confidence: "medium",
        question: null
      })
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
const llmFocused = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "회의 관련 테이블" })
);
assert.deepEqual(
  llmFocused.outputSummary.primaryTables.map((table) => table.name),
  ["activity_logs"]
);
assert.deepEqual(llmFocused.outputSummary.relatedTables, []);
assert.equal(capturedResolverBody.model, "gpt-5.4-mini");
const resolverOutputProperties =
  capturedResolverBody.text.format.schema.properties;
assert.deepEqual(resolverOutputProperties.primaryTableRefs.items, {
  type: "string"
});
for (const unsupportedKeyword of [
  "pattern",
  "uniqueItems",
  "maxItems",
  "maxLength"
]) {
  assert.equal(
    JSON.stringify(capturedResolverBody.text.format.schema).includes(
      `"${unsupportedKeyword}"`
    ),
    false,
    `provider schema must not include ${unsupportedKeyword}`
  );
}
assert.equal(capturedResolverBody.input[1].content.includes(SESSION_ID), false);
assert.equal(
  capturedResolverBody.input[1].content.includes("internal-payments-id"),
  false
);
assert.equal(capturedResolverBody.input[1].content.includes("CREATE TYPE"), false);
assert.equal(focusResolverObservations.at(-1).stage, "focus_resolver");
assert.equal(focusResolverObservations.at(-1).outcome, "success");

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        status: "focused",
        featureLabel: "orders",
        primaryTableRefs: ["t1"],
        confidence: "medium",
        question: null
      })
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
const exclusionFocused = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({
    featureQuery: "users 말고 orders만 보여줘"
  })
);
assert.deepEqual(
  exclusionFocused.outputSummary.primaryTables.map((table) => table.name),
  ["orders"]
);

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        status: "needs_clarification",
        featureLabel: null,
        primaryTableRefs: [],
        confidence: "low",
        question: "학생 기능의 기준 테이블 이름을 알려주세요."
      })
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
const clarification = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "학생 관련 테이블" })
);
assert.equal(clarification.outputSummary.action, "needs_clarification");
assert.equal(clarification.outputSummary.reason, "ambiguous_schema_match");
assert.match(clarification.outputSummary.question, /테이블 이름/);
assert.deepEqual(clarification.resourceRefs, []);
assert.match(
  buildAgentReadResultAnswer({
    toolName: "focus_sql_erd_tables",
    outputSummary: clarification.outputSummary,
    resourceRefs: []
  }),
  /학생 기능의 기준 테이블 이름/
);

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        status: "focused",
        featureLabel: "알 수 없는 기능",
        primaryTableRefs: ["t99"],
        confidence: "high",
        question: null
      })
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
const invalidProviderResult = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "알 수 없는 기능" })
);
assert.equal(
  invalidProviderResult.outputSummary.reason,
  "invalid_resolver_result"
);
assert.deepEqual(invalidProviderResult.resourceRefs, []);
assert.equal(
  focusResolverObservations.at(-1).failureDetail,
  "validation_error"
);

globalThis.fetch = async () => new Response("rate limited", { status: 429 });
const httpFailure = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "결제 운영 기능" })
);
assert.equal(httpFailure.outputSummary.reason, "resolver_unavailable");
assert.equal(focusResolverObservations.at(-1).failureDetail, "http_error");
assert.equal(focusResolverObservations.at(-1).httpStatus, 429);

globalThis.fetch = async () =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
const emptyOutputFailure = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "결제 분석 기능" })
);
assert.equal(emptyOutputFailure.outputSummary.reason, "resolver_unavailable");
assert.equal(focusResolverObservations.at(-1).failureDetail, "empty_output");

globalThis.fetch = async () =>
  new Response(JSON.stringify({ output_text: "not-json" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
const jsonFailure = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "결제 정산 기능" })
);
assert.equal(jsonFailure.outputSummary.reason, "resolver_unavailable");
assert.equal(focusResolverObservations.at(-1).failureDetail, "json_parse_error");

process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS = "1";
globalThis.fetch = async (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), {
      once: true
    });
  });
const timeoutFailure = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "결제 승인 기능" })
);
assert.equal(timeoutFailure.outputSummary.reason, "resolver_unavailable");
assert.equal(focusResolverObservations.at(-1).failureDetail, "timeout");
delete process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS;

globalThis.fetch = async () => {
  throw new Error("provider unavailable");
};
const providerFailure = await focusDefinition.execute(
  focusContext,
  focusDefinition.validateInput({ featureQuery: "알 수 없는 업무 기능" })
);
assert.equal(providerFailure.outputSummary.reason, "resolver_unavailable");
assert.deepEqual(providerFailure.resourceRefs, []);
assert.equal(focusResolverObservations.at(-1).failureDetail, "network_error");

const staleService = new FakeSqlErdService();
const stableSession = sessionPayload({
  modelJson: focusModelJson(),
  tableCount: 5,
  relationCount: 3,
  revision: 7
});
const changedModel = structuredClone(focusModelJson());
changedModel.schema.tables[0].name = "renamed_orders";
let staleReadCount = 0;
staleService.getSession = async () => {
  staleReadCount += 1;
  return staleReadCount === 1
    ? stableSession
    : sessionPayload({
        ...stableSession,
        modelJson: changedModel,
        revision: 8
      });
};
const staleFocusDefinition = new SqlErdAgentToolsService(staleService)
  .listDefinitions()
  .find((candidate) => candidate.name === "focus_sql_erd_tables");
const staleResult = await staleFocusDefinition.execute(
  focusContext,
  staleFocusDefinition.validateInput({ featureQuery: "payments" })
);
assert.equal(staleResult.outputSummary.action, "needs_clarification");
assert.equal(staleResult.outputSummary.reason, "schema_changed");
assert.deepEqual(staleResult.resourceRefs, []);

const staleEvidenceService = new FakeSqlErdService();
const evidenceSourceBefore = `CREATE TYPE activity_log_action AS ENUM (
  'meeting_started'
);`;
const evidenceSourceAfter = `CREATE TYPE activity_log_action AS ENUM (
  'meeting_cancelled'
);`;
let staleEvidenceReadCount = 0;
staleEvidenceService.getSession = async () => {
  staleEvidenceReadCount += 1;
  return sessionPayload({
    ...stableSession,
    sourceText:
      staleEvidenceReadCount === 1 ? evidenceSourceBefore : evidenceSourceAfter
  });
};
const staleEvidenceFocusDefinition = new SqlErdAgentToolsService(
  staleEvidenceService
)
  .listDefinitions()
  .find((candidate) => candidate.name === "focus_sql_erd_tables");
const staleEvidenceResult = await staleEvidenceFocusDefinition.execute(
  focusContext,
  staleEvidenceFocusDefinition.validateInput({ featureQuery: "payments" })
);
assert.equal(staleEvidenceResult.outputSummary.action, "needs_clarification");
assert.equal(staleEvidenceResult.outputSummary.reason, "schema_changed");
assert.deepEqual(staleEvidenceResult.resourceRefs, []);

for (const revokedRead of [1, 2]) {
  const revokedService = new FakeSqlErdService();
  let readCount = 0;
  revokedService.getSession = async () => {
    readCount += 1;
    if (readCount === revokedRead) {
      throw forbidden("Workspace access denied");
    }
    return stableSession;
  };
  const revokedDefinition = new SqlErdAgentToolsService(revokedService)
    .listDefinitions()
    .find((candidate) => candidate.name === "focus_sql_erd_tables");
  const revokedResult = await revokedDefinition.execute(
    focusContext,
    revokedDefinition.validateInput({ featureQuery: "payments" })
  );
  assert.equal(revokedResult.outputSummary.action, "needs_clarification");
  assert.equal(revokedResult.outputSummary.reason, "session_unavailable");
  assert.doesNotMatch(
    revokedResult.outputSummary.question,
    /forbidden|permission|workspace|session|403|404/i
  );
  assert.deepEqual(revokedResult.resourceRefs, []);
}

globalThis.fetch = originalFetch;
if (originalApiKey === undefined) {
  delete process.env.OPENAI_API_KEY;
} else {
  process.env.OPENAI_API_KEY = originalApiKey;
}
if (originalFocusTimeout === undefined) {
  delete process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS;
} else {
  process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS = originalFocusTimeout;
}

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
  assert.match(contract, /focus_sql_erd_tables/);
  assert.match(contract, /table_focus/);
  assert.match(contract, /primaryTableIds/);
  assert.match(contract, /relatedTableIds/);
  assert.match(contract, /contextTableIds/);
  assert.match(contract, /featureQuery/);
  assert.match(contract, /혼합 resolver/);
  assert.match(contract, /sessionRevision/);
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
assert.doesNotMatch(agentApiContract, /\| `inspect_sql_erd_schema` \|/);
assert.match(sqlErdApiContract, /hard cutover로 제거/);
assert.match(agentApiContract, /executionMode=contextual|`contextual`/);
assert.match(sqlErdApiContract, /sourceText, DDL, modelJson, layoutJson/);

console.log("SQLtoERD Agent tool tests passed.");
