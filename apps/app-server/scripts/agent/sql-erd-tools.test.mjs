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

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

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

class FakeSqlErdService {
  constructor() {
    this.calls = [];
    this.session = sessionPayload();
  }

  async getSession(currentUserId, workspaceId, sessionId) {
    this.calls.push({ method: "getSession", currentUserId, workspaceId, sessionId });
    return this.session;
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

const [agentApiContract, sqlErdApiContract] = await Promise.all([
  readFile(new URL("../../../../docs/api/agent-api.md", import.meta.url), "utf8"),
  readFile(new URL("../../../../docs/api/sqltoerd-api.md", import.meta.url), "utf8")
]);
for (const contract of [agentApiContract, sqlErdApiContract]) {
  assert.match(contract, /generate_sql_erd/);
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
